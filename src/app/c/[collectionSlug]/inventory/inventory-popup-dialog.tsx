"use client";

import { useMemo } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { DialogShell, DialogBody } from "@/app/dialog-shell";
import {
  useInventoryItemsInfinite,
  type InventoryItemFilters,
} from "./use-inventory-query";
import { InventoryCopyList } from "./inventory-copy-list";

/** What the popup is scoped to: a single stamp's copies, or every copy of any stamp
 * in an issue (#110). The label is shown in the dialog title. */
export type InventoryPopupTarget =
  | { kind: "stamp"; stampId: string; label: string }
  | { kind: "issue"; issueId: string; label: string };

interface InventoryPopupDialogProps {
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  target: InventoryPopupTarget;
  onClose: () => void;
}

/** Read-focused popup listing the owned copies for a stamp or issue, opened from the
 * stamp/issue list rows. Reuses {@link InventoryItemRow} in read-only mode so the copy
 * presentation matches the Inventory screen. Closing returns to the list — no navigation. */
export function InventoryPopupDialog({
  collectionId,
  areas,
  baseCurrency,
  target,
  onClose,
}: InventoryPopupDialogProps) {
  const filters: InventoryItemFilters = useMemo(
    () =>
      target.kind === "stamp"
        ? { stampId: target.stampId }
        : { issueId: target.issueId },
    [target]
  );

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useInventoryItemsInfinite(collectionId, filters);

  const copies = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  );

  return (
    <DialogShell
      title={`Copies · ${target.label}`}
      onClose={onClose}
      maxWidth="min(95vw, 90rem)"
      height="min(85vh, 46rem)"
    >
      <DialogBody>
        {isLoading && (
          <div style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            Loading copies…
          </div>
        )}

        {!isLoading && copies.length === 0 && (
          <div style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            No copies recorded {target.kind === "stamp" ? "for this stamp" : "in this issue"} yet.
          </div>
        )}

        {copies.length > 0 && (
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              overflow: "clip",
              background: "var(--color-bg-elevated)",
            }}
          >
            <InventoryCopyList
              copies={copies}
              areas={areas}
              baseCurrency={baseCurrency}
              hasNextPage={!!hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onLoadMore={fetchNextPage}
              readOnly
            />
          </div>
        )}
      </DialogBody>
    </DialogShell>
  );
}
