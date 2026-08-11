"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CollectionAreaData } from "@/lib/areas";
import type { StampListItem, StampSortBy } from "@/lib/stamps";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { ListToolbar, type SortOption, type CatalogVendorOption } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { usePersistedSort } from "@/app/c/[collectionSlug]/shared/use-persisted-sort";
import { IssueFilterAutocomplete } from "./issue-filter-autocomplete";
import { ConditionPriceSwitcher } from "@/app/c/[collectionSlug]/shared/condition-price-switcher";
import { useDisplayCondition } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { FormatPriceSwitcher } from "@/app/c/[collectionSlug]/shared/format-price-switcher";
import { useDisplayFormat } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { parseCatalogSearch } from "@/lib/catalog-number";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import {
  useStampsInfinite,
  useStampYears,
  useInvalidateStamps,
  type StampListFilters,
  type StampYearFacetFilters,
} from "./use-stamps-query";
import { StampRow } from "./stamp-row";
import { useToast } from "@/app/toast-provider";
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

  // Whether a selected area brings its sub-areas with it is the collector's choice (#385); the
  // toggle lives in the area sidebar and the resolution is shared so every list agrees.
  const [includeSubAreas] = useSubtreeScope("area");
  const filterAreaIds = useMemo(
    () => resolveAreaFilterIds(areas, filterAreaId, includeSubAreas) ?? undefined,
    [filterAreaId, areas, includeSubAreas]
  );
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
  // Catalog vendor filter, remembered per collection (#115): the URL param wins when present
  // (shareable), else fall back to the last-selected vendor on a fresh visit. Shared across the
  // stamp and issue lists so a chosen catalog carries between them.
  const [storedCatalogVendor, rememberCatalogVendor] = usePersistedCollectionValue(
    "list-catalog-vendor",
    collectionId
  );
  const catalogVendorId = searchParams.has("catalogVendorId")
    ? (searchParams.get("catalogVendorId") ?? "")
    : (storedCatalogVendor ?? "");
  const catalogNumber = searchParams.get("catalogNumber") ?? "";
  const issueId = searchParams.get("issueId") ?? "";

  const { conditions, displayConditionId, setDisplayConditionId } =
    useDisplayCondition(collectionId);
  const { formats, displayFormatId, setDisplayFormatId } = useDisplayFormat(collectionId);

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

  // Prefixed catalog search (#146): a vendor abbreviation typed into the number box
  // ("Mi PL 200") resolves and overrides the dropdown; a bare number falls back to
  // the dropdown vendor, or searches across all vendors when none is selected.
  const parsedCatalog = useMemo(
    () => parseCatalogSearch(catalogNumber, catalogVendors),
    [catalogNumber, catalogVendors]
  );
  const effectiveCatalogVendorId = parsedCatalog.vendorId ?? catalogVendorId;
  const effectiveCatalogNumber = parsedCatalog.number;

  const filters: StampListFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      catalogVendorId: effectiveCatalogVendorId || undefined,
      catalogNumber: effectiveCatalogNumber || undefined,
      issueId: issueId || undefined,
      year: year || undefined,
      displayConditionId: displayConditionId || undefined,
      displayFormatId: displayFormatId || undefined,
      sortBy,
      sortDir,
    }),
    [filterAreaIds, search, effectiveCatalogVendorId, effectiveCatalogNumber, issueId, year, displayConditionId, displayFormatId, sortBy, sortDir]
  );

  const yearFacetFilters: StampYearFacetFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      catalogVendorId: effectiveCatalogVendorId || undefined,
      catalogNumber: effectiveCatalogNumber || undefined,
      issueId: issueId || undefined,
    }),
    [filterAreaIds, search, effectiveCatalogVendorId, effectiveCatalogNumber, issueId]
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

  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);

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

  // Confirmation toasts (#541). Both actions here are taken from a dialog over a long, virtualised
  // list, and both can move the row out of the current filter — an edited catalog number lands under
  // a different year, a deleted stamp leaves nothing behind at all.
  const { toast } = useToast();

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
          onCatalogSearchChange={(vid, num) => {
            rememberCatalogVendor(vid);
            updateParams({ catalogVendorId: vid, catalogNumber: num });
          }}
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
          {/* Condition and format together name one cell of the price grid (#343); the format
              control renders nothing at all when the collection defines no formats. */}
          <FormatPriceSwitcher
            formats={formats}
            value={displayFormatId}
            onChange={setDisplayFormatId}
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
              // The stamp's issue may override its area's prefix (#377).
              const vendorMap = vendorMapFor(areaId, stamp.issues[0]?.issueId ?? null);

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
          areaVendors={[
            ...vendorMapFor(
              dialog.stamp.areaId,
              dialog.stamp.issues[0]?.issueId ?? null
            ).values(),
          ]}
          isPending={isPending}
          onClose={closeDialog}
          onSubmit={(fd) => {
            startTransition(async () => {
              const { updateStampWithCatalogAction } = await import("@/app/actions/stamps");
              const stamp = dialog.stamp;
              const result = await updateStampWithCatalogAction(stamp.id, fd);
              if (result.status === "success") {
                handleSuccess();
                toast({
                  message: `${stamp.name ?? "Stamp"} saved`,
                  href: `/c/${collectionSlug}/stamps/${stamp.id}`,
                  linkLabel: "Open stamp",
                });
              } else if (result.status === "error") setActionError(result.message);
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
              const name = dialog.stamp.name ?? "Stamp";
              const result = await deleteStampAction(dialog.stamp.id, mode);
              if (result.status === "success") {
                handleSuccess();
                toast({ message: `${name} deleted` });
              } else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}
