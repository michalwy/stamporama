// What the auction reads answer with, and the projections that build them (#1036).
//
// **Pure, and structurally typed on purpose**, exactly as `collection-reads.ts` (#710),
// `offer-reads.ts` (#711) and `bid-reads.ts` (#1168) are and for their reason (`agent-api.md`, *The
// module layout is the Prisma-free split*): `AuctionLotListItem` carries forty fields, and a
// projection naming its type would stop being readable as a statement of what an agent is told.
// Everything here is a function of plain objects, so `pnpm test:unit` holds the decisions.
//
// ## The one decision this file exists for: the figures are the app's own
//
// **Nothing here computes a figure.** Every amount, the standing, the ceiling comparisons and the
// exposure totals arrive already computed by `listAuctionLots` and `auctionLotExposure` — the reads
// the lots screen and its exposure bar are drawn from — and this file only names them for a model.
// The one thing it evaluates is `lotHasSignal`, and that is the lots toolbar's own predicate called
// with the row's own figures, not a restatement of it. An agent and the screen must not be able to
// disagree (#1036), and one function is the only form of that guarantee this repository can have.
//
// ## Read only, by absence
//
// *No create-, edit- or bid-shaped auction operation exists* (the collector, 2026-09-10) held until
// #1627 opened the register — `operations/auction-writes.ts`, whose answers reuse {@link watchlistLot}.
// No bid-shaped one exists still. Nothing in this file could write if it wanted to, and nothing in
// `operations/auctions.ts` imports a function that does — `tests/unit/agent-api-operation-boundary.test.ts`
// fails if one ever does.

import { LOT_SIGNALS, lotHasSignal, type LotSignal } from "../auction-lot";
import { auctionLotName, type AuctionLotOutcome, type AuctionLotStatus } from "../auction-rules";
import { platformOfferIdFromUrl } from "../platform-offer-url";
import { compact } from "./collection-reads";

// ── The watchlist ────────────────────────────────────────────────────────────

/** One lot as the watchlist projection reads it — the subset of `AuctionLotListItem` it states. */
export interface WatchlistLotRow {
  readonly id: string;
  readonly saleId: string;
  readonly saleName: string;
  readonly sellerName: string;
  readonly platformName: string;
  readonly currency: string;
  readonly auctionLotNo: number;
  readonly lotNo: string | null;
  readonly url: string | null;
  readonly title: string | null;
  readonly derivedTitle: string | null;
  readonly status: AuctionLotStatus;
  readonly endsAt: Date;
  readonly startingPrice: string | null;
  readonly currentBid: string | null;
  readonly checkedAt: Date | null;
  readonly allIn: string | null;
  readonly myBid: string | null;
  readonly myAllIn: string | null;
  readonly maxBid: string | null;
  readonly ceiling: string | null;
  readonly ceilingSetApart: boolean;
  /** How the ceiling set apart was reached, when the agent API set it with a note (#1627). */
  readonly ceilingNote: string | null;
  readonly bidRoom: string | null;
  readonly standing: "leading" | "outbid" | null;
  readonly overCeiling: boolean | null;
  readonly myBidOverCeiling: boolean | null;
  readonly premiumPercent: string | null;
  readonly premiumFixed: string | null;
  readonly notStamps: boolean;
  readonly notStampsDescription: string | null;
  readonly catalogValue: string | null;
  readonly catalogValueHigh: string | null;
  readonly recommendation: {
    readonly fair: { readonly allIn: string; readonly bid: string | null } | null;
    readonly high: { readonly fair: { readonly allIn: string; readonly bid: string | null } } | null;
  } | null;
  readonly conditionToSettle: boolean;
  readonly unsettledLines: readonly {
    readonly stamp: string;
    readonly possibleConditions: readonly string[];
    readonly unknown: boolean;
  }[];
  /** The collector's own labels on the lot (#1625), already in the dictionary's order. */
  readonly tags: readonly { readonly name: string }[];
  /** The *to review* marker (#1626) — `ApiReviewMark`, structurally — or null when nothing waits. */
  readonly apiReview: {
    readonly at: string;
    readonly created: boolean;
    readonly fields: readonly string[];
  } | null;
}

/** A lot's tags as the agent reads them (#1625): the names, in the order the app lists them. A tag's
 *  colour is how a chip is drawn and says nothing to a model, and its id names nothing the agent can
 *  act on — no operation takes one. */
function tagNames(tags: readonly { readonly name: string }[]): string[] {
  return tags.map((tag) => tag.name);
}

/** One open lot as the agent reads it. Every amount is in {@link currency}, the sale's. */
export interface AgentWatchlistLot {
  readonly lotId: string;
  /** The collection's own short number for the lot — what the quick-jump box takes after `lot`. */
  readonly lotNumber: number;
  /** The title, else the name derived from what the lot holds, else the platform's number. */
  readonly name: string;
  /** The platform's own number for the lot — on Allegro, the offer number. */
  readonly platformLotNo?: string;
  readonly url?: string;
  readonly sale: string;
  /** The sale's id — what `update_auction_sale` takes. */
  readonly saleId: string;
  readonly seller: string;
  readonly platform: string;
  readonly currency: string;
  /** When the auction closes, as an ISO instant. */
  readonly endsAt: string;
  /** The closing time has passed and the collector has not yet recorded how it ended. */
  readonly ended: boolean;
  /** What the lot opened at. A record, never a cost: a lot nobody has bid on costs nothing. */
  readonly startingPrice?: string;
  /** What the auction stood at when it was last looked at — an observation, dated by {@link checkedAt}. */
  readonly currentBid?: string;
  /** {@link currentBid} with the buyer's premium added; shipping belongs to the parcel, not the lot. */
  readonly currentBidAllIn?: string;
  readonly checkedAt?: string;
  /** The proxy maximum the collector placed with the platform — a commitment, not an observation. */
  readonly myBid?: string;
  readonly myBidAllIn?: string;
  /** The collector's ceiling. **Already an all-in figure**, premium included. Unless
   * {@link ceilingSetApart}, it follows the bid: it is then {@link myBidAllIn} (#1515). */
  readonly ceiling?: string;
  /** The ceiling was set apart from the bid and stays put when the bid changes. */
  readonly ceilingSetApart: boolean;
  /** How the ceiling set apart was reached, as `set_auction_lot_ceiling` recorded it (#1627). */
  readonly ceilingNote?: string;
  /** The highest hammer price whose all-in cost still fits inside {@link ceiling}. */
  readonly ceilingBid?: string;
  /** `leading` while the placed bid still covers the price, `outbid` once it does not. */
  readonly standing?: "leading" | "outbid";
  /** The price, all-in, has passed the ceiling. */
  readonly overCeiling?: boolean;
  /** The bid the collector placed would, all-in, cost more than their ceiling. */
  readonly myBidOverCeiling?: boolean;
  /** The lots toolbar's signals this lot carries — what to do about it now. */
  readonly signals: readonly LotSignal[];
  readonly premiumPercent?: string;
  readonly premiumFixed?: string;
  /** The lot is not stamps (#1624) — literature, an accessory: it has no stamps listed and no
   * catalogue value, and a won one becomes an expense on the purchase. */
  readonly notStamps: boolean;
  /** What a {@link notStamps} lot is, when the collector said. */
  readonly notStampsDescription?: string;
  /** The collector's own labels on the lot (#1625), by name. Always present — empty when it has none. */
  readonly tags: readonly string[];
  /** What the lot's described contents list at in the catalogue — the **low** end while a line's
   *  condition is to settle (#1623). Absent until something is described, or nothing is priced. */
  readonly catalogueValue?: string;
  /** The top of that range; absent when the value is one figure. */
  readonly catalogueValueHigh?: string;
  /** The lots screen's recommended figure (`recommend_bid`'s `fair`), all-in, with the hammer price
   *  that fits inside it — the low end while a condition is to settle. */
  readonly recommended?: { readonly allIn: string; readonly bid?: string };
  /** The same at the top of the range; absent when the recommendation is one figure. */
  readonly recommendedHigh?: { readonly allIn: string; readonly bid?: string };
  /** Some line's condition is unknown or one of several (#1623): the figures above are ranges, and
   *  a won lot cannot be settled into its purchase until each line has one condition. */
  readonly conditionToSettle: boolean;
  /** Those lines: the stamp, and the conditions it may be in — or `conditionUnknown` for any. */
  readonly unsettledLines?: readonly {
    readonly stamp: string;
    readonly possibleConditions?: readonly string[];
    readonly conditionUnknown?: true;
  }[];
  /** What the agent API wrote to this lot that the collector has not yet confirmed (#1626): it
   *  `created` the lot, and/or `changed` these fields, the latest `at` this instant. Absent when
   *  nothing waits for review. Only the collector clears it, in the app. */
  readonly toReview?: {
    readonly at: string;
    readonly created: boolean;
    readonly changed: readonly string[];
  };
  /** Where the lot is in the app, relative to this instance: its sale's screen, focused on it. */
  readonly path: string;
}

/** A recommendation level as the agent reads it: `bid` dropped when the fees consume the figure. */
function levelOf(
  value: { readonly allIn: string; readonly bid: string | null } | null | undefined
): { allIn: string; bid?: string } | undefined {
  if (!value) return undefined;
  return compact({ allIn: value.allIn, bid: value.bid ?? undefined }) as { allIn: string; bid?: string };
}

/** A watchlist row's own last resort, as the lots screen spells it (`auctionLotName`). */
const UNTITLED_LOT = "Untitled lot";

/**
 * One open lot as the agent reads it.
 *
 * **`now` is the caller's**, so a page of rows is read against one instant, as `resolveSignals` reads
 * the toolbar's. `false` survives `compact` and `null` does not: `overCeiling: false` is an answer,
 * while an absent one means a figure it compares was never recorded — the lot row's own three states.
 */
export function watchlistLot(row: WatchlistLotRow, now: Date, path: string): AgentWatchlistLot {
  const signals = LOT_SIGNALS.filter((signal) =>
    lotHasSignal(
      signal,
      {
        status: row.status,
        endsAt: row.endsAt,
        currentBid: row.currentBid,
        myBid: row.myBid,
        maxBid: row.maxBid,
        fees: { premiumPercent: row.premiumPercent, premiumFixed: row.premiumFixed },
      },
      now
    )
  );
  return compact({
    lotId: row.id,
    lotNumber: row.auctionLotNo,
    name: auctionLotName(row) ?? UNTITLED_LOT,
    platformLotNo: row.lotNo,
    url: row.url,
    sale: row.saleName,
    saleId: row.saleId,
    seller: row.sellerName,
    platform: row.platformName,
    currency: row.currency,
    endsAt: row.endsAt.toISOString(),
    ended: row.endsAt.getTime() <= now.getTime(),
    startingPrice: row.startingPrice,
    currentBid: row.currentBid,
    currentBidAllIn: row.allIn,
    checkedAt: row.checkedAt?.toISOString(),
    myBid: row.myBid,
    myBidAllIn: row.myAllIn,
    ceiling: row.ceiling,
    ceilingSetApart: row.ceilingSetApart,
    ceilingNote: row.ceilingNote,
    ceilingBid: row.bidRoom,
    standing: row.standing,
    overCeiling: row.overCeiling,
    myBidOverCeiling: row.myBidOverCeiling,
    signals,
    premiumPercent: row.premiumPercent,
    premiumFixed: row.premiumFixed,
    notStamps: row.notStamps,
    notStampsDescription: row.notStampsDescription,
    tags: tagNames(row.tags),
    catalogueValue: row.catalogValue,
    catalogueValueHigh: row.catalogValueHigh,
    recommended: levelOf(row.recommendation?.fair),
    recommendedHigh: levelOf(row.recommendation?.high?.fair),
    conditionToSettle: row.conditionToSettle,
    unsettledLines:
      row.unsettledLines.length === 0
        ? undefined
        : row.unsettledLines.map(
            (line) =>
              compact({
                stamp: line.stamp,
                possibleConditions: line.unknown ? undefined : line.possibleConditions,
                conditionUnknown: line.unknown ? (true as const) : undefined,
              }) as { stamp: string; possibleConditions?: string[]; conditionUnknown?: true }
          ),
    toReview: row.apiReview
      ? { at: row.apiReview.at, created: row.apiReview.created, changed: [...row.apiReview.fields] }
      : undefined,
    path,
  }) as AgentWatchlistLot;
}

// ── Exposure ─────────────────────────────────────────────────────────────────

/** What the exposure projection reads — `AuctionLotExposure`, structurally. */
export interface ExposureRow {
  readonly baseCurrency: string;
  readonly committedTotal: string;
  readonly ceilingTotal: string;
  readonly payableCount: number;
  readonly uncappedCount: number;
  readonly outpricedCount: number;
  readonly unconvertibleCount: number;
}

/** What the watchlist can cost, in the collection's base currency. */
export interface AgentAuctionExposure {
  readonly currency: string;
  /** *Committed* on the lots screen. */
  readonly committedTotal: string;
  /** *At ceiling* on the lots screen. */
  readonly ceilingTotal: string;
  readonly countedLots: number;
  readonly uncappedLots: number;
  readonly outpricedLots: number;
  readonly unconvertibleLots: number;
}

/**
 * The exposure bar's figures under the names a model reads.
 *
 * **The counts are never dropped, a zero included**, which is `valuation.md`'s standing rule: a total
 * travels with what says how much is behind it, and `uncappedLots: 0` is what lets a total be read as
 * complete.
 */
export function auctionExposure(row: ExposureRow): AgentAuctionExposure {
  return {
    currency: row.baseCurrency,
    committedTotal: row.committedTotal,
    ceilingTotal: row.ceilingTotal,
    countedLots: row.payableCount,
    uncappedLots: row.uncappedCount,
    outpricedLots: row.outpricedCount,
    unconvertibleLots: row.unconvertibleCount,
  };
}

// ── Already tracked ──────────────────────────────────────────────────────────

/**
 * The offer number a listing an agent holds names, or null when it names none.
 *
 * A bare run of digits is the number itself; anything carrying a `/` is read as a link, at the
 * boundaries `platform-offer-url.ts` matches stored addresses on. **Anything else is not guessed at**:
 * `Lot 42` is a house's catalogue position and never an offer number, which is the rule the lookup
 * behind this has kept since #575.
 */
export function listingOfferNumber(listing: string): string | null {
  const value = listing.trim();
  if (/^\d+$/.test(value)) return value;
  if (value.includes("/")) return platformOfferIdFromUrl(value);
  return null;
}

/** One tracked lot, as `findLotsForListings` answers for a listing — `AuctionLotListingMatch`, structurally. */
export interface ListingMatchRow {
  readonly platformOfferId: string;
  readonly lotId: string;
  readonly auctionLotNo: number;
  readonly title: string;
  readonly saleName: string;
  readonly outcome: AuctionLotOutcome;
  readonly notStamps: boolean;
  readonly notStampsDescription: string | null;
  readonly path: string;
  readonly matchedBy: "lot-no" | "url";
  readonly tags: readonly { readonly name: string }[];
}

/**
 * - `tracked` — the collection records a lot for this listing; which one, and how it stands, follow.
 * - `not_tracked` — the listing names an offer number and no lot answers for it.
 * - `unrecognized` — nothing in the string is an offer number, so nothing was looked up.
 */
export type ListingVerdict = "tracked" | "not_tracked" | "unrecognized";

/** What one listing in the batch is answered with. */
export interface AgentTrackedListing {
  /** The string as it was sent. */
  readonly listing: string;
  readonly verdict: ListingVerdict;
  /** The offer number it was looked up under. Absent on `unrecognized`. */
  readonly offerNumber?: string;
  readonly lotId?: string;
  readonly lotNumber?: number;
  readonly name?: string;
  readonly sale?: string;
  /** `pending` while it is still being bid on; `won`, `lost`, `observed` or `cancelled` once it is not. */
  readonly outcome?: AuctionLotOutcome;
  /** The lot is not stamps (#1624). Present on `tracked` only. */
  readonly notStamps?: boolean;
  readonly notStampsDescription?: string;
  /** Whether the platform's number stored on the lot answered, or its stored address. */
  readonly matchedBy?: "lot-no" | "url";
  /** The collector's own labels on the lot (#1625), by name. Present on `tracked` alone. */
  readonly tags?: readonly string[];
  readonly path?: string;
}

/**
 * Every listing answered, **in the order sent and none dropped**.
 *
 * `findLotsForListings` leaves an unmatched id out, which is right for a chip that draws nothing on a
 * listing nobody bid on. An agent reading a batch cannot tell a listing left out from one that was
 * never asked about, so here *no* is a row — `match_wants`' spelling, and for its reason.
 */
export function trackedListings(
  listings: readonly string[],
  matches: readonly ListingMatchRow[]
): AgentTrackedListing[] {
  const byNumber = new Map(matches.map((match) => [match.platformOfferId, match]));
  return listings.map((listing): AgentTrackedListing => {
    const offerNumber = listingOfferNumber(listing);
    if (offerNumber === null) return { listing, verdict: "unrecognized" };
    const match = byNumber.get(offerNumber);
    if (!match) return { listing, verdict: "not_tracked", offerNumber };
    return {
      listing,
      verdict: "tracked",
      offerNumber,
      lotId: match.lotId,
      lotNumber: match.auctionLotNo,
      name: match.title,
      sale: match.saleName,
      outcome: match.outcome,
      notStamps: match.notStamps,
      ...(match.notStampsDescription ? { notStampsDescription: match.notStampsDescription } : {}),
      matchedBy: match.matchedBy,
      tags: tagNames(match.tags),
      path: match.path,
    };
  });
}
