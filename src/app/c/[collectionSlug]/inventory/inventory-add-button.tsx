"use client";

import { useState, useTransition } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { addBtnStyle } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { InventoryItemFormDialog } from "./inventory-item-form-dialog";
import type { PickedStamp } from "./stamp-picker-shared";
import type { IssuePickerContext } from "./issue-stamp-picker-dialog";
import {
  useCollectionCertificateStatuses,
  useInvalidateInventory,
} from "./use-inventory-query";

/** What a new copy is seeded with: a specific stamp (pre-selected picker) or an issue
 * (picker scoped to the issue's stamps). Mirrors {@link InventoryPopupTarget} (#110). */
export type InventoryAddTarget =
  | { kind: "stamp"; stampId: string; initial: PickedStamp }
  | { kind: "issue"; issue: IssuePickerContext };

interface InventoryAddButtonProps {
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  target: InventoryAddTarget;
  /** Optional label override; defaults to "+ Copy". */
  label?: string;
}

/** Row action that opens the add-copy dialog pre-filled with a stamp (or scoped to an
 * issue's stamps) directly from the stamp/issue lists (#111). Self-contained — owns its
 * open state, the condition/certificate-status queries the dialog needs, and the create
 * mutation — mirroring {@link InventoryPopupButton}. */
export function InventoryAddButton({
  collectionId,
  areas,
  baseCurrency,
  target,
  label = "+ Copy",
}: InventoryAddButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const { invalidateList } = useInvalidateInventory();

  // Fetched client-side so the stamp/issue lists don't have to thread these server-loaded
  // props down to every row. Both are cached (staleTime) and shared across rows.
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const { data: certificateStatuses = [] } =
    useCollectionCertificateStatuses(collectionId);

  function close() {
    if (!isPending) {
      setOpen(false);
      setError(undefined);
    }
  }

  return (
    <>
      <button
        type="button"
        style={addBtnStyle}
        title="Add a copy to inventory"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open && (
        <InventoryItemFormDialog
          mode="add"
          collectionId={collectionId}
          areas={areas}
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
      )}
    </>
  );
}
