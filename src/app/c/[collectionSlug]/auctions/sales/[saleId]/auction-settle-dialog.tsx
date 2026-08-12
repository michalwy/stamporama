"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DialogActions, DialogBody, DialogShell } from "@/app/dialog-shell";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { settlementLinePrice } from "@/lib/auction-lot";
import { auctionLotName } from "@/lib/auction-rules";
import type { AuctionLotDetailView, AuctionSaleDetailView } from "../../use-auctions-query";
import { formatDay } from "../../auction-format";

// **Settling a parcel into a purchase** (#28) — the winning half of ADR-0021 §7.
//
// By the time this dialog opens the hard part is already done. A sale *is* one settlement with one
// seller, so nothing here asks which purchase a lot belongs in; what is left is transcription, and
// the dialog exists only because the seller's invoice — not our arithmetic — is the authority on
// what the parcel actually cost. Everything is therefore pre-filled and everything is editable:
// the date, the shipping, each line's price, and which won lots are in this parcel at all.
//
// It is built entirely from the sale detail the screen has already loaded. There is no settlement
// preview endpoint, because there is nothing to preview that the parcel's own rows do not already
// carry: a won lot's line price is `hammer + premium`, which is the row's own all-in figure.

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  marginBottom: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
};

const NOTE: React.CSSProperties = {
  margin: "0.5rem 0 0",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  color: "var(--color-text-muted)",
};

/** What a lot is called on the line it becomes. Mirrors the watchlist's own fallback order, so the
 * purchase line reads as the lot the collector was bidding on. */
function lotLabel(lot: AuctionLotDetailView): string {
  return auctionLotName(lot) ?? "Untitled lot";
}

/** How many copies a lot's composition will produce — a line of quantity N is N copies. */
function copyCount(lot: AuctionLotDetailView): number {
  return lot.lines.reduce((n, line) => n + Math.max(0, line.quantity), 0);
}

function toDateInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

interface AuctionSettleDialogProps {
  collectionSlug: string;
  sale: AuctionSaleDetailView;
  onClose: () => void;
  onSettled: () => void;
}

export function AuctionSettleDialog({
  collectionSlug,
  sale,
  onClose,
  onSettled,
}: AuctionSettleDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  const won = useMemo(() => sale.lots.filter((lot) => lot.outcome === "won" && !lot.settled), [sale]);

  // The premium the pre-filled prices are built from. Shipping is deliberately absent: it becomes
  // the purchase's own shared cost and is distributed across these very lines by ADR-0009 §3, so
  // adding it per line here would charge it twice.
  const fees = { premiumPercent: sale.premiumPercent, premiumFixed: sale.premiumFixed };

  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(won.map((lot) => [lot.id, settlementLinePrice(lot.finalPrice, fees) ?? ""]))
  );
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(won.map((lot) => [lot.id, true]))
  );
  const [shippingCost, setShippingCost] = useState(sale.shippingCost ?? "");
  // The parcel was paid for when its last lot closed — a house invoices the sale, not each lot. The
  // sale's own closing date is the better answer when it has one, since that is the sale's date.
  const [purchasedAt, setPurchasedAt] = useState(() => {
    if (sale.endsAt) return toDateInput(sale.endsAt);
    const latest = won.reduce<string | null>(
      (max, lot) => (max === null || lot.endsAt > max ? lot.endsAt : max),
      null
    );
    return latest ? toDateInput(latest) : new Date().toISOString().slice(0, 10);
  });

  const chosen = won.filter((lot) => included[lot.id]);
  const excluded = won.length - chosen.length;
  const linesTotal = chosen.reduce((sum, lot) => sum + (Number(prices[lot.id]) || 0), 0);
  const total = linesTotal + (Number(shippingCost) || 0);
  const copies = chosen.reduce((n, lot) => n + copyCount(lot), 0);
  const undescribed = chosen.filter((lot) => copyCount(lot) === 0).length;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    startTransition(async () => {
      const { settleAuctionSaleAction } = await import("@/app/actions/auctions");
      const result = await settleAuctionSaleAction(sale.id, {
        purchasedAt,
        shippingCost: shippingCost.trim() ? Number(shippingCost) : null,
        lots: chosen.map((lot) => ({ lotId: lot.id, price: Number(prices[lot.id]) || 0 })),
      });
      if (result.status !== "success") {
        setError(result.message);
        return;
      }
      onSettled();
      // Straight to the purchase: settling is not the end of the job, it is the handover to intake.
      router.push(`/c/${collectionSlug}/purchases/${result.id}`);
    });
  }

  return (
    <DialogShell title="Settle into a purchase" onClose={isPending ? () => {} : onClose} maxWidth="46rem">
      <form onSubmit={submit} style={{ display: "contents" }}>
        <DialogBody>
          <p style={{ ...NOTE, marginTop: 0 }}>
            Everything below is what {sale.sellerName} is owed for this parcel, as this app has it.
            Correct it against their invoice — that is what was actually paid — and the purchase is
            created from what you confirm here.
          </p>

          <div
            style={{
              display: "flex",
              gap: "1rem",
              flexWrap: "wrap",
              margin: "1rem 0 0.5rem",
            }}
          >
            <div style={{ flex: "1 1 12rem" }}>
              <label htmlFor="settle-date" style={LABEL_STYLE}>
                Purchase date
              </label>
              <input
                id="settle-date"
                type="date"
                value={purchasedAt}
                onChange={(e) => setPurchasedAt(e.currentTarget.value)}
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ flex: "1 1 12rem" }}>
              <label htmlFor="settle-shipping" style={LABEL_STYLE}>
                Shipping ({sale.currency})
              </label>
              <NumericInput
                id="settle-shipping"
                value={shippingCost}
                onChange={(e) => setShippingCost(e.currentTarget.value)}
                placeholder="0.00"
                style={INPUT_STYLE}
              />
            </div>
          </div>
          <p style={NOTE}>
            The date the parcel was paid for — the exchange rate of that day is frozen onto the
            purchase. Shipping is charged once for the whole parcel and then spread across the lines
            below by price, so a line&rsquo;s share of it follows what it cost.
          </p>

          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1.25rem" }}>
            <thead>
              <tr>
                <Th style={{ width: "1.5rem" }} />
                <Th>Lot</Th>
                <Th align="right">Hammer</Th>
                <Th align="right">Line price ({sale.currency})</Th>
              </tr>
            </thead>
            <tbody>
              {won.map((lot) => {
                const on = included[lot.id];
                const n = copyCount(lot);
                return (
                  <tr key={lot.id} style={{ opacity: on ? 1 : 0.5 }}>
                    <Td>
                      <input
                        type="checkbox"
                        checked={on}
                        aria-label={`Include ${lotLabel(lot)}`}
                        onChange={(e) =>
                          setIncluded((prev) => ({ ...prev, [lot.id]: e.currentTarget.checked }))
                        }
                      />
                    </Td>
                    <Td>
                      <div style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
                        {lotLabel(lot)}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                        {n > 0
                          ? `${n} cop${n === 1 ? "y" : "ies"} · closed ${formatDay(lot.endsAt)}`
                          : `nothing described · closed ${formatDay(lot.endsAt)}`}
                      </div>
                    </Td>
                    <Td align="right">
                      <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                        {lot.finalPrice} {sale.currency}
                      </span>
                    </Td>
                    <Td align="right">
                      <NumericInput
                        value={prices[lot.id] ?? ""}
                        disabled={!on}
                        aria-label={`Line price for ${lotLabel(lot)}`}
                        onChange={(e) =>
                          setPrices((prev) => ({ ...prev, [lot.id]: e.currentTarget.value }))
                        }
                        placeholder="0.00"
                        style={{ ...INPUT_STYLE, width: "8rem", textAlign: "right" }}
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={NOTE}>
            Each line is pre-filled at the hammer price plus{" "}
            {sale.premiumPercent || sale.premiumFixed
              ? "this seller's buyer's premium"
              : "the seller's premium, which they charge none of"}
            . Shipping is not in these figures — it is the parcel&rsquo;s and is distributed
            afterwards.
          </p>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              marginTop: "1rem",
              paddingTop: "0.75rem",
              borderTop: "1px solid var(--color-border)",
              fontSize: "0.9375rem",
              color: "var(--color-text-primary)",
            }}
          >
            <span>
              {chosen.length} lot{chosen.length === 1 ? "" : "s"}
              {copies > 0 && ` · ${copies} cop${copies === 1 ? "y" : "ies"}`}
            </span>
            <strong>
              {total.toFixed(2)} {sale.currency}
            </strong>
          </div>

          {copies > 0 && (
            <p style={NOTE}>
              The lots&rsquo; contents become {copies} identified cop{copies === 1 ? "y" : "ies"} on
              the purchase, still to be sorted — you described them to decide the bid, so there is
              nothing to retype. Their cost is frozen when you close each lot, as with any purchase.
            </p>
          )}
          {undescribed > 0 && (
            <p style={NOTE}>
              {undescribed} of the lots being settled {undescribed === 1 ? "has" : "have"} no
              contents entered, so {undescribed === 1 ? "it becomes a priced line" : "they become priced lines"}{" "}
              with no copies. You can identify {undescribed === 1 ? "it" : "them"} on the purchase.
            </p>
          )}
          {excluded > 0 && (
            <p style={{ ...NOTE, color: "var(--color-warning)" }}>
              {excluded} won lot{excluded === 1 ? "" : "s"} left out. {excluded === 1 ? "It stays" : "They stay"}{" "}
              recorded here as won and unsettled — nothing about {excluded === 1 ? "it" : "them"} is
              lost, but {excluded === 1 ? "it is" : "they are"} not part of this purchase.
            </p>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Settling…" : "Settle"}
          disabled={isPending || chosen.length === 0}
          cancelDisabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}

function Th({
  children,
  align,
  style,
}: {
  children?: React.ReactNode;
  align?: "right";
  style?: React.CSSProperties;
}) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "0.375rem 0.5rem",
        fontSize: "0.75rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        color: "var(--color-text-muted)",
        borderBottom: "1px solid var(--color-border)",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children?: React.ReactNode;
  align?: "right";
}) {
  return (
    <td
      style={{
        textAlign: align ?? "left",
        padding: "0.5rem",
        verticalAlign: "middle",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {children}
    </td>
  );
}
