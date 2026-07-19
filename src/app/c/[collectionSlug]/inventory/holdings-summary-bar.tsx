"use client";

import type { HoldingsSummary } from "@/lib/valuation";

const LABEL_STYLE: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  // Fixed width so both rows' amounts line up in a column.
  width: "6.5rem",
  flexShrink: 0,
};

const AMOUNT_STYLE: React.CSSProperties = {
  fontSize: "1.0625rem",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  // Fixed width + right-align so the currency codes align and digits share a column.
  minWidth: "9rem",
  textAlign: "right",
};

const NOTE_STYLE: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/** Holdings summary for the current filter set (ADR-0007 §7, #101; ADR-0009, #134). Shows
 * two lines over the same copy set: the summed **catalog value** in the base currency (with
 * the uncertain/unpriced/unconvertible breakdown), and the total **actual purchase cost** —
 * the frozen cost-basis snapshots — calling out copies whose cost is still pending (open
 * lot) or has no cost recorded. Renders nothing until the figures have loaded. */
export function HoldingsSummaryBar({ total }: { total: HoldingsSummary | undefined }) {
  if (!total) return null;

  const valuationNotes: string[] = [];
  if (total.uncertainCount > 0) {
    valuationNotes.push(
      `includes ~${total.uncertainBaseAmount} ${total.baseCurrency} uncertain (${total.uncertainCount} unknown-variant)`
    );
  }
  if (total.unpricedCount > 0) {
    valuationNotes.push(`${total.unpricedCount} unpriced`);
  }
  if (total.unconvertibleCount > 0) {
    valuationNotes.push(`${total.unconvertibleCount} not convertible to ${total.baseCurrency}`);
  }

  const cost = total.cost;
  const costNotes: string[] = [];
  if (cost.pendingCount > 0) {
    costNotes.push(`${cost.pendingCount} pending`);
  }
  if (cost.noneCount > 0) {
    costNotes.push(`${cost.noneCount} no cost recorded`);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
        padding: "0.625rem 1rem",
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        background: "var(--color-bg-page)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
        <span style={LABEL_STYLE}>Catalog value</span>
        <span style={AMOUNT_STYLE}>
          {total.totalBaseAmount} {total.baseCurrency}
        </span>
        <span style={NOTE_STYLE}>
          {total.pricedCount} priced
          {valuationNotes.length > 0 ? ` · ${valuationNotes.join(" · ")}` : ""}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
        <span style={LABEL_STYLE}>Purchase cost</span>
        <span style={AMOUNT_STYLE}>
          {cost.totalCostBasis} {cost.baseCurrency}
        </span>
        <span style={NOTE_STYLE}>
          {cost.knownCount} costed
          {costNotes.length > 0 ? ` · ${costNotes.join(" · ")}` : ""}
        </span>
      </div>
    </div>
  );
}
