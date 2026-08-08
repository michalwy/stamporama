// **What the market paid** (#455; ADR-0022). No Prisma import — kept apart from the domain layer so
// it is unit-testable, exactly as `auction-lot.ts` and `bid-recommendation.ts` beside it.
//
// `valuation.ts` is *catalogue* valuation of copies (ADR-0007 §7) and stays what it is. The two
// answer different questions — "what does the catalogue say this is worth" against "what did the
// market pay" — and are never merged.
//
// The whole feature is three steps, and this module is all three of them:
//
//   1. **Extraction.** Every closed lot with a final price yields one datapoint per line, at the
//      hammer and in the base currency. A mixed lot is split pro-rata by catalogue value.
//   2. **Aggregation.** Datapoints group on `stamp × condition × certificate × format` — the
//      catalogue-price key minus the edition axis (ADR-0022 §1) — and become a small statistics
//      block whose headline is the **median**.
//   3. **Confidence.** A 0–100 score from sample, recency, agreement and purity, so thin evidence
//      is usable *and* honestly labelled rather than hidden behind a threshold.
//
// The governing constraint throughout is sample size: this is a self-built base of a few lots a
// month, not a scraped corpus. There is no minimum sample and no time window — a value appears from
// n = 1 and every result counts however old (ADR-0022 §4). Both concerns are answered by the score.
//
// Money is `number` here, not the 2-dp string the other pure money modules return: the ratio and
// the score are arithmetic on these figures, and the caller formats once at the edge — the same
// division of labour `CopyValuation` makes between `baseAmount` and `baseAmountDisplay`.

import type { Amount, AuctionLotStatus } from "./auction-lot";

// ── The key (ADR-0022 §1) ───────────────────────────────────────────────────

/**
 * What a market value hangs off: exactly the key `StampCatalogPrice` uses (ADR-0006 §2, ADR-0020)
 * and exactly the key `AuctionLotLine` records, minus the catalogue **edition** — a hammer price
 * belongs to the date it was struck, not to a published book.
 *
 * Nulls are matched exactly with no fall-back across levels, the same rule copy valuation follows:
 * `formatId` null is the single, `certificateStatusId` null is "no certificate". Folding either
 * away would buy sample size with a figure describing nothing that was ever sold.
 */
export interface MarketValueKey {
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
}

/** A stable string for grouping and for a client's `key` prop. The separator cannot occur in a
 * cuid, so the four segments are unambiguous. */
export function marketKeyOf(key: MarketValueKey): string {
  return `${key.stampId}~${key.conditionId}~${key.certificateStatusId ?? ""}~${key.formatId ?? ""}`;
}

// ── Extraction (ADR-0022 §2, §3) ────────────────────────────────────────────

/** One line of a lot, with its catalogue value **already resolved** by the caller — the area's
 * primary catalogue at its latest edition, format factors per ADR-0020, unknown-variant rollup per
 * #238 — and expressed in the collection's base currency. Resolving it here would be a second copy
 * of rules `items.ts` already owns. */
export interface MarketLotLineInput {
  /** The `AuctionLotLine` row, carried through onto the datapoint so the evidence list can point
   * back at what produced a figure. */
  lineId: string;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
  /** How many of this stamp × condition × format the lot holds. */
  quantity: number;
  /** Catalogue value of **one** of them, base currency. Null when the line has none — which costs
   * the whole lot when it is a mixed one (ADR-0022 §3). */
  unitCatalogueValue: number | null;
}

/** One lot as the extraction reads it. Everything here is recorded on the lot already. */
export interface MarketLotInput {
  lotId: string;
  /** The lot's **lifecycle**, not its outcome. `won`, `lost` and `observed` are all real prices the
   * market paid, so the derived outcome is deliberately not consulted (ADR-0022 §2). */
  status: AuctionLotStatus;
  /** The lot's own closing time — the date its datapoints are stamped with. */
  endsAt: Date;
  /** What it fetched. Absent is an absent observation, not an error. */
  finalPrice: Amount;
  /** The rate frozen at `endsAt` (#354), so a 2023 result keeps its 2023 rate. */
  fxRateToBase: Amount;
  /**
   * True when the sale is already denominated in the collection's base currency.
   *
   * Needed as its own fact because `AuctionLot.fxRateToBase` is null for two different reasons —
   * no conversion was required, or none could be had — and only the sale's currency tells them
   * apart. A foreign-currency lot with no frozen rate yields **nothing**: an amount that cannot be
   * stated in the base currency is not comparable with the ones that can.
   */
  inBaseCurrency: boolean;
  lines: MarketLotLineInput[];
}

/** One result the market produced, for one key, per unit, in the base currency. */
export interface MarketDatapoint {
  key: MarketValueKey;
  lotId: string;
  lineId: string;
  /** What **one** of them fetched: the hammer share of this line divided by its quantity. Premium
   * and shipping are excluded — they are the seller's terms, not the stamp's worth (ADR-0022 §2). */
  amount: number;
  /** The lot's closing time. */
  at: Date;
  /** The figure was derived from a mixed lot's pro-rata split rather than taken whole (§3). An
   * estimate, so §5 down-weights it rather than hiding it. */
  split: boolean;
}

/** Parse an amount the way the auction modules do: anything unparseable is absent, never zero. */
function num(value: Amount): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** A quantity as a line may carry it: whole and at least one. Anything else yields no datapoint —
 * a per-unit figure divided by no units says nothing. */
function units(quantity: number): number | null {
  if (!Number.isFinite(quantity)) return null;
  const n = Math.trunc(quantity);
  return n >= 1 ? n : null;
}

/** The hammer price of a lot in the collection's base currency, or null when the lot yields no
 * datapoint at all. */
function lotBaseAmount(lot: MarketLotInput): number | null {
  if (lot.status !== "closed") return null;
  const final = num(lot.finalPrice);
  if (final === null) return null;
  if (lot.inBaseCurrency) return final;
  const rate = num(lot.fxRateToBase);
  return rate === null ? null : final * rate;
}

/**
 * Every datapoint a set of lots produces (ADR-0022 §2, §3).
 *
 * A **single-line** lot needs no catalogue price at all: it is `amount ÷ quantity`, full stop, and
 * comes through whole.
 *
 * A **mixed** lot is split pro-rata by each line's total catalogue value, then divided by quantity:
 *
 *     lineAmount = amount × (unitCatalogueValue × quantity ÷ Σ same) ÷ quantity
 *
 * The weight is the line's *total*, not its unit price — ten cheap stamps are a bigger share of one
 * hammer price than a single one is. If **any** line of a mixed lot has no catalogue value the
 * whole lot is skipped, because a partial split would silently hand the missing line's share to its
 * neighbours. A lot whose catalogue values all come to zero is skipped for the same reason: there
 * is no ratio to split on.
 *
 * Lots come back in the order given, and within a lot in line order, so a caller's evidence list is
 * whatever order it queried in.
 */
export function extractMarketDatapoints(lots: MarketLotInput[]): MarketDatapoint[] {
  const out: MarketDatapoint[] = [];

  for (const lot of lots) {
    const amount = lotBaseAmount(lot);
    if (amount === null) continue;

    // Lines that cannot state a per-unit figure are dropped before anything is decided about the
    // lot: they are not part of what the hammer price bought in any readable way.
    const lines = lot.lines
      .map((line) => ({ line, quantity: units(line.quantity) }))
      .filter((l): l is { line: MarketLotLineInput; quantity: number } => l.quantity !== null);
    if (lines.length === 0) continue;

    const keyOf = (line: MarketLotLineInput): MarketValueKey => ({
      stampId: line.stampId,
      conditionId: line.conditionId,
      certificateStatusId: line.certificateStatusId,
      formatId: line.formatId,
    });

    if (lines.length === 1) {
      const { line, quantity } = lines[0];
      out.push({
        key: keyOf(line),
        lotId: lot.lotId,
        lineId: line.lineId,
        amount: amount / quantity,
        at: lot.endsAt,
        split: false,
      });
      continue;
    }

    let total = 0;
    let complete = true;
    for (const { line, quantity } of lines) {
      const value = line.unitCatalogueValue;
      if (value === null || !Number.isFinite(value)) {
        complete = false;
        break;
      }
      total += value * quantity;
    }
    if (!complete || total <= 0) continue;

    for (const { line, quantity } of lines) {
      const share = (line.unitCatalogueValue! * quantity) / total;
      out.push({
        key: keyOf(line),
        lotId: lot.lotId,
        lineId: line.lineId,
        amount: (amount * share) / quantity,
        at: lot.endsAt,
        split: true,
      });
    }
  }

  return out;
}

// ── Aggregation (ADR-0022 §4) ───────────────────────────────────────────────

/**
 * A key's valuation: a small statistics block, not one number.
 *
 * Collectors read a thin sample better than any single statistic summarizes it — 8 · 11 · 12 · 14 ·
 * 40 tells a story that "17" hides. Where one figure is needed it is the **median**, robust to the
 * one wild result a thin philatelic sample always contains and reproducible by eye from the list.
 */
export interface MarketAggregate {
  key: MarketValueKey;
  /** The headline (§4). */
  median: number;
  mean: number;
  min: number;
  max: number;
  /** Datapoints behind the figures. At least 1 — a key with none does not appear at all. */
  n: number;
  /** Most recent result. */
  latestAt: Date;
  /** Oldest result, so the span the evidence covers can be shown beside it. */
  earliestAt: Date;
  /** Datapoints derived from a mixed lot's split (§3). */
  splitCount: number;
  /** Datapoints taken whole from their lot. `wholeCount + splitCount === n`. */
  wholeCount: number;
  /** What the figures were computed from, in the order they arrived. Carried rather than discarded
   * because the score is only ever shown next to the facts that produced it (ADR-0022 §5), and
   * because a row expands into the lots behind it (§8). */
  datapoints: MarketDatapoint[];
}

/** Median of a non-empty list: the middle value, or the mean of the two middle ones. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Group datapoints by key and roll each group up.
 *
 * Keys come back in first-seen order, which is the caller's query order — the server layer sorts
 * for display, since only it knows the condition and format sort orders.
 */
export function aggregateMarketDatapoints(points: MarketDatapoint[]): MarketAggregate[] {
  const groups = new Map<string, MarketDatapoint[]>();
  for (const point of points) {
    const id = marketKeyOf(point.key);
    const group = groups.get(id);
    if (group) group.push(point);
    else groups.set(id, [point]);
  }

  return [...groups.values()].map((group) => {
    const amounts = group.map((p) => p.amount);
    const splitCount = group.filter((p) => p.split).length;
    const times = group.map((p) => p.at.getTime());
    return {
      key: group[0].key,
      median: medianOf(amounts),
      mean: amounts.reduce((s, v) => s + v, 0) / amounts.length,
      min: Math.min(...amounts),
      max: Math.max(...amounts),
      n: group.length,
      latestAt: new Date(Math.max(...times)),
      earliestAt: new Date(Math.min(...times)),
      splitCount,
      wholeCount: group.length - splitCount,
      datapoints: group,
    };
  });
}

// ── Confidence (ADR-0022 §5) ────────────────────────────────────────────────

/** How much of a value to believe, at a glance. Bucketed from the score, never computed apart from
 * it — and nothing anywhere keys off the badge instead of off the figures. */
export type MarketConfidenceBadge = "low" | "medium" | "high";

/** The score and the four components that produced it. Every one is reported, because the score is
 * only ever shown next to the facts behind it: a surprising badge has to be traceable. */
export interface MarketConfidence {
  /** 0–100, rounded. */
  score: number;
  badge: MarketConfidenceBadge;
  /** `min(n, 5) / 5` — weighted heaviest at 0.40, because sample is what this base is short of. */
  sample: number;
  /** 1.0 within a year, 0.6 within three, else 0.3. Weight 0.25. */
  recency: number;
  /** `1 − min(1, ((max − min) / median) / 2)`, and 0 at a zero median. Weighted lightest at 0.20:
   * a genuinely wide spread is often the truth about a stamp rather than a defect in the evidence. */
  agreement: number;
  /** `(whole + 0.5 × split) / n` — how much of the evidence was taken whole rather than split out
   * of a mixed lot. Weight 0.15. */
  purity: number;
}

/** A year, for the recency buckets. Calendar-exact dating would make a score jump on a leap day for
 * no reason a collector could see; the buckets are 1 and 3 years wide, so a quarter-day does not
 * decide anything. */
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/** Score below which a value reads `low`, and above which it reads `high`. */
export const MARKET_CONFIDENCE_MEDIUM_FROM = 40;
export const MARKET_CONFIDENCE_HIGH_FROM = 70;

/**
 * How confident to be in a key's figures, at the instant `now`.
 *
 * `now` is an argument and is never read inside, so the function stays pure and a test can put a
 * result at any age it likes.
 */
export function marketConfidence(aggregate: MarketAggregate, now: Date): MarketConfidence {
  const sample = Math.min(aggregate.n, 5) / 5;

  const age = now.getTime() - aggregate.latestAt.getTime();
  const recency = age <= YEAR_MS ? 1.0 : age <= 3 * YEAR_MS ? 0.6 : 0.3;

  // A zero median leaves the spread with nothing to be a proportion of, so agreement is 0 rather
  // than infinite disagreement or a silent 1.
  const agreement =
    aggregate.median === 0
      ? 0
      : 1 - Math.min(1, (aggregate.max - aggregate.min) / aggregate.median / 2);

  const purity = (aggregate.wholeCount + 0.5 * aggregate.splitCount) / aggregate.n;

  const score = Math.round(100 * (0.4 * sample + 0.25 * recency + 0.2 * agreement + 0.15 * purity));

  return {
    score,
    badge:
      score >= MARKET_CONFIDENCE_HIGH_FROM
        ? "high"
        : score >= MARKET_CONFIDENCE_MEDIUM_FROM
          ? "medium"
          : "low",
    sample,
    recency,
    agreement,
    purity,
  };
}

/** An aggregate with its score — what a screen actually shows for one key. */
export interface MarketValuation extends MarketAggregate {
  confidence: MarketConfidence;
}

/** Extraction → aggregation → score in one call, for the common case. */
export function valuateMarket(lots: MarketLotInput[], now: Date): MarketValuation[] {
  return aggregateMarketDatapoints(extractMarketDatapoints(lots)).map((aggregate) => ({
    ...aggregate,
    confidence: marketConfidence(aggregate, now),
  }));
}

// ── Realization ratio (ADR-0022 §6) ─────────────────────────────────────────

/**
 * `median ÷ catalogueValue` — the number a collector actually reasons with ("24% of Michel").
 *
 * Both sides must be in the base currency, which is how the caller resolves them. Null when either
 * side is missing, and null at a zero catalogue value: a ratio to nothing is not a large ratio.
 * Returned as a ratio, not a percentage — the surface that prints it decides how.
 */
export function realizationRatio(
  median: number | null,
  catalogueValue: number | null
): number | null {
  if (median === null || catalogueValue === null) return null;
  if (!Number.isFinite(median) || !Number.isFinite(catalogueValue)) return null;
  if (catalogueValue === 0) return null;
  return median / catalogueValue;
}
