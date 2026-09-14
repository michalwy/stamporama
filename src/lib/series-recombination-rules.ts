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
// a pool — a variant copy covers its parent's slot (#661) — asked over two pools. #754's own comment
// is the reason: one derivation, not a second answer to "is this series complete".
//
// **What may sit together in one proposal is decided here** (#1265), and it is narrower than the lot
// builder's reading: by default one proposal holds copies of one condition, one certificate status and
// one format, because buyers look for a set in one condition. So the copies are split by
// {@link SeriesCombination} first and the two-pool question is asked **within each group** — a
// checklist complete in MNH and in used is two proposals, and "complete over the available copies
// alone" is asked of the same combination. Mixing is a switch per axis, and a mixed axis simply
// stops splitting the copies.

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
  conditionId: string;
  /** Null: no certificate — a value on this axis (ADR-0006 §2), not a missing one. */
  certificateStatusId: string | null;
  /** Null: a single (ADR-0020) — a value on this axis too. */
  formatId: string | null;
  /** The offers holding it singly on the platform. **Empty means available** — not offered there
   *  yet, in the bulk-lot builder's reading (#759). */
  offerIds: readonly string[];
}

// Which copies may sit together (#1265) --------------------------------------------------------

/** Which axes one proposal may mix. **All off is the default**: a series in one condition, one
 *  certificate status and one format. */
export interface SeriesMixing {
  condition: boolean;
  certificate: boolean;
  format: boolean;
}

export const NO_MIXING: SeriesMixing = { condition: false, certificate: false, format: false };

/**
 * What one proposal's copies share: a value on every axis that is **not** mixed, and nothing on an
 * axis that is. An absent key is a mixed axis; `null` on the certificate or format axis is the value
 * *no certificate* / *single*, so the two must not be confused.
 */
export interface SeriesCombination {
  conditionId?: string;
  certificateStatusId?: string | null;
  formatId?: string | null;
}

type CombinationCopy = Pick<RecombinationCopy, "conditionId" | "certificateStatusId" | "formatId">;

/** The combination a copy belongs to under the given mixing. */
export function combinationOf(copy: CombinationCopy, mixing: SeriesMixing): SeriesCombination {
  return {
    ...(mixing.condition ? {} : { conditionId: copy.conditionId }),
    ...(mixing.certificate ? {} : { certificateStatusId: copy.certificateStatusId }),
    ...(mixing.format ? {} : { formatId: copy.formatId }),
  };
}

/** Whether a copy belongs to a combination: equal on every axis the combination names. */
export function copyMatchesCombination(copy: CombinationCopy, combination: SeriesCombination): boolean {
  return (
    (combination.conditionId === undefined || combination.conditionId === copy.conditionId) &&
    (combination.certificateStatusId === undefined ||
      combination.certificateStatusId === copy.certificateStatusId) &&
    (combination.formatId === undefined || combination.formatId === copy.formatId)
  );
}

/** A stable identity for a combination. JSON of a fixed key order, so `null` and an absent key — a
 *  single and a mixed format — stay different strings. */
export function combinationKey(combination: SeriesCombination): string {
  return JSON.stringify([
    combination.conditionId === undefined ? "*" : combination.conditionId,
    combination.certificateStatusId === undefined ? "*" : combination.certificateStatusId,
    combination.formatId === undefined ? "*" : combination.formatId,
  ]);
}

/**
 * The screen's own criteria, as they live in the address: the four filters, which narrow the
 * candidate copies **before** completeness is judged, and the three mixing switches.
 *
 * The filter parameters are spelled as the Copies list spells them (`conditionIds`, …, comma
 * separated, `"none"` / `"single"` as tickable null values), so one reading of each axis serves both.
 */
export interface SeriesCriteria {
  conditionIds: string[];
  certificateStatusIds: string[];
  formatIds: string[];
  subtypeIds: string[];
  mixing: SeriesMixing;
}

export const DEFAULT_SERIES_CRITERIA: SeriesCriteria = {
  conditionIds: [],
  certificateStatusIds: [],
  formatIds: [],
  subtypeIds: [],
  mixing: NO_MIXING,
};

/**
 * A combination handed across the wire (#1265's compose), checked for shape. Null when it is not
 * one: a malformed card identity must refuse rather than read as *every axis mixed*, which would let
 * copies of another combination in.
 */
export function parseSeriesCombination(value: unknown): SeriesCombination | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out: SeriesCombination = {};
  for (const key of Object.keys(raw)) {
    if (key !== "conditionId" && key !== "certificateStatusId" && key !== "formatId") return null;
  }
  if ("conditionId" in raw) {
    if (typeof raw.conditionId !== "string") return null;
    out.conditionId = raw.conditionId;
  }
  for (const key of ["certificateStatusId", "formatId"] as const) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (v !== null && typeof v !== "string") return null;
    out[key] = v;
  }
  return out;
}

export const SERIES_FILTER_PARAMS =["conditionIds", "certificateStatusIds", "formatIds", "subtypeIds"] as const;

export const SERIES_MIXING_PARAMS: Record<keyof SeriesMixing, string> = {
  condition: "mixConditions",
  certificate: "mixCertificates",
  format: "mixFormats",
};

function csv(sp: URLSearchParams, key: string): string[] {
  return (sp.get(key) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Read the criteria off a query string. Anything unrecognised is no filter and no mixing, so a
 *  stale link shows the default screen rather than an empty one. */
export function parseSeriesCriteria(sp: URLSearchParams): SeriesCriteria {
  return {
    conditionIds: csv(sp, "conditionIds"),
    certificateStatusIds: csv(sp, "certificateStatusIds"),
    formatIds: csv(sp, "formatIds"),
    subtypeIds: csv(sp, "subtypeIds"),
    mixing: {
      condition: sp.get(SERIES_MIXING_PARAMS.condition) === "true",
      certificate: sp.get(SERIES_MIXING_PARAMS.certificate) === "true",
      format: sp.get(SERIES_MIXING_PARAMS.format) === "true",
    },
  };
}

/** The criteria as query parameters — only what differs from the default, so the default screen's
 *  address carries nothing but its platform. */
export function seriesCriteriaParams(criteria: SeriesCriteria): [string, string][] {
  const out: [string, string][] = [];
  for (const key of SERIES_FILTER_PARAMS) {
    if (criteria[key].length > 0) out.push([key, criteria[key].join(",")]);
  }
  for (const axis of Object.keys(SERIES_MIXING_PARAMS) as (keyof SeriesMixing)[]) {
    if (criteria.mixing[axis]) out.push([SERIES_MIXING_PARAMS[axis], "true"]);
  }
  return out;
}

export interface RecombinationInput {
  copies: readonly RecombinationCopy[];
  checklists: readonly LotChecklist[];
  /** The state of every offer a copy names. */
  offerStates: ReadonlyMap<string, OfferState>;
  /** Which axes a proposal may mix. Absent: none — the product default (#1265). */
  mixing?: SeriesMixing;
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
  /** What every copy in the proposal shares (#1265). */
  combination: SeriesCombination;
  /** The proposal's identity: one checklist can be proposed once per combination. */
  key: string;
  /** In the checklist's own order. */
  slots: RecombinationSlot[];
  offersToChange: OffersToChange;
}

/** The fewest distinct stamps a checklist needs to be listed (#1257). Counted as `checklistCoverage`
 *  counts its required slots, so a stamp repeated in a checklist is one slot here too. */
export const MIN_SERIES_STAMPS = 2;

/**
 * The series on this platform that single offers plus available copies could complete.
 *
 * The copies are split by {@link SeriesCombination} under the input's mixing first (#1265), and every
 * question below is asked **within one combination**. A proposal is listed when complete over
 * **every** copy of its combination and not complete over that combination's available ones alone. A
 * series still missing a slot after the singles are counted is not listed either: it is not a
 * recombination yet, only a want. **Nor is a checklist of one stamp** (#1257): the single offer
 * holding it already is the whole series, so composing it would only duplicate that offer.
 *
 * Checklist by checklist, each checklist's proposals in the order their combinations first appear
 * among the copies; the read names and orders them.
 */
export function findRecombinableSeries(input: RecombinationInput): RecombinableSeries[] {
  const mixing = input.mixing ?? NO_MIXING;
  const groups = new Map<string, { combination: SeriesCombination; copies: RecombinationCopy[] }>();
  for (const copy of input.copies) {
    const combination = combinationOf(copy, mixing);
    const key = combinationKey(combination);
    const group = groups.get(key);
    if (group) group.copies.push(copy);
    else groups.set(key, { combination, copies: [copy] });
  }

  const listable = input.checklists.filter(
    (checklist) => new Set(checklist.stampIds).size >= MIN_SERIES_STAMPS
  );
  const isLive = (offerId: string) => {
    const state = input.offerStates.get(offerId);
    return state !== undefined && isLiveForRecombination(state);
  };

  const byChecklist = new Map<string, RecombinableSeries[]>();
  for (const [groupKey, group] of groups) {
    const completeIds = (pool: readonly CoverageCopy[]) =>
      new Set(
        checklistCoverage(pool, listable)
          .filter((coverage) => coverage.complete)
          .map((coverage) => coverage.checklistId)
      );
    const completeOverAll = completeIds(group.copies);
    if (completeOverAll.size === 0) continue;
    const completeOverAvailable = completeIds(group.copies.filter((copy) => copy.offerIds.length === 0));

    for (const checklist of listable) {
      if (!completeOverAll.has(checklist.checklistId)) continue;
      if (completeOverAvailable.has(checklist.checklistId)) continue;
      const slots = [...checklistSlots(group.copies, checklist)].map(([stampId, copies]) => ({
        stampId,
        copies: [...copies].sort(availableFirst),
      }));
      const found = byChecklist.get(checklist.checklistId) ?? [];
      found.push({
        checklistId: checklist.checklistId,
        combination: group.combination,
        key: `${checklist.checklistId}:${groupKey}`,
        slots,
        offersToChange: fewestOffersToChange(slots, isLive),
      });
      byChecklist.set(checklist.checklistId, found);
    }
  }
  return listable.flatMap((checklist) => byChecklist.get(checklist.checklistId) ?? []);
}

function availableFirst(a: RecombinationCopy, b: RecombinationCopy): number {
  const aOffered = a.offerIds.length > 0 ? 1 : 0;
  const bOffered = b.offerIds.length > 0 ? 1 : 0;
  if (aOffered !== bOffered) return aOffered - bOffered;
  return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
}

// How a slot's candidates are shown (#1266) -----------------------------------------------------

/** What makes two candidates for one slot interchangeable on the card. */
export type CandidateIdentity = Pick<
  RecombinationCopy,
  "stampId" | "conditionId" | "certificateStatusId" | "formatId" | "offerIds"
>;

/**
 * A candidate's identity for collapsing (#1266): the stamp it is **of** (a variant is not its parent),
 * its condition, certificate status and format, and **where it comes from** — the exact offers holding
 * it singly, or none for *not offered here yet*. Copies in different offers never share a key, because
 * which offer changes is part of the choice. JSON over a fixed order, so `null` stays a value.
 */
export function candidateKey(copy: CandidateIdentity): string {
  return JSON.stringify([
    copy.stampId,
    copy.conditionId,
    copy.certificateStatusId,
    copy.formatId,
    [...new Set(copy.offerIds)].sort(),
  ]);
}

/** Identical candidates, lowest inventory number first. */
export interface CandidateGroup<T> {
  key: string;
  copies: T[];
}

/**
 * A slot's candidates collapsed into groups of identical copies (#1266), so fourteen used copies of one
 * variant in one offer read as one line with a count. Each group lists its copies lowest number first
 * — the first is the copy a collapsed line chooses. Groups of available copies come first, as the flat
 * list did, then by their lowest number.
 */
export function collapseCandidates<T extends CandidateIdentity & { itemNo: number }>(
  copies: readonly T[]
): CandidateGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const copy of copies) {
    const key = candidateKey(copy);
    const group = groups.get(key);
    if (group) group.push(copy);
    else groups.set(key, [copy]);
  }
  return [...groups]
    .map(([key, group]) => ({ key, copies: [...group].sort((a, b) => a.itemNo - b.itemNo) }))
    .sort((a, b) => {
      const aOffered = a.copies[0].offerIds.length > 0 ? 1 : 0;
      const bOffered = b.copies[0].offerIds.length > 0 ? 1 : 0;
      return aOffered - bOffered || a.copies[0].itemNo - b.copies[0].itemNo;
    });
}

/**
 * The copy a collapsed line stands for (#1266): the one already chosen, when it is in the group — an
 * expanded pick survives collapsing — and otherwise the lowest-numbered, which the line names. Picking
 * a collapsed line chooses exactly this copy, so nothing is chosen invisibly.
 */
export function collapsedChoice(lowestFirst: readonly string[], chosen: string | undefined): string {
  return chosen !== undefined && lowestFirst.includes(chosen) ? chosen : lowestFirst[0];
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

// Composing a series (#1211) --------------------------------------------------------------------

/** The collector's choice: which copy fills each slot, keyed by the slot's stamp. Every slot is
 *  named, the ones with a single candidate too — the client sends the copy it showed, so a copy that
 *  changed underneath is refused by name rather than swapped for whatever fills the slot now. */
export type SeriesPicks = Readonly<Record<string, string>>;

/** Why a composition was refused, in terms the refusal message names. */
export type CompositionRefusal =
  /** A slot of the series has no copy chosen. */
  | { kind: "unchosen"; stampId: string }
  /** The copy chosen for a slot no longer fills it: sold, under bid, composed into another set, no
   *  longer in hand — the re-read no longer counts it. */
  | { kind: "stale"; stampId: string; itemId: string }
  /** A pick names a stamp that is not a slot of this series. */
  | { kind: "not-a-slot"; stampId: string };

export type CompositionCheck =
  | { ok: true; copies: RecombinationCopy[] }
  | { ok: false; refusal: CompositionRefusal };

/**
 * Check the collector's picks against the slots **as re-read at commit** (#717's rule: the commit
 * re-reads; it is never handed a plan).
 *
 * Refuses rather than repairs. A series is atomic, so a copy that stopped being a candidate is named
 * (#314) instead of dropping out or being replaced by another copy nobody chose — where several
 * copies can fill a slot, nothing here chooses between them (#570, ADR-0032). Returns the chosen
 * copies in slot order, which is the order the new set lists them in.
 */
export function checkSeriesPicks(
  slots: readonly RecombinationSlot[],
  picks: SeriesPicks
): CompositionCheck {
  const slotIds = new Set(slots.map((slot) => slot.stampId));
  for (const stampId of Object.keys(picks)) {
    if (!slotIds.has(stampId)) return { ok: false, refusal: { kind: "not-a-slot", stampId } };
  }
  const copies: RecombinationCopy[] = [];
  for (const slot of slots) {
    const itemId = picks[slot.stampId];
    if (itemId === undefined) return { ok: false, refusal: { kind: "unchosen", stampId: slot.stampId } };
    const copy = slot.copies.find((candidate) => candidate.itemId === itemId);
    if (!copy) return { ok: false, refusal: { kind: "stale", stampId: slot.stampId, itemId } };
    copies.push(copy);
  }
  return { ok: true, copies };
}

/** An offer a composition takes sets out of, as it stands before the change. */
export interface CompositionOfferState {
  state: OfferState;
  /** Every set the offer holds now. */
  setCount: number;
}

/** What composing does to one single offer. */
export interface CompositionOfferChange {
  offerId: string;
  /** One per chosen copy the offer holds singly — an offer never lists a copy twice. */
  setsLost: number;
  setsLeft: number;
  /** Nothing is left in it. */
  emptied: boolean;
  /** Emptied and never listed, so it is withdrawn. A live offer emptied stays in its state (#1277). */
  withdrawn: boolean;
  /** Active or Paused: its listing on the platform has to be updated or taken down by hand. */
  live: boolean;
}

/**
 * The offers a composition changes, in the order the chosen copies name them — what the collector
 * sees before committing, and what the commit carries out.
 *
 * Every chosen copy takes its one-copy set out of **each** offer holding it singly; the offer's other
 * sets stay. An available copy changes nothing.
 *
 * An offer left with no sets is withdrawn **only if it was never listed** (Preparing or Ready). A
 * **live** one stays Active or Paused, empty, flagged as changed after listing like any live offer
 * that lost a set (#1277, decided with the user on 2026-09-14, correcting #1211): withdrawing it
 * closed the one record of a listing still up on the platform, and the collector withdraws it himself
 * once it has been taken down there.
 */
export function compositionOutcome(
  chosen: readonly Pick<RecombinationCopy, "offerIds">[],
  offers: ReadonlyMap<string, CompositionOfferState>
): CompositionOfferChange[] {
  const lost = new Map<string, number>();
  for (const copy of chosen) {
    for (const offerId of new Set(copy.offerIds)) lost.set(offerId, (lost.get(offerId) ?? 0) + 1);
  }
  return [...lost].map(([offerId, setsLost]) => {
    const offer = offers.get(offerId);
    const setsLeft = Math.max(0, (offer?.setCount ?? setsLost) - setsLost);
    const live = offer !== undefined && isLiveForRecombination(offer.state);
    return {
      offerId,
      setsLost,
      setsLeft,
      emptied: setsLeft === 0,
      withdrawn: setsLeft === 0 && !live,
      live,
    };
  });
}
