"use client";

import type { AreaCatalogEntry } from "@/lib/areas";
import { formatStampCN } from "@/lib/area-vendor";
import { Tooltip } from "./tooltip";

/**
 * A stamp's or issue's catalog number, as the chip every list draws it with.
 *
 * It is **plain text, not a control** (#1590). It used to copy its number on click (#420), which
 * the collector did to search Colnect by hand — the Colnect chip beside it now runs that search
 * itself, and a chip that looked clickable for no purpose competed with clicking the row it sits
 * in (#1591). So a click on it is a click on the row, and the number can still be selected and
 * copied the ordinary way.
 */
export function CatalogNumberChip({
  number,
  vendor,
  label,
  style,
  tooltip,
  tooltipAlign,
}: {
  /** The stored number, for the sites that have the parts (`Mi` + `PL` + `200`). */
  number?: string;
  /** The area's (or issue's, #377) catalog entry for this vendor — its abbreviation and prefix. */
  vendor?: AreaCatalogEntry;
  /** An already-formatted label (`Mi·PL 1B`), for the surfaces that only carry one — the pickers'
   * `PickedStamp.catalogLabels` and an issue's declared range. Ignored when `number` is given. */
  label?: string;
  /** The chip's own styling — `STAMP_PRIMARY_CHIP`, `ISSUE_SECONDARY_CHIP`, … */
  style: React.CSSProperties;
  /** A hint where the chip has something to say (the primary-catalog marker, an extended declared
   * range). None otherwise: a bare number explains itself. */
  tooltip?: React.ReactNode;
  /** Anchoring for a long bubble that would otherwise centre off the row's edge. */
  tooltipAlign?: "start" | "center" | "end";
}) {
  const text = number !== undefined ? formatStampCN(number, vendor) : (label ?? "");
  const chip = <span style={style}>{text}</span>;
  if (!tooltip) return chip;
  return (
    <Tooltip align={tooltipAlign} content={tooltip}>
      {chip}
    </Tooltip>
  );
}
