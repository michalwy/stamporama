"use client";

import type { CatalogChipLabel } from "@/lib/area-vendor";
import { CatalogNumberChip } from "./catalog-number-chip";
import { STAMP_PRIMARY_CHIP, STAMP_SECONDARY_CHIP } from "./chip-styles";

/**
 * A stamp's catalogue numbers as the row of chips every stamp row draws (#1525) — the main
 * catalogue's highlighted and first, the others after it. A fragment, so it lands in the caller's
 * own flex line beside whatever else names the stamp.
 */
export function CatalogNumberChips({ chips }: { chips: readonly CatalogChipLabel[] }) {
  return (
    <>
      {chips.map((chip, i) => (
        <CatalogNumberChip
          key={`${i}-${chip.label}`}
          label={chip.label}
          style={chip.primary ? STAMP_PRIMARY_CHIP : STAMP_SECONDARY_CHIP}
        />
      ))}
    </>
  );
}
