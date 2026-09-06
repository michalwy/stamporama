import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { buildDescendantMap } from "./pricing";
import { MAX_SIZE_MM, MIN_SIZE_MM, roundSizeMm } from "./stamp-size";

// The collection's stamp size presets (#803; ADR-0048) — the dictionary, and the one write that
// puts a preset's pair onto stamps.
//
// A collector planning an album page knows a stamp's size without having the stamp: an overprint run
// is the same impression as the base issue he measured years ago, on another checklist. #763 gave a
// stamp a size and two ways to obtain one, and **both need a scan** — the ruler in `TileZoomView`
// through `Collection.scanDpi`, or an estimate off a `ScanTile`'s crop. Its fallback cannot reach
// the figure either: `resolveStampSize` walks one checklist, and a new overprint run *is* its own
// checklist, so every stamp in it resolves to nothing. A preset is the way to state a figure he
// already knows, for a whole series at once, without measuring anything.
//
// ## Copied, never referenced
//
// Applying writes `Stamp.widthMm` / `Stamp.heightMm` and the relationship ends there. There is no
// `stampSizePresetId` on `Stamp`, nothing resolves a preset at read time, and nothing downstream can
// tell a stamp sized from a preset from one sized with a ruler — because there is nothing to tell.
// `AlbumTemplate` (#766) and `AcceptanceProfile` (#533) are the precedent, and the reason is #763's
// own: a size is either set on this stamp or absent, one source of truth. A reference would be a
// third state — *set, but somewhere else, and liable to change under you* — and every surface that
// draws a box (#769) or cuts a strip (#770) would have to learn about it.
//
// The cost is real and accepted: **correcting a preset does not correct stamps already set from it**
// (ADR-0048 §1). Under the scope this module was built to, the pair is immutable and only the label
// is editable, so correcting one is a delete and a create — which lands exactly where §1 says it
// lands, and keeps the duplicate-pair error on the single path that can raise it.
//
// ## `src/lib/stamp-size.ts` gains nothing
//
// The resolution rule, the parsing and the rounding are unchanged, and `resolveStampSize`'s
// checklist fallback stays as it is: it is what a collection that has not used presets still relies
// on, and what covers stamps a preset was never applied to. A preset simply means more stamps state
// their own size, which is the state the fallback was always the substitute for.

/** How a preset states a size: the pair, in millimetres, at `SIZE_DECIMALS`. */
export interface StampSizePresetPair {
  widthMm: number;
  heightMm: number;
}

/** A preset as it is created — the pair, and the optional label. */
export interface StampSizePresetInput extends StampSizePresetPair {
  name?: string | null;
}

/** A preset as the picker and the Settings panel read one. */
export interface StampSizePresetData extends StampSizePresetPair {
  id: string;
  name: string | null;
  sortOrder: number;
}

/**
 * Raised on `@@unique([collectionId, widthMm, heightMm])`.
 *
 * Its own error rather than a generic failed save — `HawidStripHeightTakenError`'s convention, and
 * for the same reason one model up: the **numbers are the identity** (ADR-0048 §3), so a second
 * preset stating the same pair is not a save that went wrong, it is the pair the collector was
 * reaching for already being on the list. The message says so.
 */
export class StampSizePresetPairTakenError extends Error {
  constructor(pair: StampSizePresetPair) {
    super(`A ${formatPair(pair)} preset is already saved.`);
    this.name = "StampSizePresetPairTakenError";
  }
}

/**
 * Raised by a figure this app will not accept as a dimension.
 *
 * #763's asymmetry, one layer down: a size that cannot be read is **nothing at all**, and storing it
 * as *no size* would be worse than refusing it, because the stamp then borrows its checklist
 * neighbour's figure and a hawid is cut to a number nobody accepted. `parseStampSizeInput` makes
 * that call for a form; this makes it for every other door into the module.
 */
export class StampSizePresetFigureError extends Error {
  constructor(field: "width" | "height") {
    super(`The preset's ${field} must be a figure in millimetres between ${MIN_SIZE_MM} and ${MAX_SIZE_MM}.`);
    this.name = "StampSizePresetFigureError";
  }
}

/** `25 × 30 mm`, the way the picker and the errors both say it. Not `formatStampSize`: that reads a
 *  half-stated pair, and a preset is never half. */
function formatPair(pair: StampSizePresetPair): string {
  return `${pair.widthMm} × ${pair.heightMm} mm`;
}

/**
 * One figure as the module will store it: bounds first, then rounded to `SIZE_DECIMALS`.
 *
 * **In that order, because that is `parseSizeMm`'s order** (#763) and the two are the same gate seen
 * from two doors — a preset saved from the attributes tab goes through `parseStampSizeInput`, and
 * one saved from anywhere else comes through here. A figure the form refuses must not be a figure
 * this accepts, or the rule would depend on which screen the collector was standing on.
 */
function normalizeFigure(mm: number, field: "width" | "height"): number {
  if (!Number.isFinite(mm)) throw new StampSizePresetFigureError(field);
  if (mm < MIN_SIZE_MM || mm > MAX_SIZE_MM) throw new StampSizePresetFigureError(field);
  return roundSizeMm(mm);
}

/** The pair as it is stored, and therefore the pair the unique index compares. Rounding on the way
 *  in is what makes the value shown in the picker byte-for-byte the value that lands on the stamp:
 *  a figure carrying more precision, stored and quietly truncated by `Decimal(5, 1)`, would come
 *  back different from the one the collector accepted. */
function normalizePair(input: StampSizePresetPair): StampSizePresetPair {
  return {
    widthMm: normalizeFigure(input.widthMm, "width"),
    heightMm: normalizeFigure(input.heightMm, "height"),
  };
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

async function resolvePresetCollection(presetId: string): Promise<string> {
  const preset = await prisma.stampSizePreset.findUnique({
    where: { id: presetId },
    select: { collectionId: true },
  });
  if (!preset) throw new Error("Stamp size preset not found.");
  return preset.collectionId;
}

const PRESET_SELECT = {
  id: true,
  widthMm: true,
  heightMm: true,
  name: true,
  sortOrder: true,
} satisfies Prisma.StampSizePresetSelect;

type PresetRow = {
  id: string;
  widthMm: Prisma.Decimal;
  heightMm: Prisma.Decimal;
  name: string | null;
  sortOrder: number;
};

/** `Decimal` turned into the plain numbers every pure rule in the app is written against —
 *  `stampSizeFields`' job for a stamp, done here for a preset. */
function presetData(row: PresetRow): StampSizePresetData {
  return {
    id: row.id,
    widthMm: row.widthMm.toNumber(),
    heightMm: row.heightMm.toNumber(),
    name: row.name,
    sortOrder: row.sortOrder,
  };
}

/** The collection's presets in the collector's own dragged order — which is the order the picker
 *  reads them in. Deliberately not most-recently-used: a list that reorders itself cannot be found
 *  by muscle memory (ADR-0048, *Deliberately left out*). */
export async function getStampSizePresets(
  ownerId: string,
  collectionId: string
): Promise<StampSizePresetData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.stampSizePreset.findMany({
    where: { collectionId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: PRESET_SELECT,
  });
  return rows.map(presetData);
}

function rethrowPairClash(err: unknown, pair: StampSizePresetPair): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new StampSizePresetPairTakenError(pair);
  }
  throw err;
}

/**
 * Saves a pair, appended at the end of the collector's order.
 *
 * The name is optional on purpose (ADR-0048 §3): the button that calls this sits beside the width
 * and height fields on the attributes tab and saves **whatever is in them at that moment**, so a
 * required name would put a text field between finishing a measurement and keeping it — the exact
 * moment this feature exists to make cheap. Naming happens afterwards, in Settings.
 */
export async function createStampSizePreset(
  ownerId: string,
  collectionId: string,
  input: StampSizePresetInput
): Promise<StampSizePresetData> {
  await assertCollectionOwner(ownerId, collectionId);
  const pair = normalizePair(input);
  const last = await prisma.stampSizePreset.findFirst({
    where: { collectionId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  try {
    const row = await prisma.stampSizePreset.create({
      data: {
        collectionId,
        ...pair,
        name: input.name?.trim() || null,
        sortOrder: last ? last.sortOrder + 1 : 0,
      },
      select: PRESET_SELECT,
    });
    return presetData(row);
  } catch (err) {
    rethrowPairClash(err, pair);
  }
}

/**
 * Renames a preset. **The pair is not editable, and that is the shape #803 scoped**: the numbers are
 * the identity, so changing them is changing which preset this is — a delete and a create, which is
 * also what ADR-0048 §1 describes correcting one as, since the stamps already set from it do not
 * follow either way.
 */
export async function renameStampSizePreset(
  ownerId: string,
  presetId: string,
  name: string | null
): Promise<void> {
  const collectionId = await resolvePresetCollection(presetId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampSizePreset.update({
    where: { id: presetId },
    data: { name: name?.trim() || null },
  });
}

/** Deletes a preset. **Nothing points at one** — applying copies the pair onto the stamp — so there
 *  is no in-use check to make and nothing to warn about: the stamps it sized keep the figures they
 *  hold, which is the whole of decision 1. */
export async function deleteStampSizePreset(ownerId: string, presetId: string): Promise<void> {
  const collectionId = await resolvePresetCollection(presetId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampSizePreset.delete({ where: { id: presetId } });
}

/** Persists a new order. `orderedIds` must be exactly the collection's presets; `sortOrder` is
 *  rewritten to match array position, as `reorderHawidStrips` does. */
export async function reorderStampSizePresets(
  ownerId: string,
  collectionId: string,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const existing = await prisma.stampSizePreset.findMany({
    where: { collectionId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((p) => p.id));
  if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) {
    throw new Error("Reorder list does not match the collection's stamp size presets.");
  }
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.stampSizePreset.update({ where: { id }, data: { sortOrder: i } })
    )
  );
}

/**
 * What a preset is being applied to (ADR-0048 §4). Four entry points, three subjects: the stamp-range
 * dialog and the stamp tree's selection both name an explicit list of stamps, while an issue and a
 * checklist name themselves. They differ only in how they name the set — one write serves all four.
 */
export type StampSizePresetSubject =
  | { kind: "issue"; issueId: string }
  | { kind: "checklist"; checklistId: string }
  | { kind: "stamps"; stampIds: string[] };

export interface ApplyStampSizePresetInput {
  presetId: string;
  subject: StampSizePresetSubject;
  /** Whether stamps that already state a figure are written over. **Defaults to false**, and the
   *  dialog's checkbox is unchecked (ADR-0048 §6). */
  overwriteStated?: boolean;
  /** Count and report, write nothing. What the dialog calls before the collector commits. */
  preview?: boolean;
}

/**
 * What the apply did, or would do. The counts are what the dialog states before anything is written
 * — *17 stamps have no size and will get 25 × 30 mm; 3 already state one*.
 */
export interface StampSizePresetApplyResult extends StampSizePresetPair {
  /** Every stamp the subject reaches, variant descendants included. What the preview counts over. */
  total: number;
  /** Stamps storing neither figure. These take the pair whatever the checkbox says. */
  withoutSize: number;
  /** Stamps storing at least one figure. Skipped unless `overwriteStated`. */
  withStatedSize: number;
  /** Rows actually written. **Zero on a preview**, which is how a caller tells the two apart. */
  written: number;
}

/** The subject's own stamps, before the subtree walk — and the check that it belongs to this
 *  collection at all, made explicitly rather than folded into the `where`: an issue in somebody
 *  else's collection must be an error, not an empty result reported as *nothing to do*. */
async function resolveSubjectRoots(
  collectionId: string,
  subject: StampSizePresetSubject
): Promise<string[]> {
  if (subject.kind === "issue") {
    const issue = await prisma.issue.findUnique({
      where: { id: subject.issueId },
      select: { collectionId: true },
    });
    if (!issue || issue.collectionId !== collectionId) throw new Error("Issue not found.");
    const members = await prisma.issueMember.findMany({
      where: { issueId: subject.issueId },
      select: { stampId: true },
    });
    return members.map((m) => m.stampId);
  }
  if (subject.kind === "checklist") {
    const checklist = await prisma.checklist.findUnique({
      where: { id: subject.checklistId },
      select: { collectionId: true },
    });
    if (!checklist || checklist.collectionId !== collectionId) {
      throw new Error("Checklist not found.");
    }
    const entries = await prisma.checklistStamp.findMany({
      where: { checklistId: subject.checklistId },
      select: { stampId: true },
    });
    return entries.map((e) => e.stampId);
  }
  const wanted = [...new Set(subject.stampIds)];
  if (wanted.length === 0) return [];
  const found = await prisma.stamp.findMany({
    where: { id: { in: wanted }, collectionId },
    select: { id: true },
  });
  if (found.length !== wanted.length) throw new Error("Stamp not found in this collection.");
  return found.map((s) => s.id);
}

/**
 * Every stamp a subject reaches: its own, and **every descendant of every one of them, at any
 * depth** — `309`, `309A`, `309AP`, `309APa`.
 *
 * ADR-0048 §7, and it will look like a breach of #763's "nothing is inherited down the variant
 * tree", which is why it is spelled out here as well as there. That rule is about **resolution** —
 * a child does not *read* its parent's value, it states its own or none. This is a **write**: the
 * collector is asserting a figure about a printing, and a variant of an overprint is the same
 * impression on the same paper, so writing it to the subtree stores a real value on each stamp,
 * which is what every other size in the app is. Leaving the subtree out would leave exactly the
 * stamps that reach an album page sizeless — a specialized page is made of variants — and they
 * would then fall back to a checklist neighbour, which is the borrowing this feature exists to
 * avoid.
 *
 * **No `actsAsVariant` filter, deliberately.** `checklist-variant-rollup.ts` walks the same edges
 * and does filter, because *holding* a distinct entry is not another way of holding its parent
 * (ADR-0010 §3) — a question about collecting. This one is a question about paper: a plate flaw
 * under `309` was printed on the same press at the same size, and it is exactly the sort of stamp a
 * specialized page is made of. ADR-0048 §7's body and #803's scope line both say *every descendant
 * at any depth*, and this is the reading that matches them.
 *
 * One recursive walk whatever the subject's size — `pricing.ts`'s `buildDescendantMap`, the walk the
 * price rollup and the completeness rollup already take.
 */
async function expandSubtree(collectionId: string, rootIds: string[]): Promise<string[]> {
  const ids = new Set(rootIds);
  if (ids.size === 0) return [];
  const descendantsByRoot = await buildDescendantMap(collectionId, ids);
  for (const set of descendantsByRoot.values()) for (const id of set) ids.add(id);
  return [...ids];
}

/**
 * Writes a preset's pair onto a subject's stamps, or reports what it would write.
 *
 * **Skipping a stated size is the default and the whole of ADR-0048 §6.** A stated size is either a
 * measurement taken with the ruler at a stated dpi or a figure the collector typed on purpose, and a
 * bulk write that silently replaced it would destroy the most expensive data in the feature with the
 * same click that fills in the cheapest. Overwriting stays possible — a series whose early figure
 * was wrong is exactly what a preset should be able to correct — but it is a second decision, taken
 * with the counts on screen.
 *
 * **A stamp storing *either* figure counts as stating one**, which is deliberately not
 * `statedStampSize`'s rule. That rule — half a size is no size — governs **resolution**: half a box
 * cannot be drawn, so a stamp holding only a width resolves through its checklist like one holding
 * nothing. The guard here is not about drawing a box, it is about what the collector typed, and a
 * lone width is as typed as a pair. Reading it as *no size* would let an unchecked checkbox erase
 * it, which is the one outcome §6 exists to prevent.
 *
 * There is nothing to preview about *inherited* sizes: #763 stores none, so a stamp resolving
 * through its checklist is, to this write, a stamp with no size.
 */
export async function applyStampSizePreset(
  ownerId: string,
  input: ApplyStampSizePresetInput
): Promise<StampSizePresetApplyResult> {
  const collectionId = await resolvePresetCollection(input.presetId);
  await assertCollectionOwner(ownerId, collectionId);

  const preset = await prisma.stampSizePreset.findUniqueOrThrow({
    where: { id: input.presetId },
    select: PRESET_SELECT,
  });
  const { widthMm, heightMm } = presetData(preset);

  const roots = await resolveSubjectRoots(collectionId, input.subject);
  const stampIds = await expandSubtree(collectionId, roots);

  const empty: StampSizePresetApplyResult = {
    widthMm,
    heightMm,
    total: 0,
    withoutSize: 0,
    withStatedSize: 0,
    written: 0,
  };
  if (stampIds.length === 0) return empty;

  const rows = await prisma.stamp.findMany({
    where: { id: { in: stampIds }, collectionId },
    select: { id: true, widthMm: true, heightMm: true },
  });

  const sizeless: string[] = [];
  const stated: string[] = [];
  for (const row of rows) {
    if (row.widthMm === null && row.heightMm === null) sizeless.push(row.id);
    else stated.push(row.id);
  }

  const result: StampSizePresetApplyResult = {
    widthMm,
    heightMm,
    total: rows.length,
    withoutSize: sizeless.length,
    withStatedSize: stated.length,
    written: 0,
  };
  if (input.preview) return result;

  const targets = input.overwriteStated ? [...sizeless, ...stated] : sizeless;
  if (targets.length === 0) return result;

  // Scoped by `collectionId` as well as by id: the ids came from this collection's own reads, and
  // repeating the tenancy bound on the write is what keeps that true of the write itself.
  const { count } = await prisma.stamp.updateMany({
    where: { id: { in: targets }, collectionId },
    data: { widthMm, heightMm },
  });
  result.written = count;
  return result;
}
