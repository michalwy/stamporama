"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import type { StampListItem } from "@/lib/stamps";
import { AreaFilterSidebar } from "@/app/c/[collectionSlug]/shared/area-filter-sidebar";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import {
  effectiveVendorsForArea,
  effectivePrimaryVendorId,
} from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useStampsInfinite, useInvalidateStamps } from "./use-stamps-query";
import { StampRow } from "./stamp-row";
import { StampEditDialog } from "@/app/c/[collectionSlug]/shared/stamp-edit-dialog";
import { DeleteStampDialog } from "@/app/c/[collectionSlug]/shared/delete-stamp-dialog";

type DialogState =
  | { kind: "none" }
  | { kind: "edit-stamp"; stamp: StampListItem }
  | { kind: "delete-stamp"; stamp: StampListItem };

interface StampsListPanelProps {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
  filterAreaId: string | null;
  filterAreaIds: string[] | undefined;
}

export function StampsListPanel({
  collectionId,
  collectionSlug,
  areas,
  filterAreaId,
  filterAreaIds,
}: StampsListPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateList } = useInvalidateStamps();

  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isLoading,
  } = useStampsInfinite(collectionId, filterAreaIds);

  const allStamps = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  );

  const areaById = useMemo(
    () => new Map(areas.map((a) => [a.id, a])),
    [areas]
  );

  const primaryVendorByArea = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const a of areas) {
      m.set(a.id, effectivePrimaryVendorId(areas, a.id));
    }
    return m;
  }, [areas]);

  const vendorMapByArea = useMemo(() => {
    const m = new Map<string, Map<string, AreaCatalogEntry>>();
    for (const a of areas) {
      const vendors = effectiveVendorsForArea(areas, a.id);
      const unique = new Map(vendors.map((v) => [v.catalogVendorId, v]));
      m.set(a.id, unique);
    }
    return m;
  }, [areas]);

  function handleNavigateFilter(areaId: string | null) {
    if (areaId) {
      router.push(`/c/${collectionSlug}/stamps?areaId=${areaId}`);
    } else {
      router.push(`/c/${collectionSlug}/stamps`);
    }
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

  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        overflow: "hidden",
        minHeight: "24rem",
      }}
    >
      <AreaFilterSidebar
        areas={areas}
        filterAreaId={filterAreaId}
        onNavigate={handleNavigateFilter}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            padding: "0.875rem 1.25rem",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-bg-elevated)",
          }}
        >
          <span
            style={{
              fontSize: "0.875rem",
              color: "var(--color-text-muted)",
              display: "flex",
              alignItems: "center",
            }}
          >
            All stamps
          </span>
          {filterAreaId && areaById.has(filterAreaId) && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              Filtered by:
              <span
                style={{
                  fontWeight: 600,
                  color: "var(--color-text-secondary)",
                }}
              >
                {areaById.get(filterAreaId)!.name}
              </span>
              <button
                type="button"
                onClick={() => handleNavigateFilter(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  fontSize: "0.8125rem",
                  padding: "0 0.125rem",
                }}
                title="Clear filter"
              >
                ✕
              </button>
            </span>
          )}
        </div>

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
            {filterAreaId
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
                  areas={areas}
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
        <StampEditDialog
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
