import {
  pickFormatCatalogPrice,
  pickLowestByBase,
  pickStillValidPrice,
  baseValueOf,
  rolledUpCatalogPriceMark,
  type PickedPrice,
  type RawCatalogPrice,
} from "./catalog-price";
import type { StillValidRule } from "./still-valid-postage";
import type { PieceColumn, UnmappedRole } from "./valuation-method-roles";
import type { CatalogPriceMark } from "./catalog-price-mark";
import type { CostBasisTotal } from "./cost-basis";
import type {
  CoverUsage,
  Franking,
  InheritedMethod,
  MethodSource,
  MissingPiecePrice,
  PiecePrice,
  PieceComponent,
  PieceKind,
  PieceRule,
  PieceTerm,
  PieceValueResult,
  ValuationMethod,
} from "./piece-valuation";

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
//
// A cell the catalogue marks as giving no price (#1615) leaves the copy `unpriced` too — there is no
// figure, so nothing that adds or compares amounts has to learn a new case — but says why in `mark`.
// Such a copy is not *missing* a price ({@link isMissingCatalogPrice}): there is nothing to enter.

/** One descendant variant's catalog prices, with the stamp they belong to (#616). */
export interface VariantPrices {
  stampId: string;
  prices: RawCatalogPrice[];
  /**
   * True when this variant is **fully identified** — it has no variant children of its own, so a
   * catalog prices it directly. Absent reads as true.
   *
   * Only these are expected to carry a price (#617): an intermediate node is itself an
   * unknown-variant umbrella (ADR-0010 §3), and its value *is* the lowest of its own children rather
   * than a figure of its own, so an unpriced one is not a gap in the data. It says nothing about the
   * rollup's own arithmetic, which compares whatever is priced at any depth — it is what
   * {@link CopyValuation.unpricedVariantIds} is counted over.
   */
  identified?: boolean;
}

export interface CopyValuationInput {
  conditionId: string;
  certificateStatusId: string | null;
  /** The copy's physical format (#343); null is the single, which is most copies. */
  formatId?: string | null;
  /** Multiplier deriving that format's price from the single's, when no explicit price for the
   *  format exists. Null when none applies — the copy is then unpriced rather than valued as a
   *  single, which would be a different stamp's figure. */
  formatFactor?: number | null;
  /** Set to read the figure by Michel's rule for a stamp still valid for postage (#2358) instead of
   *  at `conditionId` — what the *Michel* method asks where its cover price is missing (#2375). The
   *  single only; the variant rollup reads each variant by the same rule. */
  stillValid?: StillValidRule | null;
  /** True when the copy links to a base stamp that has variants (variant unknown). */
  unknownVariant: boolean;
  /** Primary catalog name id resolved from the copy's stamp area (may be null). */
  primaryCatalogNameId: string | null;
  /** The linked stamp's own catalog prices. */
  ownPrices: RawCatalogPrice[];
  /** Per-descendant-variant catalog prices; only consulted for unknown-variant copies
   * whose base stamp has no matching price of its own. One entry is one variant, **tagged with the
   * variant it belongs to** (#616): the rollup's answer is a figure *and* the stamp it came from,
   * and the listing side needs the second half to know which catalogue entry the copy stands
   * under. */
  variantPrices?: VariantPrices[];
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
  /** The **book** this figure was read in, and the edition it was read at — null whenever the copy
   *  is unpriced. The same answer read a third way, beside {@link sourceStampId}: what the copy is
   *  worth, which catalogue entry the figure describes, and which volume of which year said so.
   *
   *  Kept because a figure can outlive the catalogue it came from. A trade freezes both its
   *  valuations onto its lines the moment both sides commit (#638), and a snapshot that recorded an
   *  amount but not the book and edition behind it would be a number the partner's printout could
   *  never be checked against. Every other reader ignores it. */
  catalogNameId: string | null;
  editionYear: number | null;
  /** True when the copy's variant is unknown → value is a lowest-variant estimate. */
  uncertain: boolean;
  /** True when there is no figure — no catalog price matched (condition/cert/catalog), or the
   *  catalogue gives none ({@link mark}). */
  unpriced: boolean;
  /**
   * Set when the copy is unpriced because the catalogue gives **no price on purpose** (#1615): the
   * stamp does not exist in that condition (—) or its price cannot be determined (?). Null for every
   * valuation with a figure and for a copy whose price has simply not been entered.
   *
   * For an unknown-variant umbrella it is the umbrella's own mark, or — when no variant is priced and
   * every identified one is marked — the state they share.
   */
  mark: CatalogPriceMark | null;
  /** The **variant** this figure came from (#616), and null whenever the linked stamp's own price was
   *  used — including every identified copy and every unpriced one. It is the same answer read a
   *  second way: what the copy is valued at and what catalogue entry that figure describes. The
   *  listing side derives an umbrella's item-ID from it (`listing-catalog-ids.ts`), which is why it
   *  is reported here rather than re-derived there — a listing that stood under one variant while
   *  being priced from another would be two answers to one question. */
  sourceStampId: string | null;
  /**
   * The **fully identified** variants of an unknown-variant umbrella that carry no price at this key
   * (#617), in candidate order. Empty for an identified copy, for an umbrella priced directly (where
   * no rollup happens at all), and for one whose variants are all priced.
   *
   * A variant whose cell is marked (#1615) is not in it: it has nothing to enter, and does not stand
   * in the way of a listing either.
   *
   * A report, never a rule of its own: the figure above is still the lowest of what *is* priced, and
   * it is flagged `uncertain` precisely because it is an estimate over incomplete information. What
   * cannot rest on it is a **listing** (`listing-catalog-ids.ts`), which claims to stand under the
   * *cheapest* variant — and while any variant is unpriced there is nothing to say which that is.
   * The asymmetry is deliberate: an estimate may be marked as one, a sale may not.
   */
  unpricedVariantIds: string[];
  /**
   * Set when the copy is a **piece** — a cover, a fragment, several stamps on one piece of paper —
   * valued by its method from its stamps' prices (#2359; ADR-0076) rather than read off one cell of
   * the catalogue grid: which method, from where, the franking, the rule, and the prices it missed.
   * Null for every catalogue valuation.
   *
   * Carried so a surface can say how the figure was reached: a piece's value is the catalogue's rule
   * applied to several prices, and calling it one stamp's catalogue value would misstate it.
   */
  piece: PieceValuation | null;
  /**
   * Set when the figure above has been **lowered for the copy's faults** (#1560): the percentage
   * typed on the copy, and the figure as it stood before. Null for every unreduced valuation — no
   * percentage, a row that is not a copy, or an unpriced copy, which has nothing to lower.
   *
   * Carried rather than re-derived so that every surface printing a reduced figure can say so and
   * name the full one (*45.00, −40 % for faults*), and so a total can count what it took off.
   */
  faultReduction: FaultReduction | null;
  /**
   * Set when the figure above has been **adjusted by the copy's value modifier** (#2357): the
   * percentage, amount and note typed on the copy, and the figure as the catalogue gave it. Null for
   * every unmodified valuation — no modifier, a row that is not a copy, or an unpriced copy, which
   * has no figure to adjust. Applied before the fault reduction, so when both are set
   * `faultReduction`'s full figure is the modified one.
   */
  valueModifier: AppliedValueModifier | null;
}

/** A copy's value modifier as typed on it (#2357) — see {@link applyValueModifier}. */
export interface ValueModifier {
  /** Whole percent, ≥ −100 and not 0; null for none. */
  percent: number | null;
  /** 2-dp string in the currency of the figure it adjusts, not 0; null for none. */
  amount: string | null;
  note: string | null;
}

/** How a copy's figure was adjusted by its modifier — see {@link CopyValuation.valueModifier}. */
export interface AppliedValueModifier extends ValueModifier {
  /** The figure before the modifier, in its own currency, 2-dp string. */
  fullAmount: string;
  /** The figure before the modifier in base currency, or null when it had no rate. */
  fullBaseAmount: number | null;
  /** The unmodified base figure as a 2-dp string, or null. */
  fullBaseAmountDisplay: string | null;
}

/** How a copy's figure was lowered for its faults (#1560) — see {@link CopyValuation.faultReduction}. */
export interface FaultReduction {
  /** Whole percent, 1–100. */
  percent: number;
  /** The full figure in its own currency, 2-dp string. */
  fullAmount: string;
  /** The full figure in base currency, or null when it had no rate. */
  fullBaseAmount: number | null;
  /** The full base figure as a 2-dp string, or null. */
  fullBaseAmountDisplay: string | null;
}

/**
 * Lower an amount by a copy's fault reduction (#1560). Pure; the one place the arithmetic lives, so
 * a catalogue figure, a recorded one and a market median are reduced by the same rule. `null` (and
 * anything outside 1–100, which the column's CHECK refuses) leaves the amount alone.
 */
export function reduceForFaults(amount: number, percent: number | null): number {
  if (!isFaultReduction(percent)) return amount;
  return (amount * (100 - percent)) / 100;
}

/**
 * True when a valuation has no figure **and** one could be entered — the copy's catalogue price is
 * missing rather than marked as giving none (#1615). Every count, mark, worklist and warning about
 * missing prices reads this rather than `unpriced`.
 */
export function isMissingCatalogPrice(
  valuation: Pick<CopyValuation, "unpriced"> & { mark?: CatalogPriceMark | null }
): boolean {
  // `mark` read loosely: a valuation frozen before #1615 (a trade's snapshot) carries none at all.
  return valuation.unpriced && !valuation.mark;
}

/** True for a percentage that lowers anything: a whole number from 1 to 100. */
export function isFaultReduction(percent: number | null | undefined): percent is number {
  return (
    typeof percent === "number" && Number.isInteger(percent) && percent >= 1 && percent <= 100
  );
}

/**
 * Apply a copy's fault reduction to its valuation (#1560). Pure.
 *
 * The figure is lowered in its own currency and in base, and the full one is kept beside it in
 * {@link CopyValuation.faultReduction}. Everything else — which catalogue, which edition, which
 * variant, whether it is uncertain or recorded — describes the full figure and is left as it is: the
 * reduction is a statement about this piece, not about where its price was read. An unpriced
 * valuation has nothing to lower and comes back unchanged.
 */
export function applyFaultReduction(
  valuation: CopyValuation,
  percent: number | null
): CopyValuation {
  if (!isFaultReduction(percent) || valuation.unpriced || valuation.amount === null) {
    return valuation;
  }
  const amount = reduceForFaults(Number(valuation.amount), percent);
  const baseAmount =
    valuation.baseAmount === null ? null : reduceForFaults(valuation.baseAmount, percent);
  return {
    ...valuation,
    amount: amount.toFixed(2),
    baseAmount,
    baseAmountDisplay: baseAmount === null ? null : baseAmount.toFixed(2),
    faultReduction: {
      percent,
      fullAmount: valuation.amount,
      fullBaseAmount: valuation.baseAmount,
      fullBaseAmountDisplay: valuation.baseAmountDisplay,
    },
  };
}

/** True when a modifier changes anything: a percentage or an amount (#2357). */
export function isValueModifier(
  modifier: ValueModifier | null | undefined
): modifier is ValueModifier {
  return (
    !!modifier &&
    ((typeof modifier.percent === "number" && modifier.percent !== 0) ||
      (modifier.amount !== null && Number(modifier.amount) !== 0))
  );
}

/**
 * Adjust an amount by a copy's value modifier (#2357): `amount × (1 + percent / 100) + modifier
 * amount`, never below zero. Pure; the one place the arithmetic lives. The modifier's amount is in
 * the currency of `amount` — the catalogue figure it adjusts.
 */
export function modifyValue(amount: number, modifier: ValueModifier | null): number {
  if (!isValueModifier(modifier)) return amount;
  const scaled = amount * (1 + (modifier.percent ?? 0) / 100);
  const added = scaled + (modifier.amount === null ? 0 : Number(modifier.amount));
  return Math.max(0, Math.round(added * 100) / 100);
}

/**
 * Apply a copy's value modifier to its valuation (#2357). Pure.
 *
 * The figure is adjusted **in its own currency** — the modifier's amount is stated in it — and then
 * converted to base by the same rates the figure was, so *+200 € in Michel* stays what the catalogue
 * said. The unmodified figure is kept in {@link CopyValuation.valueModifier}; everything else
 * describes where the figure was read and is left as it is. An unpriced valuation comes back
 * unchanged: an amount is not a value without the catalogue figure it adjusts. The fault reduction
 * (#1560) is applied **after** this, by {@link applyFaultReduction}.
 */
export function applyValueModifier(
  valuation: CopyValuation,
  modifier: ValueModifier | null,
  baseCurrency: string,
  rates: Map<string, number | null>
): CopyValuation {
  if (
    !isValueModifier(modifier) ||
    valuation.unpriced ||
    valuation.amount === null ||
    valuation.currency === null
  ) {
    return valuation;
  }
  const amount = modifyValue(Number(valuation.amount), modifier);
  const baseAmount =
    valuation.baseAmount === null
      ? null
      : baseValueOf(amount, valuation.currency, baseCurrency, rates);
  return {
    ...valuation,
    amount: amount.toFixed(2),
    baseAmount,
    baseAmountDisplay: baseAmount === null ? null : baseAmount.toFixed(2),
    valueModifier: {
      percent: modifier.percent,
      amount: modifier.amount,
      note: modifier.note,
      fullAmount: valuation.amount,
      fullBaseAmount: valuation.baseAmount,
      fullBaseAmountDisplay: valuation.baseAmountDisplay,
    },
  };
}

/** How a piece's figure was reached (#2359) — {@link CopyValuation.piece}. */
export interface PieceValuation {
  method: ValuationMethod;
  methodSource: MethodSource;
  /** The method it would have without one of its own (#2369), whatever its source now. */
  inherited: InheritedMethod;
  franking: Franking;
  /** The format's kind; null when it has none and the piece is valued by the sum of used prices. */
  kind: PieceKind | null;
  rule: PieceRule;
  usage: CoverUsage | null;
  /** True when a price the rule reads is missing or its role is not set up: the figure, if any, is
   *  a lower bound. */
  partial: boolean;
  missing: MissingPiecePrice[];
  /** The roles of the piece's method that a price it reads stands behind and that are not mapped to
   *  a condition (#2375) — what the value names, with a link to Settings → Valuation methods. */
  unmapped: UnmappedRole[];
  /** The condition each price the method reads comes from (#2375), by price; a price whose role is
   *  not mapped has none. What the fields are headed by and the arithmetic names. */
  columns: Partial<Record<PiecePrice, PieceColumn>>;
  /** The figure as a sum (#2353): what the Valuation window prints as the arithmetic. */
  terms: PieceTerm[];
  /** Each entry on the piece with every price the rule may read, in the collection currency (#2353):
   *  its used price and its price on the piece, side by side. In the collector's order. */
  components: PieceComponent[];
  /** The collection currency, which every figure above is in — named in the arithmetic (#2388). */
  currency: string;
}

/**
 * A piece's valuation from its method's result (#2359; ADR-0076). Pure. The figure is in the
 * collection currency, where the prices were compared; `uncertain` when a stamp on it is of unknown
 * variant. A result with nothing priced is unpriced — never zero.
 */
export function valuatePiece(
  result: PieceValueResult,
  piece: Omit<PieceValuation, "rule" | "usage" | "partial" | "missing" | "terms" | "currency">,
  uncertain: boolean,
  baseCurrency: string
): CopyValuation {
  const amount = result.amount;
  return {
    amount: amount === null ? null : amount.toFixed(2),
    currency: amount === null ? null : baseCurrency,
    baseAmount: amount,
    baseAmountDisplay: amount === null ? null : amount.toFixed(2),
    catalogNameId: null,
    editionYear: null,
    uncertain,
    unpriced: amount === null,
    sourceStampId: null,
    unpricedVariantIds: [],
    piece: {
      ...piece,
      rule: result.rule,
      usage: result.usage,
      partial: result.partial || piece.unmapped.length > 0,
      missing: result.missing,
      terms: result.terms,
      currency: baseCurrency,
    },
    faultReduction: null,
    valueModifier: null,
    mark: null,
  };
}

/** Value a single physical copy from the catalog. Pure; see module header for the rule. */
export function valuateCopy(input: CopyValuationInput): CopyValuation {
  const { conditionId, certificateStatusId, primaryCatalogNameId, baseCurrency, rates } = input;
  const pick = (prices: RawCatalogPrice[]) =>
    input.stillValid
      ? pickStillValidPrice(prices, primaryCatalogNameId, certificateStatusId, input.stillValid)
      : pickFormatCatalogPrice(
          prices,
          primaryCatalogNameId,
          conditionId,
          certificateStatusId,
          input.formatId ?? null,
          input.formatFactor ?? null
        );

  const own = pick(input.ownPrices);

  // Identified copy: its own price, certain — or its own mark (#1615).
  if (!input.unknownVariant) {
    return toValuation(own.picked, false, baseCurrency, rates, null, [], own.mark);
  }

  // Unknown variant, base stamp priced directly: use it, flagged uncertain. No source stamp — the
  // figure is the umbrella's own, which is the same precedence the listing side gives its item-ID.
  // No variant coverage is reported either: nothing was rolled up, so there is no rollup to call
  // incomplete (#617). A mark recorded on the umbrella itself is its own answer the same way.
  if (own.picked || own.mark) {
    return toValuation(own.picked, true, baseCurrency, rates, null, [], own.mark);
  }

  // Unknown variant, base stamp unpriced: lowest descendant-variant price (in base currency). The
  // candidates carry the variant they came from, so the winner names it (#616) — and the identified
  // variants that priced *nothing* are collected as they go, which is what tells a listing that the
  // cheapest one is not actually known yet (#617).
  // A marked variant (#1615) is neither a candidate nor a gap: it has nothing to enter.
  const candidates: (PickedPrice & { stampId: string })[] = [];
  const unpricedVariantIds: string[] = [];
  const marks: { mark: CatalogPriceMark | null; identified: boolean }[] = [];
  for (const variant of input.variantPrices ?? []) {
    const cell = pick(variant.prices);
    const identified = variant.identified ?? true;
    marks.push({ mark: cell.mark, identified });
    if (cell.picked) candidates.push({ ...cell.picked, stampId: variant.stampId });
    else if (!cell.mark && identified) unpricedVariantIds.push(variant.stampId);
  }
  const lowest = pickLowestByBase(candidates, baseCurrency, rates);
  return toValuation(
    lowest,
    true,
    baseCurrency,
    rates,
    lowest?.stampId ?? null,
    unpricedVariantIds,
    lowest ? null : rolledUpCatalogPriceMark(marks)
  );
}

/** One candidate of a copy's candidate set (#1651), valued as a copy of it would be. */
export interface CandidateValuation {
  stampId: string;
  /** The candidate's own valuation by {@link valuateCopy} — an umbrella candidate's being its own
   *  lowest-variant rollup. */
  valuation: CopyValuation;
  /** True when the candidate is fully identified (no variant children of its own) — the ones a price
   *  is expected of, as {@link VariantPrices.identified}. */
  identified: boolean;
}

/**
 * Value a copy identified as **one of several candidate stamps** (#1651, ADR-0065). Pure.
 *
 * The rule is the unknown-variant rule over the candidates only (ADR-0007 §7): the **lowest** of
 * their figures, compared in base currency, flagged `uncertain`, and naming where it came from in
 * `sourceStampId` — the cheapest candidate, or the variant of it the figure was rolled up from when
 * that candidate is an umbrella itself. Ties go to the first candidate in the order given, which is
 * catalogue order.
 *
 * `unpricedVariantIds` is what a listing must not stand on (#617): an identified candidate that has
 * nothing entered, and whatever an umbrella candidate's own rollup left unpriced. With no candidate
 * priced, the copy is unpriced and takes the mark its candidates share, as an umbrella takes its
 * variants' (#1615).
 */
export function valuateCandidateCopy(
  candidates: readonly CandidateValuation[],
  baseCurrency: string,
  rates: Map<string, number | null>
): CopyValuation {
  const unpricedVariantIds: string[] = [];
  for (const c of candidates) {
    if (c.valuation.unpriced && !c.valuation.mark && c.identified) unpricedVariantIds.push(c.stampId);
    for (const id of c.valuation.unpricedVariantIds) {
      if (!unpricedVariantIds.includes(id)) unpricedVariantIds.push(id);
    }
  }

  const priced = candidates
    .filter((c) => !c.valuation.unpriced && c.valuation.amount !== null && c.valuation.currency !== null)
    .map((c) => ({ ...c, amount: Number(c.valuation.amount), currency: c.valuation.currency! }));
  const lowest = pickLowestByBase(priced, baseCurrency, rates);
  if (!lowest) {
    const mark = rolledUpCatalogPriceMark(
      candidates.map((c) => ({ mark: c.valuation.mark, identified: c.identified }))
    );
    return toValuation(null, true, baseCurrency, rates, null, unpricedVariantIds, mark);
  }
  return {
    ...lowest.valuation,
    uncertain: true,
    sourceStampId: lowest.valuation.sourceStampId ?? lowest.stampId,
    unpricedVariantIds,
  };
}

function toValuation(
  picked: PickedPrice | null,
  uncertain: boolean,
  baseCurrency: string,
  rates: Map<string, number | null>,
  sourceStampId: string | null = null,
  unpricedVariantIds: string[] = [],
  mark: CatalogPriceMark | null = null
): CopyValuation {
  if (!picked) {
    return {
      amount: null,
      currency: null,
      baseAmount: null,
      baseAmountDisplay: null,
      catalogNameId: null,
      editionYear: null,
      uncertain,
      unpriced: true,
      sourceStampId: null,
      unpricedVariantIds,
      piece: null,
      faultReduction: null,
      valueModifier: null,
      mark,
    };
  }
  const baseAmount = baseValueOf(picked.amount, picked.currency, baseCurrency, rates);
  return {
    amount: picked.amount.toFixed(2),
    currency: picked.currency,
    baseAmount,
    baseAmountDisplay: baseAmount === null ? null : baseAmount.toFixed(2),
    catalogNameId: picked.catalogNameId,
    editionYear: picked.editionYear,
    uncertain,
    unpriced: false,
    sourceStampId,
    unpricedVariantIds,
    piece: null,
    faultReduction: null,
    valueModifier: null,
    mark: null,
  };
}

export interface HoldingsTotal {
  baseCurrency: string;
  /** Sum of convertible copy values in the base currency, 2-dp string. */
  totalBaseAmount: string;
  /** Copies contributing a base amount to the total. */
  pricedCount: number;
  /** Copies with no matching catalog price, where one could be entered. */
  unpricedCount: number;
  /** Copies whose catalogue gives no price on purpose (#1615) — left out of the total like unpriced
   *  ones, but counted apart, since there is nothing to enter for them. */
  markedCount: number;
  /** Copies that have a price but in a currency with no available base rate. */
  unconvertibleCount: number;
  /** Priced copies whose value is variant-uncertain (unknown variant). */
  uncertainCount: number;
  /** Portion of the total contributed by uncertain copies, 2-dp string. */
  uncertainBaseAmount: string;
  /** Priced copies whose figure was lowered for their faults (#1560). */
  faultReducedCount: number;
  /** What those reductions took off the total, 2-dp string — the total plus this is what the same
   *  copies are worth before it, which is the figure a reduced total names in its hint. */
  faultReductionBaseAmount: string;
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
  /** Valued copies whose median was lowered for their faults (#1560). */
  faultReducedCount: number;
  /** What those reductions took off the total, 2-dp string. */
  faultReductionBaseAmount: string;
}

/** One held copy's market reading (#458): the median at its own key, or null with no evidence, and
 *  the percentage its faults take off it (#1560). */
export interface MarketHoldingInput {
  median: number | null;
  faultReductionPercent: number | null;
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
  /** Cost basis of the held copies that were bought, or came from no lot — money spent. */
  cost: CostBasisTotal;
  /** Cost basis of the held copies from opening balances (#1324): an opening value, which counts
   *  towards profit and loss on sale but was never spent, so it is summed apart from {@link cost}. */
  openingValue: CostBasisTotal;
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
  let markedCount = 0;
  let unconvertibleCount = 0;
  let uncertainCount = 0;
  let faultReducedCount = 0;
  let faultReductionTotal = 0;
  for (const v of valuations) {
    if (v.unpriced) {
      if (v.mark) markedCount++;
      else unpricedCount++;
      continue;
    }
    if (v.baseAmount === null) {
      unconvertibleCount++;
      continue;
    }
    pricedCount++;
    total += v.baseAmount;
    if (v.faultReduction && v.faultReduction.fullBaseAmount !== null) {
      faultReducedCount++;
      faultReductionTotal += v.faultReduction.fullBaseAmount - v.baseAmount;
    }
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
    markedCount,
    unconvertibleCount,
    uncertainCount,
    uncertainBaseAmount: uncertainTotal.toFixed(2),
    faultReducedCount,
    faultReductionBaseAmount: faultReductionTotal.toFixed(2),
  };
}

/**
 * Aggregate per-copy **market** medians into a holdings total (#458). Pure.
 *
 * One entry per copy in scope, already resolved to that copy's own key: the median in the base
 * currency, or `null` where the key has no datapoints. A `null` is counted, never valued — it is
 * the difference between "worth nothing" and "nothing recorded", and only the second is true here.
 *
 * A median is a figure for copies *like* this one; a copy with faults is lowered by its own
 * percentage before it is added (#1560), by the rule its catalogue value is ({@link reduceForFaults}).
 *
 * There is no conversion to do: a market median is aggregated in the base currency to begin with
 * (ADR-0022 §2 converts at the rate frozen on the lot), so there is no `unconvertible` third state
 * the way catalogue valuation has one.
 */
export function aggregateMarketHoldings(
  copies: MarketHoldingInput[],
  baseCurrency: string
): MarketHoldingsTotal {
  let total = 0;
  let valuedCount = 0;
  let noEvidenceCount = 0;
  let faultReducedCount = 0;
  let faultReductionTotal = 0;
  for (const { median, faultReductionPercent } of copies) {
    if (median === null) {
      noEvidenceCount++;
      continue;
    }
    valuedCount++;
    const reduced = reduceForFaults(median, faultReductionPercent);
    total += reduced;
    if (isFaultReduction(faultReductionPercent)) {
      faultReducedCount++;
      faultReductionTotal += median - reduced;
    }
  }
  return {
    baseCurrency,
    totalBaseAmount: total.toFixed(2),
    valuedCount,
    noEvidenceCount,
    faultReducedCount,
    faultReductionBaseAmount: faultReductionTotal.toFixed(2),
  };
}
