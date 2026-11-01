"use client";

import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { usePersistedFlag } from "@/app/c/[collectionSlug]/shared/use-persisted-flag";
import { describeLotCoverage, type PostPriceKind, type PostTotalKey } from "@/lib/facebook-post-price-totals";
import type { LotGroupSummary } from "@/lib/lot-group-summary-rules";
import type { LotGroup } from "@/lib/offer-lot-group-rules";
import { formatPriceMargin, marginSign, type PriceMargin } from "@/lib/offer-price-table";
import { AMOUNT_STYLE, FRAME_STYLE, LABEL_STYLE, NOTE_STYLE, ROW_STYLE, TOGGLE_STYLE } from "../offers-summary-bar";

// The summary of a group's lots (#2326), at the top of a proposal's and a Facebook post's lots, in every
// state: the Offers list's summary bar (#317) over the lots — the price total and the counts, and under
// **More** the catalogue, estimated and market values and the purchase cost, each with what the prices
// make against it; against the cost that is the profit or loss. A line of its own once lots have sold.
// The figures are `lotGroupSummary`'s over the saved prices — the totals pinned under the lots while they
// are priced follow the typing.

/** Under the offers key, so a write to any lot — a price saved, a lot sold — refreshes it. */
export const lotGroupSummaryKey = (collectionId: string, group: LotGroup) =>
  ["offers", collectionId, "lot-group-summary", group.kind, group.id] as const;

function useLotGroupSummary(collectionId: string, group: LotGroup) {
  return useQuery<LotGroupSummary>({
    queryKey: lotGroupSummaryKey(collectionId, group),
    queryFn: async () => {
      const params = new URLSearchParams({ kind: group.kind, id: group.id });
      const res = await fetch(`/api/collections/${collectionId}/lot-group-summary?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch the summary");
      return res.json();
    },
  });
}

const PRICE_LABEL: Record<PostPriceKind, string> = {
  price: "Price total",
  starting: "Starting prices",
  mixed: "Prices",
};

const ROW_LABEL: Record<PostTotalKey, string> = {
  catalogue: "Catalogue value",
  estimated: "Estimated value",
  market: "Market value",
  cost: "Purchase cost",
};

const ABOUT: Record<PostTotalKey, string> = {
  catalogue: "The lots' catalogue values, summed — each lot's as its price table shows it",
  estimated: "The lots' estimated values — catalogue × the learned realisation ratio — summed",
  market: "What recorded results paid for the lots' copies, summed",
  cost: "What the lots' copies cost, summed",
};

const lots = (n: number) => `${n} lot${n === 1 ? "" : "s"}`;

/** An amount with its currency, or a dash while there is none — never `0.00` (#1184). */
const money = (amount: string | null, currency: string) => (amount === null ? "—" : `${amount} ${currency}`);

/** What the prices make against a figure, signed and coloured as on a lot's row; `profit` names it a
 *  profit or a loss. */
function Margin({ margin, profit, hint }: { margin: PriceMargin; profit?: boolean; hint: string }) {
  const sign = marginSign(margin);
  return (
    <Tooltip content={hint}>
      <span
        style={{
          ...NOTE_STYLE,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: sign < 0 ? "var(--color-warning)" : sign > 0 ? "var(--color-success)" : "var(--color-text-muted)",
        }}
      >
        {formatPriceMargin(margin)}
        {profit ? ` ${sign < 0 ? "loss" : "profit"}` : ""}
      </span>
    </Tooltip>
  );
}

export function LotGroupSummaryBar({ collectionId, group }: { collectionId: string; group: LotGroup }) {
  const { data: summary, isError } = useLotGroupSummary(collectionId, group);
  const [expanded, setExpanded] = usePersistedFlag(`stamporama:lot-group:summaryExpanded:${collectionId}`);

  if (isError) return null;
  if (!summary) {
    return (
      <div style={FRAME_STYLE} aria-hidden>
        <div style={ROW_STYLE}>
          <span style={LABEL_STYLE}>Price total</span>
          <span style={NOTE_STYLE}>Reading the lots…</span>
        </div>
      </div>
    );
  }

  const { asking, baseCurrency: currency } = summary;
  const priceName = PRICE_LABEL[asking.priceKind];
  const notes = [lots(asking.lotCount), `${summary.sets} sets`, `${summary.copies} copies`];
  if (summary.unpriced > 0) notes.push(`${summary.unpriced} not priced yet`);
  if (asking.otherCurrency > 0) notes.push(`${lots(asking.otherCurrency)} not convertible to ${currency}`);
  const sold = summary.sold;

  return (
    <div role="status" aria-label="Lots summary" style={FRAME_STYLE}>
      <div style={ROW_STYLE}>
        <Tooltip content="The lots not withdrawn, at their saved prices — an auction at its starting price">
          <span style={{ ...LABEL_STYLE, cursor: "help" }}>{priceName}</span>
        </Tooltip>
        <span style={AMOUNT_STYLE}>
          {money(asking.price, currency)}
        </span>
        <span style={NOTE_STYLE}>{notes.join(" · ")}</span>
        <Tooltip
          content={
            expanded
              ? "Hide the catalogue, estimated and market values and the purchase cost"
              : "Show the catalogue, estimated and market values and the purchase cost, against the prices"
          }
          align="end"
        >
          <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} style={TOGGLE_STYLE}>
            {expanded ? "Less" : "More"}
            <span aria-hidden>
              <Icon name={expanded ? "collapse" : "expand"} size="sm" />
            </span>
          </button>
        </Tooltip>
      </div>

      {sold && (
        <div style={ROW_STYLE}>
          <Tooltip content="What the sold lots' sales brought in, at each sale's own rate, against what the sets sold cost">
            <span style={{ ...LABEL_STYLE, cursor: "help" }}>Sold</span>
          </Tooltip>
          <span style={AMOUNT_STYLE}>
            {money(sold.amount, currency)}
          </span>
          <span style={NOTE_STYLE}>
            {lots(sold.lots)}
            {sold.unconvertible > 0 ? ` · ${sold.unconvertible} not convertible to ${currency}` : ""}
            {sold.cost !== null ? ` · cost ${sold.cost} ${currency}` : ""}
          </span>
          {sold.profit && (
            <Margin
              margin={sold.profit}
              profit
              hint={`What the sold lots brought in against their cost${
                sold.profitLots < sold.lots ? `, over the ${lots(sold.profitLots)} with both` : ""
              }`}
            />
          )}
        </div>
      )}

      {expanded &&
        asking.columns.map((column) => {
          const over = describeLotCoverage(column.lots, asking.lotCount);
          const isCost = column.key === "cost";
          return (
            <div key={column.key} style={ROW_STYLE}>
              <Tooltip content={`${ABOUT[column.key]}, in ${currency}`}>
                <span style={{ ...LABEL_STYLE, cursor: "help" }}>{ROW_LABEL[column.key]}</span>
              </Tooltip>
              <span style={AMOUNT_STYLE}>
                {money(column.amount, currency)}
              </span>
              {column.margin && (
                <Margin
                  margin={column.margin}
                  profit={isCost}
                  hint={`${isCost ? "Profit or loss — what" : "What"} the ${priceName.toLowerCase()} make against it${
                    column.marginLots < column.lots || column.marginLots < asking.priced
                      ? `, over the ${lots(column.marginLots)} with both`
                      : ""
                  }`}
                />
              )}
              {over && <span style={NOTE_STYLE}>{over}</span>}
            </div>
          );
        })}
    </div>
  );
}
