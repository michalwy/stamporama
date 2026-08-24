import "server-only";
import { prisma } from "./db";
import { COLNECT_CONDITIONS } from "./colnect-conditions";
import {
  colnectListBucketLabel,
  colnectListSourceShape,
  colnectLocalFixesFor,
  isColnectListBucket,
  type ColnectListBucket,
  type ColnectLocalFix,
  type ColnectListSource,
  type ColnectListSourceOfTruth,
} from "./colnect-list-sync-rules";

// **Fixing this side from the report** (#687) — the half of a discrepancy that is Stamporama's
// fault rather than Colnect's.
//
// Half the rows a sync report finds are ours: a copy still flagged `forTrade` after it went out, a
// want left open after it was met. Sending the collector to another screen for each one — with a
// report of thousands of rows to come back to — turns a two-second correction into a lost place in
// the list. So the corrections live on the row.
//
// **The predicate is re-evaluated here, never taken from the request.** The row the collector
// clicked was rendered from a read that may be seconds old; a fix acting on a client-supplied list
// of copies would act on a list the report no longer stands behind. What arrives is the *row* — a
// list, a Colnect id, a bucket — and this module works out again which local rows that bucket was
// computed from.
//
// **The action names what it will touch before it takes it.** Several copies of one stamp qualify
// routinely, and "unflag this stamp" silently meaning "unflag four copies" is how a report loses
// trust. Hence the preview, and hence its shape: copies by their own number, not a count.
//
// **A fix writes nothing but the fix.** No done mark, no accepted divergence: the row leaves the
// report on the next read because the *predicate changed*, which is what computing the difference
// on read (#686) bought. Nothing has to remember anything.
//
// What is deliberately not here:
//   • **Quantity.** A quantity is a count of copies and is corrected by adding or removing them,
//     which is the inventory screen's work and not a list report's.
//   • **A copy's grade.** A copy's condition is a judgement about the physical piece in hand, and a
//     Colnect list entry is no evidence about it. A *want's* accepted condition is a statement of
//     intent, so that one is offered — see {@link ColnectLocalFix}.
//   • **Anything that writes to Colnect** (#689), and **creating stamps or copies** that do not
//     exist. Adopting a Colnect-only row into a want is #688's, and is offered from there.

/** Raised when a fix names a row, list or correction that does not go together. Every one of these
 *  is a stale tab or a programming error rather than anything the collector can type — the menu
 *  offers a fix only where it applies. */
export class ColnectLocalFixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColnectLocalFixError";
  }
}

/** One copy a fix would touch, as the dialog names it. Everything here is what a collector
 *  recognises a piece by on a shelf: its own number first, then how it is graded and where it is. */
export interface ColnectLocalFixCopy {
  id: string;
  itemNo: number;
  conditionName: string;
  conditionAbbreviation: string;
  formatName: string | null;
  locationName: string | null;
  locationRef: string | null;
}

/** One want a fix would touch. */
export interface ColnectLocalFixWant {
  id: string;
  /** The conditions it accepts today, so a narrowing says what it is narrowing *from*. */
  conditionNames: string[];
}

/** What a fix would do, stated before it is done. */
export interface ColnectLocalFixPreview {
  fix: ColnectLocalFix;
  /** The stamp the row is about, as the dialog titles itself. Null only where the row names an item
   *  this collection holds no stamp for, which no fix can act on. */
  stampId: string | null;
  stampName: string | null;
  /** Copies the fix would write to — empty for a want-backed list. */
  copies: ColnectLocalFixCopy[];
  /** Wants the fix would write to — empty for a copy-backed list. */
  wants: ColnectLocalFixWant[];
  /** For `grade`: the local condition Colnect's abbreviation resolved to. */
  conditionId: string | null;
  conditionName: string | null;
  /** Colnect's own abbreviation, as the row printed it — what the narrowing is *to*. */
  colnectGrade: string | null;
}

/** What a fix did. `changed` counts rows written, which is the number the toast states — the
 *  collector asked about a stamp and is told how many of its rows moved. */
export interface ColnectLocalFixResult {
  changed: number;
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

/** The list this fix is against, or a refusal. Every entry point starts here, so a stale list id
 *  answers "that list is not set up for sync" rather than fixing the wrong thing. */
async function readMapping(collectionId: string, lt: number) {
  const mapping = await prisma.colnectListMapping.findFirst({
    where: { collectionId, lt, enabled: true },
    select: { id: true, label: true, source: true, sourceOfTruth: true },
  });
  if (!mapping) throw new ColnectLocalFixError("That Colnect list is not set up for sync.");
  return {
    ...mapping,
    source: mapping.source as ColnectListSource,
    sourceOfTruth: mapping.sourceOfTruth as ColnectListSourceOfTruth,
  };
}

/** The bucket off the request, or a refusal. */
function assertBucket(bucket: string): ColnectListBucket {
  if (!isColnectListBucket(bucket)) {
    throw new ColnectLocalFixError(`"${bucket}" is not a bucket this report files rows under.`);
  }
  return bucket;
}

/** The stamp this collection holds under a Colnect id, or null. The report's `candidateStampId`,
 *  asked again at write time — see the module note on why nothing is taken from the request. */
async function candidateStamp(collectionId: string, colnectId: string) {
  const trimmed = colnectId.trim();
  if (!trimmed) return null;
  return prisma.stamp.findFirst({
    where: { collectionId, colnectId: trimmed },
    select: { id: true, name: true },
  });
}

/**
 * The one local condition a Colnect abbreviation means **here**, through `ColnectConditionMapping`
 * (#404) — read backwards, which is the direction that can fail.
 *
 * Forwards the mapping is a function: one condition, one grade. Backwards it need not be — the
 * unique is on the condition, so two of them may both map to `MNH` — and where it is not, this
 * answers null rather than picking. Narrowing a want to a guessed condition would be exactly the
 * invention #686 refused to make when it declined to compare grades the local side disagrees on.
 */
async function conditionForGrade(
  collectionId: string,
  abbrev: string | null
): Promise<{ id: string; name: string } | null> {
  const key = abbrev?.trim().toUpperCase();
  if (!key) return null;
  const grade = COLNECT_CONDITIONS.find((g) => g.abbrev.toUpperCase() === key);
  if (!grade) return null;
  const mappings = await prisma.colnectConditionMapping.findMany({
    where: { collectionId, colnectValue: grade.value },
    select: { stampCondition: { select: { id: true, name: true } } },
  });
  if (mappings.length !== 1) return null;
  return mappings[0].stampCondition;
}

/** The copies a copy-backed fix would write to: in hand, and on the wrong side of the flag. */
async function copiesToTouch(
  collectionId: string,
  stampId: string,
  flag: "inCollection" | "forTrade" | "forSale",
  want: boolean
): Promise<ColnectLocalFixCopy[]> {
  const rows = await prisma.item.findMany({
    where: {
      collectionId,
      stampId,
      [flag]: !want,
      // *In hand*, the report's own predicate: a copy already sold or given away is not on offer,
      // and a list still naming it is the discrepancy rather than an input to it.
      deliveryState: "delivered",
      disposedAt: null,
    },
    orderBy: { itemNo: "asc" },
    select: {
      id: true,
      itemNo: true,
      condition: { select: { name: true, abbreviation: true } },
      format: { select: { name: true } },
      location: { select: { name: true } },
      locationRef: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    itemNo: row.itemNo,
    conditionName: row.condition.name,
    conditionAbbreviation: row.condition.abbreviation,
    formatName: row.format?.name ?? null,
    locationName: row.location?.name ?? null,
    locationRef: row.locationRef,
  }));
}

/** The open wants a want-backed fix would write to. */
async function wantsToTouch(
  collectionId: string,
  stampId: string
): Promise<ColnectLocalFixWant[]> {
  const rows = await prisma.want.findMany({
    where: { collectionId, stampId, closedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      conditions: { select: { condition: { select: { name: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    conditionNames: row.conditions.map((c) => c.condition.name),
  }));
}

/**
 * What a fix would do to which rows, resolved fresh. Owner-authorized.
 *
 * The dialog renders this and only then offers the action, which is the issue's own condition: the
 * action names the copies it will touch before it takes them.
 */
export async function previewColnectLocalFix(
  ownerId: string,
  collectionId: string,
  lt: number,
  colnectId: string,
  bucket: string,
  fix: ColnectLocalFix,
  colnectGrade: string | null = null
): Promise<ColnectLocalFixPreview> {
  await assertCollectionOwner(ownerId, collectionId);
  const mapping = await readMapping(collectionId, lt);
  const parsedBucket = assertBucket(bucket);

  const allowed = colnectLocalFixesFor({
    bucket: parsedBucket,
    source: mapping.source,
    sourceOfTruth: mapping.sourceOfTruth,
    // The count is re-derived below for `set`; here it only has to be non-zero for the guard to let
    // the resolution run, and the resolution is what decides.
    candidateCopies: fix === "set" ? 1 : null,
  });
  if (!allowed.includes(fix)) {
    throw new ColnectLocalFixError(
      `A ${colnectListBucketLabel(parsedBucket).toLowerCase()} row on ${mapping.label} has no such fix here.`
    );
  }

  const stamp = await candidateStamp(collectionId, colnectId);
  if (!stamp) {
    throw new ColnectLocalFixError(
      "Nothing in this collection carries that Colnect ID, so there is nothing here to correct."
    );
  }

  const shape = colnectListSourceShape(mapping.source);
  const base = {
    fix,
    stampId: stamp.id,
    stampName: stamp.name,
    copies: [] as ColnectLocalFixCopy[],
    wants: [] as ColnectLocalFixWant[],
    conditionId: null as string | null,
    conditionName: null as string | null,
    colnectGrade,
  };

  if (fix === "grade") {
    const condition = await conditionForGrade(collectionId, colnectGrade);
    if (!condition) {
      throw new ColnectLocalFixError(
        `"${colnectGrade ?? ""}" does not resolve to exactly one of this collection's conditions, so there is no grade to narrow to.`
      );
    }
    return {
      ...base,
      wants: await wantsToTouch(collectionId, stamp.id),
      conditionId: condition.id,
      conditionName: condition.name,
    };
  }

  if (shape.kind === "wants") {
    // `clear` on a want-backed list: close the open wants.
    return { ...base, wants: await wantsToTouch(collectionId, stamp.id) };
  }

  const copies = await copiesToTouch(collectionId, stamp.id, shape.flag, fix === "set");
  if (copies.length === 0) {
    throw new ColnectLocalFixError(
      fix === "set"
        ? "There is no copy in hand to mark — this list can only flag copies you already hold."
        : "No copy of that stamp still carries the flag, so the row is already gone from the report."
    );
  }
  return { ...base, copies };
}

/**
 * Apply the fix the preview described. Owner-authorized.
 *
 * It resolves everything again rather than taking the preview's ids: the preview may be a dialog the
 * collector left open while another tab sold one of the copies, and the report's promise is that a
 * fix acts on the rows the predicate holds for **now**.
 */
export async function applyColnectLocalFix(
  ownerId: string,
  collectionId: string,
  lt: number,
  colnectId: string,
  bucket: string,
  fix: ColnectLocalFix,
  colnectGrade: string | null = null
): Promise<ColnectLocalFixResult> {
  const preview = await previewColnectLocalFix(
    ownerId,
    collectionId,
    lt,
    colnectId,
    bucket,
    fix,
    colnectGrade
  );
  const mapping = await readMapping(collectionId, lt);
  const shape = colnectListSourceShape(mapping.source);

  if (fix === "grade") {
    const conditionId = preview.conditionId;
    if (!conditionId) throw new ColnectLocalFixError("No grade to narrow to.");
    const wantIds = preview.wants.map((want) => want.id);
    if (wantIds.length === 0) return { changed: 0 };
    // A replacement, not an addition: the list states one grade and the want is being narrowed to
    // it, which is the whole point of the correction. `updateWant` would be the other idiom, but it
    // takes a whole want and this changes one axis of several at once.
    await prisma.$transaction([
      prisma.wantCondition.deleteMany({ where: { wantId: { in: wantIds } } }),
      prisma.wantCondition.createMany({
        data: wantIds.map((wantId) => ({ wantId, conditionId })),
      }),
    ]);
    return { changed: wantIds.length };
  }

  if (shape.kind === "wants") {
    const wantIds = preview.wants.map((want) => want.id);
    if (wantIds.length === 0) return { changed: 0 };
    const closed = await prisma.want.updateMany({
      where: { id: { in: wantIds }, collectionId, closedAt: null },
      data: { closedAt: new Date() },
    });
    return { changed: closed.count };
  }

  const ids = preview.copies.map((copy) => copy.id);
  if (ids.length === 0) return { changed: 0 };
  const updated = await prisma.item.updateMany({
    where: { id: { in: ids }, collectionId },
    data: { [shape.flag]: fix === "set" },
  });
  return { changed: updated.count };
}
