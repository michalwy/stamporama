"use client";

import { Tooltip } from "./tooltip";
import { PRICE_STALE_ICON } from "./chip-styles";

/** ⚠ marker shown next to a stamp price that is from an older catalog edition. */
export function StalePriceIcon() {
  return (
    <Tooltip
      align="end"
      content={
        <>
          <div style={{ fontWeight: 600, marginBottom: "0.15rem" }}>Older-edition price</div>
          <div style={{ color: "var(--color-text-secondary)" }}>
            This price is from an older catalog edition; a newer edition exists.
          </div>
          <div style={{ color: "var(--color-text-muted)" }}>
            Open the stamp&apos;s Prices tab to record an updated price.
          </div>
        </>
      }
    >
      <span aria-label="Older-edition price" style={PRICE_STALE_ICON}>
        ⚠
      </span>
    </Tooltip>
  );
}
