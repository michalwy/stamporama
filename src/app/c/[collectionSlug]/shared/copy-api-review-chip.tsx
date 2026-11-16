"use client";

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { API_REVIEW_LABEL, type ApiReviewMark } from "@/lib/auction-review";
import { describeCopyApiReview } from "@/lib/copy-review";
import { formatInstant } from "../auctions/auction-format";

/**
 * Added to a purchase lot or corrected there through the agent API, and not yet confirmed (#2551) —
 * one component for the purchase screen's copy row and the copy's own page, so a flag shown on the
 * list is shown there too, from the same columns. The auctions' and sales' chip (#1626, #1948): the
 * same label and `warning` tint, its hint saying what the agent did and when. Nothing renders once
 * the collector has confirmed it.
 */
export function CopyApiReviewChip({
  mark,
  chipStyle,
}: {
  mark: ApiReviewMark | null;
  chipStyle: React.CSSProperties;
}) {
  if (!mark) return null;
  return (
    <Tooltip content={describeCopyApiReview(mark, formatInstant)}>
      <span
        style={{
          ...chipStyle,
          color: "var(--color-warning)",
          borderColor: "var(--color-warning-border, var(--color-border))",
          background: "var(--color-warning-soft, var(--color-bg-page))",
          fontWeight: 600,
        }}
      >
        {API_REVIEW_LABEL}
      </span>
    </Tooltip>
  );
}
