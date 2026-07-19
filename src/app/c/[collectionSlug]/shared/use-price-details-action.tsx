"use client";

import { useState } from "react";
import type { RowAction } from "./row-actions-menu";
import { PriceDetailsDialog, type PriceDetailsTarget } from "./price-details-dialog";

/** Row-actions-menu entry that opens the catalog price-details dialog (averages +
 * per-catalog breakdown) for a stamp or issue, fetched lazily. Replaces the old
 * inline `⋯` price buttons — see #125. Returns the menu action plus the dialog
 * element to render at the row level so it survives the menu closing. */
export function usePriceDetailsAction(
  target: PriceDetailsTarget,
  opts?: { key?: string; label?: string }
): { action: RowAction; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);

  const action: RowAction = {
    key: opts?.key ?? "prices",
    label: opts?.label ?? "Show catalog prices",
    icon: "＄",
    onSelect: () => setOpen(true),
  };

  const dialog = open ? (
    <PriceDetailsDialog target={target} onClose={() => setOpen(false)} />
  ) : null;

  return { action, dialog };
}
