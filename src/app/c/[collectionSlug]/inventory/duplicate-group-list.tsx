"use client";

import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { CopyGroupRow } from "@/lib/items";
import type { CopyGroupAxes } from "@/lib/copy-groups";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { DuplicateGroupRow } from "./duplicate-group-row";
import type { CopySelection } from "./inventory-copy-list";
import type { InventoryItemFilters } from "./use-inventory-query";


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
  selection,
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
  /** The panel's multi-select (#373), threaded down to every group's member rows (#398). */
  selection: CopySelection;
}) {
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);

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
            vendorMap={vendorMapFor(areaId, group.issueId)}
            isLast={idx === groups.length - 1 && !hasNextPage}
            selection={selection}
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
