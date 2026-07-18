"use client";

import type { HoldingsTotal } from "@/lib/valuation";

/** Holdings valuation total for the current filter set (ADR-0007 §7, #101). Shows the
 * summed catalog value in the base currency and, when present, how much of it is
 * uncertain (unknown-variant copies valued at the lowest child price) plus the count of
 * copies with no recorded price. Renders nothing until the figure has loaded. */
export function HoldingsSummaryBar({ total }: { total: HoldingsTotal | undefined }) {
  if (!total) return null;

  const notes: string[] = [];
  if (total.uncertainCount > 0) {
    notes.push(
      `includes ~${total.uncertainBaseAmount} ${total.baseCurrency} uncertain (${total.uncertainCount} unknown-variant)`
    );
  }
  if (total.unpricedCount > 0) {
    notes.push(`${total.unpricedCount} unpriced`);
  }
  if (total.unconvertibleCount > 0) {
    notes.push(`${total.unconvertibleCount} not convertible to ${total.baseCurrency}`);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "0.75rem",
        flexWrap: "wrap",
        padding: "0.625rem 1rem",
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        background: "var(--color-bg-page)",
      }}
    >
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Holdings value
      </span>
      <span
        style={{
          fontSize: "1.0625rem",
          fontWeight: 700,
          color: "var(--color-text-primary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {total.totalBaseAmount} {total.baseCurrency}
      </span>
      <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
        {total.pricedCount} priced{notes.length > 0 ? ` · ${notes.join(" · ")}` : ""}
      </span>
    </div>
  );
}
