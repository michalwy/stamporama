import {
  pickFormatCatalogPrice,
  pickLowestByBase,
  baseValueOf,
  type PickedPrice,
  type RawCatalogPrice,
} from "./catalog-price";
import type { CostBasisTotal } from "./cost-basis";

// Pure copy-valuation domain logic (ADR-0007 §7). No Prisma / server-only, so it is
// unit-testable in isolation; the server assembles the inputs in `items.ts`.
//
// A physical copy (`Item`) is valued from the catalog at the copy's own condition,
// certificate status **and physical format** (#343), using the stamp's area primary catalog name
// at its latest recorded edition (the same "headline" selection lists use), with:
//
// A copy that is a multiple is valued as that multiple, never as a single: an explicit price for
// its format wins, and failing that the single's price is scaled by the format's multiplier
// (ADR-0020 — catalogs publish one factor per issue and an explicit price only where the multiple
// deviates). Only with neither is the copy unpriced.
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
  /** The copy's physical format (#343); null is the single, which is most copies. */
  formatId?: string | null;
  /** Multiplier deriving that format's price from the single's, when no explicit price for the
   *  format exists. Null when none applies — the copy is then unpriced rather than valued as a
   *  single, which would be a different stamp's figure. */
  formatFactor?: number | null;
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
    pickFormatCatalogPrice(
      prices,
      primaryCatalogNameId,
      conditionId,
      certificateStatusId,
      input.formatId ?? null,
      input.formatFactor ?? null
    ).picked;

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

/** What the **market** paid for the same held copies (#458; ADR-0022 §8), each valued at the median
 * for its own `condition × certificate × format` key.
 *
 * A third answer beside catalogue value and cost basis, and deliberately not a replacement for
 * either: the catalogue is a list price, the cost is what was paid for these copies, and this is
 * what copies like them fetched at auction.
 *
 * The coverage counts are **not** decoration. Market value exists only where lots have been
 * recorded, which on a self-built base is a fraction of a collection — so a total is stated with
 * the number of copies behind it and the number it could say nothing about. A total built from 12%
 * of the collection must never read as the collection's worth. */
export interface MarketHoldingsTotal {
  baseCurrency: string;
  /** Sum of the per-copy medians, 2-dp string. */
  totalBaseAmount: string;
  /** Copies whose key had evidence and so contributed to the total. */
  valuedCount: number;
  /** Copies whose key had no datapoints. They contribute **nothing** — no catalogue-derived
   * substitute is used, since a key with no results has no market value at all (ADR-0022 §6). */
  noEvidenceCount: number;
}

/** The holdings summary bar's full figure (#134): the catalog {@link HoldingsTotal} plus
 * the actual purchase {@link CostBasisTotal} aggregated over the same filtered copy set,
 * so a collector can compare paid-vs-catalog value at a glance. The {@link MarketHoldingsTotal}
 * (#458) is the third reading of the same copies.
 *
 * All three figures cover the copies **actually held** (`isHeld`, #396). What the predicate
 * excludes is not dropped, it is moved: {@link writeOff} carries the cost of the copies in the same
 * scope that are gone, so the two halves partition the scope instead of some of it silently
 * vanishing. */
export interface HoldingsSummary extends HoldingsTotal {
  cost: CostBasisTotal;
  writeOff: WriteOffTotal;
  market: MarketHoldingsTotal;
}

/** What the copies in scope that are no longer held cost (#396) — disposed after delivery (#394),
 * or never arrived in usable form (`not_delivered` / `damaged`).
 *
 * Only a **cost** figure, never a catalog value: catalog value answers "what is my collection
 * worth", and a copy that is gone is worth nothing to its owner however the catalog prices it. The
 * cost, by contrast, was really paid, and omitting it would flatter purchase performance by hiding
 * exactly the copies that did not work out. */
export interface WriteOffTotal {
  /** Cost basis of those copies, aggregated exactly as held copies' is. */
  cost: CostBasisTotal;
  /** How many copies are in it — including the ones whose cost is pending or unrecorded, which
   * contribute nothing to the total but are still gone. */
  count: number;
}

/** How many copies a {@link CostBasisTotal} was aggregated over: every copy lands in exactly one
 * of the three states, so the counts partition the set. */
export function costBasisCopyCount(total: CostBasisTotal): number {
  return total.knownCount + total.pendingCount + total.noneCount;
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

/**
 * Aggregate per-copy **market** medians into a holdings total (#458). Pure.
 *
 * One entry per copy in scope, already resolved to that copy's own key: the median in the base
 * currency, or `null` where the key has no datapoints. A `null` is counted, never valued — it is
 * the difference between "worth nothing" and "nothing recorded", and only the second is true here.
 *
 * There is no conversion to do: a market median is aggregated in the base currency to begin with
 * (ADR-0022 §2 converts at the rate frozen on the lot), so there is no `unconvertible` third state
 * the way catalogue valuation has one.
 */
export function aggregateMarketHoldings(
  medians: (number | null)[],
  baseCurrency: string
): MarketHoldingsTotal {
  let total = 0;
  let valuedCount = 0;
  let noEvidenceCount = 0;
  for (const median of medians) {
    if (median === null) {
      noEvidenceCount++;
      continue;
    }
    valuedCount++;
    total += median;
  }
  return {
    baseCurrency,
    totalBaseAmount: total.toFixed(2),
    valuedCount,
    noEvidenceCount,
  };
}
