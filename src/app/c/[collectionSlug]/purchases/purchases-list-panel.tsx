"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import type { PurchaseListItem, PurchaseSortBy, PurchaseStatus } from "@/lib/purchases";
import {
  usePurchasesInfinite,
  useInvalidatePurchases,
  type PurchaseFilters,
} from "./use-purchases-query";
import { PurchaseFormDialog } from "./purchase-form-dialog";
import { PurchaseRow } from "./purchase-row";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; purchase: PurchaseListItem }
  | { kind: "delete"; purchase: PurchaseListItem };

const STATUS_FILTERS: { value: PurchaseStatus; label: string }[] = [
  { value: "preparing", label: "Preparing" },
  { value: "in_transit", label: "In transit" },
  { value: "arrived", label: "Arrived" },
];

const SORT_OPTIONS: { value: PurchaseSortBy; label: string }[] = [
  { value: "purchasedAt", label: "Purchase date" },
  { value: "createdAt", label: "Date added" },
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

interface PurchasesListPanelProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  /** Today as yyyy-mm-dd, from the server page, so the new-purchase form defaults sanely
   * without touching the clock during SSR. */
  today: string;
}

export function PurchasesListPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  today,
}: PurchasesListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateList, invalidateContacts } = useInvalidatePurchases();

  const statusParam = searchParams.get("status") as PurchaseStatus | null;
  const status = statusParam && STATUS_FILTERS.some((s) => s.value === statusParam)
    ? statusParam
    : undefined;
  const sortBy = (searchParams.get("sortBy") as PurchaseSortBy) || "purchasedAt";
  const sortDir = (searchParams.get("sortDir") as "asc" | "desc") || "desc";

  const filters: PurchaseFilters = useMemo(
    () => ({ status, sortBy, sortDir }),
    [status, sortBy, sortDir]
  );

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/purchases${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    usePurchasesInfinite(collectionId, filters);

  const rows = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

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
    // A save may have created a supplier / platform on the fly; refresh the pickers' cache.
    invalidateContacts(collectionId);
  }

  const hasActiveFilters = !!status;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
          {STATUS_FILTERS.map(({ value, label }) => {
            const active = status === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => updateParams({ status: active ? "" : value })}
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
          Add purchase
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
            Loading purchases…
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {hasActiveFilters
              ? "No purchases match this filter."
              : "No purchases yet. Record your first acquisition."}
          </div>
        )}

        {rows.length > 0 && (
          <>
            {rows.map((p, idx) => (
              <PurchaseRow
                key={p.id}
                purchase={p}
                collectionSlug={collectionSlug}
                isLast={idx === rows.length - 1 && !hasNextPage}
                onEdit={(row) => setDialog({ kind: "edit", purchase: row })}
                onDelete={(row) => setDialog({ kind: "delete", purchase: row })}
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

      {/* Add / edit dialog */}
      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <PurchaseFormDialog
          mode={dialog.kind}
          collectionId={collectionId}
          baseCurrency={baseCurrency}
          today={today}
          purchase={dialog.kind === "edit" ? dialog.purchase : undefined}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            startTransition(async () => {
              if (dialog.kind === "add") {
                const { createPurchaseAction } = await import("@/app/actions/purchases");
                const result = await createPurchaseAction(collectionId, fd);
                if (result.status === "success") {
                  // Take the user straight to the new purchase's detail view (#139).
                  // Refresh the list/contacts caches so they're current when the user returns.
                  invalidateList(collectionId);
                  invalidateContacts(collectionId);
                  router.push(`/c/${collectionSlug}/purchases/${result.id}`);
                } else if (result.status === "error") setActionError(result.message);
              } else if (dialog.kind === "edit") {
                const { updatePurchaseAction } = await import("@/app/actions/purchases");
                const result = await updatePurchaseAction(dialog.purchase.id, fd);
                if (result.status === "success") handleSuccess();
                else if (result.status === "error") setActionError(result.message);
              }
            });
          }}
        />
      )}

      {/* Delete confirmation */}
      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete purchase"
          message="This permanently removes this purchase and its lot and expense lines. This cannot be undone."
          actionLabel="Delete purchase"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { deletePurchaseAction } = await import("@/app/actions/purchases");
              const result = await deletePurchaseAction(dialog.purchase.id);
              if (result.status === "success") handleSuccess();
              else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}
