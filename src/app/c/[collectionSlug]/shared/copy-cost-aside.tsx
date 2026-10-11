"use client";

import type { ItemListItem } from "@/lib/items";
import { copyCostFigure, type CopyCostFigure } from "@/lib/offer-cost";
import { Tooltip } from "./tooltip";
import { COST_ESTIMATE_HINT, COST_ESTIMATE_STYLE, costPendingHint } from "./cost-estimate-text";

const COST_LABEL: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

const COST_FIGURE: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

/** Why a copy adds nothing to the total's cost — each worded for the summary's own treatment of it.
 *  `whole` names what that total is: the Lot builder's lot, or the new offer (#1793). */
function missingCostHint(
  why: Extract<CopyCostFigure, { kind: "missing" }>["why"],
  copy: ItemListItem,
  whole: string
): string {
  switch (why) {
    case "pending":
      return `${costPendingHint(copy.costEstimateGap)} The ${whole}'s cost names it as a copy with no figure yet.`;
    case "opening_balance":
      return `From an opening balance: what it carries is an opening value, not money spent, so it is left out of the ${whole}'s cost — as on an offer.`;
    case "no_opening_value":
      return "From an opening balance stated without a value — there is no cost to count.";
    case "unrecorded":
      return `No cost recorded — it came from no purchase lot, or was dropped from one. Left out of the ${whole}'s cost.`;
  }
}

/**
 * What a copy cost, beside its catalogue value (#1746) — the two figures that decide whether it goes
 * into a lot or an offer. The very figure a summary's *Cost* adds up (`copyCostFigure`, which
 * `copiesCost` sums), so the rows and the total never disagree: the frozen cost basis, the open
 * lot's estimate marked `~` as everywhere (#1696), or *—* with the reason. Drawn through the copy
 * row's `valueAside` by the Lot builder and by the New offer dialog (#1793).
 */
export function CopyCostAside({
  copy,
  baseCurrency,
  whole,
}: {
  copy: ItemListItem;
  baseCurrency: string;
  /** What the summary beside the rows totals — `lot` or `offer` — for the hint on a copy left out. */
  whole: string;
}) {
  const figure = copyCostFigure(copy);
  const [text, hint, style] =
    figure.kind === "known"
      ? [
          `${figure.amount} ${baseCurrency}`,
          "What this copy cost you (base currency), frozen when its purchase lot closed.",
          COST_FIGURE,
        ]
      : figure.kind === "estimate"
        ? [
            `~${figure.amount} ${baseCurrency}`,
            COST_ESTIMATE_HINT,
            { ...COST_FIGURE, ...COST_ESTIMATE_STYLE },
          ]
        : [
            "—",
            missingCostHint(figure.why, copy, whole),
            { ...COST_FIGURE, color: "var(--color-text-muted)" },
          ];
  return (
    <Tooltip content={hint} align="end">
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.3rem" }}>
        <span style={COST_LABEL}>cost</span>
        <span style={style}>{text}</span>
      </span>
    </Tooltip>
  );
}
