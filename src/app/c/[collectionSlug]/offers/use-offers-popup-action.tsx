"use client";

import { useState } from "react";
import type { RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { OffersPopupDialog, type OffersPopupTarget } from "./offers-popup-dialog";

/** Row-actions-menu entry that opens the read-only offers popup for a copy, a stamp or an issue
 * (#276, #349). Returns the menu action plus the dialog element to render at the row level so it
 * survives the menu closing — the same shape as `useInventoryPopupAction` (#110), and used the same
 * way from the stamp/issue rows.
 *
 * Unconditional by design: a stamp whose copies have all sold still has listings worth looking up,
 * and a row carries no offer count to hide the entry by. */
export function useOffersPopupAction({
  collectionId,
  target,
  key = "offers",
  label = "View offers",
}: {
  collectionId: string;
  target: OffersPopupTarget;
  key?: string;
  label?: string;
}): { action: RowAction; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);

  const action: RowAction = {
    key,
    label,
    // Same "▤" as the read-only copies popup — one icon for "open a read-only list of related
    // records".
    icon: "▤",
    onSelect: () => setOpen(true),
  };

  const dialog = open ? (
    <OffersPopupDialog
      collectionId={collectionId}
      target={target}
      onClose={() => setOpen(false)}
    />
  ) : null;

  return { action, dialog };
}
