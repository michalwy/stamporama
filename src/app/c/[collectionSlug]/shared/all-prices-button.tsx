"use client";

import { useState } from "react";
import { StampPricesPopover } from "./stamp-prices-popover";

/**
 * Small trigger shown next to a list price. Clicking opens a popover listing all
 * of the stamp's recorded prices (every condition × certificate status), fetched
 * lazily so the list payload stays lean. See #95.
 */
export function AllPricesButton({ stampId }: { stampId: string }) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <button
        type="button"
        aria-label="Show all catalog prices"
        title="Show all catalog prices"
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
        <StampPricesPopover
          stampId={stampId}
          anchor={anchor}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
