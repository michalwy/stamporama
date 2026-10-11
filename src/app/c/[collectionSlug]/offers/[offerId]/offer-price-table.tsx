"use client";

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  describeEstimateSource,
  formatPriceMargin,
  isStatedSource,
  offerPriceRows,
  type EstimateSource,
  type OfferPriceRow,
  type OfferPriceRowKey,
} from "@/lib/offer-price-table";

/** The `OfferDetail` fields the table reads. */
export interface OfferPriceTableOffer {
  currency: string;
  platformName: string;
  platformMinimumPrice: string | null;
  suggestedPrice: string | null;
  suggestedEstimate: { valuedSets: number; copies: number; source: EstimateSource } | null;
  catalogPrice: string | null;
  catalogUnpricedSets: number;
  catalogFaultReducedCount: number;
  catalogFullPrice: string | null;
  marketPrice: { amount: string; valuedSets: number; copies: number; noEvidenceCopies: number } | null;
  costPrice: string | null;
  setsTotals: { setCount: number; costEstimated: boolean };
}

const LABEL: Record<OfferPriceRowKey, string> = {
  minimum: "Minimum",
  catalogue: "Catalogue",
  estimated: "Estimated",
  market: "Market",
  cost: "Cost",
};

const MUTED: React.CSSProperties = { color: "var(--color-text-muted)" };

/** A label and its figure as one cell spanning two of the table's columns, keeping both aligned. */
const SPAN_TWO: React.CSSProperties = { display: "grid", gridTemplateColumns: "subgrid", gridColumn: "span 2" };

const sets = (n: number) => `${n} set${n === 1 ? "" : "s"}`;
const copies = (n: number) => `${n} cop${n === 1 ? "y" : "ies"}`;

/** What each figure is, for its hover. Every one is per set, since a buyer takes one set. */
function about(row: OfferPriceRow, offer: OfferPriceTableOffer): string {
  switch (row.key) {
    case "minimum":
      return `The lowest ${offer.platformName} is worth listing on, set on the platform`;
    case "catalogue": {
      const base = "Average catalogue value per set, in this offer's currency";
      if (offer.catalogFaultReducedCount === 0 || !offer.catalogFullPrice) return base;
      return `${base} — ${copies(offer.catalogFaultReducedCount)} lowered for faults; ${offer.catalogFullPrice} ${offer.currency} without the reductions`;
    }
    case "estimated":
      return "The suggested price: catalogue value × the realisation ratio learned from recorded results, per set";
    case "market": {
      const market = offer.marketPrice!;
      const without = market.noEvidenceCopies > 0 ? `; ${copies(market.noEvidenceCopies)} without any` : "";
      return `What recorded results paid per set — ${copies(market.copies)} with results${without}`;
    }
    case "cost":
      return offer.setsTotals.costEstimated
        ? "What the copies cost per set — partly an estimate, while their lot is open"
        : "What the copies cost per set";
  }
}

/** The short fact beside a figure — the ratio's source, how many copies the market covers, the sets
 *  a figure leaves out — stated in the row rather than hidden in a hover, since each is what makes
 *  the figure beside it arguable. */
function RowNote({ row, offer }: { row: OfferPriceRow; offer: OfferPriceTableOffer }) {
  const setCount = offer.setsTotals.setCount;
  if (row.key === "estimated" && offer.suggestedEstimate) {
    const { source, valuedSets } = offer.suggestedEstimate;
    return (
      <span style={isStatedSource(source) ? { color: "var(--color-warning)" } : MUTED}>
        {describeEstimateSource(source)}
        {valuedSets < setCount && ` · ${valuedSets} of ${sets(setCount)}`}
      </span>
    );
  }
  if (row.key === "catalogue" && offer.catalogUnpricedSets > 0) {
    return <span style={MUTED}>{sets(offer.catalogUnpricedSets)} unpriced</span>;
  }
  if (row.key === "market" && offer.marketPrice) {
    return <span style={MUTED}>{copies(offer.marketPrice.copies)} with results</span>;
  }
  if (row.key === "cost" && offer.setsTotals.costEstimated) {
    return <span style={MUTED}>estimate</span>;
  }
  return <span />;
}

/**
 * The offer's price area as a small table (#1829): the platform's minimum, the catalogue value,
 * Estimated value — the suggestion — what the market paid, and what the copies cost, each per set
 * and in the offer's currency, each price with the margin it would give over the cost. A figure
 * that does not exist is left out (#1184), and so is a margin over an unknown cost.
 *
 * Clicking a price writes the figure the seller **states** (`target`) — never an auction's current
 * price, which would be recording a bid nobody placed. A figure that already is that price is drawn
 * plain, since clicking it would change nothing; nothing is clickable on an offer that is closed.
 */
export function OfferPriceTable({
  offer,
  askingPrice,
  target,
  editable,
  disabled,
  onApply,
}: {
  offer: OfferPriceTableOffer;
  /** The stated figure the prices are compared with, or null when none is stated. */
  askingPrice: string | null;
  /** The field a click writes, as the hint names it: "price", or an auction's "starting price". */
  target: string;
  editable: boolean;
  disabled: boolean;
  onApply: (amount: string) => void;
}) {
  const rows = offerPriceRows({
    minimum: offer.platformMinimumPrice,
    catalogue: offer.catalogPrice,
    estimated: offer.suggestedPrice,
    market: offer.marketPrice?.amount ?? null,
    cost: offer.costPrice,
  });
  if (rows.length === 0) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto auto auto auto",
        columnGap: "0.625rem",
        rowGap: "0.0625rem",
        alignItems: "baseline",
        fontSize: "0.75rem",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {rows.map((row) => {
        const isPrice = row.key !== "cost";
        const applied = askingPrice === row.amount;
        const clickable = isPrice && editable && !applied;
        const hint = !isPrice
          ? about(row, offer)
          : !editable
            ? about(row, offer)
            : applied
              ? `${about(row, offer)} — already the ${target}`
              : `${about(row, offer)} — click to set the ${target} to it`;
        const suggested = row.key === "estimated";
        const figure = (
          <>
            <span style={{ ...MUTED, fontWeight: suggested ? 600 : undefined }}>
              {LABEL[row.key]}
              {suggested && " · suggested"}
            </span>
            <span style={{ justifySelf: "end" }}>
              {suggested ? "≈ " : ""}
              {row.amount}
            </span>
          </>
        );
        return (
          <div key={row.key} style={{ display: "contents" }}>
            {/* The tooltip's own wrapper spans the label and the figure, so the two are one target
                and still sit in the table's columns. */}
            <Tooltip content={hint} align="end" style={SPAN_TWO}>
              {clickable ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onApply(row.amount)}
                  style={{
                    ...SPAN_TWO,
                    padding: 0,
                    background: "none",
                    border: "none",
                    font: "inherit",
                    color: "var(--color-accent)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {figure}
                </button>
              ) : (
                <span style={{ ...SPAN_TWO, color: "var(--color-text-secondary)" }}>
                  {figure}
                </span>
              )}
            </Tooltip>
            <span
              style={{
                justifySelf: "end",
                color:
                  row.margin && row.margin.amount.startsWith("-")
                    ? "var(--color-warning)"
                    : "var(--color-text-muted)",
              }}
            >
              {row.margin ? formatPriceMargin(row.margin) : ""}
            </span>
            <RowNote row={row} offer={offer} />
          </div>
        );
      })}
    </div>
  );
}
