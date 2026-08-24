import "server-only";
import { prisma } from "./db";
import { COLNECT_CONDITIONS } from "./colnect-conditions";
import { parseColnectCatalogCodes } from "./colnect-list-rules";
import { matchColnectItems } from "./colnect";
import { createWantsForStamps } from "./wants";
import {
  getColnectReportCounts,
  listColnectReportRows,
  type ColnectReportFilters,
  type ColnectReportRow,
} from "./colnect-list-report";
import {
  type ColnectListSource,
  type ColnectListSourceOfTruth,
} from "./colnect-list-sync-rules";

// **Adopting a Colnect wish list into wants** (#688).
//
// The Wish list read on 2026-08-22 held **25,145 entries**, built up over years of clicking *I want
// this* on Colnect, against a `Want` list a fraction of the size. Mapped like the other three it
// would open with a report proposing to delete twenty-five thousand rows — formally the correct
// reading of the diff, and the opposite of what the collector wants. That is why the Wish mapping
// carries `sourceOfTruth = colnect` (#684), and this is how Stamporama catches up.
//
// **In capped passes.** One call adopts at most {@link COLNECT_ADOPT_PASS_SIZE} rows, in the
// report's own order, and says how much of the bucket that was. Twenty-five thousand rows cannot be
// walked one at a time, and they cannot be swept in one request either: the resolution below is
// minutes of work at that scale, and a request that long is lost whole by a reload. A pass is
// bounded, repeatable, and resumable by construction — an adopted row leaves the bucket, so the
// next pass starts where the last one stopped without anything having to remember where that was.
//
// **A row resolves through the Assistant's own matrix, never a second matcher.** `Stamp.colnectId`
// first (#247), which the report has already looked up; otherwise `matchColnectItems` in
// **`dryRun`** (#250). The dry run is the point: adopting a wish list must not silently write
// thousands of Colnect ids onto the collection, because learning an id is a deliberate act against
// a page the collector is looking at. Only an `auto` result counts — a `needs-confirm` is a
// question, and answering it in bulk is the very thing #250 refused to do.
//
// **A row that resolves to no stamp is an outcome, not an error.** It is counted as unadoptable and
// stays on the report. On a list this size that set will be large, and it is the honest output.
//
// **Nothing is written until the collector has seen what will be.** {@link previewColnectAdoption}
// is the same resolution without the write, and the dialog renders it first.

/**
 * How many rows one pass looks at.
 *
 * Sized against the expensive half: rows resolving by `Stamp.colnectId` cost one lookup the report
 * already did, but the rest go through the matcher's candidate discovery, which is where the seconds
 * are. Five hundred keeps a pass inside an ordinary request while still being bulk — fifty passes
 * for the whole of Wish, rather than twenty-five thousand clicks.
 */
export const COLNECT_ADOPT_PASS_SIZE = 500;

/** Raised when an adopt names a list that does not admit one. Every one is a stale tab: the button
 *  appears only on a list whose Colnect side wins and whose predicate is wants. */
export class ColnectAdoptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColnectAdoptError";
  }
}

/** What a pass would do, or did. The same shape either way, because the preview *is* the run
 *  without the write — a preview computed differently from what follows it is not a preview. */
export interface ColnectAdoptPass {
  /** The whole **Extra on Colnect** bucket under these filters, so the dialog can say how far along
   *  a pass gets. */
  bucketRows: number;
  /** How many rows this pass looked at — at most {@link COLNECT_ADOPT_PASS_SIZE}. */
  passRows: number;
  /** Rows that resolve to a stamp with no open want: what a run writes. */
  adoptable: number;
  /** Rows resolving to no stamp here. Reported, and left on the report. */
  unresolved: number;
  /** Rows whose stamp already carries an open want. Nothing to do, and not a failure. */
  alreadyWanted: number;
  /** Of the adoptable, how many carry a grade this collection can read (#404). The rest take no
   *  condition rather than a guessed one. */
  withCondition: number;
  /** Written by this call — always 0 from a preview. */
  created: number;
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/**
 * The list this adopt is against, refusing every one that does not admit it.
 *
 * Two conditions, and both are about meaning rather than safety: a list whose **local** side wins is
 * one where an item only on Colnect is proposed for removal *there*, so adopting it here would be
 * the opposite of what the mapping says; and a list backed by copies has no want to create — its
 * Colnect-only rows are #687's *set the flag* fix, or nothing.
 */
async function readAdoptableMapping(collectionId: string, lt: number) {
  const mapping = await prisma.colnectListMapping.findFirst({
    where: { collectionId, lt, enabled: true },
    select: { id: true, label: true, source: true, sourceOfTruth: true, snapshot: { select: { id: true } } },
  });
  if (!mapping) throw new ColnectAdoptError("That Colnect list is not set up for sync.");
  if (!mapping.snapshot) {
    throw new ColnectAdoptError("That Colnect list holds no import to adopt from.");
  }
  if ((mapping.sourceOfTruth as ColnectListSourceOfTruth) !== "colnect") {
    throw new ColnectAdoptError(
      `${mapping.label} is kept in step from here, so an item only on Colnect is one to remove there — not one to adopt.`
    );
  }
  if ((mapping.source as ColnectListSource) !== "wants_open") {
    throw new ColnectAdoptError(
      `${mapping.label} stands for copies, not wants, so there is no want to create from it.`
    );
  }
  return mapping;
}

/**
 * The one local condition a Colnect abbreviation means here, or null (#404).
 *
 * Null covers three different silences and treats them alike, which is right: the row stated no
 * grade; the grade is not one Colnect offers; or two of this collection's conditions both claim it,
 * so there is no single answer. A want with no condition accepts anything, which is a weaker and
 * honest claim — a guessed grade would be a stronger and possibly false one.
 */
function conditionMapForGrades(
  mappings: { stampConditionId: string; colnectValue: string }[]
): Map<string, string> {
  const byValue = new Map<string, string[]>();
  for (const mapping of mappings) {
    const list = byValue.get(mapping.colnectValue);
    if (list) list.push(mapping.stampConditionId);
    else byValue.set(mapping.colnectValue, [mapping.stampConditionId]);
  }
  const byAbbrev = new Map<string, string>();
  for (const grade of COLNECT_CONDITIONS) {
    const conditions = byValue.get(grade.value);
    if (conditions?.length === 1) byAbbrev.set(grade.abbrev.toUpperCase(), conditions[0]);
  }
  return byAbbrev;
}

/** One row of the pass, resolved. */
interface Resolved {
  colnectId: string;
  stampId: string | null;
  conditionId: string | null;
}

/**
 * Resolve a page of Colnect-only rows to stamps.
 *
 * Two steps and one fallback, in the order that costs least: the report has already looked every
 * row's Colnect id up against `Stamp.colnectId`, so `candidateStampId` is free. Only what it did not
 * answer goes to the matcher, and there in `dryRun` — see the module note.
 */
async function resolveRows(
  ownerId: string,
  collectionId: string,
  rows: ColnectReportRow[]
): Promise<Resolved[]> {
  const conditionMappings = await prisma.colnectConditionMapping.findMany({
    where: { collectionId },
    select: { stampConditionId: true, colnectValue: true },
  });
  const conditionByAbbrev = conditionMapForGrades(conditionMappings);

  const resolved: Resolved[] = rows.map((row) => ({
    colnectId: row.colnectId ?? "",
    stampId: row.candidateStampId,
    conditionId: row.colnectGrade
      ? (conditionByAbbrev.get(row.colnectGrade.trim().toUpperCase()) ?? null)
      : null,
  }));

  // Everything the Colnect id did not answer, put to the matcher — with the export's own catalog
  // codes, read by the export's own parser (`colnect-list-rules.ts`) rather than a second reading
  // of the same cell.
  const unresolved = rows.flatMap((row, index) => {
    if (resolved[index].stampId || !row.colnectId) return [];
    const catalogRefs = parseColnectCatalogCodes(row.colnectCatalogCodes);
    if (catalogRefs.length === 0) return [];
    return [{ index, item: { colnectId: row.colnectId, catalogRefs } }];
  });
  if (unresolved.length === 0) return resolved;

  const results = await matchColnectItems(
    ownerId,
    collectionId,
    unresolved.map((entry) => entry.item),
    { dryRun: true }
  );
  results.forEach((result, at) => {
    // Only `auto`. A `needs-confirm` is a question the collector has to answer against a page, and
    // answering hundreds of them in bulk is exactly what #250's matrix exists to prevent.
    if (result.status !== "auto") return;
    resolved[unresolved[at].index].stampId = result.stampId;
  });
  return resolved;
}

/** One pass, with or without the write. Both entry points are this function, so a preview cannot
 *  promise something the run then does differently. */
async function runPass(
  ownerId: string,
  collectionId: string,
  lt: number,
  filters: ColnectReportFilters,
  write: boolean
): Promise<ColnectAdoptPass> {
  await assertCollectionOwner(ownerId, collectionId);
  await readAdoptableMapping(collectionId, lt);

  // The bucket, under the collector's own filters, and its whole size. Both come off the report's
  // own query: what a difference is, is spelled once (#686), and a second spelling here would be a
  // bulk write acting on rows the screen never showed.
  const bucketFilters: ColnectReportFilters = { ...filters, buckets: ["only-colnect"] };
  const [counts, page] = await Promise.all([
    getColnectReportCounts(ownerId, collectionId, lt, bucketFilters),
    listColnectReportRows(
      ownerId,
      collectionId,
      lt,
      bucketFilters,
      0,
      COLNECT_ADOPT_PASS_SIZE
    ),
  ]);

  const rows = page.rows.filter((row) => row.colnectId);
  const resolved = await resolveRows(ownerId, collectionId, rows);

  const withStamp = resolved.filter((row): row is Resolved & { stampId: string } => !!row.stampId);
  const unresolved = resolved.length - withStamp.length;

  // Which of the resolved stamps are already being looked for. Asked here rather than only inside
  // the write, because the preview has to state it — "already wanted" is the number that explains
  // why a pass of five hundred rows writes forty.
  const stampIds = [...new Set(withStamp.map((row) => row.stampId))];
  const open = stampIds.length
    ? await prisma.want.findMany({
        where: { collectionId, closedAt: null, stampId: { in: stampIds } },
        select: { stampId: true },
      })
    : [];
  const already = new Set(open.map((w) => w.stampId));

  // One entry per **stamp**: two Colnect items resolving to the same stamp are one want, and the
  // first one's grade is the one it takes — a second want on other terms would be this import
  // asserting a distinction the wish list never made.
  const entries = new Map<string, string | null>();
  for (const row of withStamp) {
    if (already.has(row.stampId)) continue;
    if (!entries.has(row.stampId)) entries.set(row.stampId, row.conditionId);
  }

  const adoptable = entries.size;
  const withCondition = [...entries.values()].filter((id) => id !== null).length;
  const base: ColnectAdoptPass = {
    bucketRows: counts["only-colnect"],
    passRows: resolved.length,
    adoptable,
    unresolved,
    // Counted over **rows**, not stamps: it answers "why did five hundred rows write forty", and two
    // rows landing on one already-wanted stamp are two rows the pass got through. Rarer than it
    // sounds on a wish list — a stamp whose own Colnect id is on the export and whose want is open
    // is *in step*, so it never reaches this bucket at all. What does reach it is a row the matcher
    // resolved to a stamp wanted under a different id, or under none.
    alreadyWanted: withStamp.filter((row) => already.has(row.stampId)).length,
    withCondition,
    created: 0,
  };
  if (!write || adoptable === 0) return base;

  const result = await createWantsForStamps(
    ownerId,
    collectionId,
    [...entries].map(([stampId, conditionId]) => ({
      stampId,
      conditionIds: conditionId ? [conditionId] : [],
    }))
  );
  return { ...base, created: result.created };
}

/** What the next pass would adopt, writing nothing. Owner-authorized. */
export async function previewColnectAdoption(
  ownerId: string,
  collectionId: string,
  lt: number,
  filters: ColnectReportFilters = {}
): Promise<ColnectAdoptPass> {
  return runPass(ownerId, collectionId, lt, filters, false);
}

/** Adopt one pass of the bucket into wants. Owner-authorized. */
export async function applyColnectAdoption(
  ownerId: string,
  collectionId: string,
  lt: number,
  filters: ColnectReportFilters = {}
): Promise<ColnectAdoptPass> {
  return runPass(ownerId, collectionId, lt, filters, true);
}

/**
 * Adopt **one** row, from its own `⋮` menu. Owner-authorized.
 *
 * The same code path narrowed to a single Colnect id rather than a second implementation of it: one
 * row and five hundred are the same act, and a menu entry resolving stamps by rules of its own would
 * be a second answer to what a wish resolves to.
 */
export async function applyColnectAdoptionForRow(
  ownerId: string,
  collectionId: string,
  lt: number,
  colnectId: string
): Promise<ColnectAdoptPass> {
  await assertCollectionOwner(ownerId, collectionId);
  await readAdoptableMapping(collectionId, lt);

  const row = await snapshotRow(collectionId, lt, colnectId);
  if (!row) {
    throw new ColnectAdoptError("That item is not on the export this report was read against.");
  }
  const [resolved] = await resolveRows(ownerId, collectionId, [row]);
  if (!resolved.stampId) {
    throw new ColnectAdoptError(
      "Nothing here matches that item, so there is no stamp to want. The Assistant is where a Colnect ID is learned."
    );
  }
  const result = await createWantsForStamps(ownerId, collectionId, [
    { stampId: resolved.stampId, conditionIds: resolved.conditionId ? [resolved.conditionId] : [] },
  ]);
  return {
    bucketRows: 1,
    passRows: 1,
    adoptable: result.created,
    unresolved: 0,
    alreadyWanted: result.alreadyWanted,
    withCondition: resolved.conditionId ? 1 : 0,
    created: result.created,
  };
}

/**
 * One snapshot row, in the shape {@link resolveRows} reads — enough of a report row and no more.
 *
 * Deliberately **not** a page of the report narrowed to one id: the bucket is tens of thousands of
 * rows and the report has no by-id read, so finding one that way is a walk. What the resolution
 * actually needs is the export's own cell and the stamp this collection holds under that id, and
 * both are one query each.
 *
 * The two aggregates mirror the report's `colnect_side` exactly — a repeated item is one row, and a
 * grade is stated only where every occurrence agrees — because a single-row adopt reading the file
 * differently from the bucket it was clicked in is how the two come to disagree.
 */
async function snapshotRow(
  collectionId: string,
  lt: number,
  colnectId: string
): Promise<ColnectReportRow | null> {
  const mapping = await prisma.colnectListMapping.findFirst({
    where: { collectionId, lt, enabled: true },
    select: { snapshot: { select: { id: true } } },
  });
  if (!mapping?.snapshot) return null;
  const rows = await prisma.colnectListSnapshotRow.findMany({
    where: { snapshotId: mapping.snapshot.id, colnectId },
    select: { name: true, country: true, catalogCodes: true, quantity: true, conditionAbbrev: true },
  });
  if (rows.length === 0) return null;

  const grades = new Set(rows.map((row) => row.conditionAbbrev));
  return {
    key: colnectId,
    bucket: "only-colnect",
    colnectId,
    country: rows[0].country || null,
    stampId: null,
    stampName: null,
    issuedYear: null,
    areaId: null,
    catalogNumbers: [],
    photos: [],
    localQuantity: null,
    localConditionId: null,
    candidateStampId:
      (
        await prisma.stamp.findFirst({
          where: { collectionId, colnectId },
          select: { id: true },
        })
      )?.id ?? null,
    candidateCopies: null,
    colnectName: rows[0].name || null,
    colnectCatalogCodes: rows.map((row) => row.catalogCodes).find((codes) => codes) ?? null,
    colnectQuantity: rows.reduce((sum, row) => sum + (row.quantity ?? 1), 0),
    colnectGrade: grades.size === 1 ? (rows[0].conditionAbbrev ?? null) : null,
    done: false,
    ignored: false,
    ignoredNote: null,
  };
}
