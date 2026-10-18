/**
 * *Sell* over one offer or several (#2050), and the toast that follows it (#2049) — the pure half of
 * `SellOfferFlowDialog`.
 *
 * Several ticked offers go into **one sale**, which is single-platform and single-currency, so the
 * ticked offers must share both. Rather than refuse the whole selection over one stray, the plan
 * picks the platform and currency **most** of the offers that can still be sold are on (the first
 * ticked breaking a tie), sells those, and names every other one with the reason it was left out —
 * as every bulk action here reports its refusals per offer (#323). An offer with nothing left to sell
 * is named the same way; when nothing at all is left the dialog refuses.
 *
 * Each offer sells **every set it still has**, at its own price — exactly the lines its own *Sell*
 * would write, so selling five offers together and one after another into the same sale are the
 * same sale.
 */

/** An offer *Sell* was asked about, as the plan needs to see it. */
export interface SaleCandidate {
  id: string;
  offerNo: number;
  platformId: string;
  platformName: string;
  currency: string;
  /** What each of its sets sells at: the offer's current price — a Facebook auction's standing bid. */
  price: string;
  /** Known already to have nothing to sell — withdrawn, sold, or holding no set — as the row's own
   *  *Sell* is not offered then. Left out of the choice of platform, and named. */
  closed?: boolean;
}

/** The platform and currency the sale will be on. */
export interface SaleTarget {
  platformId: string;
  platformName: string;
  currency: string;
}

/** One set still to sell, as the sellable-offers read gives it. */
export interface SellableSet {
  offerSetId: string;
  itemIds: string[];
}

export interface PlannedSaleLine {
  offerId: string;
  offerSetId: string;
  price: string;
  itemIds: string[];
}

export interface SaleSkip<T extends SaleCandidate> {
  offer: T;
  reason: string;
}

export interface SalePlan<T extends SaleCandidate> {
  /** The offers that go into the sale, in the order they were given. */
  sold: T[];
  lines: PlannedSaleLine[];
  /** The offers left out, in the order they were given, each with why. */
  skipped: SaleSkip<T>[];
}

const NOTHING_LEFT = "has nothing left to sell";

/**
 * The platform and currency the sale goes on: the pair most of the open candidates share, the first
 * one given winning a tie. Null when every candidate is closed — there is nothing to sell.
 */
export function saleTargetOf(candidates: readonly SaleCandidate[]): SaleTarget | null {
  const counts = new Map<string, { target: SaleTarget; n: number }>();
  for (const c of candidates) {
    if (c.closed) continue;
    const key = `${c.platformId}\u0000${c.currency}`;
    const entry = counts.get(key);
    if (entry) entry.n += 1;
    else counts.set(key, { target: { platformId: c.platformId, platformName: c.platformName, currency: c.currency }, n: 1 });
  }
  let best: { target: SaleTarget; n: number } | null = null;
  // Map iteration is insertion order, so a strict `>` keeps the first-given pair on a tie.
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  return best?.target ?? null;
}

/**
 * Which offers go into the sale and with which lines. `sellable` is the sets each offer on the
 * target's platform still has (an offer missing from it has none); `onlySetId` scopes a single
 * offer's flow to one set (#473).
 */
export function planOfferSale<T extends SaleCandidate>(
  candidates: readonly T[],
  target: SaleTarget | null,
  sellable: ReadonlyMap<string, readonly SellableSet[]>,
  onlySetId: string | null = null
): SalePlan<T> {
  const sold: T[] = [];
  const lines: PlannedSaleLine[] = [];
  const skipped: SaleSkip<T>[] = [];
  for (const offer of candidates) {
    if (offer.closed || !target) {
      skipped.push({ offer, reason: NOTHING_LEFT });
      continue;
    }
    if (offer.platformId !== target.platformId) {
      skipped.push({ offer, reason: `is on ${offer.platformName}, not ${target.platformName}` });
      continue;
    }
    if (offer.currency !== target.currency) {
      skipped.push({ offer, reason: `is in ${offer.currency}, not ${target.currency}` });
      continue;
    }
    const sets = (sellable.get(offer.id) ?? []).filter((s) => onlySetId === null || s.offerSetId === onlySetId);
    if (sets.length === 0) {
      skipped.push({ offer, reason: NOTHING_LEFT });
      continue;
    }
    sold.push(offer);
    for (const s of sets) {
      lines.push({ offerId: offer.id, offerSetId: s.offerSetId, price: offer.price, itemIds: s.itemIds });
    }
  }
  return { sold, lines, skipped };
}

/**
 * The toast after *Sell* (#2049): what went into which sale, and to whom — *Offer #412 added to sale
 * #12 · Jan Kowalski*. The collector stays where they were, so this is how the sale is reached.
 */
export function soldIntoSaleMessage(input: {
  offerNos: readonly number[];
  /** One set of the one offer was sold, not the whole offer (#473). */
  oneSet: boolean;
  saleNo: number;
  buyerName: string | null;
}): string {
  const { offerNos, oneSet, saleNo, buyerName } = input;
  const what =
    offerNos.length === 1
      ? `${oneSet ? "A set of offer" : "Offer"} #${offerNos[0]}`
      : `${offerNos.length} offers`;
  return `${what} added to sale #${saleNo}${buyerName ? ` · ${buyerName}` : ""}`;
}
