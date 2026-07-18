"use client";

import { DialogShell, DialogBody, DialogSecondaryButton } from "@/app/dialog-shell";
import type { ItemListItem } from "@/lib/items";
import { useItemVariantHistory } from "./use-inventory-query";
import { VariantHistoryList } from "./variant-history-list";

/** Read-only refinement history for a copy (#100), opened from a row's History affordance.
 * Available on any copy that has been refined, including already-identified ones. */
export function VariantHistoryDialog({
  collectionId,
  item,
  onClose,
}: {
  collectionId: string;
  item: ItemListItem;
  onClose: () => void;
}) {
  const { data: history, isLoading } = useItemVariantHistory(collectionId, item.id, true);

  return (
    <DialogShell title="Refinement history" onClose={onClose} minHeight="16rem" maxWidth="32rem">
      <DialogBody>
        <VariantHistoryList entries={history} isLoading={isLoading} />
      </DialogBody>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "1rem 1.5rem",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
      </div>
    </DialogShell>
  );
}
