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

const FRAME_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
  padding: "0.625rem 1rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-page)",
};

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "0.75rem",
  flexWrap: "wrap",
};

/** A shimmering placeholder block. ` ` keeps the span on the text baseline so its line box
 * matches the loaded row; the amount block carries the row height via {@link AMOUNT_STYLE}. */
function SkeletonBlock({ style }: { style: React.CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        ...style,
        display: "inline-block",
        borderRadius: "0.25rem",
        background: "var(--color-border)",
        color: "transparent",
      }}
    >
      &nbsp;
    </span>
  );
}

/** Loading placeholder for {@link HoldingsSummaryBar}. Mirrors the loaded two-row structure —
 * same frame, same per-span font sizes — so the bar reserves its final height and surrounding
 * content does not shift when the figures arrive (#151). */
function HoldingsSummaryBarSkeleton() {
  return (
    <div style={FRAME_STYLE} aria-hidden>
      <div style={ROW_STYLE}>
        <SkeletonBlock style={LABEL_STYLE} />
        <SkeletonBlock style={AMOUNT_STYLE} />
        <SkeletonBlock style={{ ...NOTE_STYLE, width: "5rem" }} />
      </div>
      <div style={ROW_STYLE}>
        <SkeletonBlock style={LABEL_STYLE} />
        <SkeletonBlock style={AMOUNT_STYLE} />
        <SkeletonBlock style={{ ...NOTE_STYLE, width: "5rem" }} />
      </div>
    </div>
  );
}

/** Holdings summary for the current filter set (ADR-0007 §7, #101; ADR-0009, #134). Shows
 * two lines over the same copy set: the summed **catalog value** in the base currency (with
 * the uncertain/unpriced/unconvertible breakdown), and the total **actual purchase cost** —
 * the frozen cost-basis snapshots — calling out copies whose cost is still pending (open
 * lot) or has no cost recorded. Renders a fixed-height skeleton until the figures have loaded
 * so no layout shift occurs (#151). */
export function HoldingsSummaryBar({ total }: { total: HoldingsSummary | undefined }) {
  if (!total) return <HoldingsSummaryBarSkeleton />;

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
    <div style={FRAME_STYLE}>
      <div style={ROW_STYLE}>
        <span style={LABEL_STYLE}>Catalog value</span>
        <span style={AMOUNT_STYLE}>
          {total.totalBaseAmount} {total.baseCurrency}
        </span>
        <span style={NOTE_STYLE}>
          {total.pricedCount} priced
          {valuationNotes.length > 0 ? ` · ${valuationNotes.join(" · ")}` : ""}
        </span>
      </div>
      <div style={ROW_STYLE}>
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
