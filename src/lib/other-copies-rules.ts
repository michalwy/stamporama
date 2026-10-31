import { DELIVERY_STATES, UNAVAILABLE_DELIVERY_STATES } from "./delivery-state";
import type { HoldingState } from "./copy-card-states";

// The copy page's *Other copies* card (#2090, #2282). Pure, so the card, the server page that loads
// the families and the integration test that holds the card to the stamp's own count read the same
// answers.

/** The delivery states a held copy can be in: every state but the two that mean it never usably
 *  arrived. The in-flight ones stay — a copy on its way or waiting to be sorted is bought, and its
 *  row says which it is. */
export const HELD_DELIVERY_STATES: readonly string[] = DELIVERY_STATES.filter(
  (s) => !(UNAVAILABLE_DELIVERY_STATES as readonly string[]).includes(s)
);

/**
 * The Copies list filters that name **the other copies of a stamp's family** — the umbrella and
 * every variant of it (#2282), in the holding states the card's chips have on (#2281). With Held
 * alone they are `heldCopiesWhere` in `copy-counts.ts`, spelled as list filters and widened from one
 * stamp to its family: no carrier of several stamps, none lost or arrived damaged. Copies whose
 * candidates span variant trees are dropped by `stampIds` itself — only copies identified as the
 * stamp are listed, never those that only might be it — and the copy whose page it is is left out
 * here, so the chips' counts and the rows never count it.
 */
export function otherCopiesFilters(
  familyStampIds: readonly string[],
  itemId: string,
  holdingStates?: readonly HoldingState[]
) {
  return {
    stampIds: [...familyStampIds],
    excludeIds: [itemId],
    multiStamp: "exclude" as const,
    deliveryStates: [...HELD_DELIVERY_STATES],
    ...(holdingStates ? { holdingStates: [...holdingStates] } : {}),
  };
}

/**
 * The umbrella of a stamp's family (#2282): walking up from the stamp, the first stamp that is not
 * itself a variant (ADR-0010 §3) — a base stamp, or a distinct entry such as an error, which is a
 * thing of its own to collect and so heads its own family. `chain` is the stamp and then its
 * ancestors, nearest first. A chain of variants with no such stamp above ends at its top.
 */
export function familyUmbrellaId(chain: readonly { id: string; isVariant: boolean }[]): string {
  const umbrella = chain.find((s) => !s.isVariant) ?? chain[chain.length - 1];
  if (!umbrella) throw new Error("A stamp's family needs the stamp itself");
  return umbrella.id;
}

/**
 * The stamps whose families the card lists, one group each (#2282): a copy's one stamp; **every
 * stamp a cover or fragment carries** (#744), once each, in the collector's order; and **none** for a
 * copy whose candidates span variant trees — it is no one stamp's copy (ADR-0065 §8), its pointer
 * merely the first candidate.
 */
export function otherCopiesStampIds(copy: {
  stampId: string;
  multiStamp: boolean;
  candidateTrees: number;
  carriedStamps: readonly { stampId: string }[];
}): string[] {
  if (copy.multiStamp) return [...new Set(copy.carriedStamps.map((s) => s.stampId))];
  return copy.candidateTrees < 2 ? [copy.stampId] : [];
}
