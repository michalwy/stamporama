"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { ItemListItem, ItemSortBy } from "@/lib/items";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { ConfirmDialog } from "@/app/dialog-shell";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { getDescendantIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { ListToolbar, type SortOption } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { parseCatalogSearch } from "@/lib/catalog-number";
import { usePersistedSort } from "@/app/c/[collectionSlug]/shared/use-persisted-sort";
import { IssueFilterAutocomplete } from "@/app/c/[collectionSlug]/stamps/issue-filter-autocomplete";
import {
  useInventoryItemsInfinite,
  useHoldingsValuation,
  useItemYears,
  useInvalidateInventory,
  type InventoryItemFilters,
  type InventoryYearFacetFilters,
} from "./use-inventory-query";
import { HoldingsSummaryBar } from "@/app/c/[collectionSlug]/shared/holdings-summary-bar";
import { InventoryCopyList } from "./inventory-copy-list";
import { InventoryItemFormDialog } from "./inventory-item-form-dialog";
import { IdentifyVariantDialog } from "./identify-variant-dialog";
import { VariantHistoryDialog } from "./variant-history-dialog";
import { AddToOfferDialog } from "./add-to-offer-dialog";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { effectiveVendorsForArea } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useOfferPlatforms } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { useLastUsedPlatform } from "@/app/c/[collectionSlug]/offers/use-last-used-platform";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; item: ItemListItem }
  | { kind: "editStamp"; item: ItemListItem }
  | { kind: "identify"; item: ItemListItem }
  | { kind: "history"; item: ItemListItem }
  | { kind: "delete"; item: ItemListItem }
  | { kind: "addToOffer"; item: ItemListItem }
  | { kind: "quickPrice"; item: ItemListItem };

const EMPTY_VENDOR_MAP = new Map<string, AreaCatalogEntry>();

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
  baseCurrency: string;
}

export function InventoryListPanel({
  collectionId,
  collectionSlug,
  areas,
  locations,
  conditions,
  certificateStatuses,
  baseCurrency,
}: InventoryListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateList } = useInvalidateInventory();

  // Last-used platform, to seed the "create new offer" sub-flow of Add to offer (#241). The Copies
  // list has no platform filter, so the last one used is the only signal here.
  const { data: offerPlatforms = [] } = useOfferPlatforms(collectionId);
  const [lastPlatformId, rememberPlatform] = useLastUsedPlatform(collectionId);
  const preferredPlatform = useMemo(
    () => (lastPlatformId ? offerPlatforms.find((p) => p.id === lastPlatformId) : undefined),
    [offerPlatforms, lastPlatformId]
  );

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

  const filterAreaIds = useMemo(() => {
    if (!filterAreaId) return undefined;
    const ids = getDescendantIds(areas, filterAreaId);
    ids.add(filterAreaId);
    return [...ids];
  }, [filterAreaId, areas]);

  const search = searchParams.get("search") ?? "";
  const conditionId = searchParams.get("conditionId") ?? "";
  const locationId = searchParams.get("locationId") ?? "";
  const issueId = searchParams.get("issueId") ?? "";
  const noPhotos = searchParams.get("noPhotos") === "true";
  const missingCatalogValue = searchParams.get("missingCatalogValue") === "true";
  // Sold copies are hidden by default (#207); this toggle brings them back into the list.
  const includeSold = searchParams.get("includeSold") === "true";
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
      locationId: locationId || undefined,
      issueId: issueId || undefined,
      year: year || undefined,
      inCollection: activeDispositions.has("inCollection") || undefined,
      forSale: activeDispositions.has("forSale") || undefined,
      forTrade: activeDispositions.has("forTrade") || undefined,
      noPhotos: noPhotos || undefined,
      missingCatalogValue: missingCatalogValue || undefined,
      includeSold: includeSold || undefined,
      sortBy,
      sortDir,
    }),
    [filterAreaIds, search, parsedCatalog, conditionId, locationId, issueId, year, activeDispositions, noPhotos, missingCatalogValue, includeSold, sortBy, sortDir]
  );

  const yearFacetFilters: InventoryYearFacetFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      catalogVendorId: parsedCatalog.vendorId ?? undefined,
      catalogNumber: parsedCatalog.number || undefined,
      conditionId: conditionId || undefined,
      locationId: locationId || undefined,
      issueId: issueId || undefined,
      inCollection: activeDispositions.has("inCollection") || undefined,
      forSale: activeDispositions.has("forSale") || undefined,
      forTrade: activeDispositions.has("forTrade") || undefined,
      noPhotos: noPhotos || undefined,
      missingCatalogValue: missingCatalogValue || undefined,
      includeSold: includeSold || undefined,
    }),
    [filterAreaIds, search, parsedCatalog, conditionId, locationId, issueId, activeDispositions, noPhotos, missingCatalogValue, includeSold]
  );

  const { data: yearFacets, isLoading: yearsLoading } = useItemYears(
    collectionId,
    yearFacetFilters
  );

  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);

  // Per-area vendor maps + area names for the quick-price dialog (#228), resolved once here so the
  // dialog can format catalog numbers identically to the rows (mirrors the purchase intake view).
  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);
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
    useInventoryItemsInfinite(collectionId, filters);
  const { data: holdingsTotal } = useHoldingsValuation(collectionId, filters);

  const allCopies = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
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
  }

  const hasActiveFilters =
    !!search ||
    !!issueId ||
    !!conditionId ||
    !!locationId ||
    !!year ||
    noPhotos ||
    missingCatalogValue ||
    includeSold ||
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
                <button
                  type="button"
                  onClick={() => updateParams({ noPhotos: noPhotos ? "" : "true" })}
                  title="Show only copies with no attached photos"
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
                <button
                  type="button"
                  onClick={() =>
                    updateParams({ missingCatalogValue: missingCatalogValue ? "" : "true" })
                  }
                  title="Show only copies with no catalog value recorded for their condition"
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
                <button
                  type="button"
                  onClick={() => updateParams({ includeSold: includeSold ? "" : "true" })}
                  title="Also show copies that have already sold (hidden by default)"
                  style={{
                    ...CONTROL_STYLE,
                    cursor: "pointer",
                    fontWeight: includeSold ? 600 : 400,
                    color: includeSold ? "var(--color-accent)" : "var(--color-text-secondary)",
                    borderColor: includeSold ? "var(--color-accent)" : "var(--color-border-strong)",
                    background: includeSold ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                  }}
                >
                  Include sold
                </button>
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

              <IssueFilterAutocomplete
                collectionId={collectionId}
                areaIds={filterAreaIds}
                selectedIssueId={issueId}
                onSelect={(id) => updateParams({ issueId: id })}
              />
            </div>
          </ListToolbar>

          {/* List */}
          {isLoading && (
            <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
              Loading copies…
            </div>
          )}

          {!isLoading && allCopies.length === 0 && (
            <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
              {hasActiveFilters
                ? "No copies match these filters."
                : filterAreaId
                  ? "No copies in this area."
                  : "No copies yet. Add your first physical copy."}
            </div>
          )}

          {allCopies.length > 0 && (
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
                onEdit={(it) => setDialog({ kind: "edit", item: it })}
                onEditStamp={(it) => setDialog({ kind: "editStamp", item: it })}
                onIdentify={(it) => setDialog({ kind: "identify", item: it })}
                onViewHistory={(it) => setDialog({ kind: "history", item: it })}
                onDelete={(it) => setDialog({ kind: "delete", item: it })}
                onAddToOffer={(it) => setDialog({ kind: "addToOffer", item: it })}
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
          areaVendors={
            dialog.item.areaId ? effectiveVendorsForArea(areas, dialog.item.areaId) : []
          }
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

      {/* Add copy to an existing offer (#188) */}
      {dialog.kind === "addToOffer" && (
        <AddToOfferDialog
          collectionId={collectionId}
          item={dialog.item}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          // No platform filter here, so seed the "create new offer" sub-flow from the last-used
          // platform (#241) and record it when one is created.
          initialPlatform={preferredPlatform}
          onPlatformUsed={rememberPlatform}
          onClose={closeDialog}
          onDone={handleSuccess}
        />
      )}

      {/* Quick-add catalog value (#228): the shared price dialog (#147/#170), opened from the
          row action on copies with no catalog value for their condition. */}
      {dialog.kind === "quickPrice" && (
        <QuickPriceDialog
          item={dialog.item}
          collectionId={collectionId}
          areaName={dialog.item.areaId ? (areaNameById.get(dialog.item.areaId) ?? null) : null}
          primaryVendorId={
            dialog.item.areaId ? (primaryVendorByArea.get(dialog.item.areaId) ?? null) : null
          }
          vendorMap={
            dialog.item.areaId
              ? (vendorMapByArea.get(dialog.item.areaId) ?? EMPTY_VENDOR_MAP)
              : EMPTY_VENDOR_MAP
          }
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
