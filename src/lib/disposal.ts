/** The disposal axis of a copy (#394) — a copy that left the collector's hands *after* it
 * arrived: lost, damaged in storage, discarded. It is the involuntary counterpart to a sale;
 * both are ways a copy stops being physically held, one with proceeds and one without.
 *
 * It is a fourth axis rather than a value on an existing one. `deliveryState` describes physical
 * intake and ends at arrival — conflating "broke a year later" with its `damaged` outcome ("found
 * broken while sorting") makes supplier quality unmeasurable, and `not_delivered` additionally
 * drops the copy from its lot and redistributes the allocation (#122), which would be wrong here:
 * the copy did arrive and was paid for. The disposition flags express *intent*, not possession — a
 * duplicate held for sale is `inCollection: false` and still owned.
 *
 * This module is the single vocabulary for the axis: the valid reasons, their labels, the tint
 * token each carries, and the {@link isHeld} predicate everything asking "do I still have this?"
 * reads. Pure — no Prisma, no React — mirroring `./delivery-state`, which it sits beside.
 *
 * The reason set is deliberately minimal. It can be widened later; it cannot be narrowed without
 * stranding stored rows. */

import { UNAVAILABLE_DELIVERY_STATES } from "./delivery-state";

/** The order the reasons are offered in, everywhere. `other` is last because it is the one that
 * demands a note — it is the escape hatch, not a first choice. */
export const DISPOSAL_REASONS = ["lost", "damaged", "other"] as const;

export type DisposalReason = (typeof DISPOSAL_REASONS)[number];

/** Membership test for untrusted input (form fields, query params). */
export function isDisposalReason(value: string | null | undefined): value is DisposalReason {
  return !!value && (DISPOSAL_REASONS as readonly string[]).includes(value);
}

/** Short display label + the semantic color token the reason's chip is tinted with. All three are
 * `error`: unlike delivery, where the states run from expected to exceptional, every disposal is
 * the same fact — a copy that is gone. */
export const DISPOSAL_REASON_META: Record<DisposalReason, { label: string; token: string }> = {
  lost: { label: "Lost", token: "error" },
  damaged: { label: "Damaged", token: "error" },
  other: { label: "No longer held", token: "error" },
};

/** Label for a stored value, falling back to the raw string so an unknown value is still legible
 * rather than blank (mirrors `deliveryStateLabel`). */
export function disposalReasonLabel(reason: string): string {
  return DISPOSAL_REASON_META[reason as DisposalReason]?.label ?? reason;
}

/** Tint token for a stored value; `muted` for anything outside the vocabulary. */
export function disposalReasonToken(reason: string): string {
  return DISPOSAL_REASON_META[reason as DisposalReason]?.token ?? "muted";
}

/** A note is **required** for `other` and optional otherwise: `lost` and `damaged` say what
 * happened on their own, while `other` says only that something did. */
export function disposalNoteRequired(reason: string): boolean {
  return reason === "other";
}

/** The copy projection {@link isHeld} reads — the two axes along which a copy can stop being in
 * the collector's hands without being sold. */
export interface HeldInput {
  /** When the copy was disposed of, or null while it is still held. */
  disposedAt: Date | string | null;
  /** Physical delivery axis (ADR-0009 §5). */
  deliveryState: string;
}

/**
 * Whether the collector still physically holds this copy — the single predicate behind
 * availability, collection value and the copies-held badge (#394/#396).
 *
 * Two ways to fail it: the copy was **disposed of** after arrival, or it never arrived in usable
 * form (`not_delivered` / `damaged`, `UNAVAILABLE_DELIVERY_STATES`). The in-flight states
 * (`ordered`, `in_transit`, `to_sort`) pass — those copies are on their way in, not gone.
 *
 * **Soldness is deliberately not part of this.** #394 sketched the predicate as
 * `!disposedAt && !sold`, but "sold" already has one established mechanism at every reader (the
 * `saleLineItems: { none: {} }` guard behind the `excludeSold` filter, #207), and folding it in
 * would need a sale join in what is otherwise a pure field test — two mechanisms for one rule.
 * This answers **possession**; soldness stays the separate axis it already is.
 */
export function isHeld(item: HeldInput): boolean {
  if (item.disposedAt != null) return false;
  return !(UNAVAILABLE_DELIVERY_STATES as readonly string[]).includes(item.deliveryState);
}

/** One-line description of a disposal for a chip or tooltip: the reason's label, the date, and the
 * note when one was given. Returns null for a copy that is still held, so a caller renders nothing
 * rather than branching on the raw columns. */
export function describeDisposal(item: {
  disposedAt: Date | string | null;
  disposalReason: string | null;
  disposalNote: string | null;
}): string | null {
  if (item.disposedAt == null) return null;
  const when = new Date(item.disposedAt).toISOString().slice(0, 10);
  const label = item.disposalReason ? disposalReasonLabel(item.disposalReason) : "No longer held";
  return `${label} · ${when}${item.disposalNote ? ` · ${item.disposalNote}` : ""}`;
}
