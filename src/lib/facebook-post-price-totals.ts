// **A post's totals while its lots are priced** (#2218): what the post's lots' prices come to, and what
// they make against the lots' catalogue, estimated, market and cost figures summed — the bar pinned to
// the bottom of a post's screen until the post is up. Pure — no Prisma import — so the counting rules
// below are unit-tested on their own.
//
// **It reads as a lot's price table does, summed**: each lot's figures are its row's (#1894's
// `offerPriceFigures`, already per set and in the offer's currency, the cost converted as the row
// converts it), and the margins are `priceMargin`'s, so a sign and a percentage read as on a row.
// Unlike a row, which weighs every figure against the cost, the bar weighs **the prices** against each
// total — what the post would bring in over its catalogue, its estimate, its market and its cost.
//
// **Nothing missing reads as 0** (#1184): a lot with no price yet is left out of the price total, and a
// lot without a figure out of that figure's total, each counted as *over N of M lots*. A margin is taken
// over the lots that carry **both** a price and that figure, so a lot priced but never valued — or
// valued but not yet priced — cannot tilt it.

import { isAuctionListing, type OfferListingType } from "./offer-rules";
import { priceMargin, type PriceMargin } from "./offer-price-table";

/** One lot as the bar reads it — the `PrepareOffer` fields it sums. Structural, so this stays pure. */
export interface PostTotalsLot {
  id: string;
  listingType: OfferListingType;
  /** The asking price of a quick buy; `0.00` while it has none. */
  price: string;
  /** What an auction opens at; null while unset. */
  startingPrice: string | null;
  currency: string;
  catalogPrice: string | null;
  suggestedPrice: string | null;
  marketPrice: { amount: string } | null;
  costPrice: string | null;
}

/** The figure the seller states on a lot (#449) — the asking price of a quick buy, the starting price
 *  of an auction — as its field shows it: blank while there is none. */
export function statedPrice(lot: Pick<PostTotalsLot, "listingType" | "price" | "startingPrice">): string {
  if (isAuctionListing(lot.listingType)) return lot.startingPrice ?? "";
  return lot.price === "0.00" ? "" : lot.price;
}

/** What a price field's text is worth as a figure — 2 dp — or null while it is not one: blank, not a
 *  number, or nothing above zero, which is no price. */
export function typedAmount(text: string): string | null {
  const trimmed = text.trim();
  const value = Number(trimmed);
  return trimmed !== "" && Number.isFinite(value) && value > 0 ? value.toFixed(2) : null;
}

/** A price being typed in a lot's field, with the saved figure it was typed over — so a draft left
 *  behind once the saved figure moves on (saved, or set from elsewhere) no longer counts. */
export interface PriceDraft {
  text: string;
  from: string;
}

/** The lot's price as the bar counts it: what is being typed, once it is typed, else what is saved. */
export function lotPriceFor(lot: PostTotalsLot, draft: PriceDraft | undefined): string | null {
  const saved = statedPrice(lot);
  return typedAmount(draft && draft.from === saved ? draft.text : saved);
}

export type PostTotalKey = "catalogue" | "estimated" | "market" | "cost";

export const POST_TOTAL_KEYS: readonly PostTotalKey[] = ["catalogue", "estimated", "market", "cost"];

export interface PostTotalColumn {
  key: PostTotalKey;
  /** The figure summed over the lots that carry it, 2 dp; null when none does. */
  amount: string | null;
  /** How many lots carry the figure. */
  lots: number;
  /** What the prices make against the figure, over the lots carrying both; null when none does. */
  margin: PriceMargin | null;
  /** How many lots the margin was taken over. */
  marginLots: number;
}

/** What the post's prices are, as the bar names them: asking prices, an auction's starting prices, or
 *  both in a post that mixes them. */
export type PostPriceKind = "price" | "starting" | "mixed";

export interface PostPriceTotals {
  currency: string;
  /** The lots summed — every lot in the post's currency. */
  lotCount: number;
  /** Lots priced in another currency, left out of every total rather than added in the wrong one. */
  otherCurrency: number;
  /** The lots' prices summed, 2 dp; null while no lot is priced. */
  price: string | null;
  priced: number;
  priceKind: PostPriceKind;
  columns: PostTotalColumn[];
}

function figureOf(lot: PostTotalsLot, key: PostTotalKey): number | null {
  const raw =
    key === "catalogue"
      ? lot.catalogPrice
      : key === "estimated"
        ? lot.suggestedPrice
        : key === "market"
          ? (lot.marketPrice?.amount ?? null)
          : lot.costPrice;
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  // A cost of zero is a known cost — copies that cost nothing — as on a row; any other figure at zero
  // is no figure (`offerPriceRows`).
  return key === "cost" ? (value >= 0 ? value : null) : value > 0 ? value : null;
}

const cents = (value: number) => Math.round(value * 100) / 100;

/**
 * The post's totals over its lots in lot order, `drafts` holding the prices being typed by lot id.
 * The post's currency is `currency` — its lots' own, which its group gives them; a lot in another is
 * counted apart and summed nowhere.
 */
export function postPriceTotals(
  lots: readonly PostTotalsLot[],
  drafts: ReadonlyMap<string, PriceDraft>,
  currency: string
): PostPriceTotals {
  const inCurrency = lots.filter((l) => l.currency === currency);
  const prices = inCurrency.map((l) => {
    const amount = lotPriceFor(l, drafts.get(l.id));
    return amount === null ? null : Number(amount);
  });

  let priceSum = 0;
  let priced = 0;
  for (const p of prices) {
    if (p === null) continue;
    priceSum += p;
    priced++;
  }

  const columns = POST_TOTAL_KEYS.map((key): PostTotalColumn => {
    let sum = 0;
    let count = 0;
    let bothPrice = 0;
    let bothFigure = 0;
    let both = 0;
    inCurrency.forEach((lot, i) => {
      const figure = figureOf(lot, key);
      if (figure === null) return;
      sum += figure;
      count++;
      const price = prices[i];
      if (price === null) return;
      bothPrice += price;
      bothFigure += figure;
      both++;
    });
    return {
      key,
      amount: count > 0 ? cents(sum).toFixed(2) : null,
      lots: count,
      margin: both > 0 ? priceMargin(cents(bothPrice), cents(bothFigure)) : null,
      marginLots: both,
    };
  });

  const auctions = inCurrency.filter((l) => isAuctionListing(l.listingType)).length;
  return {
    currency,
    lotCount: inCurrency.length,
    otherCurrency: lots.length - inCurrency.length,
    price: priced > 0 ? cents(priceSum).toFixed(2) : null,
    priced,
    priceKind: auctions === 0 ? "price" : auctions === inCurrency.length ? "starting" : "mixed",
    columns,
  };
}

/** `over 5 of 8 lots`, or null when every lot is counted. */
export function describeLotCoverage(counted: number, of: number): string | null {
  return counted < of ? `over ${counted} of ${of} lot${of === 1 ? "" : "s"}` : null;
}
