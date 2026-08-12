"use client";

// Toolbar controls shared by the three auction screens (lots, sales, sale detail), so a chip and a
// select look the same on all of them. Same shapes the offers toolbar uses; kept here rather than
// imported from there because that panel owns its own copy and nothing else does yet.

import type { LotSignal } from "@/lib/auction-lot";

/** The derived states offered on the toolbar (`auction-lot.ts`). *Bid possible* leads because it is
 * the one that turns the list into a to-do: those are the lots that can still be taken without
 * going past what they are worth. */
export const SIGNALS: { value: LotSignal; label: string; hint: string }[] = [
  {
    value: "bid-possible",
    label: "Can still bid",
    hint: "Your ceiling leaves room above the current price",
  },
  { value: "outbid", label: "Outbid", hint: "The price has passed the bid you placed" },
  { value: "leading", label: "Leading", hint: "Your bid still covers the current price" },
  {
    value: "over-ceiling",
    label: "Over ceiling",
    hint: "All-in, the current price has passed what the lot is worth to you",
  },
  {
    value: "won-pending",
    label: "Won?",
    hint: "Closed with your bid ahead — the outcome has not been recorded yet",
  },
];

export const CONTROL_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minHeight: "2rem",
};

export function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  /** Matching rows (#332), or undefined for a chip that carries no count (and while the first count
   * fetch is still in flight — the chips render without badges rather than flashing zeros). */
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...CONTROL_STYLE,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        // A chip is one word for one filter: it may leave the row, but it must not break in half
        // (#558). Its label is what it is, so there is nothing to gain by letting a squeezed
        // toolbar reflow it into two lines of a control two lines tall.
        whiteSpace: "nowrap",
        flexShrink: 0,
        fontWeight: active ? 600 : 400,
        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
        borderColor: active ? "var(--color-accent)" : "var(--color-border-strong)",
        background: active ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
      }}
    >
      {label}
      {count !== undefined && (
        <span
          style={{
            fontSize: "0.75rem",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            opacity: count === 0 ? 0.5 : 0.8,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
