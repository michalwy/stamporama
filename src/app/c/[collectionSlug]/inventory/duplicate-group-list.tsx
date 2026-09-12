"use client";

import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { CopyGroupRow } from "@/lib/items";
import type { CopyGroupAxes } from "@/lib/copy-groups";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { DuplicateGroupRow } from "./duplicate-group-row";
import { MultiStampGroupRow } from "./multi-stamp-group-row";
import type { MultiStampGroupRow as MultiStampGroupRowData } from "@/lib/multi-stamp";
import type { CopyRowActions, CopySelection } from "./inventory-copy-list";
import type { InventoryItemFilters } from "./use-inventory-query";
import type { GroupExpansion } from "@/app/c/[collectionSlug]/shared/use-group-expansion";


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
  expansion,
  selection,
  rowActions,
  multiStampGroup,
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
  /** Which group rows are open (#538) — panel state, so one control operates the whole list. */
  expansion: GroupExpansion;
  /** The panel's multi-select (#373), threaded down to every group's member rows (#398). */
  selection: CopySelection;
  /** The member rows' own `⋮` menu (#125/#516), threaded down to every group's copies: a
   * grouping decides what a row is listed *under*, never what may be done to it. */
  rowActions?: CopyRowActions;
  /** The multi-stamp bucket (#748), drawn after every duplicate group — none of which a carrier can
   *  belong to — once the last page has said it exists. */
  multiStampGroup?: MultiStampGroupRowData | null;
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
            isLast={idx === groups.length - 1 && !hasNextPage && !multiStampGroup}
            open={expansion.isExpanded(group.key)}
            onToggle={() => expansion.toggle(group.key)}
            selection={selection}
            rowActions={rowActions}
          />
        );
      })}
      {multiStampGroup && (
        <MultiStampGroupRow
          collectionId={collectionId}
          group={multiStampGroup}
          baseFilters={baseFilters}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          isLast={!hasNextPage}
          open={expansion.isExpanded(multiStampGroup.key)}
          onToggle={() => expansion.toggle(multiStampGroup.key)}
          selection={selection}
          rowActions={rowActions}
        />
      )}
      <InfiniteScrollSentinel
        onLoadMore={onLoadMore}
        hasMore={hasNextPage}
        isLoading={isFetchingNextPage}
      />
    </>
  );
}
