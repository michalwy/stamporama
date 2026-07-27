"use client";

import { useState, useTransition } from "react";
import type { AreaCatalogEntry } from "@/lib/areas";
import { QuickPriceDialog, type QuickPriceSubject } from "./quick-price-dialog";

/**
 * Opener + rendered dialog for the quick-add catalog value dialog (#147/#170), owning the
 * save (#341). Returns `open` for whatever affordance the row uses — the Issue list hangs it
 * off the **+ catalog value** link in the price slot, mirroring the Copies list (#228) — and
 * the dialog element to render at the row level so it outlives a transient trigger.
 *
 * `subject` may be null when there is no condition to price at (a collection with no
 * conditions set up yet); `open` is then null too and the row omits the affordance.
 */
export function useQuickPriceDialog({
  collectionId,
  subject,
  areaName,
  primaryVendorId,
  vendorMap,
  onSaved,
}: {
  collectionId: string;
  subject: QuickPriceSubject | null;
  areaName: string | null;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  /** Called after a successful save, to refresh whatever list shows the price. */
  onSaved?: () => void | Promise<unknown>;
}): { open: (() => void) | null; dialog: React.ReactNode } {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const open = subject
    ? () => {
        setError(undefined);
        setIsOpen(true);
      }
    : null;

  const dialog =
    isOpen && subject ? (
      <QuickPriceDialog
        subject={subject}
        collectionId={collectionId}
        areaName={areaName}
        primaryVendorId={primaryVendorId}
        vendorMap={vendorMap}
        isPending={isPending}
        error={error}
        onClose={() => {
          if (isPending) return;
          setIsOpen(false);
          setError(undefined);
        }}
        onSubmit={(entries) => {
          setError(undefined);
          startTransition(async () => {
            const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
            const r = await quickSetCatalogPricesAction(
              subject.stampId,
              subject.conditionId,
              subject.certificateStatusId,
              entries,
              subject.formatId ?? null
            );
            if (r.status === "error") setError(r.message);
            else {
              setIsOpen(false);
              await onSaved?.();
            }
          });
        }}
      />
    ) : null;

  return { open, dialog };
}
