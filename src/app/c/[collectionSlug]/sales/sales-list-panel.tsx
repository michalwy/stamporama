"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import {
  ListSearchBox,
  useDebouncedSearch,
} from "@/app/c/[collectionSlug]/shared/list-search-box";
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
import { useToast } from "@/app/toast-provider";

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
  const { toast } = useToast();
  const { data: platforms = [] } = useSalePlatforms(collectionId);

  const platformId = searchParams.get("platform") || undefined;

  // Fulfillment-status filter (#392), remembered per collection (#325): the URL stays authoritative
  // when it names one, so a link is still shareable, and a fresh navigation falls back to the last
  // chip picked here. Every change writes both, so clearing the filter clears the memory of it too.
  //
  // Several chips can be on at once (#475), so the stored value and the URL param both carry a
  // comma-separated set. Unrecognised tokens are dropped rather than refused, exactly as the route
  // drops them: a stale link narrows to nothing otherwise.
  const [storedStatus, rememberStatusFilter] = usePersistedCollectionValue(
    "sales-status",
    collectionId
  );
  const statusParam = searchParams.has("status")
    ? (searchParams.get("status") ?? "")
    : (storedStatus ?? "");
  const statuses = useMemo(() => statusParam.split(",").filter(isSaleStatus), [statusParam]);

  // The search is remembered too (#1055), by the same rule and in the same spelling as the auction
  // sales list' (`auction-sale-search`, #496): the URL wins where it names one, the stored value
  // fills in otherwise, and every change writes both.
  //
  // **This list is a worklist, which is the whole of why.** #1028's rule tracks a search where the
  // list is one and leaves it alone where the list is a catalogue, and #496's argument for the
  // auction settlement list transfers here without amendment: *what do I still owe for* — or here,
  // *what have I still to pack and send* — is the question one comes back to, not one asked once.
  // The Copies list is the contrast and keeps its search untracked (#693): there a phrase is a
  // lookup one finishes. Decided by the user on 2026-09-10; it classifies this list under the rule
  // and does not touch the rule.
  //
  // What makes remembering it honest is a property of the control rather than a promise: the box
  // draws the restored phrase, with its clear ✕ beside it, before the collector has done anything —
  // see `useDebouncedSearch`, which follows the value in force rather than only seeding from it.
  const [storedSearch, rememberSearch] = usePersistedCollectionValue("sales-search", collectionId);
  const search = (searchParams.has("search") ? searchParams.get("search") : storedSearch) || "";

  // "Only the sales still waiting on which set went" (#697). A filter of its own rather than a chip
  // among the statuses: it is not a place in the fulfilment lifecycle but a decision outstanding
  // *inside* a sale, and a sale can be waiting on it in any status. URL-only and **not** remembered
  // per collection like the status set is — it answers a question one comes to the list with today,
  // and a remembered one would silently hide every settled sale on the next visit.
  const setChoicePending = searchParams.get("setChoice") === "1";

  const filters: SaleFilters = useMemo(
    () => ({ platformId, statuses, search: search || undefined, setChoicePending }),
    [platformId, statuses, search, setChoicePending]
  );

  // Seed the Record a Sale dialog's platform from the list's own filter (#464): a sale being
  // recorded while looking at one marketplace is a sale on it. Left editable — it is a pre-fill,
  // not the quick-sell flow's locked platform (#225). Its currency travels with it, or the dialog's
  // locked-currency field (#196) would fall back to the base currency.
  const filterPlatform = useMemo(
    () => platforms.find((p) => p.id === platformId),
    [platforms, platformId]
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

  // Debounced search box (#193), now the shared one (#1055): settle the local input, then write it
  // to the URL and to the remembered value together. This screen carried its own copy of the box
  // and of the debounce — the copy `list-search-box.tsx` was extracted *from* (#484) and the one
  // caller never migrated onto it — and a fourth spelling of "remember a search" is exactly what
  // the extraction exists to prevent.
  const [localSearch, setLocalSearch] = useDebouncedSearch(search, (value) => {
    rememberSearch(value);
    updateParams({ search: value });
  });

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
        {/* Find one sale by who bought it, where, or what was in it (#193). The box keeps its own
            20rem basis, which is what it had before it became the shared control. */}
        <ListSearchBox
          value={localSearch}
          onChange={setLocalSearch}
          placeholder="Search buyer, platform, item…"
          label="Search sales"
          width="20rem"
        />
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
            got to is readable without opening anything. Multi-select (#475): a sale is in exactly
            one status, but the question asked of the list is routinely a group of them ("what is
            paid but not yet sent"), so a chip toggles its own status in and out of the set. */}
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
          {SALE_STATUS_ORDER.map((value) => {
            const active = statuses.includes(value);
            return (
              <FilterChip
                key={value}
                label={SALE_STATUS_META[value].label}
                active={active}
                onClick={() => {
                  // Kept in lifecycle order however they were clicked, so the stored value and the
                  // shared link read the same for one selection whatever route reached it.
                  const next = SALE_STATUS_ORDER.filter((s) =>
                    s === value ? !active : statuses.includes(s)
                  ).join(",");
                  rememberStatusFilter(next);
                  updateParams({ status: next });
                }}
              />
            );
          })}
        </div>

        {/* Drawn apart from the status chips, after a separator, because it selects on a different
            axis — see the note above `setChoicePending`. */}
        <FilterChip
          label="Set not chosen"
          active={setChoicePending}
          onClick={() => updateParams({ setChoice: setChoicePending ? "" : "1" })}
        />

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
              : setChoicePending
              ? "Every sale has had its sets chosen — nothing is waiting on that decision."
              : statuses.length > 0
                ? `No ${statuses
                    .map((s) => SALE_STATUS_META[s].label.toLowerCase())
                    .join(" or ")} sales${platformId ? " on this platform" : ""}.`
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
          initialPlatform={filterPlatform}
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
                // Confirmation toast (#541). Worth saying because deleting a sale does more than
                // remove a row — it puts stock and listings back — and none of that is visible from
                // the sales list. Creation gets none: it navigates to the new sale.
                toast({
                  message: "Sale deleted — its copies are available again and its offers are active",
                });
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
