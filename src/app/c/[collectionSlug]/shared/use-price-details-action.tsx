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
    icon: "prices",
    onSelect: () => setOpen(true),
  };

  const dialog = open ? (
    <PriceDetailsDialog target={target} onClose={() => setOpen(false)} />
  ) : null;

  return { action, dialog };
}

/**
 * The same entry, once per checklist of an issue (#531). An issue may carry several goals and each
 * has its own total, so there is no single "the prices for this issue" to open — the menu names the
 * checklist instead. With exactly one checklist the entry keeps its old label, because an issue
 * with one set is the ordinary case and naming it there would be noise.
 *
 * A hook cannot be called in a loop, so this owns one dialog and remembers which checklist opened
 * it, rather than being {@link usePriceDetailsAction} per row.
 */
export function useChecklistPriceActions({
  collectionId,
  checklists,
}: {
  collectionId: string;
  checklists: { id: string; name: string; priceTotal: unknown }[];
}): { actions: RowAction[]; dialog: React.ReactNode } {
  const [openId, setOpenId] = useState<string | null>(null);

  const actions: RowAction[] = checklists
    .filter((c) => c.priceTotal)
    .map((c) => ({
      key: `prices-${c.id}`,
      label: checklists.length === 1 ? "Show catalog prices" : `Show catalog prices — ${c.name}`,
      icon: "prices",
      onSelect: () => setOpenId(c.id),
    }));

  const dialog = openId ? (
    <PriceDetailsDialog
      target={{ kind: "checklist", collectionId, checklistId: openId }}
      onClose={() => setOpenId(null)}
    />
  ) : null;

  return { actions, dialog };
}
