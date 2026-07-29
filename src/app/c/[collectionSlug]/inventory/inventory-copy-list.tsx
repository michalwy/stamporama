"use client";

import type { ItemListItem } from "@/lib/items";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { InventoryItemRow } from "./inventory-item-row";

const EMPTY_VENDOR_MAP = new Map<string, AreaCatalogEntry>();
const EMPTY_LOCATIONS: LocationData[] = [];

/**
 * The gutter a copy's selection checkbox lives in — the whole strip is the control, not the box.
 * Full row height (the parent stretches it) with the box centred in it: a copy row is four lines
 * tall, so a top-aligned box reads as belonging to the first line rather than to the row, and a
 * 13-pixel hit area is a poor target for a list one works through by ticking.
 *
 * Every surface that puts a checkbox beside an `InventoryItemRow` uses it — this list, the offer
 * composition picker and the duplicate-group listing picker — since they are the same control over
 * the same row and had no business behaving differently. (The sale-line picker is not one of them:
 * there the *whole row* toggles, which is more than a strip, not less.)
 */
export const SELECT_STRIP: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "2.5rem",
  flexShrink: 0,
  cursor: "pointer",
};

interface InventoryCopyListProps {
  /** Owning collection, for building each row's collection-scoped photo URLs (#112). */
  collectionId: string;
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
  /** When provided, each row gains an "Edit stamp" action for its underlying stamp (#243). */
  onEditStamp?: (item: ItemListItem) => void;
  onIdentify?: (item: ItemListItem) => void;
  onViewHistory?: (item: ItemListItem) => void;
  onDelete?: (item: ItemListItem) => void;
  onAddToOffer?: (item: ItemListItem) => void;
  /** When provided, each eligible row gains an "Add to new offer" action that skips the offer
   * picker and opens offer creation seeded with the copy (#277). */
  onAddToNewOffer?: (item: ItemListItem) => void;
  /** When provided, each row gains a "View offers" action opening the read-only popup of every
   * offer that references the copy (#276). */
  onViewOffers?: (item: ItemListItem) => void;
  /** When provided, each row's catalog-value cell becomes the quick-price trigger (#228): a
   * "+ catalog value" link when unpriced, click-to-edit when priced — mirroring the purchase
   * intake view (#121). The dialog itself is owned by the caller. */
  onSetCatalogPrice?: (item: ItemListItem) => void;
  /** When provided, each row gains a selection checkbox (#373). Only *eligible* copies get one —
   * a copy that is not for sale or not in hand cannot be listed, and the row already says so
   * through its disposition and delivery chips, so a permanently disabled checkbox would add a
   * control that explains nothing. Ineligible rows keep the column's width so nothing jumps. */
  selection?: CopySelection;
}

export interface CopySelection {
  selected: Set<string>;
  onToggle: (id: string) => void;
  isEligible: (item: ItemListItem) => boolean;
}

/**
 * Renders a list of copy rows plus the infinite-scroll sentinel, resolving each row's
 * catalog-vendor display from its area. Shared by the inventory list panel (editable)
 * and the stamp/issue inventory popup (read-only) so the row-mapping logic lives once.
 * Callers own the surrounding container and the loading / empty states.
 */
export function InventoryCopyList({
  collectionId,
  copies,
  areas,
  locations = EMPTY_LOCATIONS,
  baseCurrency,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  readOnly,
  onEdit,
  onEditStamp,
  onIdentify,
  onViewHistory,
  onDelete,
  onAddToOffer,
  onAddToNewOffer,
  onViewOffers,
  onSetCatalogPrice,
  selection,
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
        const checked = !!selection?.selected.has(item.id);
        const row = (
          <InventoryItemRow
            key={item.id}
            collectionId={collectionId}
            item={item}
            areas={areas}
            locations={locations}
            baseCurrency={baseCurrency}
            primaryVendorId={primaryVendorId}
            vendorMap={vendorMap}
            isLast={idx === copies.length - 1 && !hasNextPage}
            readOnly={readOnly}
            showCostBasis
            onEdit={onEdit}
            onEditStamp={onEditStamp}
            onIdentify={onIdentify}
            onViewHistory={onViewHistory}
            onDelete={onDelete}
            onAddToOffer={onAddToOffer}
            onAddToNewOffer={onAddToNewOffer}
            onViewOffers={onViewOffers}
            onSetCatalogPrice={onSetCatalogPrice ? () => onSetCatalogPrice(item) : undefined}
          />
        );
        if (!selection) return row;
        return (
          <div
            key={item.id}
            style={{
              display: "flex",
              // Stretch, so the checkbox strip runs the full height of the row it belongs to and
              // can centre the box in it — a row is four lines tall and a top-aligned box reads as
              // belonging to the first of them.
              alignItems: "stretch",
              background: checked ? "var(--color-accent-soft)" : undefined,
            }}
          >
            {selection.isEligible(item) ? (
              // A `<label>`, so the whole strip is the hit area rather than the 13px box in it.
              <label style={SELECT_STRIP}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => selection.onToggle(item.id)}
                  aria-label="Select this copy"
                  style={{ cursor: "pointer" }}
                />
              </label>
            ) : (
              <span style={{ ...SELECT_STRIP, cursor: "default" }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>{row}</div>
          </div>
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
