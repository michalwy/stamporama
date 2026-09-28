/** A purchase's delivery status (ADR-0009 §1, #141, #1449) — the order's own lifecycle, separate
 * from the delivery state each of its copies carries (`delivery-state.ts`).
 *
 * `preparing` → `in_transit` → `arrived` → `completed`. The last one is the collector saying the
 * parcel is **sorted**, not merely on the desk (#1449): once it had arrived there was nothing left to
 * mark, so the *Arrived* filter held the orders still being worked beside the ones finished long ago.
 * It is set by hand, suggested when nothing is left, and locks nothing — closing a lot is what
 * freezes cost, and that is unchanged.
 *
 * This module is the single vocabulary for the axis: the valid set, the labels, the tint tokens, and
 * the two rules every reader needs — *has it arrived* and *what is left before it is finished*. Pure —
 * no Prisma, no React — so the domain layer, the route handlers and every screen read the same list
 * instead of restating it. An opening balance has no delivery status of its own and is stored
 * `arrived` (#1323) — but it is marked *Completed* exactly as a purchase is (#1461), so the completion
 * rules below answer for both kinds. */

/** Lifecycle order — the order the statuses are offered in every select and filter. */
export const PURCHASE_STATUSES = ["preparing", "in_transit", "arrived", "completed"] as const;

export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/** Membership test for untrusted input (form fields, query params). */
export function isPurchaseStatus(value: string | null | undefined): value is PurchaseStatus {
  return !!value && (PURCHASE_STATUSES as readonly string[]).includes(value);
}

/** Display label + the semantic color token the status chip is tinted with (`muted` = no tint). */
export const PURCHASE_STATUS_META: Record<PurchaseStatus, { label: string; token: string }> = {
  preparing: { label: "Preparing", token: "muted" },
  in_transit: { label: "In transit", token: "accent" },
  arrived: { label: "Arrived", token: "success" },
  completed: { label: "Completed", token: "info" },
};

/** Label for a stored value, falling back to the raw string so an unknown value stays legible. */
export function purchaseStatusLabel(status: string): string {
  return PURCHASE_STATUS_META[status as PurchaseStatus]?.label ?? status;
}

/** The parcel is in hand: *Arrived*, or past it. A completed order has arrived too, so a copy
 * identified into it lands `to_sort` exactly as it would on an arrived one (#1449). */
export function hasPurchaseArrived(status: string): boolean {
  return status === "arrived" || status === "completed";
}

/** What still stands between an arrived order and *Completed* (#1449). */
export interface PurchaseWorkLeft {
  /** Copies in the `to_sort` state — the toolbar's *N to sort* (#375). */
  toSort: number;
  /** Scan tiles still to be identified: waiting (#566) or parked (#597). A discarded tile is done. */
  tiles: number;
  /** Lots not yet closed — their cost is not frozen. */
  openLots: number;
}

/** Nothing left to do: every copy sorted, every tile dealt with, every lot closed. What the order
 * screen's *Mark completed* suggestion waits for. */
export function isPurchaseWorkDone(left: PurchaseWorkLeft): boolean {
  return left.toSort === 0 && left.tiles === 0 && left.openLots === 0;
}

/** The work left, one phrase per kind that has any, in the order the pass goes — sort, identify,
 * close. Empty when nothing is left. What marking an order completed with work outstanding states,
 * without refusing: a collector may leave a doubtful piece for later on purpose. */
export function describePurchaseWorkLeft(left: PurchaseWorkLeft): string[] {
  const parts: string[] = [];
  if (left.toSort > 0) parts.push(`${left.toSort} ${left.toSort === 1 ? "copy" : "copies"} to sort`);
  if (left.tiles > 0) {
    parts.push(`${left.tiles} scan ${left.tiles === 1 ? "tile" : "tiles"} not yet identified`);
  }
  if (left.openLots > 0) parts.push(`${left.openLots} open ${left.openLots === 1 ? "lot" : "lots"}`);
  return parts;
}
