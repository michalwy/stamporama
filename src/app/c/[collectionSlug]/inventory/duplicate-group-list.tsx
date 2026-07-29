"use client";

import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { CopyGroupRow } from "@/lib/items";
import type { CopyGroupAxes } from "@/lib/copy-groups";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { DuplicateGroupRow } from "./duplicate-group-row";
import type { InventoryItemFilters } from "./use-inventory-query";

const EMPTY_VENDOR_MAP = new Map<string, AreaCatalogEntry>();

/**
 * The grouped Copies list (#372) — one row per duplicate key plus the infinite-scroll sentinel,
 * resolving each row's catalog-vendor display from its area exactly as `InventoryCopyList` does.
 * The caller owns the container and the loading / empty states.
 */
export function DuplicateGroupList({
  collectionId,
  groups,
  axes,
  baseFilters,
  areas,
  locations,
  baseCurrency,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onListAsOffer,
}: {
  collectionId: string;
  groups: CopyGroupRow[];
  axes: CopyGroupAxes;
  baseFilters: InventoryItemFilters;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onListAsOffer: (group: CopyGroupRow) => void;
}) {
  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);

  return (
    <>
      {groups.map((group, idx) => {
        const areaId = group.areaId;
        return (
          <DuplicateGroupRow
            key={group.key}
            collectionId={collectionId}
            group={group}
            axes={axes}
            baseFilters={baseFilters}
            areas={areas}
            locations={locations}
            baseCurrency={baseCurrency}
            primaryVendorId={areaId ? (primaryVendorByArea.get(areaId) ?? null) : null}
            vendorMap={
              areaId ? (vendorMapByArea.get(areaId) ?? EMPTY_VENDOR_MAP) : EMPTY_VENDOR_MAP
            }
            isLast={idx === groups.length - 1 && !hasNextPage}
            onListAsOffer={onListAsOffer}
          />
        );
      })}
      <InfiniteScrollSentinel
        onLoadMore={onLoadMore}
        hasMore={hasNextPage}
        isLoading={isFetchingNextPage}
      />
    </>
  );
}
