"use client";

import { useState } from "react";
import { IssuePricesPopover } from "./issue-prices-popover";

/**
 * Trigger next to an issue's total, opening a popover with the required-stamps
 * total for every condition. Mirrors AllPricesButton for stamp rows. See #95.
 */
export function IssuePricesButton({
  collectionId,
  issueId,
}: {
  collectionId: string;
  issueId: string;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <button
        type="button"
        aria-label="Show total by condition"
        title="Show total by condition"
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setAnchor({ x: r.left, y: r.bottom });
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "1.4rem",
          height: "1.4rem",
          padding: 0,
          border: "1px solid var(--color-border-strong)",
          borderRadius: "0.25rem",
          background: "var(--color-bg-page)",
          color: "var(--color-text-secondary)",
          cursor: "pointer",
          fontSize: "0.9rem",
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        ⋯
      </button>
      {anchor && (
        <IssuePricesPopover
          collectionId={collectionId}
          issueId={issueId}
          anchor={anchor}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
