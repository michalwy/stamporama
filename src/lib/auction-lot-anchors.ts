import "server-only";
import {
  baseToSaleRates,
  valuateAuctionLotLines,
  type AnchorableLine,
  type AuctionLotComposition,
} from "./auction-lines";
import type { BidLine } from "./bid-recommendation";
import { countCopiesByStampAndCondition, stampConditionKey } from "./copy-counts";
import { marketKeyOf, type MarketConfidenceBadge } from "./market-value";
import { readStampMarketValues, type StampMarketValue } from "./market-values";
import { getCollectionBaseCurrency } from "./pricing";
import { loadRealizationRatios, type RealizationRatio } from "./realization-ratios";

// **What anchors a line** (#510; ADR-0029 §1, §5, §7) — the domain layer between the valuation
// modules and the recommendation arithmetic in `bid-recommendation.ts`.
//
// **It was keyed on lots until #1168 and is not any more, and that is one rule rather than two.**
// The agent workflow this surface now answers is a query about something the collection does not
// hold: an auctioneer's description of a stamp and an opening price, with no lot, no sale and no
// `AuctionLotLine` anywhere. What the anchoring rule actually reads off a line is a
// `stamp × condition × certificate × format × quantity` with its catalogue value resolved
// (`AnchorableLine`), which is what a composition line *is* — so the lots screen and a lot-free
// caller go through `loadAnchorContext` + `anchorLine` alike. A second anchoring rule beside this
// one is the defect with no detector: the agent's answer and the lot screen's would disagree and
// nothing would ever go red over it (`agent-api.md`).
//
// Nothing is decided here that the modules below have already decided. The market median is
// ADR-0022's for the line's exact key, the catalogue value is the composition rollup the lots
// screen already computes (unknown-variant rollup #238, format factors ADR-0020), and the
// realization ratio is #520's ladder. What this module does is put them in order:
//
//     anchor(line) = marketMedian(key)                 when the key has any datapoint
//                  | catalogueValue × learnedRatio     when the catalogue prices it
//                  | none
//
// **Per line, never per lot.** A single lot routinely mixes a well-recorded key with one that has
// never been seen; a lot-level "use market if we have enough of it" switch would throw away
// measured evidence for the lines that have it, or extend it to lines that do not.
//
// **Market first** because it is a transaction and the catalogue is a list price — the whole
// argument of ADR-0022. There is no blend of the two: a figure that is part-measured and
// part-policy cannot be explained when it looks wrong.
//
// **Currency** (ADR-0029 §5). Catalogue values arrive already stated in the currency being answered
// in — the sale's on the lots screen, the caller's otherwise — and ratios are unitless, so a
// catalogue anchor needs no conversion *here*. Market medians are in the base currency and are
// converted at the **current** rate, because the recommendation is about a bid being placed now —
// not at a rate frozen on some past lot. A line whose anchor cannot be converted is reported
// *unconvertible*, never unanchored: it has a price and cannot be summed, which must not send the
// collector off to enter a value that already exists.
//
// **One rate does both halves**, which is worth saying because §5's wording invites reading it as
// two rules. `valuateAuctionLotLines` has already applied that same base → target rate to the
// catalogue figure by the time a line reaches here, so the catalogue side needing no conversion is
// a statement about *this* module rather than about the pipeline.
//
// **Ownership is evidence, never arithmetic** (ADR-0029 §7). How many copies are already held is
// reported and does not move a figure: duplicates are bought deliberately for trade and resale, so
// a system-applied haircut would under-bid the material a collector most wants.
//
// Resolved for a whole page at a time: one composition pass, one market read, one ratio load, one
// ownership count, however many lots or lines are in play. Ownership is **not** checked here — the
// caller has already resolved the collection for the owner, as everywhere in the auction modules.

/** The market side of an anchor: ADR-0022's figures for the line's exact key, in the **base**
 * currency, with the evidence #511 renders beside them. */
export interface AnchorMarketEvidence {
  /** The headline (ADR-0022 §4), base currency, 2-dp. */
  median: string;
  /** Datapoints behind it. At least 1 — a key with none carries no evidence at all. */
  n: number;
  /** Most recent result, and the oldest, so the span the evidence covers can be shown. */
  latestAt: Date;
  earliestAt: Date;
  confidence: { score: number; badge: MarketConfidenceBadge };
}

/** One line, resolved: what anchors it, in what currency, and what is known about it. Carries no
 * identity of its own — a line the caller merely described has none — so the lot path adds its
 * `lineId` and `auctionLotId` on top (see {@link AuctionLotLineAnchor}). */
export interface LineAnchor {
  stampId: string;
  /** The leading catalog number, prefix-formatted (`Mi·PL 12`) — how a line is named on screen. */
  catalogLabel: string | null;
  stampName: string | null;
  conditionId: string;
  conditionAbbreviation: string;
  certificateStatusId: string | null;
  formatId: string | null;
  formatAbbreviation: string | null;
  quantity: number;
  /** What {@link anchor} and {@link catalogueValue} are in — the sale's on the lots screen, the
   * one the caller asked for otherwise. */
  currency: string;
  /** What {@link market}'s figures are in. */
  baseCurrency: string;

  /** What **one** of them is worth, in {@link currency} — the figure #509 sums. Null when the line
   * is unanchored or unconvertible. */
  anchor: number | null;
  /** Which route produced it; null when neither could. */
  source: "market" | "catalogue" | null;
  /** An anchor exists and cannot be stated in {@link currency}. */
  unconvertible: boolean;

  /** ADR-0022's figures for this key, or null when nothing has ever been recorded against it. */
  market: AnchorMarketEvidence | null;
  /** The catalogue rollup for this line, in {@link currency}, 2-dp. Null when the catalogue prices
   * it at nothing — or prices it in a currency with no rate to this one, which
   * {@link unconvertible} is what says. */
  catalogueValue: string | null;
  /** The ladder #520 resolved for this line's `stamp × condition`. Carried only for a line the
   * catalogue anchors, since that is the only figure it multiplies. */
  ratio: RealizationRatio | null;
  /** Copies already held of this `stamp × condition` — shown, never computed with. */
  owned: number;
}

/** A resolved line that **is** an `AuctionLotLine`, which is every line on the lots screen. The two
 * identity fields are the only thing the lot path adds. */
export interface AuctionLotLineAnchor extends LineAnchor {
  lineId: string;
  auctionLotId: string;
}

/** A lot's lines, resolved. */
export interface AuctionLotAnchors {
  lotId: string;
  currency: string;
  baseCurrency: string;
  lines: AuctionLotLineAnchor[];
}

// ── The shared context, loaded once for a whole page ─────────────────────────

/**
 * Everything anchoring needs from the database, for however many lines are being resolved at once.
 *
 * **The batching is the reason this is a context rather than a per-line read.** One market read, one
 * rate map, one ratio load and one ownership count cover a whole page of lots — resolving a line at
 * a time would turn a forty-lot watchlist into four separate queries per row.
 */
export interface AnchorContext {
  /** What the market medians are in, and what a catalogue figure was converted *from*. */
  baseCurrency: string;
  /** Base → each currency being answered in, current. Null for a currency no rate could be had for,
   * which is what makes a line *unconvertible* rather than unanchored. */
  rates: Map<string, number | null>;
  marketByStamp: Map<string, StampMarketValue[]>;
  ratios: {
    resolve(subject: {
      areaId: string | null;
      conditionId: string;
      issuedYear: number | null;
    }): RealizationRatio;
  };
  /** Keyed by {@link stampConditionKey}. */
  owned: Map<string, number>;
}

/**
 * Load {@link AnchorContext} for a set of stamps and the currencies the answers are wanted in.
 *
 * Both callers load it the same way and neither may load half of it: the lots screen resolves a
 * page's worth of lots across several sale currencies, and a lot-free query resolves one line-set in
 * one currency (#1168).
 */
export async function loadAnchorContext(
  collectionId: string,
  stampIds: string[],
  currencies: string[]
): Promise<AnchorContext> {
  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  const [marketByStamp, rates, ratios, owned] = await Promise.all([
    readStampMarketValues(collectionId, stampIds),
    baseToSaleRates(collectionId, baseCurrency, currencies),
    loadRealizationRatios(collectionId),
    countCopiesByStampAndCondition(collectionId, stampIds),
  ]);
  return { baseCurrency, rates, marketByStamp, ratios, owned };
}

/**
 * **The anchoring rule, and the only statement of it.**
 *
 * Market median for the line's exact key when it has any datapoint, else catalogue × the learned
 * ratio, else nothing — per line, never per lot, and the same function whether the line came off an
 * `AuctionLotLine` or out of a caller's description of a lot that does not exist here (#1168). A
 * second spelling of this is the defect the whole arrangement exists to prevent: the agent's answer
 * and the lot screen's would diverge and nothing would ever go red over it.
 */
export function anchorLine(line: AnchorableLine, context: AnchorContext): LineAnchor {
  return resolveLine(line, {
    baseCurrency: context.baseCurrency,
    rate: context.rates.get(line.currency) ?? null,
    market: findMarketValue(context.marketByStamp.get(line.stampId), line),
    ratios: context.ratios,
    owned: context.owned.get(stampConditionKey(line.stampId, line.conditionId)) ?? 0,
  });
}

/**
 * Resolve the anchors for a whole page of lots.
 *
 * Lots with no composition are absent from the result — the caller reads that as a lot there is
 * nothing to recommend for, which is the normal state of a lot while it is still being entered.
 *
 * `valued` is the composition pass the caller has **already** made, where it made one: the lots
 * list values a page to fill its catalogue-value column before it ever asks for a recommendation,
 * and valuing the same lots twice would load the format-factor table and the area tree twice for
 * one screen. It is an input, never a cache — a caller with nothing in hand passes nothing and this
 * makes the pass itself.
 */
export async function resolveAuctionLotAnchors(
  collectionId: string,
  lotIds: string[],
  valued?: Map<string, AuctionLotComposition>
): Promise<Map<string, AuctionLotAnchors>> {
  if (lotIds.length === 0) return new Map();

  const valuations = valued ?? (await valuateAuctionLotLines(collectionId, lotIds));
  // Narrowed to what was asked for: a caller handing in a page's valuations may well have valued
  // more lots than it is asking about, and answering for those would be a quiet superset.
  const compositions = lotIds
    .map((lotId) => valuations.get(lotId))
    .filter((composition): composition is AuctionLotComposition => composition !== undefined);
  if (compositions.length === 0) return new Map();

  const lines = compositions.flatMap((composition) => composition.lines);

  // The same context the lot-free caller loads, over this page's stamps and sale currencies. One
  // market read, one rate map, one ratio load and one ownership count for the whole page.
  const context = await loadAnchorContext(
    collectionId,
    lines.map((line) => line.stampId),
    compositions.map((composition) => composition.currency)
  );

  const out = new Map<string, AuctionLotAnchors>();
  for (const composition of compositions) {
    out.set(composition.lotId, {
      lotId: composition.lotId,
      currency: composition.currency,
      baseCurrency: context.baseCurrency,
      // `AuctionLotLineItem` satisfies `AnchorableLine` structurally, so this is the shared rule
      // with the line's own identity put back on top — not a lot-shaped variant of it.
      lines: composition.lines.map((line) => ({
        lineId: line.id,
        auctionLotId: line.auctionLotId,
        ...anchorLine(line, context),
      })),
    });
  }
  return out;
}

/** The market value recorded for a line's **exact** key. Nulls are matched exactly, with no
 * fall-back across levels (ADR-0022 §1): folding a certificate or a format away would anchor a bid
 * on a figure describing something that was never sold. */
function findMarketValue(
  values: StampMarketValue[] | undefined,
  line: AnchorableLine
): StampMarketValue | null {
  if (!values) return null;
  const wanted = marketKeyOf(line);
  return values.find((value) => marketKeyOf(value) === wanted) ?? null;
}

interface LineContext {
  baseCurrency: string;
  /** Base → sale, current. Null when no rate could be had. */
  rate: number | null;
  market: StampMarketValue | null;
  ratios: { resolve(subject: { areaId: string | null; conditionId: string; issuedYear: number | null }): RealizationRatio };
  owned: number;
}

function resolveLine(line: AnchorableLine, context: LineContext): LineAnchor {
  const identity = {
    stampId: line.stampId,
    catalogLabel: line.catalogLabel,
    stampName: line.stampName,
    conditionId: line.conditionId,
    conditionAbbreviation: line.conditionAbbreviation,
    certificateStatusId: line.certificateStatusId,
    formatId: line.formatId,
    formatAbbreviation: line.formatAbbreviation,
    quantity: line.quantity,
    currency: line.currency,
    baseCurrency: context.baseCurrency,
    owned: context.owned,
  };

  const market: AnchorMarketEvidence | null = context.market
    ? {
        median: context.market.median,
        n: context.market.n,
        latestAt: context.market.latestAt,
        earliestAt: context.market.earliestAt,
        confidence: context.market.confidence,
      }
    : null;

  // The catalogue side is the composition's own figure: already in the sale's currency, already
  // rolled up. `unpriced` and `unconvertible` are kept apart there and stay apart here.
  const catalogueValue = line.unpriced || line.unconvertible ? null : line.unitValue;

  if (market) {
    // A key with any datapoint is anchored on it, whatever the catalogue says. The median is in the
    // base currency, so this is the one anchor that needs a rate.
    const median = Number(market.median);
    if (context.rate === null || !Number.isFinite(median)) {
      return {
        ...identity,
        anchor: null,
        source: "market",
        unconvertible: context.rate === null,
        market,
        catalogueValue,
        ratio: null,
      };
    }
    return {
      ...identity,
      anchor: median * context.rate,
      source: "market",
      unconvertible: false,
      market,
      catalogueValue,
      ratio: null,
    };
  }

  if (line.unpriced) {
    // Neither route: counted and reported, never treated as zero (ADR-0029 §1).
    return {
      ...identity,
      anchor: null,
      source: null,
      unconvertible: false,
      market: null,
      catalogueValue: null,
      ratio: null,
    };
  }

  const ratio = context.ratios.resolve({
    areaId: line.areaId,
    conditionId: line.conditionId,
    issuedYear: line.issuedYear,
  });

  if (line.unconvertible || catalogueValue === null) {
    // Priced by the catalogue, in a currency with no rate to the sale's. The ratio is still stated:
    // it is what the figure *would* be multiplied by, and hiding it would make the line look
    // unpriceable rather than unconvertible.
    return {
      ...identity,
      anchor: null,
      source: "catalogue",
      unconvertible: true,
      market: null,
      catalogueValue: null,
      ratio,
    };
  }

  return {
    ...identity,
    anchor: Number(catalogueValue) * ratio.ratio,
    source: "catalogue",
    unconvertible: false,
    market: null,
    catalogueValue,
    ratio,
  };
}

/**
 * The resolved lines as the pure arithmetic takes them (#509).
 *
 * An unanchored line arrives with no source at all; `bid-recommendation.ts` reads `source` only
 * where there is an anchor, so the unanchored case is handed the catalogue label and counted as
 * unanchored on its null figure — which is the one place the two shapes do not line up exactly.
 */
export function toBidLines(lines: LineAnchor[]): BidLine[] {
  return lines.map((line) => ({
    quantity: line.quantity,
    anchor: line.anchor,
    source: line.source ?? "catalogue",
    unconvertible: line.unconvertible,
  }));
}
