// Which offer states the Offers card of a copy, stamp and issue page — and the View offers window
// opened from a list row — shows (#2263). Every state not closed is on by default; sold and
// withdrawn are history and off until their chips are switched on. Remembered per collection, the
// same in all four places. Pure (no React / Prisma), so the rules are unit-tested here and the card
// only draws them.

import {
  OFFER_STATES,
  OFFER_STATE_LABEL,
  OPEN_OFFER_STATES,
  type OfferState,
} from "./offer-rules";

/** The states shown before the collector has switched any chip. */
export const DEFAULT_SHOWN_OFFER_STATES: readonly OfferState[] = OPEN_OFFER_STATES;

/** How "every chip switched off" is stored — `""` already means the default. */
const NONE_SHOWN = "none";

/**
 * The states a stored value shows, in the lifecycle's order. Nothing stored — and a value naming no
 * state the app still has — reads as the default.
 */
export function parseShownOfferStates(raw: string | null | undefined): OfferState[] {
  if (!raw) return [...DEFAULT_SHOWN_OFFER_STATES];
  if (raw === NONE_SHOWN) return [];
  const named = new Set(raw.split(",").map((s) => s.trim()));
  const shown = OFFER_STATES.filter((s) => named.has(s));
  return shown.length === 0 ? [...DEFAULT_SHOWN_OFFER_STATES] : shown;
}

/** How a choice is written — `""` for the default, so the default is stored as nothing. */
export function writeShownOfferStates(shown: readonly OfferState[]): string {
  const set = new Set(shown);
  const ordered = OFFER_STATES.filter((s) => set.has(s));
  if (ordered.length === 0) return NONE_SHOWN;
  const isDefault =
    ordered.length === DEFAULT_SHOWN_OFFER_STATES.length &&
    DEFAULT_SHOWN_OFFER_STATES.every((s) => set.has(s));
  return isDefault ? "" : ordered.join(",");
}

/** Switch one state's chip on or off. Any number may be on together, none included. */
export function toggleShownOfferState(shown: readonly OfferState[], state: OfferState): OfferState[] {
  const set = new Set(shown);
  if (set.has(state)) set.delete(state);
  else set.add(state);
  return OFFER_STATES.filter((s) => set.has(s));
}

/** One chip: a state the offers are actually in, and how many. A state with none gets no chip. */
export interface OfferStateCount {
  state: OfferState;
  count: number;
}

export function countOffersByState(offers: readonly { state: OfferState }[]): OfferStateCount[] {
  const counts = new Map<OfferState, number>();
  for (const o of offers) counts.set(o.state, (counts.get(o.state) ?? 0) + 1);
  return OFFER_STATES.filter((s) => counts.has(s)).map((state) => ({
    state,
    count: counts.get(state)!,
  }));
}

/** What the card says when its chips leave nothing in view — `2 sold, 1 withdrawn hidden` — so a
 * card with offers never reads as empty. */
export function hiddenOffersText(counts: readonly OfferStateCount[], shown: readonly OfferState[]): string {
  const on = new Set(shown);
  const parts = counts
    .filter((c) => !on.has(c.state))
    .map((c) => `${c.count} ${OFFER_STATE_LABEL[c.state].toLowerCase()}`);
  return `${parts.join(", ")} hidden`;
}
