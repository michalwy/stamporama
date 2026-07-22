// Pure, Prisma-free rules for the per-platform offer lifecycle (ADR-0012, #165). A `Lot` is
// listed on one platform as an `Offer`; this module owns the offer's state machine and the
// small validation helpers, so they can be unit-tested without a DB and reused verbatim by the
// server domain module (`offers.ts`). No side effects.

export type OfferState = "active" | "paused" | "sold" | "withdrawn";

export const OFFER_STATES: readonly OfferState[] = ["active", "paused", "sold", "withdrawn"];

export function isOfferState(value: unknown): value is OfferState {
  return value === "active" || value === "paused" || value === "sold" || value === "withdrawn";
}

/** Only an `active` offer competes for its copies, so only `active` offers can collide (at most
 * one active offer per Item × platform). Paused / sold / withdrawn offers hold no live claim. */
export function isLiveState(state: OfferState): boolean {
  return state === "active";
}

/**
 * The offer state machine (ADR-0012): `active ↔ paused → sold / withdrawn`.
 *
 *   active   → paused | withdrawn        (and → sold, but only via the sale flow, #166)
 *   paused   → active | withdrawn        (and → sold, via #166)
 *   sold     → (terminal)
 *   withdrawn→ (terminal — relist = a new offer)
 *
 * `sold` is reachable only by recording a sale, never by a manual toggle, so it is excluded
 * from the manual-transition map below. Returns the states a user may move to by hand.
 */
const MANUAL_TRANSITIONS: Record<OfferState, readonly OfferState[]> = {
  active: ["paused", "withdrawn"],
  paused: ["active", "withdrawn"],
  sold: [],
  withdrawn: [],
};

/** Whether a user-initiated lifecycle change from `from` to `to` is allowed (excludes `sold`,
 * which the sale flow owns). */
export function canTransition(from: OfferState, to: OfferState): boolean {
  return MANUAL_TRANSITIONS[from].includes(to);
}

/** States a user may move an offer to by hand, given its current state. */
export function manualTransitions(from: OfferState): readonly OfferState[] {
  return MANUAL_TRANSITIONS[from];
}

/** Terminal states cannot change state and cannot be edited (price/url/platform are frozen). */
export function isTerminalState(state: OfferState): boolean {
  return state === "sold" || state === "withdrawn";
}

export const OFFER_STATE_LABEL: Record<OfferState, string> = {
  active: "Active",
  paused: "Paused",
  sold: "Sold",
  withdrawn: "Withdrawn",
};

/** Validate and normalise a user-entered asking price. Returns the 2-dp string on success or a
 * human-readable message on failure. Empty / non-numeric / negative are rejected. */
export function parsePrice(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: "Enter an asking price." };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, message: "Asking price must be a number." };
  if (n < 0) return { ok: false, message: "Asking price cannot be negative." };
  return { ok: true, value: n.toFixed(2) };
}

/** Normalise a listing URL: trim, drop when blank. Not validated beyond non-empty — collectors
 * paste whatever the platform gives them. */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
