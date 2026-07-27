import { hasPrice } from "./offer-rules";

// Pure aggregation for the offer list's summary bar (#317). Kept apart from `offers.ts` — which
// imports Prisma — so the arithmetic is unit-testable, mirroring how `valuation.ts` holds
// `aggregateHoldings` for the holdings bar (#134).
//
// The figure the bar leads with is the **asking value**: what the filtered offers would bring in if
// every one of them sold at its listed price, expressed in the collection's base currency. Two
// things keep an offer out of that sum, and they are counted apart because they mean different
// things: an offer with no price yet is *unfinished* (a `preparing` listing normally has none),
// while an offer priced in a currency with no known rate is *unconvertible* — its money is real,
// we just cannot state it here.

/** One offer as the summary reads it: its price, and the size of what it is selling. */
export interface OfferSummaryRow {
  platformId: string;
  platformName: string;
  /** Asking price as stored, in `currency`. */
  price: string;
  currency: string;
  /** Sellable sets the offer holds. */
  setCount: number;
  /** The copies across those sets, one entry per membership. */
  itemIds: string[];
}

/** The asking-value figures for one slice — the whole filtered set, or a single platform. The two
 * carry the same fields on purpose: the per-platform breakdown answers exactly the questions the
 * total does, one platform at a time. */
export interface OfferAskingTotal {
  /** Offers in this slice. */
  offerCount: number;
  /** Sum of the convertible asking prices in the base currency, 2-dp string. */
  askingBaseAmount: string;
  /** Offers contributing an amount to the total. */
  pricedCount: number;
  /** Offers with no asking price recorded yet. */
  unpricedCount: number;
  /** Priced offers in a currency with no available base rate. */
  unconvertibleCount: number;
  /** Sellable sets across the slice — the offer list's "quantity" summed. */
  setCount: number;
  /** Physical copies across those sets. Counted per membership: a copy listed on two platforms is
   * two lines here, because each offer is separately sellable. The holdings figures beside this one
   * deduplicate instead — they value the stock, and stock is not doubled by being listed twice. */
  itemCount: number;
}

export interface OfferPlatformTotal extends OfferAskingTotal {
  platformId: string;
  platformName: string;
  /** The distinct copies this platform's offers hold, for valuing its slice of the stock. */
  itemIds: string[];
}

export interface OffersAskingSummary extends OfferAskingTotal {
  baseCurrency: string;
  /** Per-platform breakdown, largest asking value first. Empty when the slice is empty. */
  platforms: OfferPlatformTotal[];
}

/** Aggregate offers into their asking total, plus a per-platform breakdown. `rates` maps a currency
 * to its rate into `baseCurrency`; an offer already in the base currency needs no entry, and a
 * missing entry is what makes an offer unconvertible. Pure. */
export function aggregateOfferAsking(
  rows: OfferSummaryRow[],
  baseCurrency: string,
  rates: Map<string, number>
): OffersAskingSummary {
  const perPlatform = new Map<string, { name: string; rows: OfferSummaryRow[] }>();
  for (const row of rows) {
    const entry = perPlatform.get(row.platformId);
    if (entry) entry.rows.push(row);
    else perPlatform.set(row.platformId, { name: row.platformName, rows: [row] });
  }

  const platforms = [...perPlatform.entries()]
    .map(([platformId, { name, rows: platformRows }]) => ({
      platformId,
      platformName: name,
      // Deduplicated within the platform: two offers on the same marketplace holding one copy are
      // two sellable listings (so `itemCount` counts both) but one piece of stock to value.
      itemIds: [...new Set(platformRows.flatMap((r) => r.itemIds))],
      ...askingTotal(platformRows, baseCurrency, rates),
    }))
    .sort(
      (a, b) =>
        Number(b.askingBaseAmount) - Number(a.askingBaseAmount) ||
        a.platformName.localeCompare(b.platformName)
    );

  return {
    baseCurrency,
    ...askingTotal(rows, baseCurrency, rates),
    platforms,
  };
}

function askingTotal(
  rows: OfferSummaryRow[],
  baseCurrency: string,
  rates: Map<string, number>
): OfferAskingTotal {
  let total = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let unconvertibleCount = 0;
  for (const row of rows) {
    if (!hasPrice(row.price)) {
      unpricedCount++;
      continue;
    }
    const rate = row.currency === baseCurrency ? 1 : rates.get(row.currency);
    if (rate === undefined) {
      unconvertibleCount++;
      continue;
    }
    pricedCount++;
    total += Number(row.price) * rate;
  }
  return {
    offerCount: rows.length,
    askingBaseAmount: total.toFixed(2),
    pricedCount,
    unpricedCount,
    unconvertibleCount,
    setCount: rows.reduce((n, r) => n + r.setCount, 0),
    itemCount: rows.reduce((n, r) => n + r.itemIds.length, 0),
  };
}
