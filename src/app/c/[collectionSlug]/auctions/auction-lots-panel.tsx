"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ConfirmDialog } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { STICKY_TOOLBAR_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { usePersistedFlag } from "@/app/c/[collectionSlug]/shared/use-persisted-flag";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import {
  AUCTION_LOT_STATUSES,
  AUCTION_LOT_STATUS_LABEL,
  isAuctionLotStatus,
} from "@/lib/auction-rules";
import {
  useAuctionLotCounts,
  useAuctionLotsInfinite,
  useAuctionParties,
  useInvalidateAuctions,
  type AuctionClosingWindow,
  type LotSignal,
  type AuctionLotFilters,
  type AuctionLotView,
} from "./use-auctions-query";
import { AuctionLotRow } from "./auction-lot-row";
import { AuctionLotFormDialog } from "./auction-lot-form-dialog";
import { AuctionLotLinesDialog } from "./auction-lot-lines-dialog";
import { CONTROL_STYLE, FilterChip, SIGNALS } from "./auction-controls";

/** The closing windows offered on the toolbar. *Ended* is the one that earns its keep: those lots
 * are muted in the list on purpose, so this is how you go and find them. */
const CLOSING_WINDOWS: { value: AuctionClosingWindow; label: string }[] = [
  { value: "today", label: "Closing today" },
  { value: "week", label: "This week" },
  { value: "ended", label: "Ended" },
];

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; lot: AuctionLotView }
  | { kind: "lines"; lot: AuctionLotView }
  | { kind: "delete"; lot: AuctionLotView };

/**
 * The clock every row on the list ages against (closing times, staleness). One instant shared by
 * the whole list, refreshed each minute — per-row `new Date()` calls would disagree with each other
 * and re-render nothing when the minute turns.
 */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

interface AuctionLotsPanelProps {
  collectionId: string;
  collectionSlug: string;
  /** Needed by the composition editor (#353): the stamp picker browses by area, and catalog
   * numbers are prefix-formatted from each area's own vendor map (#357). */
  areas: CollectionAreaData[];
}

/**
 * The flat list of lots across every sale — the primary auction screen (ADR-0021 §9).
 *
 * The sale is a **column, not a level**: "everything I have running on Allegro" is a filter here
 * rather than a walk through per-seller parcels, because scanning closing times and refreshing bids
 * is the daily job while the settlement bucket only matters twice. Grouping by sale is available
 * and off by default, which is the same relationship the bulk listing workspace (#322) has with its
 * groups.
 */
export function AuctionLotsPanel({
  collectionId,
  collectionSlug,
  areas,
}: AuctionLotsPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const now = useMinuteClock();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateAuctions();
  const { data: parties } = useAuctionParties(collectionId);

  // Remembered filter selections, per collection, with the URL winning whenever it carries one —
  // the offers list's rule (#325), so a shared link still means exactly what it says.
  const [storedStatus, rememberStatus] = usePersistedCollectionValue("auction-status", collectionId);
  const [storedSeller, rememberSeller] = usePersistedCollectionValue("auction-seller", collectionId);
  const [storedPlatform, rememberPlatform] = usePersistedCollectionValue(
    "auction-platform",
    collectionId
  );

  const statusRaw = searchParams.has("status")
    ? (searchParams.get("status") ?? "")
    : (storedStatus ?? "");
  const status = isAuctionLotStatus(statusRaw) ? statusRaw : undefined;

  // Only a *stored* party is checked against the loaded lists: one whose sales have since gone
  // would silently narrow the list to nothing, and unlike a link nobody typed it this time.
  const sellerFromUrl = searchParams.has("seller") ? (searchParams.get("seller") ?? "") : null;
  const sellerId =
    (sellerFromUrl ??
      (storedSeller && parties?.sellers.some((s) => s.id === storedSeller) ? storedSeller : "")) ||
    undefined;
  const platformFromUrl = searchParams.has("platform") ? (searchParams.get("platform") ?? "") : null;
  const platformId =
    (platformFromUrl ??
      (storedPlatform && parties?.platforms.some((p) => p.id === storedPlatform)
        ? storedPlatform
        : "")) ||
    undefined;

  // Closing-time window. Deliberately **not** remembered between visits, unlike the other filters:
  // "ended" is a job you go and do, and coming back tomorrow to a list silently narrowed to old
  // lots would hide everything that is actually running.
  const closingRaw = searchParams.get("closing") ?? "";
  const closing = CLOSING_WINDOWS.some((w) => w.value === closingRaw)
    ? (closingRaw as AuctionClosingWindow)
    : undefined;

  // Derived-state filter. Like the closing window it lives in the URL only — these are questions
  // asked of today's list ("what can I still bid on?"), not a view to come back to.
  const signalRaw = searchParams.get("signal") ?? "";
  const signal = SIGNALS.some((s) => s.value === signalRaw) ? (signalRaw as LotSignal) : undefined;

  const [groupBySale, setGroupBySale] = usePersistedFlag(
    `stamporama:auctions:groupBySale:${collectionId}`
  );

  const filters: AuctionLotFilters = useMemo(
    () => ({ status, closing, signal, sellerId, platformId }),
    [status, closing, signal, sellerId, platformId]
  );

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/auctions${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useAuctionLotsInfinite(collectionId, filters);
  const { data: counts } = useAuctionLotCounts(collectionId, filters);
  const rows = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  // Grouping is a presentation of the rows already loaded, exactly as the listing workspace groups
  // its batch (#322) — the server order is preserved within each group, so the reading order inside
  // a sale is the same one the ungrouped list gives.
  const groups = useMemo(() => {
    if (!groupBySale) return null;
    const bySale = new Map<string, { name: string; lots: AuctionLotView[] }>();
    for (const lot of rows) {
      const group = bySale.get(lot.saleId) ?? { name: lot.saleName, lots: [] };
      group.lots.push(lot);
      bySale.set(lot.saleId, group);
    }
    return [...bySale.entries()].map(([saleId, group]) => ({ saleId, ...group }));
  }, [rows, groupBySale]);

  function closeDialog() {
    if (!isPending) {
      setDialog({ kind: "none" });
      setActionError(undefined);
    }
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    setActionError(undefined);
    invalidateAll(collectionId);
  }

  /** Every inline edit takes the same path: run it, refresh the list (and the sale totals two
   * screens away), surface a refusal in the toolbar rather than silently reverting. */
  function runLotAction(action: () => Promise<{ status: "success" } | { status: "error"; message: string }>) {
    setActionError(undefined);
    startTransition(async () => {
      const result = await action();
      if (result.status === "success") invalidateAll(collectionId);
      else setActionError(result.message);
    });
  }

  const hasActiveFilters = !!status || !!closing || !!signal || !!sellerId || !!platformId;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Toolbar — pinned while the rows scroll under it (#358), carrying the page background so
          rows never show through it. */}
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
        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
          {/* What to do about a lot, before what became of it: on a live watchlist the derived
              states are the working set, while the recorded outcomes are how it is filed. */}
          {SIGNALS.map(({ value, label, hint }) => {
            const active = signal === value;
            return (
              <Tooltip key={value} content={hint}>
                <FilterChip
                  label={label}
                  count={counts ? counts.signals[value] : undefined}
                  active={active}
                  onClick={() => updateParams({ signal: active ? "" : value })}
                />
              </Tooltip>
            );
          })}
          <span
            style={{
              width: "1px",
              height: "1.25rem",
              background: "var(--color-border)",
              margin: "0 0.25rem",
            }}
          />
          {AUCTION_LOT_STATUSES.map((value) => {
            const active = status === value;
            return (
              <FilterChip
                key={value}
                label={AUCTION_LOT_STATUS_LABEL[value]}
                count={counts ? (counts.statuses[value] ?? 0) : undefined}
                active={active}
                onClick={() => {
                  const next = active ? "" : value;
                  rememberStatus(next);
                  updateParams({ status: next });
                }}
              />
            );
          })}
          <span
            style={{
              width: "1px",
              height: "1.25rem",
              background: "var(--color-border)",
              margin: "0 0.25rem",
            }}
          />
          {CLOSING_WINDOWS.map(({ value, label }) => {
            const active = closing === value;
            return (
              <FilterChip
                key={value}
                label={label}
                count={counts ? counts.closing[value] : undefined}
                active={active}
                onClick={() => updateParams({ closing: active ? "" : value })}
              />
            );
          })}
          <span
            style={{
              width: "1px",
              height: "1.25rem",
              background: "var(--color-border)",
              margin: "0 0.25rem",
            }}
          />
          <select
            aria-label="Filter by seller"
            value={sellerId ?? ""}
            onChange={(e) => {
              rememberSeller(e.target.value);
              updateParams({ seller: e.target.value });
            }}
            style={{ ...CONTROL_STYLE, cursor: "pointer" }}
          >
            <option value="">{counts ? `All sellers (${counts.total})` : "All sellers"}</option>
            {(parties?.sellers ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {counts ? `${s.name} (${counts.sellers[s.id] ?? 0})` : s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by platform"
            value={platformId ?? ""}
            onChange={(e) => {
              rememberPlatform(e.target.value);
              updateParams({ platform: e.target.value });
            }}
            style={{ ...CONTROL_STYLE, cursor: "pointer" }}
          >
            <option value="">{counts ? `All platforms (${counts.total})` : "All platforms"}</option>
            {(parties?.platforms ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {counts ? `${p.name} (${counts.platforms[p.id] ?? 0})` : p.name}
              </option>
            ))}
          </select>
          <span
            style={{
              width: "1px",
              height: "1.25rem",
              background: "var(--color-border)",
              margin: "0 0.25rem",
            }}
          />
          <FilterChip
            label="Group by sale"
            active={groupBySale}
            onClick={() => setGroupBySale(!groupBySale)}
          />
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {actionError && (
            <span style={{ fontSize: "0.8125rem", color: "var(--color-error)" }}>{actionError}</span>
          )}
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
            Add lot
          </button>
        </div>
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
            Loading lots…
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {hasActiveFilters
              ? "No lots match this filter."
              : "No lots tracked yet. Add one by naming the seller and the platform — the settlement it belongs to follows from those."}
          </div>
        )}

        {rows.length > 0 &&
          (groups ? (
            groups.map((group, groupIdx) => (
              <div key={group.saleId}>
                <div
                  style={{
                    padding: "0.5rem 1.25rem",
                    background: "var(--color-bg-page)",
                    borderTop: groupIdx === 0 ? undefined : "1px solid var(--color-border)",
                    borderBottom: "1px solid var(--color-border)",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    color: "var(--color-text-secondary)",
                    display: "flex",
                    gap: "0.5rem",
                  }}
                >
                  <Link
                    href={`/c/${collectionSlug}/auctions/sales/${group.saleId}`}
                    style={{ color: "var(--color-accent)", textDecoration: "none" }}
                  >
                    {group.name}
                  </Link>
                  <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>
                    {group.lots.length} lot{group.lots.length === 1 ? "" : "s"}
                  </span>
                </div>
                {group.lots.map((lot, idx) => (
                  <AuctionLotRow
                    key={lot.id}
                    lot={lot}
                    collectionSlug={collectionSlug}
                    now={now}
                    showSale={false}
                    linkToSale
                    isLast={idx === group.lots.length - 1}
                    isPending={isPending}
                    onEdit={(row) => setDialog({ kind: "edit", lot: row })}
                    onDelete={(row) => setDialog({ kind: "delete", lot: row })}
                    onSetBid={(row, value) =>
                      runLotAction(async () => {
                        const { setAuctionLotBidAction } = await import("@/app/actions/auctions");
                        return setAuctionLotBidAction(row.id, value);
                      })
                    }
                    onSetMyBid={(row, value) =>
                      runLotAction(async () => {
                        const { setAuctionLotMyBidAction } = await import("@/app/actions/auctions");
                        return setAuctionLotMyBidAction(row.id, value);
                      })
                    }
                    onSetMaxBid={(row, value) =>
                      runLotAction(async () => {
                        const { setAuctionLotMaxBidAction } = await import("@/app/actions/auctions");
                        return setAuctionLotMaxBidAction(row.id, value);
                      })
                    }
                    onMarkChecked={(row) =>
                      runLotAction(async () => {
                        const { touchAuctionLotCheckedAction } = await import(
                          "@/app/actions/auctions"
                        );
                        return touchAuctionLotCheckedAction(row.id);
                      })
                    }
                    onEditComposition={(row) => setDialog({ kind: "lines", lot: row })}
                    onOutcomeRecorded={() => invalidateAll(collectionId)}
                  />
                ))}
              </div>
            ))
          ) : (
            <>
              {rows.map((lot, idx) => (
                <AuctionLotRow
                  key={lot.id}
                  lot={lot}
                  collectionSlug={collectionSlug}
                  now={now}
                  linkToSale
                  isLast={idx === rows.length - 1 && !hasNextPage}
                  isPending={isPending}
                  onEdit={(row) => setDialog({ kind: "edit", lot: row })}
                  onDelete={(row) => setDialog({ kind: "delete", lot: row })}
                  onSetBid={(row, value) =>
                    runLotAction(async () => {
                      const { setAuctionLotBidAction } = await import("@/app/actions/auctions");
                      return setAuctionLotBidAction(row.id, value);
                    })
                  }
                  onSetMyBid={(row, value) =>
                    runLotAction(async () => {
                      const { setAuctionLotMyBidAction } = await import("@/app/actions/auctions");
                      return setAuctionLotMyBidAction(row.id, value);
                    })
                  }
                  onSetMaxBid={(row, value) =>
                    runLotAction(async () => {
                      const { setAuctionLotMaxBidAction } = await import("@/app/actions/auctions");
                      return setAuctionLotMaxBidAction(row.id, value);
                    })
                  }
                  onMarkChecked={(row) =>
                    runLotAction(async () => {
                      const { touchAuctionLotCheckedAction } = await import("@/app/actions/auctions");
                      return touchAuctionLotCheckedAction(row.id);
                    })
                  }
                  onEditComposition={(row) => setDialog({ kind: "lines", lot: row })}
                  onOutcomeRecorded={() => invalidateAll(collectionId)}
                />
              ))}
            </>
          ))}

        {rows.length > 0 && (
          <InfiniteScrollSentinel
            onLoadMore={fetchNextPage}
            hasMore={!!hasNextPage}
            isLoading={isFetchingNextPage}
          />
        )}
      </div>

      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <AuctionLotFormDialog
          mode={dialog.kind}
          collectionId={collectionId}
          lot={dialog.kind === "edit" ? dialog.lot : undefined}
          areas={areas}
          onClose={closeDialog}
          onSaved={handleSuccess}
        />
      )}

      {/* What the lot contains, and what that is worth (#353). Its own dialog rather than a tab on
          the lot form: composition is a list that grows, and it is read far more often than the
          lot's own fields are edited. */}
      {dialog.kind === "lines" && (
        <AuctionLotLinesDialog
          collectionId={collectionId}
          lot={dialog.lot}
          areas={areas}
          onClose={closeDialog}
          onChanged={() => invalidateAll(collectionId)}
        />
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete lot"
          message="This removes the lot and anything recorded about what it contains. The sale it belongs to stays. This cannot be undone."
          actionLabel="Delete lot"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            setActionError(undefined);
            startTransition(async () => {
              const { deleteAuctionLotAction } = await import("@/app/actions/auctions");
              const result = await deleteAuctionLotAction(dialog.lot.id);
              if (result.status === "success") handleSuccess();
              else setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}
