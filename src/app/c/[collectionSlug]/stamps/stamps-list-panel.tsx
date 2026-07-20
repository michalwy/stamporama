"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import type { StampListItem, StampSortBy } from "@/lib/stamps";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { ListToolbar, type SortOption, type CatalogVendorOption } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { usePersistedSort } from "@/app/c/[collectionSlug]/shared/use-persisted-sort";
import { IssueFilterAutocomplete } from "./issue-filter-autocomplete";
import { ConditionPriceSwitcher } from "@/app/c/[collectionSlug]/shared/condition-price-switcher";
import { useDisplayCondition } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { effectiveVendorsForArea, getDescendantIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import {
  useStampsInfinite,
  useStampYears,
  useInvalidateStamps,
  type StampListFilters,
  type StampYearFacetFilters,
} from "./use-stamps-query";
import { StampRow } from "./stamp-row";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { DeleteStampDialog } from "@/app/c/[collectionSlug]/shared/delete-stamp-dialog";

type DialogState =
  | { kind: "none" }
  | { kind: "edit-stamp"; stamp: StampListItem }
  | { kind: "delete-stamp"; stamp: StampListItem };

interface StampsListPanelProps {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
}

const STAMP_SORT_OPTIONS: SortOption[] = [
  { value: "issueDate", label: "Issue date" },
  { value: "catalogNumber", label: "Catalog number" },
  { value: "name", label: "Stamp name" },
  { value: "issueName", label: "Issue name" },
];

export function StampsListPanel({
  collectionId,
  collectionSlug,
  areas,
  baseCurrency,
}: StampsListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

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
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateList } = useInvalidateStamps();

  const search = searchParams.get("search") ?? "";
  const { sortBy, sortDir, persistSort } = usePersistedSort<StampSortBy>(
    "stamps", "issueDate", "asc",
    searchParams.get("sortBy"),
    searchParams.get("sortDir"),
    ["issueDate", "catalogNumber", "name", "issueName"]
  );
  const catalogVendorId = searchParams.get("catalogVendorId") ?? "";
  const catalogNumber = searchParams.get("catalogNumber") ?? "";
  const issueId = searchParams.get("issueId") ?? "";

  const { conditions, displayConditionId, setDisplayConditionId } =
    useDisplayCondition(collectionId);

  const filters: StampListFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      catalogVendorId: catalogVendorId || undefined,
      catalogNumber: catalogNumber || undefined,
      issueId: issueId || undefined,
      year: year || undefined,
      displayConditionId: displayConditionId || undefined,
      sortBy,
      sortDir,
    }),
    [filterAreaIds, search, catalogVendorId, catalogNumber, issueId, year, displayConditionId, sortBy, sortDir]
  );

  const yearFacetFilters: StampYearFacetFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      catalogVendorId: catalogVendorId || undefined,
      catalogNumber: catalogNumber || undefined,
      issueId: issueId || undefined,
    }),
    [filterAreaIds, search, catalogVendorId, catalogNumber, issueId]
  );

  const { data: yearFacets, isLoading: yearsLoading } = useStampYears(
    collectionId,
    yearFacetFilters
  );

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/stamps${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const catalogVendors = useMemo<CatalogVendorOption[]>(() => {
    const seen = new Map<string, CatalogVendorOption>();
    for (const area of areas) {
      for (const entry of area.catalogEntries) {
        if (!seen.has(entry.catalogVendorId)) {
          seen.set(entry.catalogVendorId, {
            id: entry.catalogVendorId,
            name: entry.vendorName,
            abbreviation: entry.vendorAbbreviation,
          });
        }
      }
    }
    return Array.from(seen.values());
  }, [areas]);

  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isLoading,
  } = useStampsInfinite(collectionId, filters);

  const allStamps = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  );

  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);

  function handleNavigateFilter(areaId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    // "all" sentinel (not delete) so an explicit "all areas" is distinguishable
    // from an absent param that falls back to the store (#143).
    params.set("areaId", areaId ?? "all");
    const qs = params.toString();
    router.push(`/c/${collectionSlug}/stamps${qs ? `?${qs}` : ""}`);
  }

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

  const hasActiveFilters = !!(search || catalogNumber || issueId || year);

  return (
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
        {/* Toolbar */}
        <ListToolbar
          search={search}
          onSearchChange={(v) => updateParams({ search: v })}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={(sb, sd) => { persistSort(sb as StampSortBy, sd); updateParams({ sortBy: sb, sortDir: sd }); }}
          sortOptions={STAMP_SORT_OPTIONS}
          catalogVendors={catalogVendors}
          catalogVendorId={catalogVendorId}
          catalogNumber={catalogNumber}
          onCatalogSearchChange={(vid, num) =>
            updateParams({ catalogVendorId: vid, catalogNumber: num })
          }
        >
          <IssueFilterAutocomplete
            collectionId={collectionId}
            areaIds={filterAreaIds}
            selectedIssueId={issueId}
            onSelect={(id) => updateParams({ issueId: id })}
          />
          <ConditionPriceSwitcher
            conditions={conditions}
            value={displayConditionId}
            onChange={setDisplayConditionId}
          />
        </ListToolbar>

        {/* Stamps list */}
        {isLoading && (
          <div
            style={{
              padding: "2rem",
              color: "var(--color-text-muted)",
              fontSize: "0.9375rem",
            }}
          >
            Loading stamps...
          </div>
        )}

        {!isLoading && allStamps.length === 0 && (
          <div
            style={{
              padding: "2rem",
              color: "var(--color-text-muted)",
              fontSize: "0.9375rem",
            }}
          >
            {hasActiveFilters
              ? "No stamps match your search."
              : filterAreaId
                ? "No stamps in this area."
                : "No stamps yet. Add stamps through the Issues page."}
          </div>
        )}

        {allStamps.length > 0 && (
          <div style={{ flex: 1 }}>
            {allStamps.map((stamp, idx) => {
              const areaId = stamp.areaId;
              const primaryVendorId = areaId
                ? (primaryVendorByArea.get(areaId) ?? null)
                : null;
              const vendorMap = areaId
                ? (vendorMapByArea.get(areaId) ?? new Map<string, AreaCatalogEntry>())
                : new Map<string, AreaCatalogEntry>();

              return (
                <StampRow
                  key={stamp.id}
                  stamp={stamp}
                  collectionId={collectionId}
                  areas={areas}
                  baseCurrency={baseCurrency}
                  primaryVendorId={primaryVendorId}
                  vendorMap={vendorMap}
                  isLast={idx === allStamps.length - 1 && !hasNextPage}
                  onEdit={(s) => setDialog({ kind: "edit-stamp", stamp: s })}
                  onDelete={(s) => setDialog({ kind: "delete-stamp", stamp: s })}
                />
              );
            })}
            <InfiniteScrollSentinel
              onLoadMore={fetchNextPage}
              hasMore={!!hasNextPage}
              isLoading={isFetchingNextPage}
            />
          </div>
        )}
      </div>

      {/* ── Edit dialog ── */}
      {dialog.kind === "edit-stamp" && (
        <StampFormDialog
          mode="edit"
          stampId={dialog.stamp.id}
          collectionId={collectionId}
          stamp={dialog.stamp}
          areaVendors={
            dialog.stamp.areaId
              ? effectiveVendorsForArea(areas, dialog.stamp.areaId)
              : []
          }
          isPending={isPending}
          onClose={closeDialog}
          onSubmit={(fd) => {
            startTransition(async () => {
              const { updateStampWithCatalogAction } = await import("@/app/actions/stamps");
              const result = await updateStampWithCatalogAction(dialog.stamp.id, fd);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}

      {dialog.kind === "delete-stamp" && (
        <DeleteStampDialog
          stampId={dialog.stamp.id}
          stampName={dialog.stamp.name ?? "(unnamed)"}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={(mode) => {
            startTransition(async () => {
              const { deleteStampAction } = await import("@/app/actions/stamps");
              const result = await deleteStampAction(dialog.stamp.id, mode);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}
