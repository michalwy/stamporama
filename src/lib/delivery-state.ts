/** The physical delivery axis of a copy (ADR-0009 §5, #121) — orthogonal to disposition.
 *
 * Lifecycle for a purchased copy: `ordered` (intake default) → `in_transit` → `to_sort`
 * (arrived, awaiting sorting) → `delivered` (sorted / in hand), with `not_delivered` and
 * `damaged` as outcomes found while sorting. A copy added by hand starts `delivered`.
 *
 * This module is the single vocabulary for the axis: the valid set, the display labels, the
 * tint token each state carries, and the lifecycle order. Pure — no Prisma, no React — so
 * both the domain layer and every screen that renders or filters the axis read the same list
 * instead of restating it. */

/** Lifecycle progression first, then the exception outcomes — the order the states are
 * offered in every select and chip legend. */
export const DELIVERY_STATES = [
  "ordered",
  "in_transit",
  "to_sort",
  "delivered",
  "not_delivered",
  "damaged",
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** Membership test for untrusted input (form fields, query params). */
export function isDeliveryState(value: string | null | undefined): value is DeliveryState {
  return !!value && (DELIVERY_STATES as readonly string[]).includes(value);
}

/** Short display label + the semantic color token the state's chip is tinted with. `muted`
 * means "no tint" — used as the fallback for a value written before this vocabulary. */
export const DELIVERY_STATE_META: Record<DeliveryState, { label: string; token: string }> = {
  ordered: { label: "Ordered", token: "accent" },
  in_transit: { label: "In transit", token: "accent" },
  to_sort: { label: "To sort", token: "warning" },
  delivered: { label: "Delivered", token: "success" },
  not_delivered: { label: "Not delivered / missing", token: "error" },
  damaged: { label: "Damaged", token: "error" },
};

/** Label for a stored value, falling back to the raw string so an unknown value is still
 * legible rather than blank. */
export function deliveryStateLabel(state: string): string {
  return DELIVERY_STATE_META[state as DeliveryState]?.label ?? state;
}

/** Tint token for a stored value; `muted` for anything outside the vocabulary. */
export function deliveryStateToken(state: string): string {
  return DELIVERY_STATE_META[state as DeliveryState]?.token ?? "muted";
}

/** The two exception outcomes — the copy was paid for but is not in the collector's hands and
 * never will be. Nothing that asks "what can still be listed for sale?" should surface them
 * (#259's not-offered-on-platform filter), unlike the in-flight states, which are copies on
 * their way in. */
export const UNAVAILABLE_DELIVERY_STATES = ["not_delivered", "damaged"] as const;

/** A copy is *in hand* only when it is delivered — the precondition for listing it for sale
 * (#188) and the reason the offer actions are unavailable otherwise (#273). */
export function isDelivered(state: string): boolean {
  return state === "delivered";
}
