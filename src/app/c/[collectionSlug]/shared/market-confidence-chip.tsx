"use client";

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { MarketConfidenceBadge } from "@/lib/market-value";

/** The confidence badge's colours (ADR-0022 §5). Shown **next to the facts that produced it** and
 * never keyed off by any rule — a `low` badge is a note about the evidence, not a verdict, so it
 * takes the same muted chip shape a fact does rather than an alarm. */
const BADGE_COLOR: Record<MarketConfidenceBadge, { fg: string; bg: string }> = {
  low: { fg: "var(--color-text-muted)", bg: "var(--color-bg-page)" },
  medium: { fg: "var(--color-warning)", bg: "var(--color-warning-soft)" },
  high: { fg: "var(--color-success)", bg: "var(--color-success-soft)" },
};

/** The same three colours, for a surface that carries the confidence **on the figure itself**.
 *
 * The Valuation grid does: a chip beside each median made every column ragged, and a column of
 * prices that does not line up is a column that cannot be scanned — which is most of what a grid is
 * for. Colouring the amount says the same thing in no width at all. It stays a *note about the
 * evidence* either way, never a verdict, and never the only place the score is said: the hover
 * still spells it out, since colour alone is not something every reader can act on. */
export function marketConfidenceColor(badge: MarketConfidenceBadge): string {
  return BADGE_COLOR[badge].fg;
}

/**
 * How much a market figure is worth trusting, wherever one is shown (#511, #457).
 *
 * Shared rather than drawn twice: the bid popover and the stamp's Valuation tab print the same
 * score off the same rule, and two chips would sooner or later disagree about what `medium` looks
 * like — which is exactly the kind of drift that makes a confidence signal stop meaning anything.
 */
export function MarketConfidenceChip({
  badge,
  score,
}: {
  badge: MarketConfidenceBadge;
  score: number;
}) {
  const colors = BADGE_COLOR[badge];
  return (
    <Tooltip content={`Confidence ${score}/100 — from sample, recency, agreement and how much of the evidence was taken whole`}>
      <span
        style={{
          fontSize: "0.625rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          padding: "0.05rem 0.35rem",
          borderRadius: "0.25rem",
          border: "1px solid var(--color-border)",
          color: colors.fg,
          background: colors.bg,
          whiteSpace: "nowrap",
        }}
      >
        {badge}
      </span>
    </Tooltip>
  );
}
