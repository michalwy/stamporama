import "server-only";
import { prisma } from "./db";
import type { AuctionLotComposition } from "./auction-lines";
import type { AuctionFees } from "./auction-lot";
import {
  resolveAuctionLotAnchors,
  toBidLines,
  type AuctionLotLineAnchor,
} from "./auction-lot-anchors";
import {
  recommendBid,
  DEFAULT_BID_CEILING_PERCENT,
  DEFAULT_BID_FLOOR_PERCENT,
  type BidBandPercents,
  type BidRecommendation,
} from "./bid-recommendation";

// **What a lot is worth bidding, read for a screen** (#511; ADR-0029 §3, §5, §8) — the domain half
// of the pure `bid-recommendation.ts`, exactly as `market-values.ts` is of `market-value.ts` and
// `realization-ratios.ts` of `realization-ratio.ts`.
//
// It decides nothing. `auction-lot-anchors.ts` (#510) says what anchors each line and in what
// currency, `bid-recommendation.ts` (#509) does the arithmetic, and the collection's band (#508) is
// two columns. What is left is reading them together, once per screen.
//
// **Two reads, because the two surfaces ask different questions.**
//
//   - {@link resolveLotRecommendations} answers *what would the quick fill write* for a whole page
//     of lots. That is three figures per row, and it is what the `REC` control needs before it is
//     ever clicked, so it rides on the lot list itself.
//   - {@link getAuctionLotBidEvidence} answers *why* for **one** lot — a row per composition line
//     with what anchored it, the market evidence or the learned ratio behind it, and the ownership
//     counts. Fetched only while the popover is open, on the rule the composition editor already
//     follows (#353): a forty-lot watchlist must not pull forty lots' evidence to draw forty
//     collapsed rows.
//
// **Nothing is stored** (ADR-0029 §10) — not the recommendation and not the ratios behind it. The
// figures move as results accumulate, and that is the point: a lot recommended differently a month
// apart is the price base having learned something, not a cache going stale.

/** The collection's band (#508), falling back to the ADR's own defaults for a row the migration has
 * not reached. Read per screen rather than threaded through the lot reads: it is two integers, and
 * the alternative is every caller of a list remembering to fetch them. */
export async function readBidBand(collectionId: string): Promise<BidBandPercents> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { bidFloorPercent: true, bidCeilingPercent: true },
  });
  return {
    bidFloorPercent: collection?.bidFloorPercent ?? DEFAULT_BID_FLOOR_PERCENT,
    bidCeilingPercent: collection?.bidCeilingPercent ?? DEFAULT_BID_CEILING_PERCENT,
  };
}

/**
 * The three figures for a whole page of lots.
 *
 * `feesOf` is asked per lot because the premium lives on the **sale** and a page spans sales; the
 * caller has the row in hand and this module has no reason to read one. Shipping is ignored by
 * `recommendBid` itself — a parcel ships once, however many lots are in it.
 *
 * `valued` is the composition pass the caller has already made for its catalogue-value column, so
 * a page is valued once and not twice. Lots with no composition are simply absent from the result:
 * a lot nobody has described has nothing to recommend, which is what `lotNeedsComposition` (#442)
 * already says on the row.
 */
export async function resolveLotRecommendations(
  collectionId: string,
  lotIds: string[],
  valued: Map<string, AuctionLotComposition>,
  feesOf: (lotId: string) => AuctionFees
): Promise<Map<string, BidRecommendation>> {
  const described = lotIds.filter((lotId) => valued.has(lotId));
  if (described.length === 0) return new Map();

  const [band, anchors] = await Promise.all([
    readBidBand(collectionId),
    resolveAuctionLotAnchors(collectionId, described, valued),
  ]);

  const out = new Map<string, BidRecommendation>();
  for (const [lotId, resolved] of anchors) {
    out.set(lotId, recommendBid(toBidLines(resolved.lines), band, feesOf(lotId)));
  }
  return out;
}

/** Everything the evidence popover renders for one lot (ADR-0029 §8). */
export interface AuctionLotBidEvidence {
  lotId: string;
  /** What every figure on the recommendation is in — the sale's. */
  currency: string;
  /** What the market medians are in, so the popover can label them where the two differ. */
  baseCurrency: string;
  /** The percentages the floor and walk-away were taken at, so the popover can state them rather
   * than leave two figures whose relationship to `fair` has to be inferred. */
  band: BidBandPercents;
  recommendation: BidRecommendation;
  /** One per composition line, in the composition's own order. Carries what anchored it and the
   * evidence behind that — the whole point of the popover being that every figure on it can be
   * traced back to something recorded. */
  lines: AuctionLotLineAnchor[];
}

/**
 * The evidence for one lot, or **null** when it has no composition — the same answer the row gives
 * itself: there is nothing to recommend for a lot nobody has said anything about yet.
 *
 * Authorized by the lot, as every other per-lot read here is.
 */
export async function getAuctionLotBidEvidence(
  ownerId: string,
  lotId: string
): Promise<AuctionLotBidEvidence | null> {
  const lot = await prisma.auctionLot.findFirst({
    where: { id: lotId, auctionSale: { collection: { ownerId } } },
    select: {
      id: true,
      auctionSale: {
        select: { collectionId: true, premiumPercent: true, premiumFixed: true },
      },
    },
  });
  if (!lot) throw new Error("Auction lot not found");

  const collectionId = lot.auctionSale.collectionId;
  const [band, anchors] = await Promise.all([
    readBidBand(collectionId),
    resolveAuctionLotAnchors(collectionId, [lotId]),
  ]);
  const resolved = anchors.get(lotId);
  if (!resolved) return null;

  const fees: AuctionFees = {
    premiumPercent: lot.auctionSale.premiumPercent?.toFixed(2) ?? null,
    premiumFixed: lot.auctionSale.premiumFixed?.toFixed(2) ?? null,
  };

  return {
    lotId,
    currency: resolved.currency,
    baseCurrency: resolved.baseCurrency,
    band,
    recommendation: recommendBid(toBidLines(resolved.lines), band, fees),
    lines: resolved.lines,
  };
}
