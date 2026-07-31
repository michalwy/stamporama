"use client";

import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { IssueGroupRow as IssueGroupRowData } from "@/lib/items";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { IssueGroupRow } from "./issue-group-row";
import type { CopySelection } from "./inventory-copy-list";
import type { InventoryItemFilters } from "./use-inventory-query";

/**
 * The Copies list grouped by issue (#424) — one row per series — plus the infinite-scroll sentinel.
 * The caller owns the container and the loading / empty states, exactly as with
 * `DuplicateGroupList` and `LocationGroupList`.
 */
export function IssueGroupList({
  collectionId,
  groups,
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
  groups: IssueGroupRowData[];
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
        <IssueGroupRow
          key={group.key}
          collectionId={collectionId}
          group={group}
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
