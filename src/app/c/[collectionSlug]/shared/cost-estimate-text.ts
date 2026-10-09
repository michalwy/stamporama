import type { CSSProperties } from "react";
import type { CostEstimateGap } from "@/lib/purchase-allocation";

// How a copy's **estimated** cost reads wherever its cost basis would otherwise say *Pending*
// (#1696): the copy's page, the copies list, and the Valuation dialog's *What I paid*. One wording
// and one look, so the three screens say the same thing about the same copy as its purchase order.

/** #238's vocabulary for a figure inferred rather than recorded: a `~`, muted and italic. */
export const COST_ESTIMATE_STYLE: CSSProperties = {
  color: "var(--color-text-muted)",
  fontStyle: "italic",
  fontVariantNumeric: "tabular-nums",
};

/** The hint beside an estimated cost. */
export const COST_ESTIMATE_HINT =
  "Estimated: this copy's share of its open purchase lot's cost by catalog value, the figure its purchase order shows. It becomes the cost basis when the lot is closed.";

/** Why a copy on an open lot shows *Pending* with no estimate — the gap the estimate reports, or the
 *  plain rule when no estimate was read. */
export function costPendingHint(gap: CostEstimateGap | null): string {
  switch (gap) {
    case "not_delivered":
      return "The purchase lot is still open, and this copy is marked not delivered: it leaves the split when the lot closes, so it has no estimated cost.";
    case "no_rate":
      return "The purchase lot is still open, and its cost cannot be estimated: the purchase has no exchange rate to the collection currency.";
    case "no_catalog_value":
      return "The purchase lot is still open, and this copy's cost cannot be estimated: it has no catalog value to share the lot's cost by.";
    default:
      return "The purchase lot is still open — the cost per copy is settled when the lot is closed.";
  }
}
