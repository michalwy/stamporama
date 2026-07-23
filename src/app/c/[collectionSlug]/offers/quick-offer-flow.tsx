"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/app/dialog-shell";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { ItemListItem } from "@/lib/items";
import { InventoryItemFormDialog } from "@/app/c/[collectionSlug]/inventory/inventory-item-form-dialog";
import { AddToOfferDialog } from "@/app/c/[collectionSlug]/inventory/add-to-offer-dialog";

/** Start the copy For sale so the offer step can list it immediately (#241). Delivery already
 * defaults to "delivered" in the copy form, so the copy is listable without extra clicks. */
const QUICK_OFFER_DISPOSITION = {
  inCollection: false,
  forSale: true,
  forTrade: false,
} as const;

export interface QuickOfferFlowProps {
  collectionId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  baseCurrency: string;
  /** Pre-fills the platform when creating a new offer in the offer step — the list filter's
   * platform, falling back to the last one used (#241). */
  initialPlatform?: { id: string; name: string; platformCurrency?: string | null };
  /** Fires with the platform id when a brand-new offer is created, so the caller can remember it. */
  onPlatformUsed?: (platformId: string) => void;
  /** Close the whole flow. */
  onClose: () => void;
  /** An offer was created or the copy joined an offer — refresh the offers list. */
  onOfferDone: () => void;
}

type Step =
  | { kind: "copy" }
  | { kind: "offer"; item: ItemListItem }
  | { kind: "saved"; item: ItemListItem };

/**
 * End-to-end "sell a new item" flow (#241): walks from nothing to a live offer in one pass by
 * chaining the pieces that already exist.
 *
 * 1. **Describe the item** — the shared add-copy dialog, whose stamp picker creates the Issue and
 *    stamp inline (#104/#105) when they don't exist yet. The copy starts *For sale* + delivered so
 *    it's immediately listable.
 * 2. **List it** — the same rich offer picker used from the Copies list (#188/#189), seeded with the
 *    freshly created copy: create a brand-new offer (price pre-filled from the catalog value, #230)
 *    or drop it into an existing one.
 *
 * Cancelling the offer step doesn't orphan anything — the copy is a real inventory item — so an
 * acknowledgement step makes clear what was created and offers a one-click path to list it later.
 */
export function QuickOfferFlow({
  collectionId,
  areas,
  locations,
  conditions,
  certificateStatuses,
  baseCurrency,
  initialPlatform,
  onPlatformUsed,
  onClose,
  onOfferDone,
}: QuickOfferFlowProps) {
  const [step, setStep] = useState<Step>({ kind: "copy" });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  if (step.kind === "copy") {
    return (
      <InventoryItemFormDialog
        mode="add"
        collectionId={collectionId}
        areas={areas}
        locations={locations}
        conditions={conditions}
        certificateStatuses={certificateStatuses}
        initialDisposition={{ ...QUICK_OFFER_DISPOSITION }}
        addActionLabel="Save & continue to offer"
        persistDefaults={false}
        isPending={isPending}
        error={error}
        onClose={onClose}
        onSubmit={(fd) => {
          setError(undefined);
          startTransition(async () => {
            const { createItemForOfferAction } = await import("@/app/actions/items");
            const result = await createItemForOfferAction(collectionId, fd);
            if (result.status === "success") {
              setStep({ kind: "offer", item: result.item });
            } else {
              setError(result.message);
            }
          });
        }}
      />
    );
  }

  if (step.kind === "offer") {
    return (
      <AddToOfferDialog
        collectionId={collectionId}
        item={step.item}
        areas={areas}
        locations={locations}
        baseCurrency={baseCurrency}
        initialPlatform={initialPlatform}
        onPlatformUsed={onPlatformUsed}
        // Abandoning the offer step leaves the copy in inventory — acknowledge it rather than
        // silently dropping the user back to the list.
        onClose={() => setStep({ kind: "saved", item: step.item })}
        onDone={() => {
          onOfferDone();
          onClose();
        }}
      />
    );
  }

  // Acknowledgement (offer step abandoned): the copy exists; offer listing it now or later.
  const copyName = step.item.stampName ?? "The copy";
  return (
    <ConfirmDialog
      title="Copy saved to inventory"
      variant="primary"
      message={
        <>
          <strong>{copyName}</strong> was added to your inventory as a <em>For sale</em> copy, but
          isn&rsquo;t listed on any offer yet. You can list it now, or anytime from the Copies list.
        </>
      }
      actionLabel="List it now"
      onConfirm={() => setStep({ kind: "offer", item: step.item })}
      onClose={onClose}
    />
  );
}
