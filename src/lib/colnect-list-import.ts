import "server-only";
import { prisma } from "./db";
import { COLNECT_CONDITIONS } from "./colnect-conditions";
import {
  matchColnectItems,
  type ColnectCandidate,
  type ColnectMineStatus,
  type ColnectRefStatus,
} from "./colnect";
import { readCollectionAreas } from "./areas";
import { buildAreaVendorMaps, formatStampCN } from "./area-vendor";
import { loadIssuePrefixMap } from "./issue-prefix";
import { readColnectList, type ColnectListRow } from "./colnect-list-rules";
import { sortPhotos, type PhotoSummary } from "./photos";
import { colnectSearchUrl, colnectStampUrl } from "./colnect-link";
import { assertSectionOwner, assertTradeOwner } from "./trade-access";
import {
  addTradeGiveLinesForRequirements,
  resolveTradeGiveRequirements,
  type GiveRequirementReport,
} from "./trade-give-resolution";
import type { GiveRequirement } from "./trade-give-resolution-rules";
import { addTradeReceiveLinesBulk } from "./trade-lines";
import type { TradeSide } from "./trade-rules";

// **Importing a Colnect list into one side of a trade** (#645) — the half that needs the database.
//
// The file is read by `colnect-list-rules.ts`; what happens here is the three questions a row has to
// answer before it can become a line, and the three ways it can fail to.
//
// **Which stamp.** Two ways in, in this order:
//
//   1. the **Colnect item id** off the row's `Link`, against `Stamp.colnectId` (#247). A stamp
//      already carrying that id *is* the stamp — the collector said so, and there is nothing to be
//      ambiguous about;
//   2. the **catalog numbers**, through `matchColnectItems` in `dryRun` — the matcher the Assistant
//      uses (#250) and its decision matrix, rather than a third matcher written here to disagree
//      with it in six months. `auto` is a match, `needs-confirm` is a gap that names its candidates,
//      `skipped` is a gap with none.
//
// `dryRun` matters: matching a list must not quietly write eighty-five Colnect ids onto the
// collection's stamps. Learning an id is the Assistant's act, done deliberately against a page the
// collector is looking at; here it would be a side effect of reading somebody else's wish list.
//
// **Which condition — and on which list.** A row states a grade and a quantity **per list it is on**,
// and it is routinely on several: what a collector offers is also on their swap lists, what they want
// is also on their wish list, and the same stamp is then `MNH` on one and `U` on the other. So the
// grade is resolved for *every* list the row carries ({@link ColnectImportRow.entries}) and the
// caller picks the list; nothing here chooses between them, and nothing takes the first.
//
// The resolution itself is Colnect's abbreviation (`MNH`) → Colnect's option value (`1`) →
// `ColnectConditionMapping` **read backwards** to the collection's own grade. Backwards is the whole
// point: the collection has already stated what each Colnect grade means to it (#404), and a trade
// inventing a second opinion about that is how two screens come to disagree about what MNH is. Where
// the chosen list states no grade — five rows in eight of a real export — the **section's** default
// answers (#645), and where the section states none either, the row is a gap.
//
// **How many.** The `Quantity` cell of the chosen list, or one. On the give side that becomes N lines
// over N distinct copies (#659); on the receive side it is the line's own `quantity`.
//
// **Nothing here writes.** {@link previewColnectListImport} and {@link resolveColnectImportRows} are
// reads, and the write is a separate act over rows the collector has settled — which is the issue's
// own rule: an import that quietly drops rows is worse than one that refuses, because both sides go
// on believing the list is complete.

// Why a row cannot be written as it stands, in two dimensions that fail independently: the stamp is
// a property of the row, the condition a property of the row **on one list**. Named rather than
// counted — *which* stamp could not be found is the half of an import the collector works through.

export type ColnectStampGapReason =
  /** There was nothing to look up: the row prints no catalog reference this collection keeps a
   *  catalog for, or prints none at all, and its Colnect id is one no stamp here carries. */
  | "unresolved"
  /** Nothing in the collection carries any of these numbers. */
  | "not-held"
  /** Several stamps do, and picking one would be a guess. */
  | "ambiguous"
  /** One stamp matches but disagrees on another catalog, or already carries a different Colnect id.
   *  Both are the matcher's *needs-confirm*, and both mean: look at this one. */
  | "needs-confirm";

export type ColnectConditionGapReason =
  /** The file states none and the section has no default (#645). */
  | "not-stated"
  /** The file states a grade Colnect does not offer — a hand-edited spreadsheet. */
  | "unknown-grade"
  /** Colnect's grade is one this collection has never mapped (#404). */
  | "unmapped-grade"
  /** Two of the collection's conditions map to the same Colnect grade, so reading the mapping
   *  backwards has two answers. */
  | "ambiguous-mapping";

/** One catalog reference the **file** prints, marked against the stamp the row resolved to (#284's
 *  vocabulary): `matched` is the evidence the match rests on, `conflict` is a number that disagrees,
 *  `unmapped` a catalog this collection does not keep. All of them are shown — a match is only
 *  checkable if the numbers that did *not* match are visible beside the one that did. */
export interface ColnectImportRef {
  catalog: string;
  number: string;
  status: ColnectRefStatus;
}

/** One catalog number of **ours**, marked from the other side: `matched` (the file prints the same),
 *  `conflict` (it prints a different one for that catalog), `only-mine` (it does not mention that
 *  catalog). Null where nothing compared them — a stamp found by its Colnect id whose numbers the
 *  matcher never had occasion to look at. */
export interface ColnectImportNumber {
  label: string;
  status: ColnectMineStatus | null;
}

/** A stamp the collector may pick between when the matcher could not. */
export interface ColnectImportCandidate {
  stampId: string;
  label: string;
  /** Its own numbers, marked — which is how *which of these two* is answered. */
  numbers: ColnectImportNumber[];
  /** Its own pictures, so *which of these two* can be answered by looking rather than by reading two
   *  catalog numbers that differ in one letter. Empty where the stamp has none. */
  photos: PhotoSummary[];
}

/** One row of the file, as far as the collection can take it. */
export interface ColnectImportRow {
  /** The line of the file, so a gap names something findable in a spreadsheet. */
  line: number;
  /** What Colnect calls it, where it is from, and when — enough to recognise a row by eye. */
  name: string;
  country: string;
  issuedOn: string;
  /** Every catalog reference the file prints, each marked against the stamp this row resolved to.
   *  Kept structured rather than joined: the screen marks them one by one and builds the *find this
   *  on Colnect* link out of the first. */
  catalogRefs: ColnectImportRef[];
  colnectId: string | null;
  /** True where the **id** is what found the stamp — so the screen can mark the thing that matched
   *  rather than leaving the collector to guess which of six numbers did it. */
  colnectIdMatched: boolean;
  /** The row's own page on Colnect, off its `Link` column — or, where it carries no id, the Colnect
   *  search for its first catalog number. Never null in practice: a row with neither is dropped by
   *  the reader. This is the row's way *out* of the app, and on an unmatched row it is how the
   *  collector works out what the stamp actually is. */
  colnectUrl: string | null;
  /** The stamp this row resolved to, or null. */
  stampId: string | null;
  stampLabel: string | null;
  /** How it was found — worth showing, because *already carries this Colnect id* and *the numbers
   *  agree* are different degrees of certainty. */
  matchedBy: "colnect-id" | "catalog-number" | null;
  /** Where the matcher could not choose, the stamps it could not choose between. */
  candidates: ColnectImportCandidate[];
  /** Why there is no stamp, or null where there is one. */
  stampGap: ColnectStampGapReason | null;
  /** The matched stamp's pictures, for the row's thumbnail — the fastest way to see that a match is
   *  wrong. Empty where nothing matched, or where the stamp has no photos. */
  photos: PhotoSummary[];
  /** Every catalog number the matched stamp carries, marked against the file. Empty where nothing
   *  matched. */
  stampNumbers: ColnectImportNumber[];
  /** What this row says on each list it is on, each already resolved against the collection. The
   *  caller reads the one whose `listName` is the list being imported; a row with no entry for that
   *  list is simply not on it. */
  entries: ColnectImportEntry[];
}

/** One row's reading **on one list**: the grade and the quantity that list states, resolved. */
export interface ColnectImportEntry {
  listName: string;
  /** The condition this list's grade resolved to, or null. */
  conditionId: string | null;
  conditionName: string | null;
  /** What the file said for this list, verbatim (`MNH`), or null where it said nothing. */
  statedGrade: string | null;
  /** True where the condition came from the section's default rather than from the file. */
  conditionFromSection: boolean;
  /** Why there is no condition, or null where there is one. */
  conditionGap: ColnectConditionGapReason | null;
  quantity: number;
}

/** What one settled row would come to on the give side (#659) — how many copies can actually be
 *  promised, and how many cannot. The third kind of gap, and on an imported wish list the most
 *  useful thing to come out of the whole exercise. */
export interface ColnectImportShortfall {
  line: number;
  requested: number;
  served: number;
  missing: number;
}

/** A whole file, read against the collection. */
export interface ColnectImportPreview {
  /** The list's page on Colnect, off the file's own preamble — offered as a link to keep. */
  listUrl: string | null;
  /** Every list the rows mention, most rows first. The caller picks which one is being imported —
   *  see the module note on why that is a question. */
  lists: { name: string; rows: number }[];
  /** The likeliest of them: the list the most rows carry, which in an export of one list is all of
   *  them. Null only where the file names none. Also the link's proposed label. */
  suggestedList: string | null;
  exportedAt: string | null;
  /** What the file claims it holds, against what was read — a spreadsheet that lost its tail says
   *  so here rather than by importing quietly. */
  declaredCount: number | null;
  rows: ColnectImportRow[];
  /** Give side only, and only for the rows that are settled enough to resolve. */
  shortfalls: ColnectImportShortfall[];
}

/** One row as the collector has settled it, on the way to being written. */
export interface ColnectImportSettledRow {
  line: number;
  stampId: string;
  conditionId: string;
  quantity: number;
}

/** What an import came to. The give side's own report rides along whole — it is where the
 *  shortfalls and the refusals are named. */
export interface ColnectImportResult {
  added: number;
  side: TradeSide;
  give: GiveRequirementReport | null;
}

/**
 * Read a file against a trade section, without writing anything.
 *
 * `side` decides what a row will become, not how it is read: both sides of a Colnect exchange come
 * out of the same **Export list** button, and the file cannot tell you whose wish it is.
 */
export async function previewColnectListImport(
  ownerId: string,
  sectionId: string,
  side: TradeSide,
  text: string
): Promise<ColnectImportPreview> {
  const { tradeId } = await assertSectionOwner(ownerId, sectionId);
  const { collectionId } = await assertTradeOwner(ownerId, tradeId);

  const read = readColnectList(text);
  if (!read.ok) throw new Error(read.message);
  const { file } = read;

  const section = await prisma.tradeSection.findUnique({
    where: { id: sectionId },
    select: { defaultConditionId: true },
  });

  const [byId, conditionsByGrade, conditionNames] = await Promise.all([
    stampsByColnectId(collectionId, file.rows),
    conditionsByColnectGrade(collectionId),
    conditionNamesOf(collectionId),
  ]);
  const stampsById = byId.byColnectId;

  // **Every** row with something to look up goes through the matcher, not only the ones the id
  // could not place. The id still decides the match — but a row matched by id still has to *show*
  // how its numbers compare, and asking the matcher is how that comparison stays the same one #284
  // draws everywhere else. It is one batched call either way.
  const matched = await matchByCatalogNumbers(ownerId, collectionId, file.rows);

  // Every stamp the screen may draw — the ones matched either way, and the candidates it offers to
  // choose between. One query: a thumbnail per row is the fastest way to see a wrong match, and
  // eighty-five round trips for it would not be.
  const photosByStampId = await photosByStamp(collectionId, [
    ...[...stampsById.values()].map((stamp) => stamp.id),
    ...[...matched.values()].flatMap((entry) => [
      ...(entry.found ? [entry.found.stampId] : []),
      ...entry.candidates.map((candidate) => candidate.stampId),
    ]),
  ]);

  const rows = file.rows.map((row) =>
    readRow({
      row,
      stampsById,
      matched,
      photosByStampId,
      plainNumbers: byId.numbers,
      conditionsByGrade,
      conditionNames,
      defaultConditionId: section?.defaultConditionId ?? null,
    })
  );

  return {
    listUrl: file.listUrl,
    lists: file.lists,
    suggestedList: file.suggestedList,
    exportedAt: file.exportedAt,
    declaredCount: file.declaredCount,
    rows,
    // The preview's own shortfalls are for the list it suggests, which is the one the screen opens
    // on. Choosing another asks again, because the answer is different.
    shortfalls:
      side === "give"
        ? await resolveColnectImportRows(
            ownerId,
            tradeId,
            settledOf(rows, file.suggestedList ?? "")
          )
        : [],
  };
}

/**
 * What these settled rows would come to on the give side, without writing.
 *
 * Called again every time the collector fixes a gap: the pool is finite and shared, so a row that
 * was a shortfall can stop being one — and the other way round — the moment another row above it
 * takes a copy.
 */
export async function resolveColnectImportRows(
  ownerId: string,
  tradeId: string,
  rows: readonly ColnectImportSettledRow[]
): Promise<ColnectImportShortfall[]> {
  if (rows.length === 0) return [];
  const resolutions = await resolveTradeGiveRequirements(ownerId, tradeId, requirementsOf(rows));
  return resolutions.map((resolution) => ({
    line: rows[resolution.index].line,
    requested: resolution.requested,
    served: resolution.served,
    missing: resolution.missing,
  }));
}

/**
 * Write the settled rows into the section.
 *
 * Only what the collector settled arrives — a row still carrying a gap is not here, because the
 * screen does not offer to import one. What the write can still refuse is a **copy**: the give side
 * goes through `addTradeGiveLines`, which re-checks eligibility as the collection stands now and
 * names each refusal, and a copy refused there goes back onto the shortfall it came from.
 */
export async function importColnectListRows(
  ownerId: string,
  sectionId: string,
  side: TradeSide,
  rows: readonly ColnectImportSettledRow[]
): Promise<ColnectImportResult> {
  if (rows.length === 0) return { added: 0, side, give: null };

  if (side === "receive") {
    const added = await addTradeReceiveLinesBulk(
      ownerId,
      sectionId,
      rows.map((row) => ({
        stampId: row.stampId,
        conditionId: row.conditionId,
        quantity: row.quantity,
      }))
    );
    return { added, side, give: null };
  }

  const report = await addTradeGiveLinesForRequirements(ownerId, sectionId, requirementsOf(rows));
  return { added: report.added, side, give: report };
}

// ── Reading one row ──────────────────────────────────────────────────────────────────────────────

function readRow(input: {
  row: ColnectListRow;
  stampsById: Map<string, { id: string; label: string }>;
  matched: Map<string, MatchedStamp>;
  photosByStampId: Map<string, PhotoSummary[]>;
  /** Unmarked numbers for the stamps the matcher never compared — see below. */
  plainNumbers: Map<string, ColnectImportNumber[]>;
  conditionsByGrade: Map<string, string[]>;
  conditionNames: Map<string, string>;
  defaultConditionId: string | null;
}): ColnectImportRow {
  const {
    row,
    stampsById,
    matched,
    photosByStampId,
    plainNumbers,
    conditionsByGrade,
    conditionNames,
    defaultConditionId,
  } = input;

  const byId = row.colnectId ? stampsById.get(row.colnectId) : undefined;
  const byNumber = row.colnectId ? matched.get(row.colnectId) : undefined;

  let stampId: string | null = null;
  let stampLabel: string | null = null;
  let matchedBy: ColnectImportRow["matchedBy"] = null;
  let candidates: ColnectImportCandidate[] = [];
  let stampGap: ColnectStampGapReason | null = null;

  if (byId) {
    stampId = byId.id;
    stampLabel = byId.label;
    matchedBy = "colnect-id";
  } else if (byNumber?.found) {
    stampId = byNumber.found.stampId;
    stampLabel = byNumber.found.label;
    matchedBy = "catalog-number";
  } else {
    candidates = (byNumber?.candidates ?? []).map((candidate) => ({
      ...candidate,
      photos: photosByStampId.get(candidate.stampId) ?? [],
    }));
    stampGap = byNumber?.reason ?? "unresolved";
  }

  // Every list the row is on is resolved, because which one is being imported is the caller's
  // question and the answers genuinely differ — the same stamp is mint on the wish list and used on
  // the swap list.
  const entries: ColnectImportEntry[] = row.entries.map((entry) => {
    const condition = readCondition({
      statedGrade: entry.conditionAbbrev,
      conditionsByGrade,
      defaultConditionId,
    });
    const conditionId = "conditionId" in condition ? condition.conditionId : null;
    return {
      listName: entry.listName,
      conditionId,
      conditionName: conditionId ? (conditionNames.get(conditionId) ?? null) : null,
      statedGrade: entry.conditionAbbrev,
      conditionFromSection: conditionId !== null && entry.conditionAbbrev === null,
      conditionGap: "gap" in condition ? condition.gap : null,
      quantity: Math.max(1, entry.quantity ?? 1),
    };
  });

  return {
    line: row.line,
    name: row.name,
    country: row.country,
    issuedOn: row.issuedOn,
    // The matcher's classification where it ran; otherwise the references as printed, unmarked —
    // a row it never looked at has nothing to be marked against.
    catalogRefs:
      byNumber?.refs ??
      row.catalogRefs.map((ref) => ({
        catalog: ref.catalog,
        number: ref.number,
        status: "unknown" as const,
      })),
    colnectId: row.colnectId,
    colnectIdMatched: matchedBy === "colnect-id",
    // The item page where the file gave an id, and otherwise Colnect's own catalog-number search —
    // which is the page that answers *what is this, then*, and the first step of recording the id
    // that would make the direct link exist (#290/#441's rule for an unmatched stamp).
    colnectUrl:
      colnectStampUrl(row.colnectId) ?? colnectSearchUrl(row.catalogRefs[0]?.number ?? null),
    stampId,
    stampLabel,
    matchedBy,
    candidates,
    stampGap,
    photos: stampId ? (photosByStampId.get(stampId) ?? []) : [],
    // Marked where the matcher looked at this stamp, plain where it did not — which happens on a
    // row found by its Colnect id whose numbers agree with nothing in the file. Plain is the honest
    // rendering there: nothing compared them, so nothing may claim they agree.
    stampNumbers: stampId
      ? (byNumber?.numbersByStampId.get(stampId) ?? plainNumbers.get(stampId) ?? [])
      : [],
    entries,
  };
}

/** What one list's grade means here, or why it means nothing. */
function readCondition(input: {
  statedGrade: string | null;
  conditionsByGrade: Map<string, string[]>;
  defaultConditionId: string | null;
}): { conditionId: string } | { gap: ColnectConditionGapReason } {
  const { statedGrade, conditionsByGrade, defaultConditionId } = input;

  if (!statedGrade) {
    if (defaultConditionId) return { conditionId: defaultConditionId };
    return { gap: "not-stated" };
  }

  const abbrev = statedGrade.trim().toLowerCase();
  const grade = COLNECT_CONDITIONS.find((g) => g.abbrev.toLowerCase() === abbrev);
  if (!grade) return { gap: "unknown-grade" };

  const mapped = conditionsByGrade.get(grade.value) ?? [];
  if (mapped.length === 0) return { gap: "unmapped-grade" };
  if (mapped.length > 1) return { gap: "ambiguous-mapping" };
  return { conditionId: mapped[0] };
}

// ── The three reads the collection answers with ──────────────────────────────────────────────────

/** Stamps already carrying one of the file's Colnect ids (#247) — the first and surest way in. */
async function stampsByColnectId(
  collectionId: string,
  rows: readonly ColnectListRow[]
): Promise<{
  byColnectId: Map<string, { id: string; label: string }>;
  /** Their numbers, formatted the way every other stamp surface prints them (#357/#377) and
   *  **unmarked**: the matcher may never have compared this stamp to this row, and a mark it did not
   *  make would be a claim nobody checked. */
  numbers: Map<string, ColnectImportNumber[]>;
}> {
  const ids = [...new Set(rows.map((row) => row.colnectId).filter((id): id is string => !!id))];
  if (ids.length === 0) return { byColnectId: new Map(), numbers: new Map() };

  const [stamps, areas, issuePrefixes] = await Promise.all([
    prisma.stamp.findMany({
      where: { collectionId, colnectId: { in: ids } },
      select: {
        id: true,
        colnectId: true,
        name: true,
        catalogNumbers: { select: { catalogVendorId: true, number: true } },
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
        issueMemberships: { select: { issueId: true }, take: 1 },
      },
    }),
    readCollectionAreas(collectionId),
    loadIssuePrefixMap(collectionId),
  ]);
  const { primaryVendorByArea, vendorMapFor } = buildAreaVendorMaps(areas, issuePrefixes);

  const byColnectId = new Map<string, { id: string; label: string }>();
  const numbers = new Map<string, ColnectImportNumber[]>();
  for (const stamp of stamps) {
    const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    const issueId = stamp.issueMemberships[0]?.issueId ?? null;
    const vendorMap = vendorMapFor(areaId, issueId);
    const primaryVendorId = areaId ? (primaryVendorByArea.get(areaId) ?? null) : null;
    // The area's leading catalogue first, as every list here orders them.
    const ordered = [
      ...stamp.catalogNumbers.filter((cn) => cn.catalogVendorId === primaryVendorId),
      ...stamp.catalogNumbers.filter((cn) => cn.catalogVendorId !== primaryVendorId),
    ];
    const labels = ordered.map((cn) => ({
      label: formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId)),
      status: null,
    }));
    numbers.set(stamp.id, labels);
    if (!stamp.colnectId) continue;
    byColnectId.set(stamp.colnectId, {
      id: stamp.id,
      label: stamp.name || labels[0]?.label || "(unnamed)",
    });
  }
  return { byColnectId, numbers };
}

/**
 * `ColnectConditionMapping`, **read backwards**: Colnect's grade → the collection's conditions.
 *
 * A list, not a value. The mapping is unique per *condition*, which leaves two conditions free to
 * point at one Colnect grade — a collection distinguishing two shades of used, both listed as `U`.
 * That is a perfectly sensible thing to have done for listing and a genuine ambiguity here, and it
 * comes back as one rather than as whichever row the database happened to return first.
 */
async function conditionsByColnectGrade(collectionId: string): Promise<Map<string, string[]>> {
  const rows = await prisma.colnectConditionMapping.findMany({
    where: { collectionId },
    select: { stampConditionId: true, colnectValue: true },
  });
  const out = new Map<string, string[]>();
  for (const row of rows) {
    const list = out.get(row.colnectValue);
    if (list) list.push(row.stampConditionId);
    else out.set(row.colnectValue, [row.stampConditionId]);
  }
  return out;
}

/** The pictures of the stamps a preview may draw, in the app's own order (`sortPhotos`), so the
 *  thumbnail here is the same picture every other screen leads with. */
async function photosByStamp(
  collectionId: string,
  stampIds: readonly string[]
): Promise<Map<string, PhotoSummary[]>> {
  const ids = [...new Set(stampIds)];
  if (ids.length === 0) return new Map();
  const rows = await prisma.photo.findMany({
    where: { stampId: { in: ids }, stamp: { collectionId } },
    select: { id: true, stampId: true, role: true, title: true, sortOrder: true },
  });
  const out = new Map<string, PhotoSummary[]>();
  for (const row of rows) {
    if (!row.stampId) continue;
    const summary: PhotoSummary = {
      id: row.id,
      role:
        row.role === "main" || row.role === "front" || row.role === "back"
          ? row.role
          : null,
      title: row.title,
      sortOrder: row.sortOrder,
    };
    const list = out.get(row.stampId);
    if (list) list.push(summary);
    else out.set(row.stampId, [summary]);
  }
  for (const list of out.values()) list.sort(sortPhotos);
  return out;
}

async function conditionNamesOf(collectionId: string): Promise<Map<string, string>> {
  const rows = await prisma.stampCondition.findMany({
    where: { collectionId },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** What the catalog-number matcher said about one row: a stamp, or why there is none — and, either
 *  way, how it read the file's own references, which the screen shows whichever way the row was
 *  finally matched. */
interface MatchedStamp {
  /** The file's references as the matcher classified them (#284). */
  refs: ColnectImportRef[];
  /** The marked numbers of every stamp it looked at, by stamp id — the auto match's and each
   *  candidate's. */
  numbersByStampId: Map<string, ColnectImportNumber[]>;
  found:
    | { stampId: string; label: string | null }
    | null;
  candidates: ColnectImportCandidate[];
  reason: ColnectStampGapReason;
}

/**
 * The rows the id could not place, put through the Assistant's own matcher (#250) in `dryRun`.
 *
 * Deduplicated by Colnect id, which is what the matcher is keyed on. A row with no id at all cannot
 * go through it — the matrix reads the id to decide whether a candidate already carries a different
 * one — and comes back `unresolved`, which is what it is: the file gave nothing to look up.
 */
async function matchByCatalogNumbers(
  ownerId: string,
  collectionId: string,
  rows: readonly ColnectListRow[]
): Promise<Map<string, MatchedStamp>> {
  const items = new Map<
    string,
    { colnectId: string; catalogRefs: { catalog: string; number: string }[] }
  >();
  for (const row of rows) {
    if (!row.colnectId || row.catalogRefs.length === 0) continue;
    if (items.has(row.colnectId)) continue;
    items.set(row.colnectId, {
      colnectId: row.colnectId,
      catalogRefs: row.catalogRefs.map((ref) => ({ catalog: ref.catalog, number: ref.number })),
    });
  }
  if (items.size === 0) return new Map();

  const results = await matchColnectItems(ownerId, collectionId, [...items.values()], {
    dryRun: true,
  });

  const out = new Map<string, MatchedStamp>();
  for (const result of results) {
    const refs: ColnectImportRef[] = result.refs.map((ref) => ({
      catalog: ref.catalog,
      number: ref.number,
      status: ref.status,
    }));
    const numbersByStampId = new Map<string, ColnectImportNumber[]>();

    if (result.status === "auto") {
      if (result.stamp) numbersByStampId.set(result.stampId, numbersOf(result.stamp));
      out.set(result.colnectId, {
        refs,
        numbersByStampId,
        found: { stampId: result.stampId, label: result.stamp ? nameOf(result.stamp) : null },
        candidates: [],
        // Never read while `found` is set; stated so the shape has no hole in it.
        reason: "not-held",
      });
      continue;
    }
    if (result.status === "needs-confirm") {
      for (const candidate of result.candidates) {
        numbersByStampId.set(candidate.stampId, numbersOf(candidate));
      }
      out.set(result.colnectId, {
        refs,
        numbersByStampId,
        found: null,
        candidates: result.candidates.map((candidate) => ({
          stampId: candidate.stampId,
          label: nameOf(candidate),
          numbers: numbersOf(candidate),
          // Filled in by the caller, which reads every drawable stamp's pictures in one query.
          photos: [],
        })),
        // Several candidates is *choose one*; one candidate that needs confirming is *look at this
        // one*. Two different sentences on the report, so two reasons.
        reason: result.reason === "multiple-candidates" ? "ambiguous" : "needs-confirm",
      });
      continue;
    }
    out.set(result.colnectId, {
      refs,
      numbersByStampId,
      found: null,
      candidates: [],
      reason: result.reason === "unresolved-refs" ? "unresolved" : "not-held",
    });
  }
  return out;
}

/** A candidate's own numbers, in the matcher's marked form. */
function numbersOf(candidate: ColnectCandidate): ColnectImportNumber[] {
  return candidate.catalogNumbers.map((number) => ({
    label: number.label,
    status: number.status,
  }));
}

/** What to call a stamp on a row: its name where it has one, else its leading number — the numbers
 *  themselves are listed under it now, so repeating the first one as a title says nothing twice. */
function nameOf(candidate: ColnectCandidate): string {
  return candidate.name || candidate.catalogNumbers[0]?.label || "(unnamed)";
}

/** The rows of **one list** that need nothing more from the collector, in file order. A row not on
 *  that list is not part of it and is simply absent — not a gap, and nothing to answer for. */
function settledOf(
  rows: readonly ColnectImportRow[],
  listName: string
): ColnectImportSettledRow[] {
  const out: ColnectImportSettledRow[] = [];
  for (const row of rows) {
    const entry = row.entries.find((candidate) => candidate.listName === listName);
    if (!entry || !row.stampId || !entry.conditionId) continue;
    out.push({
      line: row.line,
      stampId: row.stampId,
      conditionId: entry.conditionId,
      quantity: entry.quantity,
    });
  }
  return out;
}

/** Settled rows as #659's requirements. The certificate and format axes are left **unnarrowed**: a
 *  wish list says nothing about either, and narrowing them to *none* would turn silence into a
 *  requirement (see `GiveAxisNarrowing`). */
function requirementsOf(rows: readonly ColnectImportSettledRow[]): GiveRequirement[] {
  return rows.map((row) => ({
    stampId: row.stampId,
    conditionId: row.conditionId,
    quantity: Math.max(1, Math.trunc(row.quantity || 1)),
  }));
}

