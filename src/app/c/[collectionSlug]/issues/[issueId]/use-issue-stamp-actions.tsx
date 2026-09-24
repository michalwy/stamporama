"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { IssueListItem, StampNodeData } from "@/lib/issues";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { AddVariantRangeDialog } from "@/app/c/[collectionSlug]/shared/add-variant-range-dialog";
import { DeleteStampDialog } from "@/app/c/[collectionSlug]/shared/delete-stamp-dialog";
import { useInvalidateStampsAndIssues } from "@/app/c/[collectionSlug]/shared/use-invalidate-stamps-and-issues";
import type { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { inventoryKeys } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";

// The issue's stamp tree, managed from the issue's own screen (#1381).
//
// #630 gave the stamp page its variant tree's operations for a reason that holds one level up: an
// issue's membership is the relationship *between* its stamps, not a field of the issue, so adding,
// correcting or removing one here is not a second editor. And, as there, **not one field of its
// own**: every write goes through the very dialog the Issues list's stamp row opens —
// `StampFormDialog` to add and edit, `AddVariantRangeDialog` (#722) for a lettered run,
// `DeleteStampDialog` to remove, with its own confirmation and rules — so there is still exactly one
// editor per record, and nothing is removed here that could not be removed from the list.
//
// Move to another issue (#54) and reassign to another parent (#656) stay on the list. They were not
// asked for, and each is a correction across the tree rather than a change to one of its stamps.

type Dialog =
  | { kind: "none" }
  | { kind: "add"; parent: StampNodeData | null }
  | { kind: "add-range"; parent: StampNodeData }
  | { kind: "edit"; stamp: StampNodeData }
  | { kind: "delete"; stamp: StampNodeData };

/** An issue named the way every other surface names it: year first, then name. */
function issueLabel(issue: IssueListItem): string {
  return [issue.year, issue.name].filter(Boolean).join(", ") || "(unnamed issue)";
}

export interface IssueStampActions {
  /** Add a stamp to the issue itself, at its top level. */
  addStamp: () => void;
  /** Add one variant under a stamp of the tree. */
  addChild: (parent: StampNodeData) => void;
  /** Add a whole lettered run under a stamp of the tree (#722). */
  addVariantRange: (parent: StampNodeData) => void;
  edit: (stamp: StampNodeData) => void;
  remove: (stamp: StampNodeData) => void;
  /** Re-read everything the page draws from the tree. The dialogs call it on success; the tree's
   *  reorder (#549) is handed it too, so every write on the card ends the same way. */
  afterWrite: () => void;
  /** True while a write is in flight. */
  isPending: boolean;
  /** Whichever dialog is open, or null. */
  dialog: React.ReactNode;
}

export function useIssueStampActions({
  collectionId,
  issue,
  maps,
}: {
  collectionId: string;
  issue: IssueListItem;
  maps: ReturnType<typeof useAreaVendorMaps>;
}): IssueStampActions {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function open(next: Dialog) {
    setError(undefined);
    setDialog(next);
  }

  function closeDialog() {
    if (isPending) return;
    setDialog({ kind: "none" });
    setError(undefined);
  }

  /**
   * A write landed, and everything that reads the tree must say so at once. The page is
   * server-rendered, so the tree, the Details and Checklists cards and the Completeness grids come
   * back with `router.refresh()`. The rest hold queries of their own: the Issues and Stamps lists
   * (#918 — **Back to issues** is the way out, and its tree must not still read as before), the
   * catalog-value cards (`checklistPriceDetails`, as the checklist editor's close does, #1278), and
   * the Copies card, whose rows name the stamp and which a delete takes copies out of.
   */
  function afterWrite() {
    router.refresh();
    void invalidateStampsAndIssues(collectionId);
    void queryClient.invalidateQueries({ queryKey: ["checklistPriceDetails", collectionId] });
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.all(collectionId) });
  }

  function onSaved() {
    setDialog({ kind: "none" });
    setError(undefined);
    afterWrite();
  }

  // Resolved through the issue, so a per-issue prefix override (#377) labels the catalog-number
  // inputs with the prefix the numbers will actually carry — the Issues list's own resolution.
  const areaVendors = [...maps.vendorMapFor(issue.collectionAreaId, issue.id).values()];

  let rendered: React.ReactNode = null;

  if (dialog.kind === "add") {
    const { parent } = dialog;
    rendered = (
      <StampFormDialog
        mode="add"
        collectionId={collectionId}
        issues={[issue]}
        areaVendors={areaVendors}
        prefilledIssueId={issue.id}
        prefilledParentStampId={parent?.stampId}
        // A variant is dated from the stamp it hangs under, not from the issue (#360), and numbered
        // off it (`309` → `309A`) — the Issues list's own prefill (#386).
        prefilledParentIssuedYear={parent?.issuedYear ?? null}
        defaultCatalogNumbers={parent?.catalogNumbers}
        isPending={isPending}
        error={error}
        onClose={closeDialog}
        onSubmit={(issueId, fd) =>
          startTransition(async () => {
            const { addStampToIssueAction } = await import("@/app/actions/issues");
            const result = await addStampToIssueAction(collectionId, issueId, fd);
            if (result.status === "success") onSaved();
            else if (result.status === "error") setError(result.message);
          })
        }
      />
    );
  } else if (dialog.kind === "add-range") {
    const { parent } = dialog;
    rendered = (
      <AddVariantRangeDialog
        collectionId={collectionId}
        issueId={issue.id}
        issueName={issueLabel(issue)}
        areaId={issue.collectionAreaId}
        parent={{
          stampId: parent.stampId,
          name: parent.name,
          catalogNumbers: parent.catalogNumbers,
        }}
        vendors={areaVendors}
        primaryVendorId={maps.primaryVendorByArea.get(issue.collectionAreaId) ?? null}
        isPending={isPending}
        error={error}
        onClose={closeDialog}
        onSubmit={(fd) =>
          startTransition(async () => {
            const { addVariantRangeAction } = await import("@/app/actions/issues");
            const result = await addVariantRangeAction(collectionId, issue.id, parent.stampId, fd);
            if (result.status === "success") onSaved();
            else if (result.status === "error") setError(result.message);
          })
        }
      />
    );
  } else if (dialog.kind === "edit") {
    const { stamp } = dialog;
    rendered = (
      <StampFormDialog
        mode="edit"
        stampId={stamp.stampId}
        collectionId={collectionId}
        stamp={{
          ...stamp,
          // This issue's checklists, each ticked where the stamp is on it (#531) — the node carries
          // only the ids it belongs to, and the picker needs the boxes it does not. The Issues
          // list's stamp row hands the dialog exactly this.
          issues: [
            {
              issueId: issue.id,
              checklists: issue.checklists.map((c) => ({
                id: c.id,
                name: c.name,
                on: stamp.checklistIds.includes(c.id),
              })),
            },
          ],
        }}
        areaVendors={areaVendors}
        isPending={isPending}
        error={error}
        onClose={closeDialog}
        onSubmit={(fd) =>
          startTransition(async () => {
            const { updateStampWithCatalogAction } = await import("@/app/actions/stamps");
            const result = await updateStampWithCatalogAction(stamp.stampId, fd);
            if (result.status === "success") onSaved();
            else if (result.status === "error") setError(result.message);
          })
        }
      />
    );
  } else if (dialog.kind === "delete") {
    const { stamp } = dialog;
    rendered = (
      <DeleteStampDialog
        stampId={stamp.stampId}
        stampName={stamp.name ?? "(unnamed)"}
        isPending={isPending}
        error={error}
        onClose={closeDialog}
        onConfirm={(mode) =>
          startTransition(async () => {
            const { deleteStampAction } = await import("@/app/actions/stamps");
            const result = await deleteStampAction(stamp.stampId, mode);
            if (result.status === "success") onSaved();
            else if (result.status === "error") setError(result.message);
          })
        }
      />
    );
  }

  return {
    addStamp: () => open({ kind: "add", parent: null }),
    addChild: (parent) => open({ kind: "add", parent }),
    addVariantRange: (parent) => open({ kind: "add-range", parent }),
    edit: (stamp) => open({ kind: "edit", stamp }),
    remove: (stamp) => open({ kind: "delete", stamp }),
    afterWrite,
    isPending,
    dialog: rendered,
  };
}
