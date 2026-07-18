import {
  pickCatalogPriceFor,
  baseValueOf,
  type PickedPrice,
  type RawCatalogPrice,
} from "./catalog-price";

// Pure copy-valuation domain logic (ADR-0007 §7). No Prisma / server-only, so it is
// unit-testable in isolation; the server assembles the inputs in `items.ts`.
//
// A physical copy (`Item`) is valued from the catalog at the copy's own condition and
// certificate status, using the stamp's area primary catalog name at its latest
// recorded edition (the same "headline" selection lists use), with:
//
//   - Identified copy (links to a variant row) → that variant's own price.
//   - Unknown-variant copy (links to a base stamp that has variants):
//       1. the base stamp's own price if one exists at that condition/cert, else
//       2. the LOWEST price among all descendant variants, compared in base currency.
//     Either way the value is flagged `uncertain` — the variant identity is unknown.
//
// Certificate matching is exact (null = none); there is no fall-back across
// certificate levels. When no price matches, the copy is `unpriced`.

export interface CopyValuationInput {
  conditionId: string;
  certificateStatusId: string | null;
  /** True when the copy links to a base stamp that has variants (variant unknown). */
  unknownVariant: boolean;
  /** Primary catalog name id resolved from the copy's stamp area (may be null). */
  primaryCatalogNameId: string | null;
  /** The linked stamp's own catalog prices. */
  ownPrices: RawCatalogPrice[];
  /** Per-descendant-variant catalog prices; only consulted for unknown-variant copies
   * whose base stamp has no matching price of its own. Each inner array is one variant. */
  variantPrices?: RawCatalogPrice[][];
  baseCurrency: string;
  /** Non-base currency → base rate (see `safeRateMap`); missing/undefined = no rate. */
  rates: Map<string, number | null>;
}

export interface CopyValuation {
  /** Picked price in its own catalog currency (2-dp string), or null when unpriced. */
  amount: string | null;
  currency: string | null;
  /** Value in the collection base currency, or null when unpriced or unconvertible. */
  baseAmount: number | null;
  /** Base-currency value as a 2-dp string, or null. */
  baseAmountDisplay: string | null;
  /** True when the copy's variant is unknown → value is a lowest-variant estimate. */
  uncertain: boolean;
  /** True when no catalog price matched (condition/cert/catalog). */
  unpriced: boolean;
}

/** Value a single physical copy from the catalog. Pure; see module header for the rule. */
export function valuateCopy(input: CopyValuationInput): CopyValuation {
  const { conditionId, certificateStatusId, primaryCatalogNameId, baseCurrency, rates } = input;
  const pick = (prices: RawCatalogPrice[]) =>
    pickCatalogPriceFor(prices, primaryCatalogNameId, conditionId, certificateStatusId);

  const own = pick(input.ownPrices);

  // Identified copy: its own price, certain.
  if (!input.unknownVariant) {
    return toValuation(own, false, baseCurrency, rates);
  }

  // Unknown variant, base stamp priced directly: use it, flagged uncertain.
  if (own) {
    return toValuation(own, true, baseCurrency, rates);
  }

  // Unknown variant, base stamp unpriced: lowest descendant-variant price (in base currency).
  const candidates = (input.variantPrices ?? [])
    .map(pick)
    .filter((p): p is PickedPrice => p !== null);
  return toValuation(pickLowestByBase(candidates, baseCurrency, rates), true, baseCurrency, rates);
}

/** The candidate with the lowest base-currency value. Unconvertible candidates (no rate)
 * cannot be compared, so they are skipped; if every candidate is unconvertible the first is
 * returned (amount known, base value unknown). Null when there are no candidates. */
function pickLowestByBase(
  candidates: PickedPrice[],
  baseCurrency: string,
  rates: Map<string, number | null>
): PickedPrice | null {
  if (candidates.length === 0) return null;
  let best: PickedPrice | null = null;
  let bestBase: number | null = null;
  for (const c of candidates) {
    const bv = baseValueOf(c.amount, c.currency, baseCurrency, rates);
    if (bv === null) continue;
    if (bestBase === null || bv < bestBase) {
      best = c;
      bestBase = bv;
    }
  }
  return best ?? candidates[0];
}

function toValuation(
  picked: PickedPrice | null,
  uncertain: boolean,
  baseCurrency: string,
  rates: Map<string, number | null>
): CopyValuation {
  if (!picked) {
    return {
      amount: null,
      currency: null,
      baseAmount: null,
      baseAmountDisplay: null,
      uncertain,
      unpriced: true,
    };
  }
  const baseAmount = baseValueOf(picked.amount, picked.currency, baseCurrency, rates);
  return {
    amount: picked.amount.toFixed(2),
    currency: picked.currency,
    baseAmount,
    baseAmountDisplay: baseAmount === null ? null : baseAmount.toFixed(2),
    uncertain,
    unpriced: false,
  };
}

export interface HoldingsTotal {
  baseCurrency: string;
  /** Sum of convertible copy values in the base currency, 2-dp string. */
  totalBaseAmount: string;
  /** Copies contributing a base amount to the total. */
  pricedCount: number;
  /** Copies with no matching catalog price. */
  unpricedCount: number;
  /** Copies that have a price but in a currency with no available base rate. */
  unconvertibleCount: number;
  /** Priced copies whose value is variant-uncertain (unknown variant). */
  uncertainCount: number;
  /** Portion of the total contributed by uncertain copies, 2-dp string. */
  uncertainBaseAmount: string;
}

/** Aggregate per-copy valuations into a holdings total in the base currency. Pure. */
export function aggregateHoldings(
  valuations: CopyValuation[],
  baseCurrency: string
): HoldingsTotal {
  let total = 0;
  let uncertainTotal = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let unconvertibleCount = 0;
  let uncertainCount = 0;
  for (const v of valuations) {
    if (v.unpriced) {
      unpricedCount++;
      continue;
    }
    if (v.baseAmount === null) {
      unconvertibleCount++;
      continue;
    }
    pricedCount++;
    total += v.baseAmount;
    if (v.uncertain) {
      uncertainCount++;
      uncertainTotal += v.baseAmount;
    }
  }
  return {
    baseCurrency,
    totalBaseAmount: total.toFixed(2),
    pricedCount,
    unpricedCount,
    unconvertibleCount,
    uncertainCount,
    uncertainBaseAmount: uncertainTotal.toFixed(2),
  };
}
