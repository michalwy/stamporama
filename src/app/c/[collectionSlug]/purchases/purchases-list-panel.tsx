"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  LIST_BANNER_STYLE,
  STICKY_TOOLBAR_STYLE,
} from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { FILTER_CONTROL_STYLE, FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { FilterSlot } from "@/app/c/[collectionSlug]/shared/filter-popover";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import type { PurchaseListItem, PurchaseSortBy, PurchaseStatus } from "@/lib/purchases";
import {
  INTAKE_DOCUMENT_TYPES,
  INTAKE_PARTY_NONE,
  type PurchaseKind,
} from "@/lib/purchase-kind";
import {
  useIntakeParties,
  usePurchasesInfinite,
  useInvalidatePurchases,
  type PurchaseFilters,
} from "./use-purchases-query";
import { intakeViewNarrowings, intakeViewOffersStatus, type IntakeNarrowing } from "./intake-view-params";
import { useIntakeView } from "./use-intake-view";
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
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateList, invalidateContacts } = useInvalidatePurchases();

  // The platforms and suppliers on the documents (#1392): the two filters' options, and what a
  // remembered id is checked against before it is applied.
  const { data: parties } = useIntakeParties(collectionId);
  const knownParties = useMemo(
    () =>
      parties
        ? new Set([...parties.platforms, ...parties.suppliers].map((p) => p.id))
        : undefined,
    [parties]
  );

  // Every setting on the toolbar is in the address and remembered per collection (#1392), so the
  // list comes back as it was left however it is reached — `use-intake-view.ts`.
  const { view, setView, clearFilters } = useIntakeView(
    collectionId,
    `/c/${collectionSlug}/purchases`,
    knownParties
  );
  const { type, status, platforms, suppliers, sortBy, sortDir } = view;
  // A delivery status is a purchase's own (#1323): under *Opening balances* there is none to filter
  // by, so the status toggles are not drawn — and none is in force (`resolveIntakeView`).
  const showStatus = intakeViewOffersStatus(type);

  const filters: PurchaseFilters = useMemo(
    () => ({ type, status, platformIds: platforms, supplierIds: suppliers, sortBy, sortDir }),
    [type, status, platforms, suppliers, sortBy, sortDir]
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

  const narrowings = intakeViewNarrowings(view);
  const hasActiveFilters = narrowings.length > 0;

  /** One narrowing as the band names it — in the words of the control that set it, so it can be
   * found on the toolbar and switched off there as well as by *Clear filters*. */
  function narrowingLabel(n: IntakeNarrowing): string {
    switch (n.key) {
      case "type":
        return INTAKE_DOCUMENT_TYPES.find((t) => t.value === n.value)?.label ?? n.value;
      case "status":
        return STATUS_FILTERS.find((f) => f.value === n.value)?.label ?? n.value;
      case "platforms":
        return `Platform: ${partyNames(n.value, parties?.platforms, "No platform", "Unknown platform")}`;
      case "suppliers":
        return `Supplier: ${partyNames(n.value, parties?.suppliers, "No supplier", "Unknown supplier")}`;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Toolbar — pinned while the rows scroll under it (#358). Unlike the card-embedded
          `ListToolbar`, this one sits on the page, so it carries the page background and a
          little padding of its own to stay opaque. The narrowed-list band is inside the same
          sticky block (#848), so it stays on screen exactly while the rows are being scrolled. */}
      <div
        style={{
          ...STICKY_TOOLBAR_STYLE,
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          padding: "0.5rem 0",
          background: "var(--color-bg-page)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
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
                onClick={() => setView({ type: type === value ? undefined : value })}
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
                    onClick={() => setView({ status: active ? undefined : value })}
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

          {/* Platform and supplier (#1392). Multi-select, each with a *none* value for documents
              recorded without one — an opening balance carries neither, so it is found there and
              under no named party. Only parties that appear on a document are offered. */}
          <FilterSlot width="10rem">
            <MultiSelectFilter
              fullWidth
              options={[
                { id: INTAKE_PARTY_NONE, label: "No platform" },
                ...(parties?.platforms ?? []).map((p) => ({ id: p.id, label: p.name })),
              ]}
              selected={platforms}
              onChange={(ids) => setView({ platforms: ids })}
              allLabel="All platforms"
              itemNoun="platforms"
              ariaLabel="Filter by platform"
            />
          </FilterSlot>
          {/* Searchable, because a collection's suppliers run to hundreds where its platforms are a
              handful. */}
          <FilterSlot width="10rem">
            <MultiSelectFilter
              fullWidth
              options={[
                { id: INTAKE_PARTY_NONE, label: "No supplier" },
                ...(parties?.suppliers ?? []).map((p) => ({ id: p.id, label: p.name })),
              ]}
              selected={suppliers}
              onChange={(ids) => setView({ suppliers: ids })}
              allLabel="All suppliers"
              itemNoun="suppliers"
              ariaLabel="Filter by supplier"
              searchPlaceholder="Search suppliers…"
            />
          </FilterSlot>

          <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", marginLeft: "auto" }}>
            <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Sort
            </span>
            <select
              value={sortBy}
              onChange={(e) => setView({ sortBy: e.target.value as PurchaseSortBy })}
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
                onClick={() => setView({ sortDir: sortDir === "asc" ? "desc" : "asc" })}
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

        {/* **A narrowed list says so** (#1392, the auction lots list's band, #1018). Every filter here
            is restored on arrival, so the list opened today can be narrowed by a choice made last
            week, and a forgotten filter must never read as missing documents. It names each filter in
            the words of its control, and clears them all in one press; the sort is not a filter and
            stays. Drawn only while something narrows — its absence is the statement that nothing does. */}
        {hasActiveFilters && (
          <div style={LIST_BANNER_STYLE}>
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-primary)" }}>
              This list is narrowed — {narrowings.map(narrowingLabel).join(" · ")}
            </span>
            <button
              type="button"
              onClick={clearFilters}
              style={{
                ...FILTER_CONTROL_STYLE,
                marginLeft: "auto",
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "var(--color-accent)",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              Clear filters
            </button>
          </div>
        )}
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

/** The parties a filter is set to, by name — *none* as the control's own option says it, and an id
 * no document carries any more (a link that has aged) as the bare word rather than a raw id. */
function partyNames(
  ids: readonly string[],
  known: { id: string; name: string }[] | undefined,
  noneLabel: string,
  unknownLabel: string
): string {
  return ids
    .map((id) =>
      id === INTAKE_PARTY_NONE ? noneLabel : (known?.find((p) => p.id === id)?.name ?? unknownLabel)
    )
    .join(", ");
}
