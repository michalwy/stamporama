import type { TradeBalanceRule, TradeSide } from "./trade-rules";

// **Does this trade balance, and what am I actually giving away?** (#638; ADR-0039 §7.)
//
// Pure — no Prisma, no I/O, no `server-only` — so the domain (`trade-valuation.ts`), the trade
// screen and the tests all judge a trade by the same arithmetic instead of each spelling it out. The
// server half assembles the figures; everything below is what is done with them.
//
// **Two valuations, and they are never merged.** They answer different questions and are summed,
// compared and printed apart:
//
//   - **Own** — always computed, for the collector alone, from the area's primary catalog at its
//     latest edition, with **no override of any kind**, in the collection's **base** currency. It is
//     the same figure the app quotes for that stamp everywhere else, and that is the point: a trade
//     screen quoting a different one would be describing a different collection than the copies list
//     does. It is what the "am I giving away 1000 EUR for 10 EUR" guard is measured on.
//   - **Agreed** — from the catalog the two collectors named, in the **trade's** currency. Optional,
//     and the verdict only where value balancing is on. That StampWorld says something different
//     from Fischer is a property of the negotiation, not a discrepancy to reconcile.
//
// One figure that "just converted" the other into a single number would be the one thing that
// destroys both answers, which is why nothing here ever adds them.
//
// **The skew warns and never blocks.** A deliberately uneven trade — clearing out duplicates for one
// stamp somebody has been after for years — is a normal thing between collectors, and an app that
// refused to record it would simply be wrong about the hobby. What *does* block is a line with no
// figure at all, because a total resting on an unspoken zero is a total that lies.

/** Which of a line's two valuations. An axis, exactly as `side` is (ADR-0039 §1): the two are the
 *  same shape asked of two different books, and neither may acquire a field the other lacks. */
export const TRADE_VALUATION_KINDS = ["own", "agreed"] as const;
export type TradeValuationKind = (typeof TRADE_VALUATION_KINDS)[number];

export const TRADE_VALUATION_LABEL: Record<TradeValuationKind, string> = {
  own: "My valuation",
  agreed: "Agreed catalog",
};

/**
 * One line's two figures, **per piece**.
 *
 * Per piece rather than per line because a receive line carries a quantity (three lines can be
 * thirty stamps) and the totals below are what multiply it. A give line is always one copy.
 *
 * `own` is in the collection's base currency and `agreed` in the trade's, and they are deliberately
 * two fields of two units rather than one field and a flag — the whole failure this module exists to
 * prevent is somebody one day adding 340 to 78.
 */
export interface TradeLineValue {
  lineId: string;
  sectionId: string;
  side: TradeSide;
  /** Pieces this line contributes. Always 1 on the give side. */
  quantity: number;
  /** How this line is named in a refusal — the copy number and stamp, or the stamp and condition.
   *  A gate that says "3 lines are unvalued" and stops there sends the collector hunting. */
  label: string;
  /** Own valuation per piece, base currency. **Null is the gate's business**: it means no catalog
   *  price, no rate, and no manual figure — not zero. */
  own: number | null;
  /** The own figure is an unknown-variant rollup (#238) — the lowest priced descendant. It still
   *  counts as a value; see {@link unvaluedLines}. */
  ownUncertain: boolean;
  /** The own figure is the collector's own typed number, never a catalog one. */
  ownManual: boolean;
  /** Agreed valuation per piece, in the **trade's** currency. Null on every line of a trade that
   *  names no agreed catalog, and on one the agreed catalog does not price. */
  agreed: number | null;
  agreedUncertain: boolean;
  agreedManual: boolean;
}

/** One side of one section — or of the whole trade, which is the same sum over more lines. */
export interface TradeSideTotals {
  lines: number;
  pieces: number;
  /** Own valuation, base currency, quantities counted. */
  own: number;
  /** Lines carrying **no** own figure. Never folded into `own` as a zero: a total that quietly
   *  assumed one would read as an answer while being a guess. */
  ownMissing: number;
  /** Lines whose own figure is an unknown-variant estimate — the total is that much of an estimate
   *  too, and says so rather than being withheld. */
  ownUncertain: number;
  /** Lines valued from the collector's own typed figure rather than from a catalog. */
  ownManual: number;
  /** Agreed valuation, trade currency, quantities counted. */
  agreed: number;
  agreedMissing: number;
  agreedUncertain: number;
  agreedManual: number;
}

const EMPTY_SIDE: TradeSideTotals = {
  lines: 0,
  pieces: 0,
  own: 0,
  ownMissing: 0,
  ownUncertain: 0,
  ownManual: 0,
  agreed: 0,
  agreedMissing: 0,
  agreedUncertain: 0,
  agreedManual: 0,
};

/** Sum one side's lines. Missing figures are **counted, never assumed** — see `ownMissing`. */
export function summariseTradeSide(values: readonly TradeLineValue[]): TradeSideTotals {
  const totals: TradeSideTotals = { ...EMPTY_SIDE };
  for (const v of values) {
    totals.lines += 1;
    totals.pieces += v.quantity;
    if (v.own === null) {
      totals.ownMissing += 1;
    } else {
      totals.own += v.own * v.quantity;
      if (v.ownUncertain) totals.ownUncertain += 1;
      if (v.ownManual) totals.ownManual += 1;
    }
    if (v.agreed === null) {
      totals.agreedMissing += 1;
    } else {
      totals.agreed += v.agreed * v.quantity;
      if (v.agreedUncertain) totals.agreedUncertain += 1;
      if (v.agreedManual) totals.agreedManual += 1;
    }
  }
  totals.own = round2(totals.own);
  totals.agreed = round2(totals.agreed);
  return totals;
}

/**
 * The verdict for one section, or for the whole trade.
 *
 * Both modes are computed and only one is the verdict — that is deliberate. The count is a fact
 * whatever the trade is balanced on, and the **own-valuation skew is computed always**, in both
 * modes, because "am I giving away 1000 EUR for 10 EUR" is a question a piece-count trade can get
 * wrong just as easily as a value one.
 */
export interface TradeBalanceVerdict {
  /** The rule in force, already resolved against the trade's (`resolveBalanceRule`). */
  byValue: boolean;
  give: TradeSideTotals;
  receive: TradeSideTotals;

  /** Pieces given minus pieces received. Positive = more is leaving than arriving. */
  countDiff: number;
  countTolerance: number;
  /** Within tolerance in pieces. Read as the verdict only in count mode. */
  countBalanced: boolean;

  /** Agreed value given minus received, in the trade's currency. */
  valueDiff: number;
  /** {@link valueDiff} as a percentage of the larger side — which is what "within 5%" means to a
   *  reader. Zero when both sides are zero, rather than a division nobody can defend. */
  valuePct: number;
  valueTolerancePct: number;
  valueBalanced: boolean;
  /**
   * Whether a value verdict could be reached at all: false while any line on either side has no
   * agreed figure. A percentage computed over a side with a line missing from it is a percentage
   * that describes a different trade, so the screen says *incomplete* rather than printing one.
   */
  valueComplete: boolean;

  /** Own value given minus received, base currency. Positive = the collector is giving more away. */
  ownDiff: number;
  /** {@link ownDiff} as a percentage of the larger side. */
  ownSkewPct: number;
  ownWarnPct: number;
  /**
   * Past the threshold — a **warning and never a block**. A deliberately uneven trade is a normal
   * thing and the app has no business forbidding it; what this does is make sure it is deliberate.
   */
  ownWarn: boolean;
  /** True while any line on either side has no own figure. The skew above is then a partial sum and
   *  is presented as one — this is also exactly what the `preparing → shared` gate refuses on. */
  ownIncomplete: boolean;
}

/** Judge one section (or the whole trade) against the rule in force for it. */
export function judgeTradeBalance(
  rule: TradeBalanceRule,
  give: TradeSideTotals,
  receive: TradeSideTotals
): TradeBalanceVerdict {
  const countDiff = give.pieces - receive.pieces;
  const valueDiff = round2(give.agreed - receive.agreed);
  const ownDiff = round2(give.own - receive.own);
  const valueComplete = give.agreedMissing === 0 && receive.agreedMissing === 0;
  const valuePct = skewPct(give.agreed, receive.agreed);
  const ownSkewPct = skewPct(give.own, receive.own);
  return {
    byValue: rule.balanceByValue,
    give,
    receive,
    countDiff,
    countTolerance: rule.countTolerance,
    countBalanced: Math.abs(countDiff) <= rule.countTolerance,
    valueDiff,
    valuePct,
    valueTolerancePct: rule.valueTolerancePct,
    // An incomplete side cannot be called balanced. Calling it unbalanced would be just as wrong,
    // which is what `valueComplete` is for — the screen states the gap instead of a verdict.
    valueBalanced: valueComplete && valuePct <= rule.valueTolerancePct,
    valueComplete,
    ownDiff,
    ownSkewPct,
    ownWarnPct: rule.ownValueWarnPct,
    ownWarn: ownSkewPct > rule.ownValueWarnPct,
    ownIncomplete: give.ownMissing > 0 || receive.ownMissing > 0,
  };
}

/**
 * How far two sides are apart, as a percentage **of the larger one**.
 *
 * Of the larger rather than of an average or of one nominated side, because that is what a reader
 * takes "these are within 5% of each other" to mean, and because it is symmetric — swapping the
 * sides must not change the answer. Two zeroes are zero apart, not a division by zero.
 */
export function skewPct(a: number, b: number): number {
  const larger = Math.max(Math.abs(a), Math.abs(b));
  if (larger === 0) return 0;
  return round2((Math.abs(a - b) / larger) * 100);
}

// ── The gates ────────────────────────────────────────────────────────────────────────────────────
//
// Two gates, and they are not the same rule at two strengths.
//
// **Own valuation is required for every line, both sides, always.** A trade cannot leave `preparing`
// with one unvalued, and the check is re-run on every attempt rather than stamped once — a line
// added while the trade is `shared` must not slip through into `agreed` on the strength of a check
// that passed last week. It refuses **by name**, the shape the listing gate takes (#418): a refusal
// that says "3 lines are unvalued" and stops there sends the collector hunting through both sides of
// every section.
//
// **Agreed valuation is required only where it is the verdict** — value balancing on, and only for
// the lines that mode covers. A trade balanced 1:1 on pieces may still name a catalog both sides
// speak in (#640), and gating on a figure nothing is decided by would be refusing over bookkeeping.
//
// **An unknown-variant rollup counts as a value.** A `~` figure from #238 — the lowest priced
// descendant, flagged `uncertain` — satisfies both gates, flagged as the estimate it is. Blocking on
// it would throw every umbrella stamp out of every trade. Deliberately looser than the listing rule
// (#617), which refuses an uncertain figure because a listing *claims* to stand under the cheapest
// variant; a negotiating figure claims nothing of the sort.

/** Lines with no own valuation at all — no catalog price, no rate, no manual figure. */
export function unvaluedLines(values: readonly TradeLineValue[]): TradeLineValue[] {
  return values.filter((v) => v.own === null);
}

/** Lines with no agreed valuation, among those the value mode actually covers. `coveredSectionIds`
 *  is the set of sections whose **resolved** rule balances by value; a trade balanced on pieces
 *  passes an empty set and this is empty by construction. */
export function unvaluedAgreedLines(
  values: readonly TradeLineValue[],
  coveredSectionIds: ReadonlySet<string>
): TradeLineValue[] {
  return values.filter((v) => coveredSectionIds.has(v.sectionId) && v.agreed === null);
}

/** How many offending lines a refusal names before it starts counting. Five is what fits in a
 *  sentence; past that the count is the useful half and the collector opens the screen anyway. */
const NAMED_LIMIT = 5;

/** The offending lines, in a sentence: `#00012 Chopin (MNH), #00013 …, and 4 more`. */
export function describeLines(lines: readonly TradeLineValue[]): string {
  const named = lines.slice(0, NAMED_LIMIT).map((l) => l.label);
  const rest = lines.length - named.length;
  if (rest <= 0) return named.join(", ");
  return `${named.join(", ")}, and ${rest} more`;
}

/**
 * Why this trade cannot move on, or an empty list.
 *
 * One function for both gates so a caller cannot ask half the question. Order matters only in that
 * the own-valuation gap is the one every trade is subject to, so it is stated first.
 */
export interface TradeGateBlocker {
  kind: "own-unvalued" | "agreed-unvalued" | "agreed-no-catalog";
  /** The lines at fault, named. Empty for a fault that is the trade's rather than any line's. */
  lines: TradeLineValue[];
  message: string;
}

/**
 * @param hasAgreedCatalog Whether the trade names an agreed catalog at all. A trade balanced **by
 * value** that names none has no second valuation to judge on, and every line it covers is
 * unvalued by construction — so it is refused as the one fault it is, naming the missing catalog,
 * rather than as forty lines each blamed for a figure the trade never asked any book for.
 */
export function tradeGateBlockers(
  values: readonly TradeLineValue[],
  coveredSectionIds: ReadonlySet<string>,
  hasAgreedCatalog: boolean
): TradeGateBlocker[] {
  const blockers: TradeGateBlocker[] = [];
  const own = unvaluedLines(values);
  if (own.length > 0) {
    blockers.push({
      kind: "own-unvalued",
      lines: own,
      message: `${own.length === 1 ? "This line has" : `${own.length} lines have`} no value yet: ${describeLines(own)}. Add a catalogue price, or set a manual value on the line.`,
    });
  }
  if (coveredSectionIds.size > 0 && !hasAgreedCatalog) {
    return [
      ...blockers,
      {
        kind: "agreed-no-catalog",
        lines: [],
        message:
          "This trade is balanced by value but names no agreed catalogue, so there is nothing to balance on. Name the publisher you both go by, or balance it by piece count.",
      },
    ];
  }
  const agreed = unvaluedAgreedLines(values, coveredSectionIds);
  if (agreed.length > 0) {
    blockers.push({
      kind: "agreed-unvalued",
      lines: agreed,
      message: `This trade is balanced by value, and ${agreed.length === 1 ? "one line has" : `${agreed.length} lines have`} no figure in the agreed catalog: ${describeLines(agreed)}.`,
    });
  }
  return blockers;
}

/** Money, to the cent. Every total here is a sum of 2-dp figures, and floating point drift that
 *  makes a balanced trade read as 0.01 out is drift a collector cannot act on. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
