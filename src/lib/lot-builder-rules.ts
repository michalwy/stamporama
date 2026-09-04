// The bulk-lot builder's selection rules (#758) — the pure half of #756. No React, no Prisma, so
// the server read (#759), the wizard screen (#760) and the unit tests share one derivation, and
// the commit re-plans through this same function rather than being handed a plan (#717's rule).
//
// What is being decided here is **which hundred copies go into a job lot**, and that is not a
// filter. The structural narrowing — platform availability, area, year, condition, format — has
// already happened in SQL by the time this module runs; what is left is a constrained pick against
// two range targets with two preferences, over a pool that has to keep its dear copies back.
//
// Everything below is a pure function of `(pool, checklists, criteria, seed, pinned, rejected)`.
// The pick is randomized and the seed is what makes it reproducible, so "re-roll" is a new seed
// and nothing else. The pool's own order never reaches the result: the candidates are sorted by
// `itemId` before they are shuffled, so two reads that returned the same copies in a different
// order plan the same lot.

import { satisfiedMember, type VariantChain } from "./checklist-completeness-rules";

// The input ------------------------------------------------------------------

/**
 * One copy the pool offers up. Assembled server-side (#759); this module never reads.
 *
 * `catalogValue` is the copy's figure in the collection's base currency — `valuateItemRows`'
 * `baseAmount` — and **null is not zero** (#378). A catalog value is computed and never stored,
 * which is also why the per-copy ceiling is applied here rather than in the pool's `where`.
 */
export interface LotCandidate {
  itemId: string;
  stampId: string;
  /** The stamp's variant chain, nearest first and itself included — `checklist-variant-rollup.ts`.
   *  It answers both questions this module asks of a copy: which checklist slot it covers
   *  ({@link satisfiedMember}), and which pile it is a duplicate of ({@link duplicateKey}). */
  variantChain: VariantChain;
  conditionId: string;
  /** ADR-0020: null **is** a value — it means single. */
  formatId: string | null;
  /** Base-currency catalog value, or null when the copy is unpriced. */
  catalogValue: number | null;
}

/** One series the lot may take whole. A series is a `Checklist` (#531) and `stampIds` is its
 *  membership — the slots, in the checklist's own order. The caller passes the checklists whose
 *  members the pool can touch; deciding which those are is a read, not a rule. */
export interface LotChecklist {
  checklistId: string;
  stampIds: readonly string[];
}

/** A target axis. Both bounds are optional and either may stand alone. */
export interface LotRange {
  min: number | null;
  max: number | null;
}

/** What the lot should do about assemblable series.
 *
 *  - `preferComplete` — run the series phase: every checklist complete **in the pool** is offered
 *    the chance to enter whole, before any single is taken.
 *  - `neutral` — no series phase. Copies are picked by the singles ordering alone and a complete
 *    series may fall out of that by chance, which is neither sought nor avoided.
 *  - `preferSingles` — no series phase, and copies covering a slot of a pool-complete checklist
 *    rank **last**, so a series that could be sold whole survives the lot unless nothing else is
 *    left to fill it. A preference, not a guarantee: the collector's count target still wins,
 *    because refusing the copies outright would silently shrink the lot instead of filling it.
 */
export type SeriesPreference = "preferComplete" | "preferSingles" | "neutral";

/** What the lot should do about duplicate piles.
 *
 *  - `preferDuplicates` — deepest pile first: the stamps held five over are drained before the
 *    stamps held once, so the only copy of a stamp is the last thing to fall into a job lot.
 *  - `neutral` — pile depth plays no part; the seeded order alone decides.
 *
 *  Neither direction is the cap: {@link LotCriteria.maxPerStamp} limits how many copies of one
 *  stamp the lot may hold whichever direction is chosen. */
export type DuplicatePolicy = "preferDuplicates" | "neutral";

export interface LotCriteria {
  /**
   * Per-copy catalog-value ceiling, so a dear stamp cannot fall into a job lot by accident.
   *
   * **An unpriced copy passes it, and is counted.** A missing catalog value is a gap in the data,
   * not a figure, so it may be read neither as "cheap enough" nor as "too dear" (#378). The
   * ceiling filters what is *known* to be dear; everything unpriced goes through and the result
   * names it, so the risk is visible before the offer exists.
   */
  maxCatalogValue: number | null;
  /** Piece count. Null for "no opinion". */
  count: LotRange | null;
  /** Sum of the chosen copies' catalog values, unpriced copies contributing nothing. Null for
   *  "no opinion". */
  catalogValue: LotRange | null;
  series: SeriesPreference;
  /** How many copies of one stamp — rolled up through variants — the lot may hold. Null for no
   *  cap. Counted over the pins too: a pin is a copy in the lot like any other. */
  maxPerStamp: number | null;
  duplicates: DuplicatePolicy;
}

export interface LotBuilderInput {
  pool: readonly LotCandidate[];
  checklists: readonly LotChecklist[];
  criteria: LotCriteria;
  /** The explicit seed. The pick is randomized; this is what makes it reproducible. */
  seed: string;
  /** Taken first, and they eat the target from the top. A pin is the collector's own decision, so
   *  it bypasses the catalog-value ceiling — which guards against accidents, not against choices —
   *  but it does count toward the cap and toward both targets. */
  pinnedItemIds?: readonly string[];
  /** Never proposed. A copy that is both pinned and rejected is not taken: between two
   *  contradictory instructions the one that leaves a copy out is the recoverable one. */
  rejectedItemIds?: readonly string[];
}

// The output -----------------------------------------------------------------

/** Which pass took a copy. */
export type LotPickPhase = "pinned" | "series" | "single";

/** One copy's attribution — how it got in, and under which series where that applies. */
export interface LotPick {
  itemId: string;
  phase: LotPickPhase;
  /** The checklist that pulled the copy in; null for pins and singles. A copy that covers a slot
   *  of a second checklist is not re-attributed: it is one piece of paper, taken once. */
  checklistId: string | null;
}

/** One target axis, reached against what was asked. Both misses are reported rather than thrown:
 *  two range targets over atomic blocks is a knapsack, and this pass is not expected to be
 *  optimal — it is expected to be truthful about how close it got. */
export interface LotAxisReport {
  value: number;
  min: number | null;
  max: number | null;
  /** How far below `min` — 0 when at or above it, and when no min was set. */
  shortBy: number;
  /** How far above `max` — 0 when at or below it, and when no max was set. */
  overBy: number;
  /** Within both bounds that were set. True when neither was. */
  withinRange: boolean;
}

/** Why a series that was complete in the pool did not enter. */
export type RefusedChecklistReason =
  /** Its atomic take would have pushed a stamp over `maxPerStamp`. The cap is a condition the
   *  collector typed; a complete series is a preference, so the cap wins — and the series is
   *  named rather than dropped in silence. */
  | "cap"
  /** Its take would have crossed a target's max, or the targets were already reached. */
  | "target";

export interface RefusedChecklist {
  checklistId: string;
  reason: RefusedChecklistReason;
  /** The stamp whose cap the take would have broken. Set for `cap` only. */
  stampId: string | null;
}

export interface LotPlan {
  /** The chosen copies, in the order they were picked. */
  itemIds: string[];
  /** The same copies with their attribution, in the same order. */
  picks: LotPick[];
  count: LotAxisReport;
  catalogValue: LotAxisReport;
  /** Chosen copies carrying **no** catalog value — named, never counted as zero (#378). They are
   *  the copies that passed the ceiling unpriced and the copies the value sum leaves out, which is
   *  one fact and so one figure rather than two. The pool-wide count is the pool readout's own
   *  (#759); this one describes the lot. */
  unpricedItemIds: string[];
  /** Checklists that entered whole, in the order they were taken. */
  takenChecklistIds: string[];
  /** Checklists complete in the pool that did not enter, with the reason. */
  refusedChecklists: RefusedChecklist[];
  /** Pinned copies the pool no longer holds — listed on another offer since the wizard opened, or
   *  rejected in the same breath. Named, never silently released (#314); the caller decides what
   *  to say about them. */
  missingPinnedItemIds: string[];
}

// Duplicates and capacity ----------------------------------------------------

/**
 * Which pile a copy belongs to: **a stamp, rolled up through variants**. Two copies of `226` and
 * one of `226yw` are three of the same thing to a buyer, so the key is the top of the variant
 * chain — a walk that stops at the first non-variant edge, so a distinct entry (an error, a plate
 * flaw, an overprint) keeps its own pile.
 *
 * Deliberately **not** `copyGroupKey` (#372), which splits on condition: that key exists to answer
 * "what would Colnect take as one quantity offer", and here two conditions of one stamp still read
 * as a repeat in the photograph.
 */
export function duplicateKey(candidate: LotCandidate): string {
  const chain = candidate.variantChain;
  return chain.length > 0 ? chain[chain.length - 1] : candidate.stampId;
}

/** How many copies of each pile a set of candidates holds. */
export function pileDepths(candidates: readonly LotCandidate[]): Map<string, number> {
  const depths = new Map<string, number>();
  for (const candidate of candidates) {
    const key = duplicateKey(candidate);
    depths.set(key, (depths.get(key) ?? 0) + 1);
  }
  return depths;
}

/**
 * `Σ min(copies of that stamp, cap)` — the largest lot the duplicate cap permits out of this pool.
 *
 * The criteria panel's readout (#756) draws it against the count target, and it is an exact
 * ceiling rather than an estimate: it catches a target of 100 against a pool that can only yield
 * 80 before any proposal exists. It lives here so the readout and the pick cannot disagree about
 * what counts as a duplicate.
 */
export function capBoundedCapacity(
  pool: readonly LotCandidate[],
  maxPerStamp: number | null
): number {
  if (maxPerStamp === null) return pool.length;
  let total = 0;
  for (const depth of pileDepths(pool).values()) total += Math.min(depth, maxPerStamp);
  return total;
}

// Checklist coverage ---------------------------------------------------------

/** How far one checklist gets **within a pool** — coverage, not one cell of the
 *  `checklist-completeness-rules.ts` grid. */
export interface ChecklistCoverage {
  checklistId: string;
  /** Slots on the checklist. */
  requiredCount: number;
  /** Of those, the ones at least one pool copy covers. */
  coveredCount: number;
  complete: boolean;
}

/**
 * Which checklists the pool can assemble whole.
 *
 * A checklist is complete *for this lot* when every one of its slots is covered by a copy in the
 * pool, resolved through {@link satisfiedMember} (#661) so a `226yw` copy covers a `226` slot.
 * Coverage is deliberately **mixed** — condition and format need not agree across the series — so
 * this is plain coverage rather than a cell of the completeness grid, whose whole point is to keep
 * those axes apart.
 *
 * Completeness is measured **against the pool**, i.e. after the hard filters and after the
 * ceiling: a series the criteria cannot actually assemble must never be offered as complete. It
 * follows that a checklist whose slot can only be covered by an over-ceiling copy is simply not
 * complete here, which needs no rule of its own.
 *
 * Exported because #759's criteria readout wants the same figure over the same pool, and #754
 * wants it over a wider one: the three must not grow separate completeness derivations.
 */
export function checklistCoverage(
  pool: readonly LotCandidate[],
  checklists: readonly LotChecklist[]
): ChecklistCoverage[] {
  return checklists.map((checklist) => {
    const slots = coveredSlots(pool, checklist);
    const requiredCount = new Set(checklist.stampIds).size;
    let coveredCount = 0;
    for (const candidates of slots.values()) if (candidates.length > 0) coveredCount += 1;
    return {
      checklistId: checklist.checklistId,
      requiredCount,
      coveredCount,
      complete: requiredCount > 0 && coveredCount === requiredCount,
    };
  });
}

/** One slot per member, holding the pool copies that cover it. An empty checklist yields an empty
 *  map, and {@link checklistCoverage} calls it incomplete: a set of nothing is not an achievement,
 *  the same rule the completeness grid keeps. */
function coveredSlots(
  pool: readonly LotCandidate[],
  checklist: LotChecklist
): Map<string, LotCandidate[]> {
  const members = new Set(checklist.stampIds);
  const slots = new Map<string, LotCandidate[]>();
  for (const stampId of members) slots.set(stampId, []);
  for (const candidate of pool) {
    const member = satisfiedMember(candidate.variantChain, members);
    if (member !== null) slots.get(member)?.push(candidate);
  }
  return slots;
}

// The seeded shuffle ---------------------------------------------------------

/** FNV-1a over the seed string. Any stable string-to-int would do; this one is short and has no
 *  dependency behind it. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The same small PRNG the demo seeder uses. Deterministic, and that is the whole requirement. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates, in place, off the given generator. */
function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

const byId = (a: { itemId: string }, b: { itemId: string }) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);

// The pick -------------------------------------------------------------------

/**
 * Plan one bulk lot.
 *
 * Three passes, in order: **pins**, then — under `preferComplete` only — **whole series**, then
 * **singles** to top the lot up. Each pass stops the moment every target axis it was given has
 * reached its floor, and nothing is ever added that would cross a max.
 *
 * **Where a range lands.** The floor of an axis is its `min`, or its `max` when only a max was
 * given: a collector who says "at most 110 pieces" is aiming at 110, and one who says "at least
 * 90" is aiming at 90. With no floor on either axis there is nothing to fill toward and the lot is
 * the pins alone — the caller is expected to supply a bound or a pin, and gets an honest empty
 * result rather than an invented target if it does not.
 */
export function planLot(input: LotBuilderInput): LotPlan {
  const { criteria, seed } = input;
  const rejected = new Set(input.rejectedItemIds ?? []);
  const pinnedIds = (input.pinnedItemIds ?? []).filter((id) => !rejected.has(id));

  const poolById = new Map(input.pool.map((c) => [c.itemId, c]));
  const pinned: LotCandidate[] = [];
  const missingPinnedItemIds: string[] = [];
  for (const id of pinnedIds) {
    const candidate = poolById.get(id);
    if (candidate) pinned.push(candidate);
    else missingPinnedItemIds.push(id);
  }

  const pinnedSet = new Set(pinned.map((c) => c.itemId));
  // Sorted before it is shuffled: the pick must be a function of *which* copies the pool holds,
  // not of the order the read happened to return them in.
  const available = input.pool
    .filter((c) => !rejected.has(c.itemId) && !pinnedSet.has(c.itemId) && passesCeiling(c, criteria.maxCatalogValue))
    .sort(byId);

  const random = mulberry32(hashSeed(seed));
  const seededOrder = new Map(shuffle([...available], random).map((c, i) => [c.itemId, i]));

  // Pile depth is read off what is still available to draw on, once — a depth recomputed after
  // every pick would reorder the queue mid-pass for no gain the collector could describe.
  const depths = pileDepths(available);
  const depthOf = (c: LotCandidate) => depths.get(duplicateKey(c)) ?? 0;
  const orderOf = (c: LotCandidate) => seededOrder.get(c.itemId) ?? 0;

  // Completeness is judged over the whole pool the lot may draw on — the pins included, since a
  // pinned copy is in the lot and covers its slot for free.
  const coveragePool = [...pinned, ...available];
  const complete = checklistCoverage(coveragePool, input.checklists).filter((c) => c.complete);
  const completeIds = new Set(complete.map((c) => c.checklistId));

  const state = newState(criteria);
  for (const candidate of pinned) take(state, candidate, "pinned", null);

  const refusedChecklists: RefusedChecklist[] = [];
  const takenChecklistIds: string[] = [];

  if (criteria.series === "preferComplete") {
    const order = shuffle(
      input.checklists.filter((c) => completeIds.has(c.checklistId)).sort((a, b) => (a.checklistId < b.checklistId ? -1 : 1)),
      random
    );
    for (const checklist of order) {
      if (!needsMore(state)) {
        refusedChecklists.push({ checklistId: checklist.checklistId, reason: "target", stampId: null });
        continue;
      }
      const refusal = takeSeries(state, checklist, coveragePool, depthOf, orderOf);
      if (refusal === null) takenChecklistIds.push(checklist.checklistId);
      else refusedChecklists.push(refusal);
    }
  }

  // The singles top the lot up. `preferSingles` ranks a copy covering a pool-complete series last;
  // `preferDuplicates` ranks the deepest pile first; the seeded order breaks every remaining tie,
  // which is what a re-roll changes.
  const protectedItems =
    criteria.series === "preferSingles" ? seriesCopyIds(coveragePool, input.checklists, completeIds) : new Set<string>();
  const singles = [...available].sort((a, b) => {
    if (protectedItems.size > 0) {
      const pa = protectedItems.has(a.itemId) ? 1 : 0;
      const pb = protectedItems.has(b.itemId) ? 1 : 0;
      if (pa !== pb) return pa - pb;
    }
    if (criteria.duplicates === "preferDuplicates" && depthOf(a) !== depthOf(b)) return depthOf(b) - depthOf(a);
    return orderOf(a) - orderOf(b);
  });

  for (const candidate of singles) {
    if (!needsMore(state)) break;
    if (state.taken.has(candidate.itemId)) continue;
    if (overCap(state, candidate, criteria.maxPerStamp)) continue;
    // Skipped rather than stopped on: a cheaper copy further down may still fit under the max.
    if (crossesMax(state, 1, valueOf(candidate))) continue;
    take(state, candidate, "single", null);
  }

  return {
    itemIds: state.picks.map((p) => p.itemId),
    picks: state.picks,
    count: axisReport(state.picks.length, criteria.count),
    catalogValue: axisReport(state.value, criteria.catalogValue),
    unpricedItemIds: state.unpricedItemIds,
    takenChecklistIds,
    refusedChecklists,
    missingPinnedItemIds,
  };
}

/** The ceiling filters what is *known* to be dear. An unpriced copy goes through (#378). */
function passesCeiling(candidate: LotCandidate, maxCatalogValue: number | null): boolean {
  if (maxCatalogValue === null || candidate.catalogValue === null) return true;
  return candidate.catalogValue <= maxCatalogValue;
}

/** What a copy adds to the value axis. An unpriced copy adds nothing and is named in
 *  `unpricedItemIds` instead — the sum says what is known, and the list says what it leaves out. */
function valueOf(candidate: LotCandidate): number {
  return candidate.catalogValue ?? 0;
}

// The running pick -----------------------------------------------------------

interface PickState {
  criteria: LotCriteria;
  picks: LotPick[];
  taken: Set<string>;
  unpricedItemIds: string[];
  perPile: Map<string, number>;
  value: number;
}

function newState(criteria: LotCriteria): PickState {
  return { criteria, picks: [], taken: new Set(), unpricedItemIds: [], perPile: new Map(), value: 0 };
}

function take(state: PickState, candidate: LotCandidate, phase: LotPickPhase, checklistId: string | null): void {
  state.picks.push({ itemId: candidate.itemId, phase, checklistId });
  state.taken.add(candidate.itemId);
  const key = duplicateKey(candidate);
  state.perPile.set(key, (state.perPile.get(key) ?? 0) + 1);
  state.value += valueOf(candidate);
  if (candidate.catalogValue === null) state.unpricedItemIds.push(candidate.itemId);
}

/** An axis is aimed at its `min`, or at its `max` when that is the only bound given. */
function floorOf(range: LotRange | null): number | null {
  if (range === null) return null;
  return range.min ?? range.max;
}

/** Still below the floor of some axis that has one. False when no axis has a floor — there is then
 *  nothing to fill toward, and the lot is whatever the pins made it. */
function needsMore(state: PickState): boolean {
  const countFloor = floorOf(state.criteria.count);
  const valueFloor = floorOf(state.criteria.catalogValue);
  if (countFloor !== null && state.picks.length < countFloor) return true;
  if (valueFloor !== null && state.value < valueFloor) return true;
  return false;
}

/** Would adding this much cross a max that was set? */
function crossesMax(state: PickState, addedCount: number, addedValue: number): boolean {
  const countMax = state.criteria.count?.max ?? null;
  const valueMax = state.criteria.catalogValue?.max ?? null;
  if (countMax !== null && state.picks.length + addedCount > countMax) return true;
  if (valueMax !== null && state.value + addedValue > valueMax) return true;
  return false;
}

function overCap(state: PickState, candidate: LotCandidate, maxPerStamp: number | null): boolean {
  if (maxPerStamp === null) return false;
  return (state.perPile.get(duplicateKey(candidate)) ?? 0) >= maxPerStamp;
}

// The series pass ------------------------------------------------------------

/**
 * Take one checklist whole, or refuse it and say why. **A series enters atomically**: a lot that
 * carries four fifths of a set is not what the collector asked for, so nothing is taken at all
 * unless the whole take fits.
 *
 * Slots already covered by a copy in the lot — a pin, or a copy taken for an earlier checklist that
 * shares the stamp — cost nothing: it is one piece of paper and it is already there.
 *
 * Which copy covers a slot when several could: **the cheapest**. It keeps a dear copy free for an
 * individual listing, which is the reason the per-copy ceiling exists at all; an unpriced copy
 * sorts last, because a gap in the data is not the cheapest figure (#378). Pile depth breaks a tie
 * on value and the seeded order breaks what is left — the depth rarely bites, since every copy
 * that can cover one slot rolls up to the same pile by construction, but the queue has to be
 * total for the seed to reproduce a pick.
 */
function takeSeries(
  state: PickState,
  checklist: LotChecklist,
  pool: readonly LotCandidate[],
  depthOf: (c: LotCandidate) => number,
  orderOf: (c: LotCandidate) => number
): RefusedChecklist | null {
  const slots = coveredSlots(pool, checklist);
  const additions: LotCandidate[] = [];
  const wouldAdd = new Map<string, number>();

  for (const [, candidates] of slots) {
    if (candidates.some((c) => state.taken.has(c.itemId))) continue;
    const choice = [...candidates].sort((a, b) => {
      const va = a.catalogValue;
      const vb = b.catalogValue;
      if ((va === null) !== (vb === null)) return va === null ? 1 : -1;
      if (va !== null && vb !== null && va !== vb) return va - vb;
      if (depthOf(a) !== depthOf(b)) return depthOf(b) - depthOf(a);
      return orderOf(a) - orderOf(b);
    })[0];
    // The checklist was complete over this pool, so every slot has a copy; a slot without one can
    // only mean the caller passed a coverage set the completeness was not measured over.
    if (!choice) continue;
    additions.push(choice);
    const key = duplicateKey(choice);
    wouldAdd.set(key, (wouldAdd.get(key) ?? 0) + 1);
  }

  // The cap beats the series: it is a condition the collector typed, and a complete series is a
  // preference. The stamp is named so the wizard can say which one blocked it.
  const cap = state.criteria.maxPerStamp;
  if (cap !== null) {
    for (const [key, added] of wouldAdd) {
      if ((state.perPile.get(key) ?? 0) + added > cap) {
        return { checklistId: checklist.checklistId, reason: "cap", stampId: key };
      }
    }
  }

  const addedValue = additions.reduce((sum, c) => sum + valueOf(c), 0);
  if (crossesMax(state, additions.length, addedValue)) {
    return { checklistId: checklist.checklistId, reason: "target", stampId: null };
  }

  for (const candidate of additions) take(state, candidate, "series", checklist.checklistId);
  return null;
}

/** Every copy covering a slot of a checklist that is complete in the pool — what `preferSingles`
 *  keeps back to the end of the queue. */
function seriesCopyIds(
  pool: readonly LotCandidate[],
  checklists: readonly LotChecklist[],
  completeIds: ReadonlySet<string>
): Set<string> {
  const ids = new Set<string>();
  for (const checklist of checklists) {
    if (!completeIds.has(checklist.checklistId)) continue;
    const members = new Set(checklist.stampIds);
    for (const candidate of pool) {
      if (satisfiedMember(candidate.variantChain, members) !== null) ids.add(candidate.itemId);
    }
  }
  return ids;
}

// Reporting ------------------------------------------------------------------

function axisReport(value: number, range: LotRange | null): LotAxisReport {
  const min = range?.min ?? null;
  const max = range?.max ?? null;
  const shortBy = min !== null && value < min ? min - value : 0;
  const overBy = max !== null && value > max ? value - max : 0;
  return { value, min, max, shortBy, overBy, withinRange: shortBy === 0 && overBy === 0 };
}
