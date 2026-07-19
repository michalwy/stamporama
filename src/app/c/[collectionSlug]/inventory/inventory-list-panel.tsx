"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { ItemListItem, ItemSortBy } from "@/lib/items";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { ConfirmDialog } from "@/app/dialog-shell";
import {
  useInventoryItemsInfinite,
  useHoldingsValuation,
  useInvalidateInventory,
  type InventoryItemFilters,
} from "./use-inventory-query";
import { HoldingsSummaryBar } from "./holdings-summary-bar";
import { InventoryCopyList } from "./inventory-copy-list";
import { InventoryItemFormDialog } from "./inventory-item-form-dialog";
import { IdentifyVariantDialog } from "./identify-variant-dialog";
import { VariantHistoryDialog } from "./variant-history-dialog";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; item: ItemListItem }
  | { kind: "identify"; item: ItemListItem }
  | { kind: "history"; item: ItemListItem }
  | { kind: "delete"; item: ItemListItem };

const DISPOSITION_FILTERS = [
  { key: "inCollection", label: "In collection" },
  { key: "forSale", label: "For sale" },
  { key: "forTrade", label: "For trade" },
] as const;

const SORT_OPTIONS: { value: ItemSortBy; label: string }[] = [
  { value: "created", label: "Date added" },
  { value: "acquired", label: "Acquired date" },
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

  const conditionId = searchParams.get("conditionId") ?? "";
  const locationId = searchParams.get("locationId") ?? "";
  const sortBy = (searchParams.get("sortBy") as ItemSortBy) || "created";
  const sortDir = (searchParams.get("sortDir") as "asc" | "desc") || "asc";
  const activeDispositions = useMemo(() => {
    const set = new Set<string>();
    for (const { key } of DISPOSITION_FILTERS) {
      if (searchParams.get(key) === "true") set.add(key);
    }
    return set;
  }, [searchParams]);

  const filters: InventoryItemFilters = useMemo(
    () => ({
      conditionId: conditionId || undefined,
      locationId: locationId || undefined,
      inCollection: activeDispositions.has("inCollection") || undefined,
      forSale: activeDispositions.has("forSale") || undefined,
      forTrade: activeDispositions.has("forTrade") || undefined,
      sortBy,
      sortDir,
    }),
    [conditionId, locationId, activeDispositions, sortBy, sortDir]
  );

  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);

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
    !!conditionId || !!locationId || activeDispositions.size > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
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
          <div style={{ width: "14rem" }}>
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

        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", marginLeft: "auto" }}>
          <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Sort
          </span>
          <select
            value={sortBy}
            onChange={(e) => updateParams({ sortBy: e.target.value })}
            style={CONTROL_STYLE}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => updateParams({ sortDir: sortDir === "asc" ? "desc" : "asc" })}
            style={{ ...CONTROL_STYLE, cursor: "pointer", padding: "0.375rem 0.5rem" }}
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
        </div>

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
          }}
        >
          Add copy
        </button>
      </div>

      {/* Holdings valuation total */}
      <HoldingsSummaryBar total={holdingsTotal} />

      {/* List */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          flex: 1,
          minHeight: "20rem",
          background: "var(--color-bg-elevated)",
        }}
      >
        {isLoading && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            Loading copies…
          </div>
        )}

        {!isLoading && allCopies.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {hasActiveFilters
              ? "No copies match these filters."
              : "No copies yet. Add your first physical copy."}
          </div>
        )}

        {allCopies.length > 0 && (
          <div>
            <InventoryCopyList
              copies={allCopies}
              areas={areas}
              locations={locations}
              baseCurrency={baseCurrency}
              hasNextPage={!!hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onLoadMore={fetchNextPage}
              onEdit={(it) => setDialog({ kind: "edit", item: it })}
              onIdentify={(it) => setDialog({ kind: "identify", item: it })}
              onViewHistory={(it) => setDialog({ kind: "history", item: it })}
              onDelete={(it) => setDialog({ kind: "delete", item: it })}
            />
          </div>
        )}
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
          baseCurrency={baseCurrency}
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
