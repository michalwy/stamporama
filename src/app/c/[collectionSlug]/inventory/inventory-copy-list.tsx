"use client";

import type { ItemListItem } from "@/lib/items";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { InventoryItemRow } from "./inventory-item-row";

const EMPTY_VENDOR_MAP = new Map<string, AreaCatalogEntry>();
const EMPTY_LOCATIONS: LocationData[] = [];

interface InventoryCopyListProps {
  copies: ItemListItem[];
  areas: CollectionAreaData[];
  /** Storage locations, for resolving each copy's location path (#56). Defaults to
   * empty (e.g. read-only popup contexts that don't load locations). */
  locations?: LocationData[];
  baseCurrency: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  /** Read-only mode hides per-row actions (inventory popup, #110). */
  readOnly?: boolean;
  onEdit?: (item: ItemListItem) => void;
  onIdentify?: (item: ItemListItem) => void;
  onViewHistory?: (item: ItemListItem) => void;
  onDelete?: (item: ItemListItem) => void;
}

/**
 * Renders a list of copy rows plus the infinite-scroll sentinel, resolving each row's
 * catalog-vendor display from its area. Shared by the inventory list panel (editable)
 * and the stamp/issue inventory popup (read-only) so the row-mapping logic lives once.
 * Callers own the surrounding container and the loading / empty states.
 */
export function InventoryCopyList({
  copies,
  areas,
  locations = EMPTY_LOCATIONS,
  baseCurrency,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  readOnly,
  onEdit,
  onIdentify,
  onViewHistory,
  onDelete,
}: InventoryCopyListProps) {
  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);

  return (
    <>
      {copies.map((item, idx) => {
        const areaId = item.areaId;
        const primaryVendorId = areaId
          ? (primaryVendorByArea.get(areaId) ?? null)
          : null;
        const vendorMap = areaId
          ? (vendorMapByArea.get(areaId) ?? EMPTY_VENDOR_MAP)
          : EMPTY_VENDOR_MAP;
        return (
          <InventoryItemRow
            key={item.id}
            item={item}
            areas={areas}
            locations={locations}
            baseCurrency={baseCurrency}
            primaryVendorId={primaryVendorId}
            vendorMap={vendorMap}
            isLast={idx === copies.length - 1 && !hasNextPage}
            readOnly={readOnly}
            onEdit={onEdit}
            onIdentify={onIdentify}
            onViewHistory={onViewHistory}
            onDelete={onDelete}
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
