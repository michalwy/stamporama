// Pure, Prisma-free rules for the per-platform offer lifecycle (ADR-0012, #165). A `Lot` is
// listed on one platform as an `Offer`; this module owns the offer's state machine and the
// small validation helpers, so they can be unit-tested without a DB and reused verbatim by the
// server domain module (`offers.ts`). No side effects.

import { normalizeDecimalInput } from "./decimal-input";

export type OfferState = "preparing" | "ready" | "active" | "paused" | "sold" | "withdrawn";

export const OFFER_STATES: readonly OfferState[] = [
  "preparing",
  "ready",
  "active",
  "paused",
  "sold",
  "withdrawn",
];

/** Terminal / "closed" states — dead listings the offers list hides by default (#245). */
export const CLOSED_OFFER_STATES: readonly OfferState[] = ["sold", "withdrawn"];

export function isOfferState(value: unknown): value is OfferState {
  return (
    value === "preparing" ||
    value === "ready" ||
    value === "active" ||
    value === "paused" ||
    value === "sold" ||
    value === "withdrawn"
  );
}

/** Only an `active` offer competes for its copies, so only `active` offers can collide (at most
 * one active offer per Item × platform). `preparing` / `ready` (still being composed or awaiting
 * posting), paused, sold, and withdrawn offers hold no live claim. */
export function isLiveState(state: OfferState): boolean {
  return state === "active";
}

/**
 * The offer state machine (ADR-0012, extended in #246): two pre-live states before an offer goes
 * live — `preparing → ready → active ↔ paused → sold / withdrawn`.
 *
 *   preparing→ ready | withdrawn         (still being composed — mark Ready once assembled, #246)
 *   ready    → active | preparing | withdrawn   (fully prepared; publish via Activate, or step back)
 *   active   → paused | withdrawn        (and → sold, but only via the sale flow, #166)
 *   paused   → active | withdrawn        (and → sold, via #166)
 *   sold     → (terminal)
 *   withdrawn→ (terminal — relist = a new offer)
 *
 * The flow is linear but reversible: `ready` can drop back to `preparing` to keep editing. All of
 * `preparing`, `ready`, `active`, and `paused` are composable (the states are orientational — they
 * scope filtering, not composition mechanics — #188); only terminal states freeze a listing.
 * `sold` is reachable only by recording a sale, never by a manual toggle, so it is excluded from
 * the manual-transition map below. Returns the states a user may move to by hand.
 */
const MANUAL_TRANSITIONS: Record<OfferState, readonly OfferState[]> = {
  preparing: ["ready", "withdrawn"],
  ready: ["active", "preparing", "withdrawn"],
  active: ["paused", "withdrawn"],
  paused: ["active", "withdrawn"],
  sold: [],
  withdrawn: [],
};

/** A user-reachable manual target (every state except `sold`, which the sale flow owns). */
export type ManualOfferTarget = Exclude<OfferState, "sold">;

/** A transition into `ready` or `active` requires the offer to actually list something (≥1 set) —
 * you cannot mark an empty draft as ready or publish it (#188, #246). */
export function requiresSets(to: OfferState): boolean {
  return to === "ready" || to === "active";
}

/** Whether a user-initiated lifecycle change from `from` to `to` is allowed (excludes `sold`,
 * which the sale flow owns). */
export function canTransition(from: OfferState, to: OfferState): boolean {
  return MANUAL_TRANSITIONS[from].includes(to);
}

/** States a user may move an offer to by hand, given its current state. */
export function manualTransitions(from: OfferState): readonly OfferState[] {
  return MANUAL_TRANSITIONS[from];
}

/**
 * The single unambiguous "advance one step" target for a one-click control (#255): the linear,
 * forward part of the lifecycle only — `preparing → ready` and `ready → active`. Returns `null`
 * wherever the next move is ambiguous (from `active` / `paused`: pause vs resume vs withdraw vs
 * sell) or the state is terminal, so callers fall back to the manual dropdown instead of guessing.
 * A `ready`/`active` target still requires the offer to list something (see {@link requiresSets}) —
 * the caller gates on that.
 */
export function quickAdvanceTarget(from: OfferState): ManualOfferTarget | null {
  if (from === "preparing") return "ready";
  if (from === "ready") return "active";
  return null;
}

/** Terminal states cannot change state and cannot be edited (price/url/platform are frozen). */
export function isTerminalState(state: OfferState): boolean {
  return state === "sold" || state === "withdrawn";
}

export const OFFER_STATE_LABEL: Record<OfferState, string> = {
  preparing: "Preparing",
  ready: "Ready",
  active: "Active",
  paused: "Paused",
  sold: "Sold",
  withdrawn: "Withdrawn",
};

/** Validate and normalise a user-entered asking price. Returns the 2-dp string on success or a
 * human-readable message on failure. Empty / non-numeric / negative are rejected. */
export function parsePrice(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = normalizeDecimalInput(raw.trim());
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
