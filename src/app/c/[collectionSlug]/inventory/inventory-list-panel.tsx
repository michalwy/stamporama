"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { CopyGroupRow, ItemListItem, ItemSortBy } from "@/lib/items";
import type { CopyGroupAxes } from "@/lib/copy-groups";
import { isDelivered } from "@/lib/delivery-state";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { ConfirmDialog } from "@/app/dialog-shell";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { SubtreeScopeToggle, useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { ListToolbar, type SortOption } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { parseCatalogSearch } from "@/lib/catalog-number";
import { DELIVERY_STATES, DELIVERY_STATE_META } from "@/lib/delivery-state";
import { usePersistedSort } from "@/app/c/[collectionSlug]/shared/use-persisted-sort";
import { IssueFilterAutocomplete } from "@/app/c/[collectionSlug]/stamps/issue-filter-autocomplete";
import { formatItemNo } from "@/lib/item-number";
import {
  useInventoryItemsInfinite,
  useCopyGroupsInfinite,
  useHoldingsValuation,
  useItemYears,
  useInvalidateInventory,
  useCollectionItemNoPad,
  type InventoryItemFilters,
  type InventoryYearFacetFilters,
} from "./use-inventory-query";
import { usePersistedFlag } from "@/app/c/[collectionSlug]/shared/use-persisted-flag";
import { HoldingsSummaryBar } from "@/app/c/[collectionSlug]/shared/holdings-summary-bar";
import { InventoryCopyList } from "./inventory-copy-list";
import { DuplicateGroupList } from "./duplicate-group-list";
import { ListGroupDialog } from "./list-group-dialog";
import { InventoryItemFormDialog } from "./inventory-item-form-dialog";
import { DisposeCopyDialog } from "./dispose-copy-dialog";
import { IdentifyVariantDialog } from "./identify-variant-dialog";
import { VariantHistoryDialog } from "./variant-history-dialog";
import { AddToOfferDialog } from "./add-to-offer-dialog";
import { OffersPopupDialog } from "@/app/c/[collectionSlug]/offers/offers-popup-dialog";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { useContacts } from "@/app/c/[collectionSlug]/contacts/use-contacts-query";
import { useLastUsedPlatform } from "@/app/c/[collectionSlug]/offers/use-last-used-platform";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; item: ItemListItem }
  | { kind: "editStamp"; item: ItemListItem }
  | { kind: "identify"; item: ItemListItem }
  | { kind: "history"; item: ItemListItem }
  | { kind: "delete"; item: ItemListItem }
  // One entry point, one or many copies (#373): a row's own action passes `[item]`, the bulk bar
  // passes the whole selection.
  | { kind: "addToOffer"; items: ItemListItem[] }
  | { kind: "addToNewOffer"; items: ItemListItem[] }
  | { kind: "viewOffers"; item: ItemListItem }
  // The disposal axis (#394/#395). Marking needs a reason and a note, so it is a form; reversing
  // it is one fact with nothing to fill in, so it is a confirmation.
  | { kind: "dispose"; item: ItemListItem }
  | { kind: "restore"; item: ItemListItem }
  | { kind: "quickPrice"; item: ItemListItem }
  // The duplicate group's pre-step (#372): pick which of its copies go on the listing. Confirming
  // hands them to `addToNewOffer`, so the create form is reached the same way every other flow
  // reaches it.
  | { kind: "listGroup"; group: CopyGroupRow };


const DISPOSITION_FILTERS = [
  { key: "inCollection", label: "In collection" },
  { key: "forSale", label: "For sale" },
  { key: "forTrade", label: "For trade" },
] as const;

const SORT_OPTIONS: SortOption[] = [
  { value: "created", label: "Date added" },
];

const CONTROL_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minHeight: "2rem",
};

interface InventoryListPanelProps {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  /** The collection's physical formats (#343) — drives the format filter, and absent when empty. */
  formats: StampFormatData[];
  baseCurrency: string;
}

export function InventoryListPanel({
  collectionId,
  collectionSlug,
  areas,
  locations,
  conditions,
  certificateStatuses,
  formats,
  baseCurrency,
}: InventoryListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateList } = useInvalidateInventory();

  const { data: contacts = [] } = useContacts(collectionId);
  const offerPlatforms = useMemo(() => contacts.filter((c) => c.platform), [contacts]);
  const [lastPlatformId, rememberPlatform] = useLastUsedPlatform(collectionId);

  // Area + year shared across lists (#143): URL param wins ("all" sentinel marks
  // an explicit "all"); absent param falls back to the per-collection store. The
  // effective selection is mirrored back into the store below.
  const { storedAreaId, storedYear, writeStore } =
    useCollectionFilterStore(collectionId);
  const urlAreaId = searchParams.get("areaId");
  const urlYear = searchParams.get("year");
  const filterAreaId =
    urlAreaId !== null ? (urlAreaId === "all" ? null : urlAreaId) : storedAreaId;
  const year =
    urlYear !== null ? (urlYear === "all" ? "" : urlYear) : (storedYear ?? "");

  useEffect(() => {
    writeStore({ areaId: filterAreaId, year: year || null });
  }, [filterAreaId, year, writeStore]);

  // Whether a selected area brings its sub-areas with it is the collector's choice (#385); the
  // toggle lives in the area sidebar and the resolution is shared so every list agrees.
  const [includeSubAreas] = useSubtreeScope("area");
  const filterAreaIds = useMemo(
    () => resolveAreaFilterIds(areas, filterAreaId, includeSubAreas) ?? undefined,
    [filterAreaId, areas, includeSubAreas]
  );

  const search = searchParams.get("search") ?? "";
  const conditionId = searchParams.get("conditionId") ?? "";
  // Format is a *filter* here, not a price switcher (#343): a copy's format is a fact it carries,
  // so the list narrows to it exactly the way it narrows to a condition. `"single"` is a real
  // choice — the copies with no format — which an absent value could not express.
  const formatId = searchParams.get("formatId") ?? "";
  const locationId = searchParams.get("locationId") ?? "";
  // Whether a picked location brings the boxes filed under it (#385). Server-side, unlike the
  // area axis — the location subtree is resolved in `resolveLocationScope`.
  const [includeSubLocations, setIncludeSubLocations] = useSubtreeScope("location");
  const issueId = searchParams.get("issueId") ?? "";
  const noPhotos = searchParams.get("noPhotos") === "true";
  const missingCatalogValue = searchParams.get("missingCatalogValue") === "true";
  // "For sale, not yet offered on platform X" (#259), remembered per collection (#275): the URL
  // param wins when present (shareable), else fall back to the stored selection on a fresh visit.
  // A stale value (platform since removed) is ignored so the filter can't silently narrow to nothing.
  const [storedNotOfferedPlatform, rememberNotOfferedPlatform] = usePersistedCollectionValue(
    "inventory-not-offered-platform",
    collectionId
  );
  const notOfferedPlatformParam = searchParams.has("notOfferedPlatform")
    ? (searchParams.get("notOfferedPlatform") ?? "")
    : (storedNotOfferedPlatform ?? "");
  const notOfferedPlatformId =
    notOfferedPlatformParam && offerPlatforms.some((p) => p.id === notOfferedPlatformParam)
      ? notOfferedPlatformParam
      : "";
  // Which platform seeds the "create new offer" sub-flow of Add to offer (#241). The list's own
  // "not offered on X" filter (#259) wins: while it is set, the screen *is* that platform's
  // worklist, and listing what it shows anywhere else would be a surprise. Without it, the last
  // platform used is the only signal.
  const preferredPlatform = useMemo(() => {
    const id = notOfferedPlatformId || lastPlatformId;
    return id ? offerPlatforms.find((p) => p.id === id) : undefined;
  }, [offerPlatforms, notOfferedPlatformId, lastPlatformId]);

  // Physical delivery state (#272): a plain single-select like the condition one — a copy is in
  // exactly one state, and the chip on the row is what this filter narrows to.
  const deliveryState = searchParams.get("deliveryState") ?? "";
  // Sold copies are hidden by default (#207); this toggle brings them back into the list.
  const includeSold = searchParams.get("includeSold") === "true";
  // Copies no longer held are hidden the same way (#394/#395): the list answers "what do I have".
  const includeDisposed = searchParams.get("includeDisposed") === "true";
  // Duplicate grouping (#372). A client preference rather than URL state — it changes *what the
  // rows are*, not what is being looked at, and it is a way of working the collector keeps.
  // Which axes join the key is remembered separately, so turning grouping off and on again does not
  // lose the split. Both off is the plain Colnect rule: one offer per stamp per condition.
  const [groupDuplicates, setGroupDuplicates] = usePersistedFlag(
    `stamporama:inventory:groupDuplicates:${collectionId}`
  );
  const [groupByFormat, setGroupByFormat] = usePersistedFlag(
    `stamporama:inventory:groupByFormat:${collectionId}`
  );
  const [groupByCertificate, setGroupByCertificate] = usePersistedFlag(
    `stamporama:inventory:groupByCertificate:${collectionId}`
  );
  const axes: CopyGroupAxes = useMemo(
    () => ({ format: groupByFormat, certificate: groupByCertificate }),
    [groupByFormat, groupByCertificate]
  );
  // Names the offers popup for a copy whose stamp is unnamed (#276) — the internal copy number,
  // padded to the collection's chosen width.
  const itemNoPad = useCollectionItemNoPad(collectionId);
  const { sortBy, sortDir, persistSort } = usePersistedSort<ItemSortBy>(
    "inventory", "created", "asc",
    searchParams.get("sortBy"),
    searchParams.get("sortDir"),
    ["created"]
  );
  const activeDispositions = useMemo(() => {
    const set = new Set<string>();
    for (const { key } of DISPOSITION_FILTERS) {
      if (searchParams.get(key) === "true") set.add(key);
    }
    return set;
  }, [searchParams]);

  // Prefixed catalog search (#146): the inventory list has no dedicated vendor
  // dropdown, so its single search box doubles as the catalog input. Parse a leading
  // vendor abbreviation ("Mi PL 200") against the collection's vendors and pass the
  // bare number + resolved vendor alongside the raw text, so the query matches
  // catalog numbers even when the typed prefix isn't a substring of the stored value.
  const catalogVendors = useMemo(() => {
    const seen = new Map<string, { id: string; abbreviation: string }>();
    for (const area of areas) {
      for (const entry of area.catalogEntries) {
        if (!seen.has(entry.catalogVendorId)) {
          seen.set(entry.catalogVendorId, {
            id: entry.catalogVendorId,
            abbreviation: entry.vendorAbbreviation,
          });
        }
      }
    }
    return Array.from(seen.values());
  }, [areas]);
  const parsedCatalog = useMemo(
    () => parseCatalogSearch(search, catalogVendors),
    [search, catalogVendors]
  );

  const filters: InventoryItemFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      catalogVendorId: parsedCatalog.vendorId ?? undefined,
      catalogNumber: parsedCatalog.number || undefined,
      conditionId: conditionId || undefined,
      formatId: formatId || undefined,
      locationId: locationId || undefined,
      locationExact: locationId && !includeSubLocations ? true : undefined,
      issueId: issueId || undefined,
      year: year || undefined,
      inCollection: activeDispositions.has("inCollection") || undefined,
      forSale: activeDispositions.has("forSale") || undefined,
      forTrade: activeDispositions.has("forTrade") || undefined,
      noPhotos: noPhotos || undefined,
      missingCatalogValue: missingCatalogValue || undefined,
      notOfferedPlatformId: notOfferedPlatformId || undefined,
      deliveryState: deliveryState || undefined,
      includeSold: includeSold || undefined,
      includeDisposed: includeDisposed || undefined,
      sortBy,
      sortDir,
    }),
    [filterAreaIds, search, parsedCatalog, conditionId, formatId, locationId, includeSubLocations, issueId, year, activeDispositions, noPhotos, missingCatalogValue, notOfferedPlatformId, deliveryState, includeSold, includeDisposed, sortBy, sortDir]
  );

  const yearFacetFilters: InventoryYearFacetFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      catalogVendorId: parsedCatalog.vendorId ?? undefined,
      catalogNumber: parsedCatalog.number || undefined,
      conditionId: conditionId || undefined,
      formatId: formatId || undefined,
      locationId: locationId || undefined,
      locationExact: locationId && !includeSubLocations ? true : undefined,
      issueId: issueId || undefined,
      inCollection: activeDispositions.has("inCollection") || undefined,
      forSale: activeDispositions.has("forSale") || undefined,
      forTrade: activeDispositions.has("forTrade") || undefined,
      noPhotos: noPhotos || undefined,
      missingCatalogValue: missingCatalogValue || undefined,
      notOfferedPlatformId: notOfferedPlatformId || undefined,
      deliveryState: deliveryState || undefined,
      includeSold: includeSold || undefined,
      includeDisposed: includeDisposed || undefined,
    }),
    [filterAreaIds, search, parsedCatalog, conditionId, formatId, locationId, includeSubLocations, issueId, activeDispositions, noPhotos, missingCatalogValue, notOfferedPlatformId, deliveryState, includeSold, includeDisposed]
  );

  const { data: yearFacets, isLoading: yearsLoading } = useItemYears(
    collectionId,
    yearFacetFilters
  );

  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);
  const hasChildLocations = useMemo(
    () => !!locationId && locations.some((l) => l.parentId === locationId),
    [locations, locationId]
  );

  // Per-area vendor maps + area names for the quick-price dialog (#228), resolved once here so the
  // dialog can format catalog numbers identically to the rows (mirrors the purchase intake view).
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/inventory${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  function handleNavigateFilter(areaId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    // "all" sentinel (not delete) so an explicit "all areas" is distinguishable
    // from an absent param that falls back to the store (#143).
    params.set("areaId", areaId ?? "all");
    const qs = params.toString();
    router.push(`/c/${collectionSlug}/inventory${qs ? `?${qs}` : ""}`);
  }

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useInventoryItemsInfinite(collectionId, filters, !groupDuplicates);
  const groupsQuery = useCopyGroupsInfinite(collectionId, filters, axes, groupDuplicates);
  // Grouping narrows the set to for-sale, delivered, unsold copies, so the holdings bar must narrow
  // with it — a total counting copies the list no longer shows is worse than none (#151).
  const valuationFilters = useMemo(
    () =>
      groupDuplicates
        ? {
            ...filters,
            forSale: true,
            deliveryState: "delivered",
            includeSold: undefined,
            includeDisposed: undefined,
          }
        : filters,
    [filters, groupDuplicates]
  );
  const { data: holdingsTotal } = useHoldingsValuation(collectionId, valuationFilters);

  const allCopies = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  );
  const allGroups = useMemo(
    () => groupsQuery.data?.pages.flatMap((p) => p.groups) ?? [],
    [groupsQuery.data]
  );

  // Multi-select (#373). Restricted to copies that can actually be listed — for sale and in hand,
  // the offer composition picker's own eligibility. The selection is keyed on the filter set and
  // reset when it changes (adjusted during render, never a `setState` in an effect): a selection
  // surviving a filter change would act on copies no longer on screen.
  const filterSignature = JSON.stringify(filters);
  const [selection, setSelection] = useState<{ sig: string; ids: Set<string> }>({
    sig: filterSignature,
    ids: new Set(),
  });
  if (selection.sig !== filterSignature) {
    setSelection({ sig: filterSignature, ids: new Set() });
  }
  const selectedCopies = useMemo(
    () => allCopies.filter((c) => selection.ids.has(c.id)),
    [allCopies, selection]
  );
  const toggleSelected = useCallback((id: string) => {
    setSelection((prev) => {
      const ids = new Set(prev.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { sig: prev.sig, ids };
    });
  }, []);
  const clearSelection = useCallback(
    () => setSelection((prev) => ({ sig: prev.sig, ids: new Set() })),
    []
  );

  function closeDialog() {
    if (!isPending) {
      setDialog({ kind: "none" });
      setActionError(undefined);
    }
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    setActionError(undefined);
    invalidateList(collectionId);
    // What was picked has been dealt with; leaving it ticked invites doing it twice.
    clearSelection();
  }

  const listLoading = groupDuplicates ? groupsQuery.isLoading : isLoading;
  const listEmpty = groupDuplicates ? allGroups.length === 0 : allCopies.length === 0;

  // Only a for-sale, in-hand copy can be listed — the offer composition picker's own eligibility
  // (#164/#188). A copy that fails it gets no checkbox rather than a disabled one: its disposition
  // and delivery chips are on the row, so the row already answers the question.
  const copySelection = useMemo(
    () => ({
      selected: selection.ids,
      onToggle: toggleSelected,
      // A copy no longer held cannot be listed either (#394) — same eligibility, second axis.
      isEligible: (item: ItemListItem) =>
        item.forSale && isDelivered(item.deliveryState) && item.disposedAt == null,
    }),
    [selection.ids, toggleSelected]
  );

  const hasActiveFilters =
    !!search ||
    !!issueId ||
    !!conditionId ||
    !!formatId ||
    !!locationId ||
    !!year ||
    noPhotos ||
    missingCatalogValue ||
    !!notOfferedPlatformId ||
    !!deliveryState ||
    includeSold ||
    includeDisposed ||
    activeDispositions.size > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Header: holdings total (left) + Add copy (right) */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <HoldingsSummaryBar total={holdingsTotal} />
        <button
          type="button"
          onClick={() => setDialog({ kind: "add" })}
          style={{
            ...CONTROL_STYLE,
            cursor: "pointer",
            fontWeight: 600,
            color: "#fff",
            background: "var(--color-action-primary)",
            border: "none",
            padding: "0.375rem 0.875rem",
            marginLeft: "auto",
            flexShrink: 0,
          }}
        >
          Add copy
        </button>
      </div>

      {/* Sidebar + list, mirroring the stamps list layout (#106) */}
      <div
        style={{
          display: "flex",
          gap: 0,
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          flex: 1,
          minHeight: "24rem",
          background: "var(--color-bg-elevated)",
        }}
      >
        <ListFilterSidebar
          areas={areas}
          filterAreaId={filterAreaId}
          onNavigateArea={handleNavigateFilter}
          yearFacets={yearFacets}
          yearsLoading={yearsLoading}
          selectedYear={year || null}
          onSelectYear={(y) => updateParams({ year: y ?? "all" })}
        />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            borderLeft: "1px solid var(--color-border)",
          }}
        >
          {/* Toolbar: shared search + sort, inventory-specific filters as children */}
          <ListToolbar
            search={search}
            onSearchChange={(v) => updateParams({ search: v })}
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={(sb, sd) => {
              persistSort(sb as ItemSortBy, sd);
              updateParams({ sortBy: sb, sortDir: sd });
            }}
            sortOptions={SORT_OPTIONS}
            hideSort={groupDuplicates}
            footer={
              selectedCopies.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.5rem",
                    border: "1px solid var(--color-accent)",
                    background: "var(--color-accent-soft)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      color: "var(--color-accent)",
                    }}
                  >
                    {selectedCopies.length} cop{selectedCopies.length === 1 ? "y" : "ies"} selected
                  </span>
                  <button
                    type="button"
                    onClick={clearSelection}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      fontSize: "0.8125rem",
                      color: "var(--color-text-secondary)",
                      textDecoration: "underline",
                    }}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog({ kind: "addToOffer", items: selectedCopies })}
                    style={{
                      ...CONTROL_STYLE,
                      marginLeft: "auto",
                      cursor: "pointer",
                      fontWeight: 600,
                      color: "#fff",
                      background: "var(--color-action-primary)",
                      border: "none",
                      padding: "0.375rem 0.875rem",
                    }}
                  >
                    🏷 Add selected to offer
                  </button>
                </div>
              ) : undefined
            }
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.5rem",
                flex: 1,
              }}
            >
              <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
                {DISPOSITION_FILTERS.map(({ key, label }) => {
                  const active = activeDispositions.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => updateParams({ [key]: active ? "" : "true" })}
                      style={{
                        ...CONTROL_STYLE,
                        cursor: "pointer",
                        fontWeight: active ? 600 : 400,
                        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                        borderColor: active ? "var(--color-accent)" : "var(--color-border-strong)",
                        background: active ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
                <Tooltip content="Show only copies with no attached photos">
                  <button
                    type="button"
                    onClick={() => updateParams({ noPhotos: noPhotos ? "" : "true" })}
                    style={{
                      ...CONTROL_STYLE,
                      cursor: "pointer",
                      fontWeight: noPhotos ? 600 : 400,
                      color: noPhotos ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderColor: noPhotos ? "var(--color-accent)" : "var(--color-border-strong)",
                      background: noPhotos ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                    }}
                  >
                    No photos
                  </button>
                </Tooltip>
                <Tooltip content="Show only copies with no catalog value recorded for their condition">
                  <button
                    type="button"
                    onClick={() =>
                      updateParams({ missingCatalogValue: missingCatalogValue ? "" : "true" })
                    }
                    style={{
                      ...CONTROL_STYLE,
                      cursor: "pointer",
                      fontWeight: missingCatalogValue ? 600 : 400,
                      color: missingCatalogValue ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderColor: missingCatalogValue ? "var(--color-accent)" : "var(--color-border-strong)",
                      background: missingCatalogValue ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                    }}
                  >
                    Missing catalog value
                  </button>
                </Tooltip>
                <Tooltip
                  content={
                    groupDuplicates
                      ? "Duplicate groups only cover copies you can still list, so sold ones stay out."
                      : "Also show copies that have already sold (hidden by default)"
                  }
                >
                  <button
                    type="button"
                    disabled={groupDuplicates}
                    onClick={() => updateParams({ includeSold: includeSold ? "" : "true" })}
                    style={{
                      ...CONTROL_STYLE,
                      cursor: groupDuplicates ? "default" : "pointer",
                      opacity: groupDuplicates ? 0.5 : 1,
                      fontWeight: includeSold ? 600 : 400,
                      color: includeSold ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderColor: includeSold ? "var(--color-accent)" : "var(--color-border-strong)",
                      background: includeSold ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                    }}
                  >
                    Include sold
                  </button>
                </Tooltip>
                {/* Copies no longer held (#394/#395), beside the sold toggle: the two are the
                    ways a copy leaves the shelf, one with proceeds and one without. Hidden by
                    default for the same reason — the list answers "what do I have". */}
                <Tooltip
                  content={
                    groupDuplicates
                      ? "Duplicate groups only cover copies you can still list, so ones you no longer hold stay out."
                      : "Also show copies you no longer hold — lost, damaged in storage, discarded (hidden by default)"
                  }
                >
                  <button
                    type="button"
                    disabled={groupDuplicates}
                    onClick={() =>
                      updateParams({ includeDisposed: includeDisposed ? "" : "true" })
                    }
                    style={{
                      ...CONTROL_STYLE,
                      cursor: groupDuplicates ? "default" : "pointer",
                      opacity: groupDuplicates ? 0.5 : 1,
                      fontWeight: includeDisposed ? 600 : 400,
                      color: includeDisposed ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderColor: includeDisposed ? "var(--color-accent)" : "var(--color-border-strong)",
                      background: includeDisposed ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                    }}
                  >
                    Include no longer held
                  </button>
                </Tooltip>
              </div>

              {/* Duplicate grouping (#372). The toggle collapses the list to one row per
                  `stamp × condition` — Colnect's own rule, since it refuses a second offer for the
                  same stamp in the same condition. The two splits join a further axis to that key;
                  with both on, every group has one unambiguous per-copy catalog value. They only
                  appear while grouping is on, because off they name nothing. */}
              <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
                <Tooltip content="Collapse the list to one row per duplicate — the same stamp in the same condition, ready to list as one offer with a quantity. Covers for-sale, delivered, unsold copies.">
                  <button
                    type="button"
                    onClick={() => setGroupDuplicates(!groupDuplicates)}
                    style={{
                      ...CONTROL_STYLE,
                      cursor: "pointer",
                      fontWeight: groupDuplicates ? 600 : 400,
                      color: groupDuplicates ? "var(--color-accent)" : "var(--color-text-secondary)",
                      borderColor: groupDuplicates ? "var(--color-accent)" : "var(--color-border-strong)",
                      background: groupDuplicates ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                    }}
                  >
                    ▦ Group duplicates
                  </button>
                </Tooltip>
                {groupDuplicates && formats.length > 0 && (
                  <Tooltip content="Treat a pair, block or strip as a different item from a single, instead of grouping them together.">
                    <button
                      type="button"
                      onClick={() => setGroupByFormat(!groupByFormat)}
                      style={{
                        ...CONTROL_STYLE,
                        cursor: "pointer",
                        fontWeight: groupByFormat ? 600 : 400,
                        color: groupByFormat ? "var(--color-accent)" : "var(--color-text-secondary)",
                        borderColor: groupByFormat ? "var(--color-accent)" : "var(--color-border-strong)",
                        background: groupByFormat ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                      }}
                    >
                      Split by format
                    </button>
                  </Tooltip>
                )}
                {groupDuplicates && certificateStatuses.length > 0 && (
                  <Tooltip content="Treat a certified copy as a different item from an uncertified one, instead of grouping them together.">
                    <button
                      type="button"
                      onClick={() => setGroupByCertificate(!groupByCertificate)}
                      style={{
                        ...CONTROL_STYLE,
                        cursor: "pointer",
                        fontWeight: groupByCertificate ? 600 : 400,
                        color: groupByCertificate ? "var(--color-accent)" : "var(--color-text-secondary)",
                        borderColor: groupByCertificate ? "var(--color-accent)" : "var(--color-border-strong)",
                        background: groupByCertificate ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                      }}
                    >
                      Split by certificate
                    </button>
                  </Tooltip>
                )}
              </div>

              <select
                value={conditionId}
                onChange={(e) => updateParams({ conditionId: e.target.value })}
                style={CONTROL_STYLE}
                aria-label="Filter by condition"
              >
                <option value="">All conditions</option>
                {conditions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              {/* Delivery state filter (#272), beside the condition one: the axis the row chip
                  shows, so "what is still in transit?" is one click from seeing it flagged. */}
              <Tooltip
                content={
                  groupDuplicates
                    ? "Duplicate groups only cover copies in hand, so the delivery state is fixed to Delivered."
                    : ""
                }
              >
              <select
                value={deliveryState}
                disabled={groupDuplicates}
                onChange={(e) => updateParams({ deliveryState: e.target.value })}
                style={{
                  ...CONTROL_STYLE,
                  ...(groupDuplicates ? { opacity: 0.5 } : null),
                  ...(deliveryState
                    ? {
                        fontWeight: 600,
                        color: "var(--color-accent)",
                        border: "1px solid var(--color-accent)",
                        background: "var(--color-accent-soft)",
                      }
                    : null),
                }}
                aria-label="Filter by delivery state"
              >
                <option value="">All delivery states</option>
                {DELIVERY_STATES.map((state) => (
                  <option key={state} value={state}>
                    {DELIVERY_STATE_META[state].label}
                  </option>
                ))}
              </select>
              </Tooltip>

              {/* Format filter (#343), beside the condition one. Absent entirely when the
                  collection defines no formats — most never do. "Single" is a listed choice
                  because it is a real answer (no format set), not the absence of a filter. */}
              {formats.length > 0 && (
                <select
                  value={formatId}
                  onChange={(e) => updateParams({ formatId: e.target.value })}
                  style={CONTROL_STYLE}
                  aria-label="Filter by format"
                >
                  <option value="">All formats</option>
                  <option value="single">Single</option>
                  {formats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}

              {/* "For sale, not yet offered on platform X" (#259): pick a platform to surface
                  for-sale copies still needing a listing there. Lists every platform contact
                  (not just ones with existing offers), since the point is to catch platforms
                  that haven't been used yet. Only shown once at least one platform contact
                  exists. */}
              {offerPlatforms.length > 0 && (
                <Tooltip content="Show for-sale copies with no active offer on the chosen platform">
                  <select
                    value={notOfferedPlatformId}
                    onChange={(e) => {
                      rememberNotOfferedPlatform(e.target.value);
                      updateParams({ notOfferedPlatform: e.target.value });
                    }}
                    style={{
                      ...CONTROL_STYLE,
                      ...(notOfferedPlatformId
                        ? {
                            fontWeight: 600,
                            color: "var(--color-accent)",
                            border: "1px solid var(--color-accent)",
                            background: "var(--color-accent-soft)",
                          }
                        : null),
                    }}
                    aria-label="Show for-sale copies not yet offered on a platform"
                  >
                    <option value="">For sale: any platform</option>
                    {offerPlatforms.map((p) => (
                      <option key={p.id} value={p.id}>
                        Not offered on {p.name}
                      </option>
                    ))}
                  </select>
                </Tooltip>
              )}

              {locations.length > 0 && (
                <div style={{ width: "12rem" }}>
                  <LocationTreeSelect
                    locations={locations}
                    locationTree={locationTree}
                    name="location-filter"
                    selectedId={locationId}
                    onSelectedIdChange={(id) => updateParams({ locationId: id })}
                    noneOptionLabel="All locations"
                  />
                </div>
              )}

              {/* Scope of the location filter (#385), shown only once a location with boxes
                  under it is picked — on a leaf both readings select the same copies. */}
              {hasChildLocations && (
                <SubtreeScopeToggle
                  axis="location"
                  includeDescendants={includeSubLocations}
                  onChange={setIncludeSubLocations}
                />
              )}

              <IssueFilterAutocomplete
                collectionId={collectionId}
                areaIds={filterAreaIds}
                selectedIssueId={issueId}
                onSelect={(id) => updateParams({ issueId: id })}
              />
            </div>
          </ListToolbar>

          {/* List — flat copies, or one row per duplicate group (#372) */}
          {listLoading && (
            <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
              {groupDuplicates ? "Grouping duplicates…" : "Loading copies…"}
            </div>
          )}

          {!listLoading && listEmpty && (
            <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
              {groupDuplicates
                ? "No duplicate groups here. Grouping covers copies that are For sale, delivered and unsold."
                : hasActiveFilters
                  ? "No copies match these filters."
                  : filterAreaId
                    ? "No copies in this area."
                    : "No copies yet. Add your first physical copy."}
            </div>
          )}

          {groupDuplicates && allGroups.length > 0 && (
            <div style={{ flex: 1 }}>
              <DuplicateGroupList
                collectionId={collectionId}
                groups={allGroups}
                axes={axes}
                baseFilters={filters}
                areas={areas}
                locations={locations}
                baseCurrency={baseCurrency}
                hasNextPage={!!groupsQuery.hasNextPage}
                isFetchingNextPage={groupsQuery.isFetchingNextPage}
                onLoadMore={groupsQuery.fetchNextPage}
                onListAsOffer={(group) => setDialog({ kind: "listGroup", group })}
              />
            </div>
          )}

          {!groupDuplicates && allCopies.length > 0 && (
            <div style={{ flex: 1 }}>
              <InventoryCopyList
                collectionId={collectionId}
                copies={allCopies}
                areas={areas}
                locations={locations}
                baseCurrency={baseCurrency}
                hasNextPage={!!hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                onLoadMore={fetchNextPage}
                selection={copySelection}
                onEdit={(it) => setDialog({ kind: "edit", item: it })}
                onEditStamp={(it) => setDialog({ kind: "editStamp", item: it })}
                onIdentify={(it) => setDialog({ kind: "identify", item: it })}
                onViewHistory={(it) => setDialog({ kind: "history", item: it })}
                onDelete={(it) => setDialog({ kind: "delete", item: it })}
                onAddToOffer={(it) => setDialog({ kind: "addToOffer", items: [it] })}
                onAddToNewOffer={(it) => setDialog({ kind: "addToNewOffer", items: [it] })}
                onViewOffers={(it) => setDialog({ kind: "viewOffers", item: it })}
                onViewPurchase={(it) =>
                  it.purchase &&
                  router.push(
                    `/c/${collectionSlug}/purchases/${it.purchase.id}?lot=${it.lotId}`
                  )
                }
                onDispose={(it) => setDialog({ kind: "dispose", item: it })}
                onRestore={(it) => setDialog({ kind: "restore", item: it })}
                onSetCatalogPrice={(it) => setDialog({ kind: "quickPrice", item: it })}
              />
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit dialog */}
      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <InventoryItemFormDialog
          mode={dialog.kind}
          collectionId={collectionId}
          areas={areas}
          locations={locations}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          item={dialog.kind === "edit" ? dialog.item : undefined}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            startTransition(async () => {
              if (dialog.kind === "add") {
                const { createItemAction } = await import("@/app/actions/items");
                const result = await createItemAction(collectionId, fd);
                if (result.status === "success") handleSuccess();
                else if (result.status === "error") setActionError(result.message);
              } else if (dialog.kind === "edit") {
                const { updateItemAction } = await import("@/app/actions/items");
                const result = await updateItemAction(dialog.item.id, fd);
                if (result.status === "success") handleSuccess();
                else if (result.status === "error") setActionError(result.message);
              }
            });
          }}
        />
      )}

      {/* Edit the copy's underlying stamp (#243): the shared stamp edit dialog, reused
          exactly as the stamps list and purchase intake do, opened straight from the row. */}
      {dialog.kind === "editStamp" && (
        <StampFormDialog
          mode="edit"
          stampId={dialog.item.stampId}
          collectionId={collectionId}
          stamp={{
            name: dialog.item.stampName,
            issuedDay: dialog.item.issuedDay,
            issuedMonth: dialog.item.issuedMonth,
            issuedYear: dialog.item.issuedYear,
            catalogNumbers: dialog.item.catalogNumbers,
          }}
          areaVendors={[...vendorMapFor(dialog.item.areaId, dialog.item.issueId).values()]}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            const stampId = dialog.item.stampId;
            setActionError(undefined);
            startTransition(async () => {
              const { updateStampWithCatalogAction } = await import("@/app/actions/stamps");
              const result = await updateStampWithCatalogAction(stampId, fd);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {/* Identify variant */}
      {dialog.kind === "identify" && (
        <IdentifyVariantDialog
          collectionId={collectionId}
          item={dialog.item}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            startTransition(async () => {
              const { resolveItemVariantAction } = await import("@/app/actions/items");
              const result = await resolveItemVariantAction(dialog.item.id, fd);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {/* Refinement history */}
      {dialog.kind === "history" && (
        <VariantHistoryDialog
          collectionId={collectionId}
          item={dialog.item}
          onClose={closeDialog}
        />
      )}

      {/* List a whole duplicate group as one offer (#372): pick which of its copies go on, then
          hand them to the create path below — one offer, one single-copy set each. */}
      {dialog.kind === "listGroup" && (
        <ListGroupDialog
          collectionId={collectionId}
          group={dialog.group}
          axes={axes}
          baseFilters={filters}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          platformFiltered={!!notOfferedPlatformId}
          onClose={closeDialog}
          onConfirm={(copies) => setDialog({ kind: "addToNewOffer", items: copies })}
        />
      )}

      {/* Add copies to an offer: the full picker (#188), or straight into offer creation when the
          "Add to new offer" action was used (#277). Same dialog, `startInCreate` skips the picker. */}
      {(dialog.kind === "addToOffer" || dialog.kind === "addToNewOffer") && (
        <AddToOfferDialog
          collectionId={collectionId}
          items={dialog.items}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          // No platform filter here, so seed the "create new offer" sub-flow from the last-used
          // platform (#241) and record it when one is created.
          initialPlatform={preferredPlatform}
          onPlatformUsed={rememberPlatform}
          startInCreate={dialog.kind === "addToNewOffer"}
          onClose={closeDialog}
          onDone={handleSuccess}
        />
      )}

      {/* Every offer this copy is in (#276): read-only, all platforms and states. Closing returns
          to the list; a row opens the offer's detail screen. */}
      {dialog.kind === "viewOffers" && (
        <OffersPopupDialog
          collectionId={collectionId}
          target={{
            kind: "item",
            itemId: dialog.item.id,
            label: dialog.item.stampName ?? formatItemNo(dialog.item.itemNo, itemNoPad),
          }}
          onClose={closeDialog}
        />
      )}

      {/* Quick-add catalog value (#228): the shared price dialog (#147/#170), opened from the
          row action on copies with no catalog value for their condition. */}
      {dialog.kind === "quickPrice" && (
        <QuickPriceDialog
          subject={dialog.item}
          collectionId={collectionId}
          areaName={dialog.item.areaId ? (areaNameById.get(dialog.item.areaId) ?? null) : null}
          primaryVendorId={
            dialog.item.areaId ? (primaryVendorByArea.get(dialog.item.areaId) ?? null) : null
          }
          vendorMap={vendorMapFor(dialog.item.areaId, dialog.item.issueId)}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(entries) => {
            const it = dialog.item;
            setActionError(undefined);
            startTransition(async () => {
              const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
              const result = await quickSetCatalogPricesAction(
                it.stampId,
                it.conditionId,
                it.certificateStatusId,
                entries
              );
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {/* No longer held (#394/#395): reason + note. The domain's refusals — a copy that has not
          arrived, or one sitting in a live offer — come back as the dialog's error, naming the
          offer to withdraw first. */}
      {dialog.kind === "dispose" && (
        <DisposeCopyDialog
          collectionId={collectionId}
          item={dialog.item}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            const id = dialog.item.id;
            setActionError(undefined);
            startTransition(async () => {
              const { disposeItemAction } = await import("@/app/actions/items");
              const result = await disposeItemAction(id, fd);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {/* The copy turned up again: one fact with nothing to fill in, so a confirmation rather
          than a form. */}
      {dialog.kind === "restore" && (
        <ConfirmDialog
          title="Mark as held again"
          message="This copy goes back into the collection: it counts towards collection value again and can be listed for sale."
          actionLabel="Mark as held"
          pendingLabel="Saving…"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            const id = dialog.item.id;
            startTransition(async () => {
              const { restoreItemAction } = await import("@/app/actions/items");
              const result = await restoreItemAction(id);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {/* Delete confirmation */}
      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete copy"
          message="This permanently removes this physical copy record. This cannot be undone."
          actionLabel="Delete copy"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { deleteItemAction } = await import("@/app/actions/items");
              const result = await deleteItemAction(dialog.item.id);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}
