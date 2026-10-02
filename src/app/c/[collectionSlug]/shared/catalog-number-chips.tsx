"use client";

import type { CatalogChipLabel } from "@/lib/area-vendor";
import { CatalogNumberChip } from "./catalog-number-chip";
import { STAMP_PRIMARY_CHIP, STAMP_SECONDARY_CHIP } from "./chip-styles";

/**
 * A stamp's catalogue numbers as the row of chips every stamp row draws (#1525) — the main
 * catalogue's highlighted and first, the others after it. A fragment, so it lands in the caller's
 * own flex line beside whatever else names the stamp.
 *
 * `inert` draws the same chips as plain spans, for a line that is itself a button — a row of the
 * identification history, a tile of a run. A copy chip is a `<button>` (#420), and a button inside a
 * button is invalid markup whose click would land on the wrong one; the row's press is what those
 * lines are for.
 */
export function CatalogNumberChips({
  chips,
  inert,
}: {
  chips: readonly CatalogChipLabel[];
  inert?: boolean;
}) {
  return (
    <>
      {chips.map((chip, i) => {
        const style = chip.primary ? STAMP_PRIMARY_CHIP : STAMP_SECONDARY_CHIP;
        return inert ? (
          <span key={`${i}-${chip.label}`} style={style}>
            {chip.label}
          </span>
        ) : (
          <CatalogNumberChip key={`${i}-${chip.label}`} label={chip.label} style={style} />
        );
      })}
    </>
  );
}
