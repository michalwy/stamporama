"use client";

import { useMemo } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { ItemListItem } from "@/lib/items";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { useCollectionLocations } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import { useOfferCopies } from "../use-offers-query";

const NOTE: React.CSSProperties = {
  padding: "0.5rem 1.25rem",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

/**
 * A Prepare row opened onto its copies (#1941): every copy in the offer as the full copy row the rest
 * of the app draws — thumbnail, catalogue numbers, condition, faults, certificate, location,
 * catalogue value — so what exactly is being priced is a look away rather than a trip into the offer.
 *
 * Read when the row is opened, not with the page (`useOfferCopies`, the offer screen's own read and
 * cache), since most rows stay closed — the Add-to-offer picker's *Show contents* rule (#867). Drawn
 * in the offer's set-by-set order. Read-only: the quick look is a look, and a click on a copy opens
 * its own page.
 */
export function PrepareOfferCopies({
  collectionId,
  areas,
  baseCurrency,
  offerId,
  itemIds,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  offerId: string;
  /** The offer's copies in its own order. */
  itemIds: readonly string[];
}) {
  const { data: fetched, isLoading } = useOfferCopies(collectionId, offerId, true);
  const { data: locations = [] } = useCollectionLocations(collectionId);
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const copies = useMemo(() => {
    const byId = new Map((fetched ?? []).map((c) => [c.id, c]));
    return itemIds.map((id) => byId.get(id)).filter((c): c is ItemListItem => !!c);
  }, [fetched, itemIds]);

  return (
    <div style={{ background: "var(--color-bg-page)", borderTop: "1px solid var(--color-border)" }}>
      {isLoading ? (
        <div style={{ ...NOTE, paddingLeft: SELECT_STRIP.width }}>Loading copies…</div>
      ) : copies.length === 0 ? (
        // The toggle is only drawn on an offer holding copies, so nothing here is the read failing.
        <div style={{ ...NOTE, paddingLeft: SELECT_STRIP.width }}>Couldn&apos;t load this offer&apos;s copies.</div>
      ) : (
        <div style={{ paddingLeft: SELECT_STRIP.width }}>
          {copies.map((copy, i) => (
            <InventoryItemRow
              key={copy.id}
              collectionId={collectionId}
              item={copy}
              areas={areas}
              locations={locations}
              baseCurrency={baseCurrency}
              primaryVendorId={copy.areaId ? (primaryVendorByArea.get(copy.areaId) ?? null) : null}
              vendorMap={vendorMapFor(copy.areaId, copy.issueId)}
              isLast={i === copies.length - 1}
              readOnly
              opensPage
            />
          ))}
        </div>
      )}
    </div>
  );
}
