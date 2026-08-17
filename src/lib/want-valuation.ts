import { valuateCopy, type VariantPrices } from "./valuation";
import type { RawCatalogPrice } from "./catalog-price";
import type { WantAcceptance } from "./want-rules";

// What a want is likely to cost, from the catalogue (#532). Pure — no Prisma, no `server-only` —
// so it unit-tests like `valuation.ts`, which it is built on rather than beside.
//
// A want does not name one priced thing. Its acceptance sets (ADR-0032 §1) stand for a *set* of
// (condition, certificate, format) combinations — often the whole grid, since an empty set means
// "any" — and each of those has its own catalogue value. So the honest figure is a **range**: the
// cheapest and the dearest thing that would satisfy this want. A single number would have to pick
// one combination out of the set and would then be quietly answering a different question.
//
// The range is stated in the **base currency** and nothing else: the combinations can come off
// catalogues priced in different currencies, and a low and a high in two currencies are not a range
// at all.

/** The dictionaries an "any" axis expands to. Ids only; the caller has already scoped them to the
 *  collection. `null` is a member of the certificate and format lists — "no certificate" and
 *  "single" — because those are values, not the absence of one (ADR-0006 §2; `StampFormat`). */
export interface WantValuationDictionaries {
  conditionIds: string[];
  certificateStatusIds: (string | null)[];
  formatIds: (string | null)[];
}

/** Everything about the wanted stamp that pricing one of its combinations needs. */
export interface WantValuationStamp {
  /** True when the want points at a base stamp with variants — any of them would do, so the value
   *  is a lowest-variant estimate exactly as it is for a copy of unknown variant. */
  unknownVariant: boolean;
  primaryCatalogNameId: string | null;
  ownPrices: RawCatalogPrice[];
  /** One entry per descendant variant, tagged with the variant it belongs to (#616); only consulted
   *  for an unknown-variant want. */
  variantPrices: VariantPrices[];
}

/** What the row draws. Null when nothing the want accepts carries a price at all. */
export interface WantCatalogRange {
  /** Cheapest and dearest accepted combination, in the base currency, 2-dp strings. Equal when only
   *  one combination is priced — the row then shows a single figure rather than `12.00 – 12.00`. */
  minBase: string;
  maxBase: string;
  baseCurrency: string;
  /** Accepted combinations carrying a usable price, over how many the want accepts at all. A want
   *  for "anything" against a stamp priced in one condition is `1/24`, and the row says so: the
   *  range is real but it is not the whole story. */
  pricedCombinations: number;
  totalCombinations: number;
  /** True when any contributing figure was inferred rather than read off a catalogue — a
   *  lowest-variant estimate, or a format derived from the single by a multiplier (ADR-0020). */
  estimated: boolean;
}

/** An acceptance axis resolved to the values it stands for: itself, or the whole dictionary. */
function axisValues<T extends string | null>(accepted: T[], all: T[]): T[] {
  return accepted.length > 0 ? accepted : all;
}

/**
 * The catalogue range over everything one want would accept.
 *
 * Enumerates the accepted combinations and values each with `valuateCopy` — the very function that
 * prices a *copy*, so a want's figure and the copy that eventually satisfies it are computed by one
 * rule and cannot drift. The enumeration is bounded by the collection's own dictionaries (a handful
 * of conditions, certificates and formats), not by anything that grows with the collection.
 *
 * A combination that is unpriced or unconvertible is **counted but not ranged**: it is a gap in the
 * catalogue, and letting it read as a zero would drag every range down to nothing.
 */
export function wantCatalogRange(
  want: WantAcceptance,
  stamp: WantValuationStamp,
  dictionaries: WantValuationDictionaries,
  baseCurrency: string,
  rates: Map<string, number | null>,
  /** The format multiplier for this stamp, per format — `makeFormatFactorLookup` bound to it. */
  factorFor: (formatId: string | null) => number | null
): WantCatalogRange | null {
  const conditions = axisValues(want.conditionIds, dictionaries.conditionIds);
  const certificates = axisValues(want.certificateStatusIds, dictionaries.certificateStatusIds);
  const formats = axisValues(want.formatIds, dictionaries.formatIds);

  let min: number | null = null;
  let max: number | null = null;
  let priced = 0;
  let total = 0;
  let estimated = false;

  for (const conditionId of conditions) {
    for (const certificateStatusId of certificates) {
      for (const formatId of formats) {
        total += 1;
        const valuation = valuateCopy({
          conditionId,
          certificateStatusId,
          formatId,
          formatFactor: factorFor(formatId),
          unknownVariant: stamp.unknownVariant,
          primaryCatalogNameId: stamp.primaryCatalogNameId,
          ownPrices: stamp.ownPrices,
          variantPrices: stamp.variantPrices,
          baseCurrency,
          rates,
        });
        const value = valuation.baseAmount;
        if (value === null) continue;
        priced += 1;
        if (min === null || value < min) min = value;
        if (max === null || value > max) max = value;
        // A derived format price is an estimate as surely as a lowest-variant one is, and the row
        // carries one marker for "inferred" rather than two the reader has to tell apart.
        //
        // Derived is inferred from the *absence* of any recorded row for that format rather than
        // from the presence of a factor: a factor can exist for a format that is also priced
        // explicitly, and calling that an estimate would be wrong. If a value came back and no row
        // names the format, the multiplier is the only place it can have come from.
        const derived =
          formatId !== null && !stamp.ownPrices.some((p) => p.formatId === formatId);
        if (valuation.uncertain || derived) estimated = true;
      }
    }
  }

  if (min === null || max === null) return null;
  return {
    minBase: min.toFixed(2),
    maxBase: max.toFixed(2),
    baseCurrency,
    pricedCombinations: priced,
    totalCombinations: total,
    estimated,
  };
}
