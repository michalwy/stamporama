"use client";

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { formatPriceMargin, marginSign } from "@/lib/offer-price-table";
import {
  describeLotCoverage,
  type PostPriceKind,
  type PostPriceTotals,
  type PostTotalKey,
} from "@/lib/facebook-post-price-totals";

// The post's totals while its lots are priced (#2218): pinned to the bottom of the window, the width of
// the lots, so the post's sum stays in view however far down the lots the collector has typed. The
// figures are `postPriceTotals`'; this only lays them across as a lot's price strip lays its own —
// each column its name, its total and what the prices make against it, in a row's colours and signs.

const NAME: Record<PostTotalKey, string> = {
  catalogue: "Catalogue",
  estimated: "Estimated",
  market: "Market",
  cost: "Cost",
};

const ABOUT: Record<PostTotalKey, string> = {
  catalogue: "The lots' catalogue values, summed",
  estimated: "The lots' estimated values — catalogue × the learned realisation ratio — summed",
  market: "What recorded results paid for the lots' copies, summed",
  cost: "What the lots' copies cost, summed",
};

const PRICE_NAME: Record<PostPriceKind, string> = {
  price: "Prices",
  starting: "Starting prices",
  mixed: "Prices and starting prices",
};

const MUTED: React.CSSProperties = { color: "var(--color-text-muted)" };

const BAR: React.CSSProperties = {
  position: "sticky",
  bottom: 0,
  // Above the rows scrolling beneath it; below the portalled menus (200) and dialogs (100).
  zIndex: 4,
  display: "flex",
  alignItems: "flex-start",
  flexWrap: "wrap",
  gap: "0.5rem 1.5rem",
  padding: "0.625rem 0.875rem",
  borderTop: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  boxShadow: "0 -6px 8px -6px rgba(0, 0, 0, 0.28)",
};

const lots = (n: number) => `${n} lot${n === 1 ? "" : "s"}`;

export function PostPriceTotalsBar({ totals }: { totals: PostPriceTotals }) {
  const priceName = PRICE_NAME[totals.priceKind];
  const pricedOver = describeLotCoverage(totals.priced, totals.lotCount);
  return (
    <div role="status" aria-label="Post totals" style={BAR}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", fontSize: "0.8125rem" }}>
        <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Post total</span>
        <span style={{ ...MUTED, fontSize: "0.75rem" }}>
          {lots(totals.lotCount)}, in {totals.currency}
          {totals.otherCurrency > 0 && ` · ${lots(totals.otherCurrency)} in another currency left out`}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateRows: "auto auto auto auto",
          gridAutoFlow: "column",
          gridAutoColumns: "minmax(5rem, auto)",
          columnGap: "1.25rem",
          rowGap: "0.0625rem",
          alignItems: "baseline",
          fontSize: "0.75rem",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {totals.columns.map((column) => {
          const over = describeLotCoverage(column.lots, totals.lotCount);
          const sign = column.margin ? marginSign(column.margin) : 0;
          const marginHint =
            column.margin === null
              ? null
              : `What the ${priceName.toLowerCase()} make against it${
                  column.marginLots < column.lots || column.marginLots < totals.priced
                    ? `, over the ${lots(column.marginLots)} with both`
                    : ""
                }`;
          return (
            <div key={column.key} style={{ display: "contents" }}>
              <span style={{ ...MUTED, justifySelf: "end", whiteSpace: "nowrap" }}>
                <Tooltip content={`${ABOUT[column.key]}, in ${totals.currency}`} align="end">
                  <span>{NAME[column.key]}</span>
                </Tooltip>
              </span>
              <span style={{ justifySelf: "end", whiteSpace: "nowrap", color: "var(--color-text-secondary)", fontSize: "0.8125rem" }}>
                {column.amount ?? <span style={MUTED}>—</span>}
              </span>
              <span
                style={{
                  justifySelf: "end",
                  whiteSpace: "nowrap",
                  color:
                    sign < 0 ? "var(--color-warning)" : sign > 0 ? "var(--color-success)" : "var(--color-text-muted)",
                }}
              >
                {column.margin && marginHint ? (
                  <Tooltip content={marginHint} align="end">
                    <span>{formatPriceMargin(column.margin)}</span>
                  </Tooltip>
                ) : (
                  " "
                )}
              </span>
              <span style={{ ...MUTED, justifySelf: "end", whiteSpace: "nowrap" }}>{over ?? " "}</span>
            </div>
          );
        })}
        <span style={{ justifySelf: "end", whiteSpace: "nowrap", fontWeight: 600, color: "var(--color-text-secondary)" }}>
          <Tooltip content={`The lots' ${priceName.toLowerCase()}, summed — a price being typed counts at once`} align="end">
            <span>{priceName}</span>
          </Tooltip>
        </span>
        <span style={{ justifySelf: "end", whiteSpace: "nowrap", fontWeight: 600, fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
          {totals.price === null ? <span style={MUTED}>—</span> : `${totals.price} ${totals.currency}`}
        </span>
        <span style={{ ...MUTED, justifySelf: "end", whiteSpace: "nowrap" }}>
          {totals.priced === 0 ? "No lot priced yet" : " "}
        </span>
        <span style={{ ...MUTED, justifySelf: "end", whiteSpace: "nowrap" }}>{pricedOver ?? " "}</span>
      </div>
    </div>
  );
}
