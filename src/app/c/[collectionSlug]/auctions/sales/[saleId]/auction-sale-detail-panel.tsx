"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { IssueHeader } from "@/lib/issues";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  useAuctionSaleDetail,
  useInvalidateAuctions,
  type AuctionLotDetailView,
} from "../../use-auctions-query";
import { AuctionLotFormDialog } from "../../auction-lot-form-dialog";
import { AuctionLotCardsView } from "./auction-lot-cards-view";
import { AuctionSaleFormDialog } from "../../auction-sale-form-dialog";
import { AuctionSettleDialog } from "./auction-settle-dialog";
import {
  AUCTION_LOT_OUTCOMES,
  AUCTION_LOT_OUTCOME_LABEL,
  type AuctionLotOutcome,
} from "@/lib/auction-rules";
import { lotHasSignal, LOT_SIGNALS, type LotSignal } from "@/lib/auction-lot";
import { SaleStatusChip } from "../../auction-badges";
import { CONTROL_STYLE, FilterChip, SIGNALS } from "../../auction-controls";
import { formatBase, formatDay } from "../../auction-format";
import { Icon } from "@/app/icons";

type DialogState =
  | { kind: "none" }
  | { kind: "addLot" }
  | { kind: "editSale" }
  | { kind: "editLot"; lot: AuctionLotDetailView }
  | { kind: "deleteLot"; lot: AuctionLotDetailView }
  | { kind: "settle" }
  | { kind: "close" };

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
  /** For the composition editor's stamp picker and catalog-number formatting (#353). */
  areas: CollectionAreaData[];
  /** Issue headers for the lines' issue groups, so they carry the same catalog chips and stamp
   * count the purchase-order and offer views show (#353). */
  issueHeaderById: Record<string, IssueHeader>;
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
  areas,
  issueHeaderById,
}: AuctionSaleDetailPanelProps) {
  const now = useMinuteClock();
  // Which lot the collector arrived to see (#374). A click on the flat watchlist lands here with
  // `?lot=<id>`, and the card for it scrolls into view and flashes once.
  const searchParams = useSearchParams();
  const highlightLotId = searchParams.get("lot");
  // Clearing the mark is dropping the param that carries it — that one only, so anything else in
  // the address bar survives — and `replace` rather than `push`, since undoing a highlight is not a
  // step anyone wants to walk back through.
  const pathname = usePathname();
  const router = useRouter();
  function clearHighlight() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("lot");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  // Which outcome the lot list below is narrowed to. Local state rather than a URL param, unlike
  // the flat list: this is one parcel being worked through — "what is still running", then "what
  // did I win" while settling — not a view anyone links to.
  const [outcome, setOutcome] = useState<AuctionLotOutcome | undefined>();
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
  /** Every money field on this card in the collection's base currency too (#498) — one rate for the
   * parcel, since a sale carries one currency for all of it. */
  const inBase = (amount: string | null) => formatBase(amount, sale.baseRate, sale.baseCurrency);
  // The whole parcel is already loaded, so narrowing it is a client-side question — no second
  // request, and the counts come off the same rows the chips filter.
  const outcomeCounts = sale.lots.reduce<Partial<Record<AuctionLotOutcome, number>>>((acc, lot) => {
    acc[lot.outcome] = (acc[lot.outcome] ?? 0) + 1;
    return acc;
  }, {});

  // The parcel's own fees price every signal here, exactly as they do server-side — shipping left
  // out, because a signal is about one lot.
  const fees = { premiumPercent: sale.premiumPercent, premiumFixed: sale.premiumFixed };
  const carries = (lot: AuctionLotDetailView, s: LotSignal) =>
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
    (lot) => (!outcome || lot.outcome === outcome) && (!signal || carries(lot, signal))
  );

  // Settlement (#28). A parcel is paid for as a whole, so the action only appears once every lot's
  // outcome is recorded: while something is still being watched the parcel's contents — and its
  // total — are not yet known. With nothing won there is no purchase to make and the parcel is
  // simply closed, which is the same end of the same road.
  const wonCount = sale.lots.filter((lot) => lot.outcome === "won" && !lot.settled).length;
  const openCount = outcomeCounts.pending ?? 0;
  const settleBlocked =
    openCount > 0
      ? `Close ${openCount} lot${openCount === 1 ? "" : "s"} still open first — confirming what ${openCount === 1 ? "it went" : "they went"} for is what says whether ${openCount === 1 ? "it is" : "they are"} in this parcel.`
      : undefined;
  const canSettle = sale.status === "open" && wonCount > 0;
  const canClose = sale.status === "open" && wonCount === 0 && sale.lots.length > 0;
  // The finishing action takes the emphasis once it is the thing to do; until then adding lots is.
  const settlementIsPrimary = (canSettle || canClose) && !settleBlocked;
  const PRIMARY_BUTTON: React.CSSProperties = {
    ...CONTROL_STYLE,
    fontWeight: 600,
    color: "#fff",
    background: "var(--color-action-primary)",
    border: "none",
    padding: "0.375rem 0.875rem",
  };

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
            <Icon name="externalLink" size="sm" /> Catalogue
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
            ...(settlementIsPrimary ? CONTROL_STYLE : PRIMARY_BUTTON),
            cursor: sale.purchaseId ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          Add lot
        </button>
        {sale.purchaseId ? (
          <Link
            href={`/c/${collectionSlug}/purchases/${sale.purchaseId}`}
            style={{ ...PRIMARY_BUTTON, textDecoration: "none", display: "inline-block" }}
          >
            View purchase →
          </Link>
        ) : canSettle ? (
          <Tooltip
            // Anchored to its right edge: these buttons sit at the end of the header row, so a
            // centred bubble runs off the window and gets cut.
            align="end"
            content={
              settleBlocked ??
              `Turn the ${wonCount} won lot${wonCount === 1 ? "" : "s"} into a purchase, with their contents as copies to sort.`
            }
          >
            <button
              type="button"
              onClick={() => setDialog({ kind: "settle" })}
              disabled={!!settleBlocked}
              style={{
                ...(settlementIsPrimary ? PRIMARY_BUTTON : CONTROL_STYLE),
                cursor: settleBlocked ? "not-allowed" : "pointer",
                fontWeight: 600,
              }}
            >
              Settle…
            </button>
          </Tooltip>
        ) : canClose ? (
          <Tooltip
            align="end"
            content={
              settleBlocked ??
              "Nothing was won from this parcel, so there is nothing to buy. Closing files it — the lots stay as the price record they are."
            }
          >
            <button
              type="button"
              onClick={() => setDialog({ kind: "close" })}
              disabled={!!settleBlocked}
              style={{
                ...(settlementIsPrimary ? PRIMARY_BUTTON : CONTROL_STYLE),
                cursor: settleBlocked ? "not-allowed" : "pointer",
                fontWeight: 600,
              }}
            >
              Close sale
            </button>
          </Tooltip>
        ) : null}
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
          base={inBase(sale.shippingCost)}
        />
        <span style={{ flex: 1 }} />
        <Field
          label="Bids"
          value={`${summary.bidTotal} ${sale.currency}`}
          hint={`Over the ${summary.payableCount} lot${summary.payableCount === 1 ? "" : "s"} you would pay for — watching and won.`}
          base={inBase(summary.bidTotal)}
        />
        <Field
          label="All-in"
          value={`${summary.allInTotal} ${sale.currency}`}
          hint="Bids plus premium on every payable lot, plus shipping once."
          strong
          base={inBase(summary.allInTotal)}
        />
        {/* What the parcel can still cost (#523). The two are one question asked twice: what is
            already on the hook, and what carrying the bidding through to the ceilings would come
            to. Both sit beside All-in rather than replacing it — that one says what the parcel
            costs at today's prices, and these say what it can cost. */}
        <Field
          label="Committed"
          value={`${summary.committedTotal} ${sale.currency}`}
          hint="What you owe if every bid you have placed wins at your own maximum — the settled price on the lots already won, plus shipping once. A lot you have not bid on, or one whose price has already passed your ceiling, costs nothing here."
          strong
          base={inBase(summary.committedTotal)}
        />
        <Field
          label="At ceiling"
          value={`${summary.ceilingTotal} ${sale.currency}`}
          hint="The same, if every open lot is bid up to its ceiling. A ceiling is already an all-in figure, so it is counted as it stands; where your placed bid is higher, that is what counts. A lot the price has already carried past your ceiling is left out — it needs a new ceiling before it can cost you anything."
          base={inBase(summary.ceilingTotal)}
        />
        {/* What the parcel is worth against what it costs (#353). Unlike a lot row's headroom this
            one has shipping in it — that is what the parcel actually costs, and shipping is added
            here exactly once. */}
        <Field
          label="Catalogue"
          value={`${summary.catalogTotal} ${sale.currency}`}
          hint={
            summary.unvaluedCount > 0
              ? `Over the payable lots whose contents are described. ${summary.unvaluedCount} of them ${summary.unvaluedCount === 1 ? "is" : "are"} not, so this is lower than the parcel is worth.`
              : "Catalogue value of everything this parcel is described as holding."
          }
          base={inBase(summary.catalogTotal)}
        />
        <Field
          label="Headroom"
          value={summary.headroom === null ? "—" : `${summary.headroom} ${sale.currency}`}
          hint="Catalogue value less the all-in cost of the parcel, shipping included."
          base={inBase(summary.headroom)}
          tone={
            summary.headroom === null ? undefined : Number(summary.headroom) < 0 ? "bad" : "good"
          }
          strong
        />
      </div>

      {summary.unbidCount > 0 && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-warning)" }}>
          {summary.unbidCount} payable lot{summary.unbidCount === 1 ? " has" : "s have"} no bid
          recorded, so the totals above are lower than what this parcel will actually cost.
        </p>
      )}

      {/* The exposure figures' own gap (#523), stated for the same reason: a lot with neither a bid
          nor a ceiling is not costed at all, and a total that quietly omits it looks complete. */}
      {summary.uncappedCount > 0 && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-warning)" }}>
          {summary.uncappedCount} lot{summary.uncappedCount === 1 ? " has" : "s have"} neither a bid
          nor a ceiling, so neither <strong>Committed</strong> nor <strong>At ceiling</strong> counts
          {summary.uncappedCount === 1 ? " it" : " them"}.
        </p>
      )}

      {/* The other way out of those two totals (#600), and unlike the one above it is not a gap:
          the lot is correctly costed at nothing, since the price has passed the ceiling. Stated in
          the muted tone for exactly that reason — there is nothing here to fix. */}
      {summary.outpricedCount > 0 && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          {summary.outpricedCount} lot{summary.outpricedCount === 1 ? " has" : "s have"} gone past
          {summary.outpricedCount === 1 ? " its" : " their"} ceiling, so neither{" "}
          <strong>Committed</strong> nor <strong>At ceiling</strong> counts
          {summary.outpricedCount === 1 ? " it" : " them"} — raise the ceiling to bid again.
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
          {AUCTION_LOT_OUTCOMES.filter((value) => (outcomeCounts[value] ?? 0) > 0).map((value) => {
            const active = outcome === value;
            return (
              <FilterChip
                key={value}
                label={AUCTION_LOT_OUTCOME_LABEL[value]}
                count={outcomeCounts[value] ?? 0}
                active={active}
                onClick={() => setOutcome(active ? undefined : value)}
              />
            );
          })}
        </div>
      )}

      {sale.lots.length === 0 ? (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            background: "var(--color-bg-elevated)",
            padding: "2rem",
            color: "var(--color-text-muted)",
            fontSize: "0.9375rem",
          }}
        >
          No lots in this sale yet. <strong>Add lot</strong> puts one straight into this parcel;
          adding from the lots screen and naming this seller and platform lands in it too.
        </div>
      ) : visibleLots.length === 0 ? (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            background: "var(--color-bg-elevated)",
            padding: "2rem",
            color: "var(--color-text-muted)",
            fontSize: "0.9375rem",
          }}
        >
          No lots in this parcel match that filter.
        </div>
      ) : (
        /* Each lot a collapsible card over what it holds (#353) — the purchase-order intake and
           offer detail layout, applied to a parcel. The flat watchlist keeps its plain rows: there
           the question is what to bid on next, across every seller. */
        <AuctionLotCardsView
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          lots={visibleLots}
          areas={areas}
          issueHeaderById={issueHeaderById}
          now={now}
          isPending={isPending}
          highlightLotId={highlightLotId}
          onClearHighlight={clearHighlight}
          onChanged={() => invalidateAll(collectionId)}
          onEditLot={(row) => setDialog({ kind: "editLot", lot: row })}
          onDeleteLot={(row) => setDialog({ kind: "deleteLot", lot: row })}
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
      )}


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
          areas={areas}
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

      {dialog.kind === "settle" && (
        <AuctionSettleDialog
          collectionSlug={collectionSlug}
          sale={sale}
          onClose={() => setDialog({ kind: "none" })}
          onSettled={() => {
            setDialog({ kind: "none" });
            invalidateAll(collectionId);
          }}
        />
      )}

      {dialog.kind === "close" && (
        <ConfirmDialog
          title="Close sale"
          message="Nothing was won here, so no purchase is created. The lots stay exactly as they are — a lost lot is a dated price observation, which is what this parcel produced."
          actionLabel="Close sale"
          pendingLabel="Closing…"
          variant="primary"
          isPending={isPending}
          error={actionError}
          onClose={() => !isPending && setDialog({ kind: "none" })}
          onConfirm={() =>
            runLotAction(async () => {
              const { setAuctionSaleStatusAction } = await import("@/app/actions/auctions");
              const result = await setAuctionSaleStatusAction(sale.id, "closed");
              if (result.status === "success") setDialog({ kind: "none" });
              return result;
            })
          }
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
  tone,
  base,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  /** Colours the figure where it carries a verdict rather than a measurement. */
  tone?: "good" | "bad";
  /** The same figure in the collection's base currency (#498), already formatted — null on a
   * field that is not money, on a sale already in the base currency, and where no rate was had. */
  base?: string | null;
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
            color:
              tone === "bad"
                ? "var(--color-error)"
                : tone === "good"
                  ? "var(--color-success)"
                  : "var(--color-text-primary)",
          }}
        >
          {value}
        </span>
        {base && (
          <span
            style={{
              fontSize: "0.6875rem",
              color: "var(--color-text-muted)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {base}
          </span>
        )}
      </div>
    </Tooltip>
  );
}
