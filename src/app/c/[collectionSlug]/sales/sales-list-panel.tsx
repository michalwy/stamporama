"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { SEARCH_INPUT_STYLE, useDebouncedValue } from "@/app/c/[collectionSlug]/shared/autocomplete";
import type { SaleListItem } from "@/lib/sales";
import {
  useSalesInfinite,
  useSalePlatforms,
  useInvalidateSales,
  type SaleFilters,
} from "./use-sales-query";
import { FilterChip, FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { SALE_STATUS_ORDER, SALE_STATUS_META } from "./sale-status";
import { isSaleStatus } from "@/lib/sale-status";
import { SaleRow } from "./sale-row";
import { SaleFormDialog } from "./sale-form-dialog";

type DialogState =
  | { kind: "none" }
  | { kind: "record" }
  | { kind: "delete"; sale: SaleListItem };

interface SalesListPanelProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  today: string;
}

export function SalesListPanel({ collectionId, collectionSlug, baseCurrency, today }: SalesListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateSales();
  const { data: platforms = [] } = useSalePlatforms(collectionId);

  const platformId = searchParams.get("platform") || undefined;
  const search = searchParams.get("search") || undefined;

  // Fulfillment-status filter (#392), remembered per collection (#325): the URL stays authoritative
  // when it names one, so a link is still shareable, and a fresh navigation falls back to the last
  // chip picked here. Every change writes both, so clearing the filter clears the memory of it too.
  const [storedStatus, rememberStatusFilter] = usePersistedCollectionValue(
    "sales-status",
    collectionId
  );
  const statusParam = searchParams.has("status")
    ? (searchParams.get("status") ?? "")
    : (storedStatus ?? "");
  const status = isSaleStatus(statusParam) ? statusParam : undefined;

  const filters: SaleFilters = useMemo(
    () => ({ platformId, status, search }),
    [platformId, status, search]
  );

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/sales${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  // Debounced search box (#193): mirrors the shared ListToolbar — settle the local input, then
  // push it to the URL, skipping the initial mount so an empty box doesn't clear the param.
  const [localSearch, setLocalSearch] = useState(search ?? "");
  const debouncedSearch = useDebouncedValue(localSearch);
  const updateParamsRef = useRef(updateParams);
  useEffect(() => {
    updateParamsRef.current = updateParams;
  });
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    updateParamsRef.current({ search: debouncedSearch });
  }, [debouncedSearch]);

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = useSalesInfinite(
    collectionId,
    filters
  );
  const rows = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  function closeDialog() {
    if (!isPending) {
      setDialog({ kind: "none" });
      setActionError(undefined);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "0 1 20rem", minWidth: "12rem" }}>
          <input
            type="text"
            placeholder="Search buyer, platform, item…"
            aria-label="Search sales"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            style={{ ...SEARCH_INPUT_STYLE, width: "100%", paddingRight: "1.75rem" }}
          />
          {localSearch && (
            <Tooltip
              content="Clear search"
              style={{
                position: "absolute",
                right: "0.375rem",
                top: "50%",
                transform: "translateY(-50%)",
              }}
            >
              <button
                type="button"
                onClick={() => setLocalSearch("")}
                aria-label="Clear search"
                tabIndex={-1}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  fontSize: "0.75rem",
                  padding: "0 0.25rem",
                }}
              >
                ✕
              </button>
            </Tooltip>
          )}
        </div>
        <select
          aria-label="Filter by platform"
          value={platformId ?? ""}
          onChange={(e) => updateParams({ platform: e.target.value })}
          style={{ ...FILTER_CONTROL_STYLE, cursor: "pointer" }}
        >
          <option value="">All platforms</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {/* Fulfillment status (#191/#392) — chips rather than a second select, so where a sale has
            got to is readable without opening anything. */}
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
          {SALE_STATUS_ORDER.map((value) => {
            const active = status === value;
            return (
              <FilterChip
                key={value}
                label={SALE_STATUS_META[value].label}
                active={active}
                onClick={() => {
                  const next = active ? "" : value;
                  rememberStatusFilter(next);
                  updateParams({ status: next });
                }}
              />
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setDialog({ kind: "record" })}
          style={{
            ...FILTER_CONTROL_STYLE,
            marginLeft: "auto",
            cursor: "pointer",
            fontWeight: 600,
            color: "#fff",
            background: "var(--color-action-primary)",
            border: "none",
            padding: "0.375rem 0.875rem",
          }}
        >
          Record sale
        </button>
      </div>

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
            Loading sales…
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {search
              ? "No sales match your search."
              : status
                ? `No ${SALE_STATUS_META[status].label.toLowerCase()} sales${platformId ? " on this platform" : ""}.`
                : platformId
                  ? "No sales on this platform yet."
                  : "No sales yet. Record a sale when a listed lot sells on a marketplace."}
          </div>
        )}

        {rows.length > 0 && (
          <>
            {rows.map((sale, idx) => (
              <SaleRow
                key={sale.id}
                sale={sale}
                collectionSlug={collectionSlug}
                isLast={idx === rows.length - 1 && !hasNextPage}
                onDelete={(row) => setDialog({ kind: "delete", sale: row })}
              />
            ))}
            <InfiniteScrollSentinel
              onLoadMore={fetchNextPage}
              hasMore={!!hasNextPage}
              isLoading={isFetchingNextPage}
            />
          </>
        )}
      </div>

      {/* Record sale — create the header, then open its detail to add sold units. */}
      {dialog.kind === "record" && (
        <SaleFormDialog
          mode="add"
          collectionId={collectionId}
          baseCurrency={baseCurrency}
          today={today}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(raw) => {
            setActionError(undefined);
            startTransition(async () => {
              const { createSaleAction } = await import("@/app/actions/sales");
              const result = await createSaleAction(collectionId, raw);
              if (result.status === "success") {
                invalidateAll(collectionId);
                router.push(`/c/${collectionSlug}/sales/${result.id}`);
              } else {
                setActionError(result.message);
              }
            });
          }}
        />
      )}

      {/* Delete sale */}
      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete sale"
          message="This removes the sale record. The copies it retired become available again and any offers it marked sold return to active. This cannot be undone."
          actionLabel="Delete sale"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { deleteSaleAction } = await import("@/app/actions/sales");
              const result = await deleteSaleAction(dialog.sale.id);
              if (result.status === "success") {
                setDialog({ kind: "none" });
                invalidateAll(collectionId);
              } else {
                setActionError(result.message);
              }
            });
          }}
        />
      )}
    </div>
  );
}
