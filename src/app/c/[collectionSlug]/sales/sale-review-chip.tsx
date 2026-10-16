"use client";

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  SALE_API_REVIEW_LABEL,
  describeSaleApiReview,
  type SaleApiReviewMark,
} from "@/lib/sale-review";
import { formatInstant } from "../auctions/auction-format";

/**
 * Recorded through the agent API and not yet confirmed (#1948) — one component for the sales list's
 * row and the sale's own screen, so a flag shown on the list is shown there too, from the same
 * column. `warning`, the tint the auctions' chip (#1626) and *Set not chosen* use for work
 * outstanding; its hint says what the agent did and when it last wrote. Nothing renders once the
 * collector has confirmed it.
 */
export function SaleApiReviewChip({
  mark,
  chipStyle,
}: {
  mark: SaleApiReviewMark | null;
  chipStyle: React.CSSProperties;
}) {
  if (!mark) return null;
  return (
    <Tooltip content={describeSaleApiReview(mark, formatInstant)}>
      <span
        style={{
          ...chipStyle,
          color: "var(--color-warning)",
          borderColor: "var(--color-warning-border, var(--color-border))",
          background: "var(--color-warning-soft, var(--color-bg-page))",
          fontWeight: 600,
        }}
      >
        {SALE_API_REVIEW_LABEL}
      </span>
    </Tooltip>
  );
}
