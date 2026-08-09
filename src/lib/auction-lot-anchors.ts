import "server-only";
import {
  baseToSaleRates,
  valuateAuctionLotLines,
  type AuctionLotComposition,
  type AuctionLotLineItem,
} from "./auction-lines";
import type { BidLine } from "./bid-recommendation";
import { countCopiesByStampAndCondition, stampConditionKey } from "./copy-counts";
import { marketKeyOf, type MarketConfidenceBadge } from "./market-value";
import { readStampMarketValues, type StampMarketValue } from "./market-values";
import { getCollectionBaseCurrency } from "./pricing";
import { loadRealizationRatios, type RealizationRatio } from "./realization-ratios";

// **What anchors each line of an auction lot** (#510; ADR-0029 §1, §5, §7) — the domain layer
// between the valuation modules and the recommendation arithmetic in `bid-recommendation.ts`.
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
// **Currency** (ADR-0029 §5). Catalogue values already roll up in the sale's currency and ratios
// are unitless, so a catalogue anchor needs no conversion. Market medians are in the base currency
// and are converted base → sale at the **current** rate, because the recommendation is about a bid
// being placed now — not at a rate frozen on some past lot. A line whose anchor cannot be converted
// is reported *unconvertible*, never unanchored: it has a price and cannot be summed, which must
// not send the collector off to enter a value that already exists.
//
// **Ownership is evidence, never arithmetic** (ADR-0029 §7). How many copies are already held is
// reported and does not move a figure: duplicates are bought deliberately for trade and resale, so
// a system-applied haircut would under-bid the material a collector most wants.
//
// Resolved for a whole page of lots at a time: one composition pass, one market read, one ratio
// load, one ownership count. Ownership is **not** checked here — the caller has already resolved
// the collection for the owner, as everywhere in the auction modules.

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

/** One `AuctionLotLine`, resolved: what anchors it, in what currency, and what is known about it. */
export interface AuctionLotLineAnchor {
  lineId: string;
  auctionLotId: string;
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
  /** The sale's currency: what {@link anchor} and {@link catalogueValue} are in. */
  currency: string;
  /** What {@link market}'s figures are in. */
  baseCurrency: string;

  /** What **one** of them is worth, in the sale's currency — the figure #509 sums. Null when the
   * line is unanchored or unconvertible. */
  anchor: number | null;
  /** Which route produced it; null when neither could. */
  source: "market" | "catalogue" | null;
  /** An anchor exists and cannot be stated in the sale's currency. */
  unconvertible: boolean;

  /** ADR-0022's figures for this key, or null when nothing has ever been recorded against it. */
  market: AnchorMarketEvidence | null;
  /** The composition rollup for this line, sale currency, 2-dp. Null when the catalogue prices it
   * at nothing — or prices it in a currency with no rate to the sale's, which {@link unconvertible}
   * is what says. */
  catalogueValue: string | null;
  /** The ladder #520 resolved for this line's `stamp × condition`. Carried only for a line the
   * catalogue anchors, since that is the only figure it multiplies. */
  ratio: RealizationRatio | null;
  /** Copies already held of this `stamp × condition` — shown, never computed with. */
  owned: number;
}

/** A lot's lines, resolved. */
export interface AuctionLotAnchors {
  lotId: string;
  currency: string;
  baseCurrency: string;
  lines: AuctionLotLineAnchor[];
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
  const stampIds = lines.map((line) => line.stampId);

  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  const [marketByStamp, rates, ratios, owned] = await Promise.all([
    readStampMarketValues(collectionId, stampIds),
    baseToSaleRates(
      collectionId,
      baseCurrency,
      compositions.map((composition) => composition.currency)
    ),
    loadRealizationRatios(collectionId),
    countCopiesByStampAndCondition(collectionId, stampIds),
  ]);

  const out = new Map<string, AuctionLotAnchors>();
  for (const composition of compositions) {
    const rate = rates.get(composition.currency) ?? null;
    out.set(composition.lotId, {
      lotId: composition.lotId,
      currency: composition.currency,
      baseCurrency,
      lines: composition.lines.map((line) =>
        resolveLine(line, {
          baseCurrency,
          rate,
          market: findMarketValue(marketByStamp.get(line.stampId), line),
          ratios,
          owned: owned.get(stampConditionKey(line.stampId, line.conditionId)) ?? 0,
        })
      ),
    });
  }
  return out;
}

/** The market value recorded for a line's **exact** key. Nulls are matched exactly, with no
 * fall-back across levels (ADR-0022 §1): folding a certificate or a format away would anchor a bid
 * on a figure describing something that was never sold. */
function findMarketValue(
  values: StampMarketValue[] | undefined,
  line: AuctionLotLineItem
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

function resolveLine(line: AuctionLotLineItem, context: LineContext): AuctionLotLineAnchor {
  const identity = {
    lineId: line.id,
    auctionLotId: line.auctionLotId,
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
export function toBidLines(lines: AuctionLotLineAnchor[]): BidLine[] {
  return lines.map((line) => ({
    quantity: line.quantity,
    anchor: line.anchor,
    source: line.source ?? "catalogue",
    unconvertible: line.unconvertible,
  }));
}
