import { DELIVERY_STATES, UNAVAILABLE_DELIVERY_STATES } from "./delivery-state";

// The copy page's *Other copies of this stamp* card (#2090). Pure, so the card and the integration
// test that holds it to the stamp's own count read the same two answers.

/** The delivery states a held copy can be in: every state but the two that mean it never usably
 *  arrived. The in-flight ones stay — a copy on its way or waiting to be sorted is bought, and its
 *  row says which it is. */
export const HELD_DELIVERY_STATES: readonly string[] = DELIVERY_STATES.filter(
  (s) => !(UNAVAILABLE_DELIVERY_STATES as readonly string[]).includes(s)
);

/**
 * The Copies list filters that name **the copies the stamp page counts** — `heldCopiesWhere` in
 * `copy-counts.ts`, spelled as list filters: the stamp's own copies (never a variant's), no carrier
 * of several stamps, none lost or arrived damaged. Sold, traded-away and disposed copies are already
 * off the list by default, and copies whose candidates span variant trees are dropped by `stampId`
 * itself. The copy whose page it is is taken out by the card, not here.
 */
export function otherCopiesFilters(stampId: string) {
  return {
    stampId,
    multiStamp: "exclude" as const,
    deliveryStates: [...HELD_DELIVERY_STATES],
  };
}

/**
 * Whether a copy is **one stamp's** copy, and so has other copies of that stamp to show: not a piece
 * carrying several stamps (#745), nor one whose candidates span variant trees (#1651) — both are
 * certainly no one stamp's copy, which is also why neither is counted under any stamp.
 */
export function isOneStampsCopy(copy: { multiStamp: boolean; candidateTrees: number }): boolean {
  return !copy.multiStamp && copy.candidateTrees < 2;
}
