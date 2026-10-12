"use client";

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  describeCatalogueNote,
  describeEstimateBasis,
  describeEstimateNote,
  formatPriceMargin,
  isStatedSource,
  marginSign,
  offerPriceRows,
  type EstimateSource,
  type OfferPriceRow,
  type OfferPriceRowKey,
} from "@/lib/offer-price-table";

/** The `OfferDetail` fields the table reads. */
export interface OfferPriceTableOffer {
  currency: string;
  baseCurrency: string;
  /** The offer's own price; `0.00` while it has none. */
  price: string;
  priceBase: string | null;
  platformName: string;
  platformMinimumPrice: string | null;
  suggestedPrice: string | null;
  suggestedEstimate: { valuedSets: number; copies: number; ratio: number; source: EstimateSource } | null;
  catalogPrice: string | null;
  catalogNames: string[];
  catalogUnpricedSets: number;
  catalogFaultReducedCount: number;
  catalogFullPrice: string | null;
  marketPrice: { amount: string; valuedSets: number; copies: number; noEvidenceCopies: number } | null;
  marketUnconvertible: boolean;
  costPrice: string | null;
  setsTotals: { setCount: number; costEstimated: boolean };
}

const MUTED: React.CSSProperties = { color: "var(--color-text-muted)" };
const HEADING: React.CSSProperties = { ...MUTED, fontWeight: 500, justifySelf: "end" };

const sets = (n: number) => `${n} set${n === 1 ? "" : "s"}`;
const copies = (n: number) => `${n} cop${n === 1 ? "y" : "ies"}`;

/** What each figure is, for the hover on its name. Every one is per set, since a buyer takes one
 *  set; what a figure rests on beyond its bracketed note — the ratio's bucket and sample, the sets it
 *  leaves out — is said here and not on the row (#1839). */
function about(row: OfferPriceRow, offer: OfferPriceTableOffer, ownLabel: string, editable: boolean): string {
  const setCount = offer.setsTotals.setCount;
  switch (row.key) {
    case "minimum":
      return `The lowest ${offer.platformName} is worth listing on, set on the platform`;
    case "catalogue": {
      const parts = ["Average catalogue value per set, in this offer's currency"];
      if (offer.catalogUnpricedSets > 0) parts.push(`${sets(offer.catalogUnpricedSets)} unpriced`);
      if (offer.catalogFaultReducedCount > 0 && offer.catalogFullPrice) {
        parts.push(
          `${copies(offer.catalogFaultReducedCount)} lowered for faults; ${offer.catalogFullPrice} ${offer.currency} without the reductions`
        );
      }
      return parts.join(" — ");
    }
    case "estimated": {
      const parts = ["The suggested price: catalogue value × the realisation ratio learned from recorded results, per set"];
      const estimate = offer.suggestedEstimate;
      if (estimate) {
        parts.push(describeEstimateBasis(estimate.source));
        if (estimate.valuedSets < setCount) parts.push(`${estimate.valuedSets} of ${sets(setCount)}`);
      }
      return parts.join(" — ");
    }
    case "market": {
      if (row.amount === null) {
        return offer.marketUnconvertible
          ? `Recorded results exist, but no rate converts them into ${offer.currency}`
          : "No recorded results for these copies yet";
      }
      const market = offer.marketPrice!;
      const without = market.noEvidenceCopies > 0 ? `; ${copies(market.noEvidenceCopies)} without any` : "";
      return `What recorded results paid per set — ${copies(market.copies)} with results${without}`;
    }
    case "cost":
      return offer.setsTotals.costEstimated
        ? "What the copies cost per set — partly an estimate, while their lot is open"
        : "What the copies cost per set";
    case "own":
      return editable ? `${ownLabel} — click it to change it` : ownLabel;
  }
}

/** The short note in brackets after a row's name (#1839): what the figure is, and nothing more. */
function note(row: OfferPriceRow, offer: OfferPriceTableOffer): { text: string; warn: boolean } | null {
  switch (row.key) {
    case "catalogue": {
      const text = describeCatalogueNote(offer.catalogNames);
      return text ? { text, warn: false } : null;
    }
    case "estimated":
      return offer.suggestedEstimate
        ? {
            text: describeEstimateNote(offer.suggestedEstimate.ratio),
            // An estimate resting on a figure the collector typed must never read as learned (#1828).
            warn: isStatedSource(offer.suggestedEstimate.source),
          }
        : null;
    case "market":
      return row.amount === null
        ? { text: offer.marketUnconvertible ? "no exchange rate" : "no recorded results", warn: false }
        : null;
    case "cost":
      return offer.setsTotals.costEstimated ? { text: "estimate — purchase lot still open", warn: false } : null;
    case "own":
      return offer.priceBase ? { text: `≈ ${offer.priceBase} ${offer.baseCurrency}`, warn: false } : null;
    default:
      return null;
  }
}

const NAME: Record<Exclude<OfferPriceRowKey, "own">, string> = {
  minimum: "Minimum",
  catalogue: "Catalogue",
  estimated: "Estimated",
  market: "Market",
  cost: "Cost",
};

/**
 * The offer's price area as a small table (#1829), made to read without its tooltips (#1839): three
 * headed columns — the row's name with a short note in brackets, *Price*, *Profit over cost* — the
 * platform's minimum, the catalogue value, Estimated value (the suggestion), what the market paid,
 * what the copies cost, and the offer's own price last. Every figure is per set and in the offer's
 * currency. A figure that does not exist is left out (#1184), except Market, which says why it is
 * empty, and the offer's own price, which is where it is set.
 *
 * Every figure in the Price column but the cost and the offer's own price is a link: clicking it
 * writes the figure the seller **states** (`target`) — never an auction's current price, which would
 * be recording a bid nobody placed. A figure that already is that price is drawn plain, since
 * clicking it would change nothing; nothing is a link on an offer that is closed. The offer's own
 * price reads as text and turns into its field on click (`priceEditor`, the panel's `InlineText`).
 */
export function OfferPriceTable({
  offer,
  askingPrice,
  target,
  ownLabel,
  priceEditor,
  editable,
  disabled,
  onApply,
}: {
  offer: OfferPriceTableOffer;
  /** The stated figure the prices are compared with, or null when none is stated. */
  askingPrice: string | null;
  /** The field a click writes, as the hint names it: "price", or an auction's "starting price". */
  target: string;
  /** What the offer's own price is called on its row — *Your price*, or an auction's current one. */
  ownLabel: string;
  /** The offer's own price, as text that becomes its field when clicked. */
  priceEditor: React.ReactNode;
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
    own: offer.price === "0.00" ? null : offer.price,
  });
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto auto auto",
        columnGap: "0.875rem",
        rowGap: "0.125rem",
        alignItems: "baseline",
        fontSize: "0.75rem",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span />
      <Tooltip content={`Per set, in ${offer.currency}`} align="end" style={{ justifySelf: "end" }}>
        <span style={HEADING}>Price</span>
      </Tooltip>
      <span style={HEADING}>Profit over cost</span>
      {rows.map((row) => {
        const own = row.key === "own";
        const rowNote = note(row, offer);
        const linked =
          row.key !== "cost" && !own && row.amount !== null && editable && askingPrice !== row.amount;
        const sign = row.margin ? marginSign(row.margin) : 0;
        return (
          <div key={row.key} style={{ display: "contents" }}>
            {own && (
              <span
                aria-hidden
                style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--color-border)", margin: "0.125rem 0" }}
              />
            )}
            <span style={{ color: "var(--color-text-secondary)", fontWeight: own ? 600 : undefined }}>
              <Tooltip content={about(row, offer, ownLabel, editable)} align="end">
                <span>{row.key === "own" ? ownLabel : NAME[row.key]}</span>
              </Tooltip>
              {row.key === "estimated" && (
                <span
                  style={{
                    marginLeft: "0.375rem",
                    padding: "0 0.3125rem",
                    borderRadius: "999px",
                    background: "var(--color-accent-soft)",
                    color: "var(--color-accent)",
                    fontSize: "0.6875rem",
                    fontWeight: 500,
                  }}
                >
                  suggested
                </span>
              )}
              {rowNote && (
                <span
                  style={{
                    marginLeft: "0.375rem",
                    fontWeight: 400,
                    color: rowNote.warn ? "var(--color-warning)" : "var(--color-text-muted)",
                  }}
                >
                  ({rowNote.text})
                </span>
              )}
            </span>
            <span style={{ justifySelf: "end", fontWeight: own ? 600 : undefined, fontSize: own ? "0.875rem" : undefined }}>
              {own ? (
                priceEditor
              ) : row.amount === null ? (
                <span style={MUTED}>—</span>
              ) : linked ? (
                <Tooltip content={`Use as the offer's ${target}`} align="end">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onApply(row.amount!)}
                    style={{
                      padding: 0,
                      background: "none",
                      border: "none",
                      font: "inherit",
                      color: "var(--color-accent)",
                      textDecoration: "underline",
                      textUnderlineOffset: "2px",
                      cursor: "pointer",
                    }}
                  >
                    {row.amount}
                  </button>
                </Tooltip>
              ) : (
                <span style={{ color: "var(--color-text-secondary)" }}>{row.amount}</span>
              )}
            </span>
            <span
              style={{
                justifySelf: "end",
                color:
                  sign < 0 ? "var(--color-warning)" : sign > 0 ? "var(--color-success)" : "var(--color-text-muted)",
              }}
            >
              {row.margin ? formatPriceMargin(row.margin) : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
