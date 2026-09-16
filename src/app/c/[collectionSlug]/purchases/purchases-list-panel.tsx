"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { STICKY_TOOLBAR_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { FILTER_CONTROL_STYLE, FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import type { PurchaseListItem, PurchaseSortBy, PurchaseStatus } from "@/lib/purchases";
import {
  INTAKE_DOCUMENT_TYPES,
  isIntakeDocumentType,
  type PurchaseKind,
} from "@/lib/purchase-kind";
import {
  usePurchasesInfinite,
  useInvalidatePurchases,
  type PurchaseFilters,
} from "./use-purchases-query";
import { PurchaseFormDialog } from "./purchase-form-dialog";
import { PurchaseRow } from "./purchase-row";
import { useToast } from "@/app/toast-provider";

type DialogState =
  | { kind: "none" }
  | { kind: "add"; document: PurchaseKind }
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

  const typeParam = searchParams.get("type");
  const type = isIntakeDocumentType(typeParam) ? typeParam : undefined;
  // A delivery status is a purchase's own (#1323): under *Opening balances* there is none to filter
  // by, so the status chips are not drawn and a stale `status` in the address is not applied.
  const showStatus = type !== "opening_balance";
  const statusParam = searchParams.get("status") as PurchaseStatus | null;
  const status = showStatus && statusParam && STATUS_FILTERS.some((s) => s.value === statusParam)
    ? statusParam
    : undefined;
  const sortBy = (searchParams.get("sortBy") as PurchaseSortBy) || "purchasedAt";
  const sortDir = (searchParams.get("sortDir") as "asc" | "desc") || "desc";

  const filters: PurchaseFilters = useMemo(
    () => ({ type, status, sortBy, sortDir }),
    [type, status, sortBy, sortDir]
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

  // Confirmation toasts (#541). Creation is *not* one of them: it navigates straight to the new
  // purchase (#139), and arriving on the thing you made is a better confirmation than a note saying
  // you made it. What gets a toast is the edit and the delete, both of which leave you on the list.
  const { toast } = useToast();

  const hasActiveFilters = !!status || !!type;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Toolbar — pinned while the rows scroll under it (#358). Unlike the card-embedded
          `ListToolbar`, this one sits on the page, so it carries the page background and a
          little padding of its own to stay opaque. */}
      <div
        style={{
          ...STICKY_TOOLBAR_STYLE,
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          padding: "0.5rem 0",
          background: "var(--color-bg-page)",
        }}
      >
        {/* The document type (#1323): purchases, the orders trades create, and opening balances are
            one list, told apart here rather than by a navigation entry each. */}
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
          {INTAKE_DOCUMENT_TYPES.map(({ value, label }) => (
            <FilterChip
              key={value}
              label={label}
              active={type === value}
              onClick={() => updateParams({ type: type === value ? "" : value })}
            />
          ))}
        </div>

        {showStatus && (
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
          {STATUS_FILTERS.map(({ value, label }) => {
            const active = status === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => updateParams({ status: active ? "" : value })}
                style={{
                  ...FILTER_CONTROL_STYLE,
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
        )}

        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", marginLeft: "auto" }}>
          <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Sort
          </span>
          <select
            value={sortBy}
            onChange={(e) => updateParams({ sortBy: e.target.value })}
            style={FILTER_CONTROL_STYLE}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Tooltip content={sortDir === "asc" ? "Ascending" : "Descending"}>
            <button
              type="button"
              onClick={() => updateParams({ sortDir: sortDir === "asc" ? "desc" : "asc" })}
              aria-label={sortDir === "asc" ? "Ascending" : "Descending"}
              style={{ ...FILTER_CONTROL_STYLE, cursor: "pointer", padding: "0.375rem 0.5rem" }}
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </Tooltip>
        </div>

        {/* Two doors, one per document (#1323). An opening balance is created here, beside the
            purchases it is listed with, rather than from a screen of its own. */}
        <button
          type="button"
          onClick={() => setDialog({ kind: "add", document: "opening_balance" })}
          style={{
            ...FILTER_CONTROL_STYLE,
            cursor: "pointer",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            padding: "0.375rem 0.875rem",
          }}
        >
          Add opening balance
        </button>
        <button
          type="button"
          onClick={() => setDialog({ kind: "add", document: "purchase" })}
          style={{
            ...FILTER_CONTROL_STYLE,
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
            Loading intake documents…
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {hasActiveFilters
              ? "No intake documents match this filter."
              : "Nothing here yet. Record a purchase, or an opening balance for stamps you already own."}
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
          kind={dialog.kind === "add" ? dialog.document : undefined}
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
                const purchaseId = dialog.purchase.id;
                const result = await updatePurchaseAction(purchaseId, fd);
                if (result.status === "success") {
                  handleSuccess();
                  const opening = dialog.purchase.kind === "opening_balance";
                  toast({
                    message: opening ? "Opening balance saved" : "Purchase saved",
                    href: `/c/${collectionSlug}/purchases/${purchaseId}`,
                    linkLabel: opening ? "Open opening balance" : "Open purchase",
                  });
                } else if (result.status === "error") setActionError(result.message);
              }
            });
          }}
        />
      )}

      {/* Delete confirmation */}
      {dialog.kind === "delete" && (
        <ConfirmDialog
          title={dialog.purchase.kind === "opening_balance" ? "Delete opening balance" : "Delete purchase"}
          message={
            dialog.purchase.kind === "opening_balance"
              ? "This permanently removes this opening balance and its lots. This cannot be undone."
              : "This permanently removes this purchase and its lot and expense lines. This cannot be undone."
          }
          actionLabel={dialog.purchase.kind === "opening_balance" ? "Delete opening balance" : "Delete purchase"}
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { deletePurchaseAction } = await import("@/app/actions/purchases");
              const result = await deletePurchaseAction(dialog.purchase.id);
              if (result.status === "success") {
                handleSuccess();
                toast({
                  message:
                    dialog.purchase.kind === "opening_balance"
                      ? "Opening balance deleted"
                      : "Purchase deleted",
                });
              } else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}
