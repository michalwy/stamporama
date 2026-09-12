// Which series single offers could be recombined into (#1210; #754's design) — the pure half. No
// React, no Prisma, so the screen's read, #1211's compose and the unit tests share one answer.
//
// The question, on **one platform**: which checklists are complete over the copies *not offered
// there yet* together with the copies *offered there singly*, and are **not** complete over the first
// alone. The second clause is what makes it a recombination: a series the available copies already
// complete needs no offer touched, and the bulk-lot builder (#758) and the lot's for-sale
// completeness (#563) already say so.
//
// "Complete" is not decided here. It is `checklistCoverage`, the bulk-lot builder's own coverage over
// a pool — a variant copy covers its parent's slot (#661), condition and format are free to differ —
// asked over two pools. #754's own comment is the reason: one derivation, not a second answer to "is
// this series complete".

import { OPEN_OFFER_STATES, type OfferState } from "./offer-rules";
import {
  checklistCoverage,
  checklistSlots,
  type CoverageCopy,
  type LotChecklist,
} from "./lot-builder-rules";

// Which copies are offered singly ---------------------------------------------------------------

/** The offer states a single may sit in and still count (#1210): every open one. A sold or withdrawn
 *  offer holds nothing — and a withdrawn one has released its copy back to *available* anyway. */
export const RECOMBINABLE_OFFER_STATES: readonly OfferState[] = OPEN_OFFER_STATES;

/** Of those, the ones up on the platform where a buyer can see them. **Paused counts**: it is
 *  suspended, not taken down, and recombining it changes a listing somebody may be watching. */
export const LIVE_RECOMBINATION_STATES: readonly OfferState[] = ["active", "paused"];

export function isLiveForRecombination(state: OfferState): boolean {
  return LIVE_RECOMBINATION_STATES.includes(state);
}

/** One set of an offer on the chosen platform, as the read found it. */
export interface RecombinationOfferSet {
  offerId: string;
  state: OfferState;
  /** The standing bidding flag (#215); it only means anything on an `active` offer. */
  inActiveBidding: boolean;
  itemIds: readonly string[];
}

/** The same reading `buildItemWhere`'s availability clause makes of "in active bidding" (#334). */
function inActiveBidding(set: RecombinationOfferSet): boolean {
  return set.state === "active" && set.inActiveBidding;
}

/**
 * The copies offered **singly** on the platform, each with the offers holding it that way.
 *
 * A copy counts when it is the only copy in its set, in an offer in {@link RECOMBINABLE_OFFER_STATES}
 * — and when **nothing else on the platform has composed it**:
 *
 * - **A copy inside a multi-copy set does not count**, even if a one-copy set elsewhere on the same
 *   platform holds it too. It is already part of a partial series or a pair, and recombining it would
 *   pull it out of that as well.
 * - **A copy in an offer in active bidding never counts** (#334 — a bid commits the copy). Here that
 *   is asked of the platform's own sets; a bid on *another* platform is the read's clause, the same
 *   one the available pool is read under.
 *
 * A copy offered singly in two open offers on one platform names both: taking it out changes both.
 */
export function singlyOfferedCopies(sets: readonly RecombinationOfferSet[]): Map<string, string[]> {
  const offersByItem = new Map<string, string[]>();
  const disqualified = new Set<string>();
  for (const set of sets) {
    if (!RECOMBINABLE_OFFER_STATES.includes(set.state)) continue;
    const single = set.itemIds.length === 1 && !inActiveBidding(set);
    for (const itemId of set.itemIds) {
      if (!single) {
        disqualified.add(itemId);
        continue;
      }
      const offers = offersByItem.get(itemId) ?? [];
      if (!offers.includes(set.offerId)) offers.push(set.offerId);
      offersByItem.set(itemId, offers);
    }
  }
  for (const itemId of disqualified) offersByItem.delete(itemId);
  for (const offers of offersByItem.values()) offers.sort();
  return offersByItem;
}

// Which series ----------------------------------------------------------------------------------

/** One copy that may fill a slot. */
export interface RecombinationCopy extends CoverageCopy {
  itemId: string;
  stampId: string;
  /** The offers holding it singly on the platform. **Empty means available** — not offered there
   *  yet, in the bulk-lot builder's reading (#759). */
  offerIds: readonly string[];
}

export interface RecombinationInput {
  copies: readonly RecombinationCopy[];
  checklists: readonly LotChecklist[];
  /** The state of every offer a copy names. */
  offerStates: ReadonlyMap<string, OfferState>;
}

/** One slot of the series, with every copy that can fill it — available copies first. */
export interface RecombinationSlot {
  stampId: string;
  copies: RecombinationCopy[];
}

/** The fewest offers recombining the series has to change. */
export interface OffersToChange {
  offerIds: string[];
  /** Of those, how many are {@link isLiveForRecombination live}. */
  liveCount: number;
}

export interface RecombinableSeries {
  checklistId: string;
  /** In the checklist's own order. */
  slots: RecombinationSlot[];
  offersToChange: OffersToChange;
}

/**
 * The series on this platform that single offers plus available copies could complete.
 *
 * Listed when complete over **every** copy and not complete over the available ones alone. A series
 * still missing a slot after the singles are counted is not listed either: it is not a recombination
 * yet, only a want.
 */
export function findRecombinableSeries(input: RecombinationInput): RecombinableSeries[] {
  const available = input.copies.filter((copy) => copy.offerIds.length === 0);
  const completeIds = (pool: readonly CoverageCopy[]) =>
    new Set(
      checklistCoverage(pool, input.checklists)
        .filter((coverage) => coverage.complete)
        .map((coverage) => coverage.checklistId)
    );
  const completeOverAll = completeIds(input.copies);
  const completeOverAvailable = completeIds(available);

  const isLive = (offerId: string) => {
    const state = input.offerStates.get(offerId);
    return state !== undefined && isLiveForRecombination(state);
  };

  return input.checklists
    .filter(
      (checklist) =>
        completeOverAll.has(checklist.checklistId) &&
        !completeOverAvailable.has(checklist.checklistId)
    )
    .map((checklist) => {
      const slots = [...checklistSlots(input.copies, checklist)].map(([stampId, copies]) => ({
        stampId,
        copies: [...copies].sort(availableFirst),
      }));
      return {
        checklistId: checklist.checklistId,
        slots,
        offersToChange: fewestOffersToChange(slots, isLive),
      };
    });
}

function availableFirst(a: RecombinationCopy, b: RecombinationCopy): number {
  const aOffered = a.offerIds.length > 0 ? 1 : 0;
  const bOffered = b.offerIds.length > 0 ? 1 : 0;
  if (aOffered !== bOffered) return aOffered - bOffered;
  return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
}

// How many offers would change ------------------------------------------------------------------

/** How many branches the search may explore once it holds an answer. Far beyond any real series —
 *  it exists so a pathological one returns the best cover found rather than hanging the screen. */
const SEARCH_BUDGET = 100_000;

/**
 * The **fewest** offers a recombination has to change, and of those the fewest live ones.
 *
 * Which copy fills a slot is the collector's choice (#1211), so before it is made the only honest
 * figure is the best case — the screen says *at least*. Decided with the user on 2026-09-13: an
 * available copy changes no offer, so a slot one can fill costs nothing; the rest are covered by the
 * smallest set of offers, ties going to the set with fewer live ones (a live listing is the one a
 * buyer is watching).
 *
 * Exact rather than greedy: a slot's copies are few, one offer can hold singles for several slots,
 * and a greedy pass over "the offer covering most slots" is wrong on inputs as small as three slots.
 * Slots with the fewest options go first, and a slot some already-chosen offer covers is taken for
 * free, which prunes nearly everything real.
 */
export function fewestOffersToChange(
  slots: readonly RecombinationSlot[],
  isLive: (offerId: string) => boolean
): OffersToChange {
  const forced: (readonly string[])[][] = [];
  for (const slot of slots) {
    if (slot.copies.length === 0) continue;
    if (slot.copies.some((copy) => copy.offerIds.length === 0)) continue;
    const options = new Map<string, readonly string[]>();
    for (const copy of slot.copies) {
      const ids = [...new Set(copy.offerIds)].sort();
      options.set(ids.join(" "), ids);
    }
    forced.push([...options.values()]);
  }
  forced.sort((a, b) => a.length - b.length);

  const chosen = new Set<string>();
  const search = { best: null as OffersToChange | null, live: 0, budget: SEARCH_BUDGET };
  const improves = (size: number, live: number) =>
    search.best === null ||
    size < search.best.offerIds.length ||
    (size === search.best.offerIds.length && live < search.best.liveCount);

  const visit = (index: number): void => {
    if (search.best !== null && --search.budget < 0) return;
    if (!improves(chosen.size, search.live)) return;
    if (index === forced.length) {
      search.best = { offerIds: [...chosen].sort(), liveCount: search.live };
      return;
    }
    const options = forced[index];
    if (options.some((option) => option.every((id) => chosen.has(id)))) {
      visit(index + 1);
      return;
    }
    for (const option of options) {
      const added = option.filter((id) => !chosen.has(id));
      for (const id of added) {
        chosen.add(id);
        if (isLive(id)) search.live += 1;
      }
      visit(index + 1);
      for (const id of added) {
        chosen.delete(id);
        if (isLive(id)) search.live -= 1;
      }
    }
  };
  visit(0);
  return search.best ?? { offerIds: [], liveCount: 0 };
}
