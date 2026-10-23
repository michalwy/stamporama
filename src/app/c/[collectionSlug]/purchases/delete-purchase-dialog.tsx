"use client";

import { ConfirmDialog } from "@/app/dialog-shell";
import type { PurchaseKind } from "@/lib/purchase-kind";

/** The words a deleted document is confirmed with (#541): the toast after a delete, from either
 *  place it can be deleted. */
export function purchaseDeletedMessage(kind: PurchaseKind): string {
  return kind === "opening_balance" ? "Opening balance deleted" : "Purchase deleted";
}

/** An intake document's delete confirmation — one dialog for the Intake documents list's row **⋮**
 *  and the document's own header **⋮** (#2126), so the two cannot drift apart. */
export function DeletePurchaseDialog({
  kind,
  isPending,
  error,
  onConfirm,
  onClose,
}: {
  kind: PurchaseKind;
  isPending: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const opening = kind === "opening_balance";
  return (
    <ConfirmDialog
      title={opening ? "Delete opening balance" : "Delete purchase"}
      message={
        opening
          ? "This permanently removes this opening balance and its lots. This cannot be undone."
          : "This permanently removes this purchase and its lot and expense lines. This cannot be undone."
      }
      actionLabel={opening ? "Delete opening balance" : "Delete purchase"}
      pendingLabel="Deleting…"
      variant="destructive"
      isPending={isPending}
      error={error}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
