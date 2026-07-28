"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ConfirmDialog } from "@/app/dialog-shell";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  useAuctionSaleDetail,
  useInvalidateAuctions,
  type AuctionLotView,
} from "../../use-auctions-query";
import { AuctionLotRow } from "../../auction-lot-row";
import { AuctionLotFormDialog } from "../../auction-lot-form-dialog";
import { AuctionSaleFormDialog } from "../../auction-sale-form-dialog";
import {
  AUCTION_LOT_STATUSES,
  AUCTION_LOT_STATUS_LABEL,
  type AuctionLotStatus,
} from "@/lib/auction-rules";
import { lotHasSignal, LOT_SIGNALS, type LotSignal } from "@/lib/auction-lot";
import { SaleStatusChip } from "../../auction-badges";
import { CONTROL_STYLE, FilterChip, SIGNALS } from "../../auction-controls";
import { formatDay } from "../../auction-format";

type DialogState =
  | { kind: "none" }
  | { kind: "addLot" }
  | { kind: "editSale" }
  | { kind: "editLot"; lot: AuctionLotView }
  | { kind: "deleteLot"; lot: AuctionLotView };

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  padding: "1.25rem",
};

/** The clock the lots age against — one instant for the whole screen, refreshed each minute. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

interface AuctionSaleDetailPanelProps {
  collectionId: string;
  collectionSlug: string;
  saleId: string;
}

/**
 * A sale's own screen: the terms that price the parcel (currency, premium, shipping), what it adds
 * up to, and the lots in it.
 *
 * The flat list is where lots are *watched*; this is where a parcel is *paid for*. Hence the
 * emphasis: the totals lead, and shipping appears once here rather than on every lot row, because
 * a parcel ships once however many lots are in it.
 */
export function AuctionSaleDetailPanel({
  collectionId,
  collectionSlug,
  saleId,
}: AuctionSaleDetailPanelProps) {
  const now = useMinuteClock();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  // Which outcome the lot list below is narrowed to. Local state rather than a URL param, unlike
  // the flat list: this is one parcel being worked through — "what is still running", then "what
  // did I win" while settling — not a view anyone links to.
  const [status, setStatus] = useState<AuctionLotStatus | undefined>();
  // The same derived states the flat list filters by, asked of one parcel. Computed here rather
  // than fetched: the sale's lots are already in hand, and the rules are pure.
  const [signal, setSignal] = useState<LotSignal | undefined>();
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateAuctions();
  const { data: sale, isLoading } = useAuctionSaleDetail(collectionId, saleId);

  function runLotAction(
    action: () => Promise<{ status: "success" } | { status: "error"; message: string }>
  ) {
    setActionError(undefined);
    startTransition(async () => {
      const result = await action();
      if (result.status === "success") invalidateAll(collectionId);
      else setActionError(result.message);
    });
  }

  if (isLoading || !sale) {
    return (
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
        {isLoading ? "Loading sale…" : "This auction sale no longer exists."}
      </p>
    );
  }

  const { summary } = sale;
  // The whole parcel is already loaded, so narrowing it is a client-side question — no second
  // request, and the counts come off the same rows the chips filter.
  const statusCounts = sale.lots.reduce<Partial<Record<AuctionLotStatus, number>>>((acc, lot) => {
    acc[lot.status] = (acc[lot.status] ?? 0) + 1;
    return acc;
  }, {});

  // The parcel's own fees price every signal here, exactly as they do server-side — shipping left
  // out, because a signal is about one lot.
  const fees = { premiumPercent: sale.premiumPercent, premiumFixed: sale.premiumFixed };
  const carries = (lot: AuctionLotView, s: LotSignal) =>
    lotHasSignal(
      s,
      {
        status: lot.status,
        endsAt: new Date(lot.endsAt),
        currentBid: lot.currentBid,
        myBid: lot.myBid,
        maxBid: lot.maxBid,
        fees,
      },
      now
    );
  const signalCounts = Object.fromEntries(
    LOT_SIGNALS.map((s) => [s, sale.lots.filter((lot) => carries(lot, s)).length])
  ) as Record<LotSignal, number>;

  const visibleLots = sale.lots.filter(
    (lot) => (!status || lot.status === status) && (!signal || carries(lot, signal))
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <Link
          href={`/c/${collectionSlug}/auctions/sales`}
          style={{ fontSize: "0.8125rem", color: "var(--color-accent)", textDecoration: "none" }}
        >
          ← Auction sales
        </Link>
        <h2
          style={{
            margin: 0,
            fontSize: "1.25rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          {sale.name}
        </h2>
        <SaleStatusChip status={sale.status} />
        {sale.url && (
          <a
            href={sale.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "0.8125rem", color: "var(--color-accent)" }}
          >
            🔗 Catalogue
          </a>
        )}
        <span style={{ flex: 1 }} />
        {actionError && (
          <span style={{ fontSize: "0.8125rem", color: "var(--color-error)" }}>{actionError}</span>
        )}
        <button
          type="button"
          onClick={() => setDialog({ kind: "editSale" })}
          disabled={sale.purchaseId !== null}
          style={{ ...CONTROL_STYLE, cursor: sale.purchaseId ? "not-allowed" : "pointer", fontWeight: 600 }}
        >
          Edit sale
        </button>
        {/* Adding from here needs no seller, platform or matching: the parcel is the screen. */}
        <button
          type="button"
          onClick={() => setDialog({ kind: "addLot" })}
          disabled={sale.purchaseId !== null}
          style={{
            ...CONTROL_STYLE,
            cursor: sale.purchaseId ? "not-allowed" : "pointer",
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

      {/* Terms + totals. The two halves are one question — what this parcel costs — so they share
          a card rather than sitting in two. */}
      <div style={{ ...CARD, display: "flex", gap: "2rem", flexWrap: "wrap" }}>
        <Field label="Seller" value={sale.sellerName} />
        <Field label="Platform" value={sale.platformName} />
        <Field label="Currency" value={sale.currency} />
        <Field label="Closes" value={sale.endsAt ? formatDay(sale.endsAt) : "per lot"} />
        <Field
          label="Buyer's premium"
          value={
            sale.premiumPercent || sale.premiumFixed
              ? [
                  sale.premiumPercent ? `${sale.premiumPercent}%` : null,
                  sale.premiumFixed ? `+ ${sale.premiumFixed} ${sale.currency}/lot` : null,
                ]
                  .filter(Boolean)
                  .join(" ")
              : "none"
          }
        />
        <Field
          label="Shipping"
          value={sale.shippingCost ? `${sale.shippingCost} ${sale.currency}` : "not quoted"}
          hint="For the whole parcel — counted once, however many lots are won."
        />
        <span style={{ flex: 1 }} />
        <Field
          label="Bids"
          value={`${summary.bidTotal} ${sale.currency}`}
          hint={`Over the ${summary.payableCount} lot${summary.payableCount === 1 ? "" : "s"} you would pay for — watching and won.`}
        />
        <Field
          label="All-in"
          value={`${summary.allInTotal} ${sale.currency}`}
          hint="Bids plus premium on every payable lot, plus shipping once."
          strong
        />
      </div>

      {summary.unbidCount > 0 && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-warning)" }}>
          {summary.unbidCount} payable lot{summary.unbidCount === 1 ? " has" : "s have"} no bid
          recorded, so the totals above are lower than what this parcel will actually cost.
        </p>
      )}

      {/* Outcome filter over the parcel's lots: "what is still running" while bidding, "what did I
          win" while settling. Only statuses this parcel actually holds are offered — a chip that
          can only ever show nothing is noise on a screen about one seller. */}
      {sale.lots.length > 0 && (
        <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", alignItems: "center" }}>
          {/* What to do about a lot, then what became of it — the flat list's two groups, asked of
              one parcel. Only what this parcel actually holds is offered: a chip that can only ever
              show nothing is noise on a screen about one seller. */}
          {SIGNALS.filter(({ value }) => signalCounts[value] > 0).map(({ value, label, hint }) => {
            const active = signal === value;
            return (
              <Tooltip key={value} content={hint}>
                <FilterChip
                  label={label}
                  count={signalCounts[value]}
                  active={active}
                  onClick={() => setSignal(active ? undefined : value)}
                />
              </Tooltip>
            );
          })}
          {SIGNALS.some(({ value }) => signalCounts[value] > 0) && (
            <span
              style={{
                width: "1px",
                height: "1.25rem",
                background: "var(--color-border)",
                margin: "0 0.25rem",
              }}
            />
          )}
          {AUCTION_LOT_STATUSES.filter((value) => (statusCounts[value] ?? 0) > 0).map((value) => {
            const active = status === value;
            return (
              <FilterChip
                key={value}
                label={AUCTION_LOT_STATUS_LABEL[value]}
                count={statusCounts[value] ?? 0}
                active={active}
                onClick={() => setStatus(active ? undefined : value)}
              />
            );
          })}
        </div>
      )}

      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          background: "var(--color-bg-elevated)",
        }}
      >
        {sale.lots.length === 0 ? (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            No lots in this sale yet. <strong>Add lot</strong> puts one straight into this parcel;
            adding from the lots screen and naming this seller and platform lands in it too.
          </div>
        ) : visibleLots.length === 0 ? (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            No lots in this parcel match that filter.
          </div>
        ) : (
          visibleLots.map((lot, idx) => (
            <AuctionLotRow
              key={lot.id}
              lot={lot}
              collectionSlug={collectionSlug}
              now={now}
              showSale={false}
              isLast={idx === visibleLots.length - 1}
              isPending={isPending}
              onEdit={(row) => setDialog({ kind: "editLot", lot: row })}
              onDelete={(row) => setDialog({ kind: "deleteLot", lot: row })}
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
            />
          ))
        )}
      </div>

      {dialog.kind === "editSale" && (
        <AuctionSaleFormDialog
          mode="edit"
          collectionId={collectionId}
          sale={sale}
          onClose={() => setDialog({ kind: "none" })}
          onSaved={() => {
            setDialog({ kind: "none" });
            invalidateAll(collectionId);
          }}
        />
      )}

      {dialog.kind === "addLot" && (
        <AuctionLotFormDialog
          mode="add"
          collectionId={collectionId}
          fixedSale={{
            id: sale.id,
            name: sale.name,
            currency: sale.currency,
            endsAt: sale.endsAt,
          }}
          onClose={() => setDialog({ kind: "none" })}
          onSaved={() => {
            setDialog({ kind: "none" });
            invalidateAll(collectionId);
          }}
        />
      )}

      {dialog.kind === "editLot" && (
        <AuctionLotFormDialog
          mode="edit"
          collectionId={collectionId}
          lot={dialog.lot}
          onClose={() => setDialog({ kind: "none" })}
          onSaved={() => {
            setDialog({ kind: "none" });
            invalidateAll(collectionId);
          }}
        />
      )}

      {dialog.kind === "deleteLot" && (
        <ConfirmDialog
          title="Delete lot"
          message="This removes the lot and anything recorded about what it contains. This cannot be undone."
          actionLabel="Delete lot"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={() => !isPending && setDialog({ kind: "none" })}
          onConfirm={() => {
            setActionError(undefined);
            startTransition(async () => {
              const { deleteAuctionLotAction } = await import("@/app/actions/auctions");
              const result = await deleteAuctionLotAction(dialog.lot.id);
              if (result.status === "success") {
                setDialog({ kind: "none" });
                invalidateAll(collectionId);
              } else setActionError(result.message);
            });
          }}
        />
      )}
    </div>
  );
}

function Field({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <Tooltip content={hint}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--color-text-muted)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: strong ? "1rem" : "0.875rem",
            fontWeight: strong ? 700 : 500,
            fontVariantNumeric: "tabular-nums",
            color: "var(--color-text-primary)",
          }}
        >
          {value}
        </span>
      </div>
    </Tooltip>
  );
}
