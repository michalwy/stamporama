"use client";

import { useState, useTransition } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import {
  InventoryPopupDialog,
  type InventoryPopupTarget,
} from "./inventory-popup-dialog";
import { InventoryItemFormDialog } from "./inventory-item-form-dialog";
import type { PickedStamp } from "./stamp-picker-shared";
import type { IssuePickerContext } from "./issue-stamp-picker-dialog";
import {
  useCollectionCertificateStatuses,
  useCollectionLocations,
  useInvalidateInventory,
} from "./use-inventory-query";

/** Row-actions-menu entry that opens the read-only inventory popup for a stamp or
 * issue (#110). Returns the menu action plus the dialog element to render at the
 * row level so it survives the menu closing. */
export function useInventoryPopupAction({
  collectionId,
  areas,
  baseCurrency,
  target,
  key = "copies",
  label = "View copies",
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  target: InventoryPopupTarget;
  key?: string;
  label?: string;
}): { action: RowAction; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);

  const action: RowAction = {
    key,
    label,
    icon: "▤",
    onSelect: () => setOpen(true),
  };

  const dialog = open ? (
    <InventoryPopupDialog
      collectionId={collectionId}
      areas={areas}
      baseCurrency={baseCurrency}
      target={target}
      onClose={() => setOpen(false)}
    />
  ) : null;

  return { action, dialog };
}

/** What a new copy is seeded with: a specific stamp (pre-selected picker) or an issue
 * (picker scoped to the issue's stamps). Mirrors {@link InventoryPopupTarget} (#110). */
export type InventoryAddTarget =
  | { kind: "stamp"; stampId: string; initial: PickedStamp }
  | { kind: "issue"; issue: IssuePickerContext };

/** Row-actions-menu entry that opens the add-copy dialog pre-filled with a stamp (or
 * scoped to an issue's stamps) from the stamp/issue lists (#111). Owns the
 * condition/certificate-status queries the dialog needs and the create mutation. */
export function useInventoryAddAction({
  collectionId,
  areas,
  baseCurrency,
  target,
  key = "add-copy",
  label = "Add copy",
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  target: InventoryAddTarget;
  key?: string;
  label?: string;
}): { action: RowAction; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const { invalidateList } = useInvalidateInventory();

  // Fetched client-side so the stamp/issue lists don't have to thread these server-loaded
  // props down to every row. Both are cached (staleTime) and shared across rows.
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const { data: certificateStatuses = [] } =
    useCollectionCertificateStatuses(collectionId);
  const { data: locations = [] } = useCollectionLocations(collectionId);

  function close() {
    if (!isPending) {
      setOpen(false);
      setError(undefined);
    }
  }

  const action: RowAction = {
    key,
    label,
    icon: "＋",
    onSelect: () => setOpen(true),
  };

  const dialog = open ? (
    <InventoryItemFormDialog
      mode="add"
      collectionId={collectionId}
      areas={areas}
      locations={locations}
      conditions={conditions}
      certificateStatuses={certificateStatuses}
      baseCurrency={baseCurrency}
      initialStamp={target.kind === "stamp" ? target.initial : undefined}
      initialStampId={target.kind === "stamp" ? target.stampId : undefined}
      scopeIssue={target.kind === "issue" ? target.issue : undefined}
      isPending={isPending}
      error={error}
      onClose={close}
      onSubmit={(fd) => {
        startTransition(async () => {
          const { createItemAction } = await import("@/app/actions/items");
          const result = await createItemAction(collectionId, fd);
          if (result.status === "success") {
            setOpen(false);
            setError(undefined);
            invalidateList(collectionId);
          } else if (result.status === "error") {
            setError(result.message);
          }
        });
      }}
    />
  ) : null;

  return { action, dialog };
}
