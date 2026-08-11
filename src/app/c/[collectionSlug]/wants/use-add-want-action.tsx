"use client";

import { useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { WantCreateInput } from "@/lib/wants";
import type { RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import type { PickedStamp } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { useInvalidateStamps } from "@/app/c/[collectionSlug]/stamps/use-stamps-query";
import { useInvalidateIssues } from "@/app/c/[collectionSlug]/issues/use-issues-query";
import { WantFormDialog } from "./want-form-dialog";
import { useInvalidateWants } from "./use-wants-query";

/**
 * The row-menu entry that puts a catalogue stamp on the want list (#532), for the stamps list and
 * every issue's stamp tree.
 *
 * It opens the **same form** the want list opens, with the stamp already picked — rather than
 * writing a want on one click. A want that says nothing about what would satisfy it is a want you
 * have to go and edit, and the terms are the whole content of the record (ADR-0032 §1): the form is
 * three chips and a button, which is cheaper than the round trip it saves.
 *
 * Saving invalidates **three** caches, not one. The want itself lives in the wants queries, but the
 * marker the collector is looking at rides on `StampListItem.wants` and `StampNodeData.wants` —
 * denormalized onto the catalogue read models so a row can draw it without a query of its own. A
 * write that refreshed only its own list left the chip missing until a full reload, which is the
 * bug: whatever a value is copied onto has to be invalidated with it.
 *
 * Returns the action plus the dialog to render at the row level, the shape every other row-dialog
 * hook here uses, so the dialog survives the menu closing.
 */
export function useAddWantAction({
  collectionId,
  areas,
  stamp,
  onSaved,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  /** The row's stamp, already shaped for the form's picker summary. */
  stamp: PickedStamp;
  /** Refresh the row that raised this — the want chip is on it. */
  onSaved?: () => void;
}): { action: RowAction; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { invalidate } = useInvalidateWants();
  const { invalidateList: invalidateStamps } = useInvalidateStamps();
  const { invalidateList: invalidateIssues } = useInvalidateIssues();

  const action: RowAction = {
    key: "add-want",
    label: "Add to want list",
    icon: "wants",
    onSelect: () => {
      setError(undefined);
      setOpen(true);
    },
  };

  const dialog = open ? (
    <WantFormDialog
      mode="add"
      collectionId={collectionId}
      areas={areas}
      initialStamp={stamp}
      isPending={isPending}
      error={error}
      onClose={() => {
        if (!isPending) setOpen(false);
      }}
      onSubmit={async (input: WantCreateInput) => {
        setPending(true);
        setError(undefined);
        const { createWantAction } = await import("@/app/actions/wants");
        const result = await createWantAction(collectionId, input);
        setPending(false);
        if (result.status === "error") {
          setError(result.message);
          return;
        }
        setOpen(false);
        void invalidate(collectionId);
        // The catalogue lists carry the want chip; `issueKeys.all` prefix-matches an issue's
        // expanded members too, so a tree open on screen redraws with the rest.
        void invalidateStamps(collectionId);
        void invalidateIssues(collectionId);
        onSaved?.();
      }}
    />
  ) : null;

  return { action, dialog };
}
