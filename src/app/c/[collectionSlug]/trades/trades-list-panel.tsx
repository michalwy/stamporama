"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { STICKY_TOOLBAR_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import {
  ListSearchBox,
  useDebouncedSearch,
} from "@/app/c/[collectionSlug]/shared/list-search-box";
import { FilterChip, FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import type { TradeListItem, TradeSortBy } from "@/lib/trades";
import {
  TRADE_STATUSES,
  TRADE_STATUS_LABEL,
  isTradeStatus,
  type TradeStatus,
} from "@/lib/trade-rules";
import { useTradesInfinite, useInvalidateTrades, type TradeFilters } from "./use-trades-query";
import { TradeFormDialog, type TradeCatalogVendor } from "./trade-form-dialog";
import { TradeRow } from "./trade-row";
import { useToast } from "@/app/toast-provider";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; trade: TradeListItem }
  | { kind: "delete"; trade: TradeListItem };

const SORT_OPTIONS: { value: TradeSortBy; label: string }[] = [
  { value: "createdAt", label: "Date added" },
  { value: "tradeNo", label: "Trade number" },
];

interface TradesListPanelProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  /** The catalog **vendors** a trade can be agreed in — Michel, StampWorld — never their individual
   * books, since a trade routinely spans more areas than one book covers. */
  catalogVendors: TradeCatalogVendor[];
}

/**
 * The trades list (#646; ADR-0039).
 *
 * Filtered and paged **on the server**, like purchases and unlike the want list: a trade holds tens
 * of lines each and the list is meant to survive years of them.
 *
 * The status filter and the search live in the URL, which is what makes the quick jump work — `t 7`
 * lands here with `?search=#7`, and the same box a collector types a partner's name into is the one
 * that number arrives in. Which of the two a query is, is decided server-side so the box and the
 * jump cannot come to disagree.
 */
export function TradesListPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  catalogVendors,
}: TradesListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateList, invalidatePartners } = useInvalidateTrades();
  const { toast } = useToast();

  const statusParam = searchParams.get("status");
  const status: TradeStatus | undefined =
    statusParam && isTradeStatus(statusParam) ? statusParam : undefined;
  const search = searchParams.get("search") ?? "";
  const sortBy = (searchParams.get("sortBy") as TradeSortBy) || "createdAt";
  const sortDir = (searchParams.get("sortDir") as "asc" | "desc") || "desc";

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/trades${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const [searchValue, setSearchValue] = useDebouncedSearch(search, (value) =>
    updateParams({ search: value })
  );

  const filters: TradeFilters = useMemo(
    () => ({ status, search: search || undefined, sortBy, sortDir }),
    [status, search, sortBy, sortDir]
  );

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = useTradesInfinite(
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

  function handleSuccess() {
    setDialog({ kind: "none" });
    setActionError(undefined);
    invalidateList(collectionId);
    // A save may have created the partner on the fly; refresh the picker's cache.
    invalidatePartners(collectionId);
  }

  function setStatus(trade: TradeListItem, next: TradeStatus) {
    startTransition(async () => {
      const { setTradeStatusAction } = await import("@/app/actions/trades");
      const result = await setTradeStatusAction(trade.id, next);
      if (result.status === "success") {
        invalidateList(collectionId);
        toast({ message: `Trade #${trade.tradeNo} — ${TRADE_STATUS_LABEL[next].toLowerCase()}` });
      } else {
        // A refused transition is the point of the rule, so it is said out loud rather than
        // swallowed: a menu entry that appears to do nothing reads as a broken button.
        toast({ message: result.message });
      }
    });
  }

  const hasActiveFilters = !!status || !!search;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
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
        <ListSearchBox
          value={searchValue}
          onChange={setSearchValue}
          placeholder="Partner name, or #7…"
          label="Search trades"
          width="16rem"
        />

        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
          {TRADE_STATUSES.map((value) => (
            <FilterChip
              key={value}
              label={TRADE_STATUS_LABEL[value]}
              active={status === value}
              onClick={() => updateParams({ status: status === value ? "" : value })}
            />
          ))}
        </div>

        <div
          style={{ display: "flex", gap: "0.375rem", alignItems: "center", marginLeft: "auto" }}
        >
          <span
            style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Sort
          </span>
          <select
            value={sortBy}
            onChange={(e) => updateParams({ sortBy: e.target.value })}
            style={{ ...FILTER_CONTROL_STYLE, cursor: "pointer" }}
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
              style={{
                ...FILTER_CONTROL_STYLE,
                cursor: "pointer",
                padding: "0.375rem 0.5rem",
              }}
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </Tooltip>
        </div>

        <button
          type="button"
          onClick={() => setDialog({ kind: "add" })}
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
          Add trade
        </button>
      </div>

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
            Loading trades…
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {hasActiveFilters
              ? "No trades match this filter."
              : "No trades yet. Start one with an exchange partner."}
          </div>
        )}

        {rows.length > 0 && (
          <>
            {rows.map((t, idx) => (
              <TradeRow
                key={t.id}
                trade={t}
                collectionSlug={collectionSlug}
                isLast={idx === rows.length - 1 && !hasNextPage}
                onEdit={(row) => setDialog({ kind: "edit", trade: row })}
                onSetStatus={setStatus}
                onDelete={(row) => setDialog({ kind: "delete", trade: row })}
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

      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <TradeFormDialog
          mode={dialog.kind}
          collectionId={collectionId}
          baseCurrency={baseCurrency}
          catalogVendors={catalogVendors}
          trade={dialog.kind === "edit" ? dialog.trade : undefined}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            startTransition(async () => {
              if (dialog.kind === "add") {
                const { createTradeAction } = await import("@/app/actions/trades");
                const result = await createTradeAction(collectionId, fd);
                if (result.status === "success") {
                  handleSuccess();
                  // Straight to the new trade (#637): a trade is created in order to be filled in,
                  // and the empty section waiting for its first line is the next thing to do. No
                  // toast — the screen arriving *is* the confirmation.
                  router.push(`/c/${collectionSlug}/trades/${result.id}`);
                } else if (result.status === "error") setActionError(result.message);
              } else if (dialog.kind === "edit") {
                const { updateTradeAction } = await import("@/app/actions/trades");
                const result = await updateTradeAction(dialog.trade.id, fd);
                if (result.status === "success") {
                  handleSuccess();
                  toast({ message: "Trade saved" });
                } else if (result.status === "error") setActionError(result.message);
              }
            });
          }}
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete trade"
          message="This permanently removes this trade, its sections and both sides' lines. The copies it named stay in the collection. This cannot be undone."
          actionLabel="Delete trade"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { deleteTradeAction } = await import("@/app/actions/trades");
              const result = await deleteTradeAction(dialog.trade.id);
              if (result.status === "success") {
                handleSuccess();
                toast({ message: "Trade deleted" });
              } else if (result.status === "error") setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}
