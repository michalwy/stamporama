import { formatEntityNo } from "./quick-jump";
import { isSaleSent } from "./sale-status";

/**
 * Moving sold sets to another sale of the same buyer (#2204) — the pure half: which sale may give
 * sets away, which sale may take them, and how the move is named on the *to review* marker.
 *
 * A buyer who bought several sets sometimes asks for part of them to wait for a later parcel, so the
 * sale is split: the ticked sets move — price, copies, packed state, the offer they sold through —
 * to a new sale for the same buyer or to an open one of theirs. It is merging (#2041) run the other
 * way, and it is refused for the same reason merging is: a sale already sent is a parcel gone.
 *
 * Moving **every** set is not a split, so it is refused too: what is left would be an empty sale
 * with the parcel's amounts on it. Merging the two sales, or editing this one, says that properly.
 */

/** A sale as the move reads it. */
export interface SaleMoveSide {
  id: string;
  saleNo: number;
  platformId: string;
  currency: string;
  buyerId: string | null;
  status: string;
}

/**
 * Why `moving` of the source's `total` sets cannot leave it, or null when they can: at least one is
 * moved, the source has not been sent, and at least one set stays behind.
 */
export function saleMoveSourceRefusal(
  source: Pick<SaleMoveSide, "status">,
  moving: number,
  total: number
): string | null {
  if (moving === 0) return "Tick at least one sold set to move.";
  if (isSaleSent(source.status)) {
    return "This sale has already been sent — a parcel that has gone is not split.";
  }
  if (moving >= total) {
    return "Moving every sold set is not a split — merge the two sales, or edit this one, instead.";
  }
  return null;
}

/**
 * Why `target` cannot take sets from `source`, or null when it can: **another sale of the same buyer,
 * on the same platform, in the same currency, not yet sent**. A sale with no buyer has no other sale
 * of theirs, so its sets go only to a new one.
 */
export function saleMoveTargetRefusal(
  source: Pick<SaleMoveSide, "id" | "platformId" | "currency" | "buyerId">,
  target: SaleMoveSide
): string | null {
  const no = `Sale ${formatEntityNo(target.saleNo)}`;
  if (target.id === source.id) return "A sale cannot take its own sets.";
  if (source.buyerId === null) {
    return "This sale names no buyer, so its sets can only move to a new sale.";
  }
  if (target.buyerId !== source.buyerId) return `${no} is to another buyer.`;
  if (target.platformId !== source.platformId) return `${no} is on another platform.`;
  if (target.currency !== source.currency) return `${no} is in ${target.currency}, not ${source.currency}.`;
  if (isSaleSent(target.status)) return `${no} has already been sent.`;
  return null;
}

/** How a moved set is named on the marker: its offer's number, or that it was on no offer. */
function movedSetsPhrase(offerNos: readonly (number | null)[]): string {
  const count = offerNos.length;
  const sets = `${count} ${count === 1 ? "set" : "sets"}`;
  const numbers = [...new Set(offerNos.filter((no): no is number => no !== null))].sort((a, b) => a - b);
  if (numbers.length === 0) return sets;
  return `${sets} (${numbers.length === 1 ? "offer" : "offers"} ${numbers.map(formatEntityNo).join(", ")})`;
}

/**
 * What a move through the agent API says on each sale's *to review* marker (#1948): *moved 2 sets
 * (offer #2680) to sale #13* on the sale they left, *… from sale #12* on the one they joined.
 */
export function saleSetsMovedAction(
  offerNos: readonly (number | null)[],
  direction: { to: number } | { from: number }
): string {
  const where = "to" in direction ? `to sale ${formatEntityNo(direction.to)}` : `from sale ${formatEntityNo(direction.from)}`;
  return `moved ${movedSetsPhrase(offerNos)} ${where}`;
}
