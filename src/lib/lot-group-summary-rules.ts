// **A summary of a group's lots** (#2326): what a proposal's lots, or a Facebook post's, come to — at
// the top of either screen, in every state, in the shape of the Offers list's summary bar. Pure — no
// Prisma import — so the counting rules are unit-tested on their own; `lot-group-summary.ts` reads the
// lots.
//
// **The figures are the lots' price tables', summed** — the rules of the totals pinned under the lots
// while they are priced (#2218, `postPriceTotals`), over the saved prices: each lot's Catalogue,
// Estimated, Market and Cost are its row's (`offerPriceFigures`, per set), carried into the collection's
// base currency by the server; the prices are weighed against each total, and **profit / loss** is the
// prices against the cost. A lot with no figure is left out of that figure's total, as *over N of M
// lots*; a lot whose currency could not be converted is counted apart and summed nowhere. **Withdrawn
// lots are left out**, as a proposal's total always left them.
//
// **Once lots have sold**, a line of its own: what their sale lines brought in, in the base currency at
// each sale's own rate, against the cost of the sets sold.

import type { OfferState } from "./offer-rules";
import { priceMargin, type PriceMargin } from "./offer-price-table";
import { postPriceTotals, type PostPriceTotals, type PostTotalsLot, type PriceDraft } from "./facebook-post-price-totals";

/** One lot as the summary reads it, every figure already in the base currency — or, when its own
 *  currency could not be converted, left in that currency, which the summary counts apart. */
export interface GroupSummaryLot extends PostTotalsLot {
  state: OfferState;
  setCount: number;
  itemCount: number;
  /** What the lot's sold sets brought in — null while none has sold. `amount` is in the base currency,
   *  null when a sale's rate is unknown. */
  sold: { sets: number; amount: string | null } | null;
}

export interface LotGroupSoldSummary {
  /** Lots with a set sold. */
  lots: number;
  /** What they brought in, base currency, over the lots whose sales convert; null when none does. */
  amount: string | null;
  /** Sold lots left out of {@link amount} — a sale in a currency with no rate. */
  unconvertible: number;
  /** What the sets sold cost, over the lots whose cost is known; null when none's is. */
  cost: string | null;
  costLots: number;
  /** What was brought in against the cost, over the lots with both; null when none has both. */
  profit: PriceMargin | null;
  profitLots: number;
}

export interface LotGroupSummary {
  baseCurrency: string;
  /** The asking figures: the lots not withdrawn, at their saved prices. */
  asking: PostPriceTotals;
  sets: number;
  copies: number;
  /** Lots not withdrawn with no price yet. */
  unpriced: number;
  /** Null until a lot has sold. */
  sold: LotGroupSoldSummary | null;
}

const NO_DRAFTS: ReadonlyMap<string, PriceDraft> = new Map();

const cents = (value: number) => Math.round(value * 100) / 100;

/** The summary over the group's lots, in lot order. */
export function lotGroupSummary(lots: readonly GroupSummaryLot[], baseCurrency: string): LotGroupSummary {
  const counted = lots.filter((l) => l.state !== "withdrawn");
  const asking = postPriceTotals(counted, NO_DRAFTS, baseCurrency);
  const inBase = counted.filter((l) => l.currency === baseCurrency);

  const soldLots = counted.filter((l) => l.sold !== null && l.sold.sets > 0);
  let sold: LotGroupSoldSummary | null = null;
  if (soldLots.length > 0) {
    let amount = 0;
    let amountLots = 0;
    let cost = 0;
    let costLots = 0;
    let bothAmount = 0;
    let bothCost = 0;
    let both = 0;
    for (const lot of soldLots) {
      const brought = lot.sold!.amount === null ? null : Number(lot.sold!.amount);
      if (brought !== null) {
        amount += brought;
        amountLots++;
      }
      // The cost is per set (`offerPriceFigures`), so the sets sold are what it is taken for; a lot
      // left in its own currency has no cost the base can sum.
      const perSet = lot.currency === baseCurrency && lot.costPrice !== null ? Number(lot.costPrice) : NaN;
      const setsCost = Number.isFinite(perSet) && perSet >= 0 ? perSet * lot.sold!.sets : null;
      if (setsCost !== null) {
        cost += setsCost;
        costLots++;
      }
      if (brought !== null && setsCost !== null) {
        bothAmount += brought;
        bothCost += setsCost;
        both++;
      }
    }
    sold = {
      lots: soldLots.length,
      amount: amountLots > 0 ? cents(amount).toFixed(2) : null,
      unconvertible: soldLots.length - amountLots,
      cost: costLots > 0 ? cents(cost).toFixed(2) : null,
      costLots,
      profit: both > 0 ? priceMargin(cents(bothAmount), cents(bothCost)) : null,
      profitLots: both,
    };
  }

  return {
    baseCurrency,
    asking,
    sets: inBase.reduce((n, l) => n + l.setCount, 0),
    copies: inBase.reduce((n, l) => n + l.itemCount, 0),
    unpriced: asking.lotCount - asking.priced,
    sold,
  };
}

/** Converts one lot's figures into the base currency at `rate` (its currency → base): the prices and
 *  every figure of its price table. Null `rate` leaves the lot as it is, in its own currency, which the
 *  summary then counts apart. */
export function lotInBase<T extends PostTotalsLot>(lot: T, baseCurrency: string, rate: number | null): T {
  if (lot.currency === baseCurrency || rate === null) return lot;
  const convert = (amount: string | null) => (amount === null ? null : cents(Number(amount) * rate).toFixed(2));
  return {
    ...lot,
    currency: baseCurrency,
    price: convert(lot.price) ?? "0.00",
    startingPrice: convert(lot.startingPrice),
    catalogPrice: convert(lot.catalogPrice),
    suggestedPrice: convert(lot.suggestedPrice),
    marketPrice: lot.marketPrice === null ? null : { ...lot.marketPrice, amount: convert(lot.marketPrice.amount)! },
    costPrice: convert(lot.costPrice),
  };
}
