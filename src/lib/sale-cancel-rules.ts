// Pure rules for cancelling a sale (#2500, ADR-0082) — safe for server and client alike (no Prisma).
//
// A buyer wins lots and never pays. Deleting the sale leaves no trace of it; cancelling keeps the sale
// with the status *Cancelled*, releases what deleting releases (the copies, the packing supplies, the
// offers' generated photos), and asks, offer by offer, whether each offer the sale closed goes back on
// sale or is withdrawn. The buyer carries a count of their cancelled sales, and a new sale to them
// warns about it.

/** What the cancel does to one offer the sale closed: back on sale, or withdrawn. */
export type CancelOfferOutcome = "active" | "withdrawn";

export const CANCEL_OFFER_OUTCOMES: readonly CancelOfferOutcome[] = ["active", "withdrawn"];

/** The outcome each offer starts at in the dialog — the listing is usually still up. */
export const DEFAULT_CANCEL_OFFER_OUTCOME: CancelOfferOutcome = "active";

/** The reason the dialog starts with: what a cancellation almost always is. Editable, and optional. */
export const DEFAULT_CANCEL_REASON = "Not paid";

export function isCancelOfferOutcome(value: unknown): value is CancelOfferOutcome {
  return value === "active" || value === "withdrawn";
}

/**
 * Each offer the sale closed with what happens to it: the outcome chosen for it, else the default.
 * A choice for an offer the sale did not close is not an error — the screen may have been read
 * before another sale changed it — and is dropped, so only the closed offers come back.
 */
export function resolveCancelOutcomes(
  closedOfferIds: readonly string[],
  chosen: Readonly<Record<string, CancelOfferOutcome>>
): Map<string, CancelOfferOutcome> {
  const result = new Map<string, CancelOfferOutcome>();
  for (const id of closedOfferIds) {
    const choice = chosen[id];
    result.set(id, isCancelOfferOutcome(choice) ? choice : DEFAULT_CANCEL_OFFER_OUTCOME);
  }
  return result;
}

/** The reason as stored: trimmed, and a blank one is none. */
export function normalizeCancelReason(reason: string | null | undefined): string | null {
  const trimmed = (reason ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** A buyer's cancelled sales beside their sales on the contact page: *2 cancelled*, or nothing. */
export function cancelledSalesLabel(count: number): string | null {
  return count > 0 ? `${count} cancelled` : null;
}

/** The warning a new sale to a buyer with cancelled sales shows, naming the count; null with none. */
export function cancelledSalesWarning(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "This buyer has 1 cancelled sale."
    : `This buyer has ${count} cancelled sales.`;
}

/** How an outcome reads on the cancelled sale's screen, beside the line it was chosen for. */
export function cancelOutcomeLabel(outcome: string | null): string | null {
  if (outcome === "active") return "Back to active";
  if (outcome === "withdrawn") return "Withdrawn";
  return null;
}

/**
 * The lines a sale **accounts for** where a marketplace order is matched to the sales claiming it
 * (#463, #499): its own, or — on a cancelled sale, whose lines were released — the ones it had sold
 * (#2500). The order was dealt with by cancelling it, so it is neither offered for recording again nor
 * flagged as sold and unrecorded on its offers.
 */
export function claimedSaleLines<L>(sale: {
  status: string;
  lines: readonly L[];
  cancelledLines: readonly L[];
}): readonly L[] {
  return sale.status === "cancelled" ? sale.cancelledLines : sale.lines;
}
