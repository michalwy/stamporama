"use client";

import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { LocationGroupRow as LocationGroupRowData } from "@/lib/items";
import type { LocationGroupBy } from "@/lib/location-groups";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { LocationGroupRow } from "./location-group-row";
import type { CopySelection } from "./inventory-copy-list";
import type { InventoryItemFilters } from "./use-inventory-query";

/**
 * The Copies list grouped by where its copies are filed (#421) — one row per location, or per
 * `(location, ref)` pair — plus the infinite-scroll sentinel. The caller owns the container and the
 * loading / empty states, exactly as with `DuplicateGroupList`.
 */
export function LocationGroupList({
  collectionId,
  groups,
  by,
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
  groups: LocationGroupRowData[];
  by: LocationGroupBy;
  baseFilters: InventoryItemFilters;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  selection: CopySelection;
}) {
  return (
    <>
      {groups.map((group, idx) => (
        <LocationGroupRow
          key={group.key}
          collectionId={collectionId}
          group={group}
          by={by}
          baseFilters={baseFilters}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          isLast={idx === groups.length - 1 && !hasNextPage}
          selection={selection}
        />
      ))}
      <InfiniteScrollSentinel
        onLoadMore={onLoadMore}
        hasMore={hasNextPage}
        isLoading={isFetchingNextPage}
      />
    </>
  );
}
