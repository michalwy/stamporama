"use client";

import type { ItemListItem } from "@/lib/items";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { InventoryItemRow } from "./inventory-item-row";

const EMPTY_LOCATIONS: LocationData[] = [];

/** The marking on a copy that differs from the rest of its duplicate group (#372/#398). */
const DIFFERS_CHIP: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  padding: "0.05rem 0.375rem",
  borderRadius: "0.25rem",
  color: "var(--color-warning)",
  border: "1px solid var(--color-warning-border, var(--color-border))",
  background: "var(--color-warning-soft, var(--color-bg-page))",
  whiteSpace: "nowrap",
};

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

/**
 * Everything a copy row's `⋮` menu (#125) is made of, as **one** object.
 *
 * The flat list takes these thirteen one by one, which is fine where the panel renders the rows
 * itself. A **grouped** list (#372/#421/#424) does not: two layers of group components sit between
 * the panel and the member rows, and repeating thirteen props at each of them three times over is
 * how #516 happened in the first place — the grouped branches simply passed `readOnly` instead and
 * the menu disappeared the moment a grouping was switched on. One bundle threads through in one
 * prop, so a new action reaches the grouped views without anyone remembering to plumb it.
 */
export interface CopyRowActions {
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
  /** Set while quick offer mode is armed (#537): the entry above creates the offer outright, on
   * this platform in this status, so it names both rather than reading as an invitation to a dialog
   * that will not open. */
  quickOffer?: { platformName: string; stateLabel: string };
  /** When provided, each row gains a "View offers" action opening the read-only popup of every
   * offer that references the copy (#276). */
  onViewOffers?: (item: ItemListItem) => void;
  /** When provided, a row whose copy came from a purchase order gains a "Go to purchase"
   * link (#387/#557) — the address, so the entry is a real anchor. */
  purchaseHref?: (item: ItemListItem) => string | null;
  /** When provided, each row gains the disposal entry (#395) — *No longer held* on a copy still in
   * hand, *Mark as held again* on one already disposed of. */
  onDispose?: (item: ItemListItem) => void;
  onRestore?: (item: ItemListItem) => void;
  /** The platform the list is working through (#506), and the writer behind each row's one-click
   * *Never list on X*. Absent on every surface that is not the Copies list — the decision belongs
   * to the worklist it exists for. */
  exclusionPlatform?: { id: string; name: string } | null;
  onSetPlatformExclusion?: (item: ItemListItem, platformId: string, excluded: boolean) => void;
  /** When provided, each row's catalog-value cell becomes the quick-price trigger (#228): a
   * "+ catalog value" link when unpriced, click-to-edit when priced — mirroring the purchase
   * intake view (#121). The dialog itself is owned by the caller. */
  onSetCatalogPrice?: (item: ItemListItem) => void;
}

interface InventoryCopyListProps extends CopyRowActions {
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
  /** When provided, each row gains a selection checkbox (#373). Only *eligible* copies get one —
   * a copy that is not for sale or not in hand cannot be listed, and the row already says so
   * through its disposition and delivery chips, so a permanently disabled checkbox would add a
   * control that explains nothing. Ineligible rows keep the column's width so nothing jumps. */
  selection?: CopySelection;
  /** Copies that **differ from the rest of the duplicate group** they are listed under (#372/#398):
   * warning-tinted and marked, so the odd one out is visible in the group's own member list rather
   * than only inside a dialog of its own. Empty/absent everywhere else. */
  differingIds?: ReadonlySet<string>;
}

export interface CopySelection {
  selected: Set<string>;
  /** The **item**, not its id: a grouped list (#398) selects copies its own member query loaded, and
   * the panel has no flat page to resolve an id against. */
  onToggle: (item: ItemListItem) => void;
  /** Tick or untick a whole batch at once — a duplicate group's quick select-all (#398). */
  onSetMany: (items: ItemListItem[], selected: boolean) => void;
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
  quickOffer,
  onViewOffers,
  purchaseHref,
  onDispose,
  onRestore,
  exclusionPlatform,
  onSetPlatformExclusion,
  onSetCatalogPrice,
  selection,
  differingIds,
}: InventoryCopyListProps) {
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);

  return (
    <>
      {copies.map((item, idx) => {
        const areaId = item.areaId;
        const primaryVendorId = areaId
          ? (primaryVendorByArea.get(areaId) ?? null)
          : null;
        // The copy's stamp may sit in an issue that overrides its area's prefix (#377).
        const vendorMap = vendorMapFor(areaId, item.issueId);
        const checked = !!selection?.selected.has(item.id);
        const differs = !!differingIds?.has(item.id);
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
            quickOffer={quickOffer}
            onViewOffers={onViewOffers}
            purchaseHref={purchaseHref}
            onDispose={onDispose}
            onRestore={onRestore}
            exclusionPlatform={exclusionPlatform}
            onSetPlatformExclusion={onSetPlatformExclusion}
            onSetCatalogPrice={onSetCatalogPrice ? () => onSetCatalogPrice(item) : undefined}
            trailingChips={
              differs ? (
                <Tooltip content="This copy differs from the rest of its group — listing it with them would make the quantity misleading.">
                  <span style={DIFFERS_CHIP}>differs from the group</span>
                </Tooltip>
              ) : undefined
            }
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
              // A ticked copy leads: what is selected is what the bulk action is about to act on,
              // while differing from the group is a caution about one of them.
              background: checked
                ? "var(--color-accent-soft)"
                : differs
                  ? "var(--color-warning-soft, var(--color-bg-page))"
                  : undefined,
            }}
          >
            {selection.isEligible(item) ? (
              // A `<label>`, so the whole strip is the hit area rather than the 13px box in it.
              <label style={SELECT_STRIP}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => selection.onToggle(item)}
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
