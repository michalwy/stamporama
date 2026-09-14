import "server-only";
import {
  AUCTION_LOT_LISTING_LOOKUP_LIMIT,
  auctionLotExposure,
  countAuctionLots,
  findLotsForListings,
  listAuctionLots,
  type AuctionLotFilters,
} from "../../auctions";
import {
  auctionExposure,
  listingOfferNumber,
  trackedListings,
  watchlistLot,
  type AgentAuctionExposure,
  type AgentTrackedListing,
  type AgentWatchlistLot,
} from "../auction-reads";
import { invalidRequest } from "../errors";
import { listResponse, parseListWindow, type ListResponse } from "../list";
import { stringList } from "../params";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import type { Operation, OperationContext, ParsedParams } from "../types";

// **The auctions the collector is already following** (#1036) — three reads the agent's daily report
// on new Allegro listings could not make before: which lots are open and how each stands, what they
// can cost, and whether a listing in the mail is one it reported yesterday.
//
// ## Read only, and no lot is created
//
// The collector, 2026-09-10: *the agent only reads from Stamporama — it does not create auctions
// automatically, at least at this stage.* So there is no create-, edit- or bid-shaped auction
// operation at all, **as an absence rather than a switch** (`agent-api.md`, *What is deliberately
// absent*). Adding a listing to the watchlist stays the collector's decision, made in the app after
// reading the report. This module imports three reads from `auctions.ts` and nothing that writes;
// `tests/unit/agent-api-operation-boundary.test.ts` fails if that changes, whatever the operation is
// called.
//
// ## Everything is `src/lib/` exposed rather than reinvented
//
// | operation | domain read | the screen that reads it too |
// | --- | --- | --- |
// | `list_auction_watchlist` | `listAuctionLots` + `countAuctionLots` | the lots list |
// | `summarize_auction_exposure` | `auctionLotExposure` | the exposure bar above it |
// | `find_tracked_auction_lots` | `findLotsForListings` | the Assistant's chip on a listing (#575) |
//
// **The figures are the app's own, and that is a requirement rather than a convenience**: the
// lead/outbid signal and the exposure totals an agent reports are the ones the auction screens show,
// from the same rule, so the two cannot come to disagree.
//
// ## One watchlist, and it is the screen's default
//
// Both the list and the exposure read over {@link WATCHLIST}, which is the lots screen with nothing
// narrowed: **open lots**, soonest closing first (#504). A closed lot is filed rather than followed,
// and its outcome is what `find_tracked_auction_lots` reports when the agent meets its listing again.
// No filter is published, on `agent-api.md`'s argument for leaving a line's manual value out: `/api/v1`
// only grows, so a parameter left out is reversible next week and one published is not.

/**
 * The watchlist an agent reads: the lots screen with nothing narrowed.
 *
 * **Empty on purpose, and shared by both reads** so the list and the exposure cannot describe two
 * different sets of lots. `lotListWhere` turns *no outcome chosen* into *open lots only* (#504),
 * which is exactly the collector's watchlist.
 */
const WATCHLIST: AuctionLotFilters = {};

// ── list_auction_watchlist ───────────────────────────────────────────────────

export async function readAuctionWatchlist(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentWatchlistLot>> {
  const window = parseListWindow(params);
  // First, and alone: the domain reads refuse a collection they cannot see with a plain `Error`,
  // which would reach the agent as a bare `internal_error`.
  const header = await loadCollectionHeader(context);

  const [page, total] = await Promise.all([
    listAuctionLots(context.ownerId, context.collectionId, {
      ...WATCHLIST,
      offset: window.offset,
      pageSize: window.limit,
    }),
    // **The match count, never `items.length`** (#706), over the same `lotListWhere` the page used.
    countAuctionLots(context.ownerId, context.collectionId, WATCHLIST),
  ]);

  const now = new Date();
  return listResponse(
    page.items.map((row) =>
      watchlistLot(
        row,
        now,
        // A lot has no page of its own; its address is its sale's, focused on it (#431).
        collectionPath(
          header,
          `/auctions/sales/${encodeURIComponent(row.saleId)}?lot=${encodeURIComponent(row.id)}`
        )
      )
    ),
    total,
    window
  );
}

export const listAuctionWatchlistOperation: Operation = {
  name: "list_auction_watchlist",
  method: "GET",
  path: "/auctions/lots",
  description:
    "The auction lots the collector is following and that are still open, soonest closing first — each with its closing time, what the auction stands at, the bid the collector placed, their ceiling, and whether they are leading or outbid. Read this before reporting on new listings: a listing already here is not new, and an open lot is money already committed. Nothing here bids, creates or edits a lot; adding one to the watchlist is the collector's decision.",
  writes: false,
  parameters: [],
  result: {
    kind: "list",
    description:
      "The open lots. Every amount is in the lot's own `currency`, the sale's. Three amounts are different things and must not be merged: `currentBid` is what the auction stood at when it was last looked at (dated by `checkedAt` — refreshing it is manual, so an old `checkedAt` means an old price), `myBid` is the proxy maximum the collector placed with the platform, and `ceiling` is their private valuation, **already all-in** — premium included — so `ceilingBid` is the highest hammer price that still fits inside it. `currentBidAllIn` and `myBidAllIn` add the buyer's premium and never shipping, which belongs to the parcel. `standing` is `leading` while `myBid` covers `currentBid` and `outbid` once it does not; it is absent when either is unrecorded. `signals` are the lots screen's own: `bid-possible` (the ceiling leaves room above the price), `outbid`, `leading`, `over-ceiling` (the price all-in has passed the ceiling) and `won-pending` (the lot has closed with the collector ahead and nobody has recorded the result). `ended: true` means the closing time has passed: `standing` is then where the bidding was last seen, not a confirmed result. Lots the collector has closed or cancelled are not listed.",
  },
  handler: async (context, params) => readAuctionWatchlist(context, params),
};

// ── summarize_auction_exposure ───────────────────────────────────────────────

export async function readAuctionExposure(context: OperationContext): Promise<AgentAuctionExposure> {
  await loadCollectionHeader(context);
  return auctionExposure(
    await auctionLotExposure(context.ownerId, context.collectionId, WATCHLIST)
  );
}

export const summarizeAuctionExposureOperation: Operation = {
  name: "summarize_auction_exposure",
  method: "GET",
  path: "/auctions/exposure",
  description:
    "What the open auction watchlist can cost, in the collection's base currency — the two figures the lots screen shows above the list. Use it to say how much is already riding on open bids before recommending another lot.",
  writes: false,
  parameters: [],
  result: {
    kind: "object",
    description:
      "`committedTotal` (*Committed* on the screen) is what is already at risk: every open lot at the proxy maximum the collector placed, with the buyer's premium, plus each parcel's shipping once — a lot with no bid placed costs nothing in it. `ceilingTotal` (*At ceiling*) is the same if every open lot were bid up to its ceiling; where a placed bid is higher than the ceiling, the bid counts. The counts say what is behind the figures and belong in any report of them: `countedLots` were costed; `uncappedLots` carry neither a bid nor a ceiling, so both totals read low by them; `outpricedLots` are lots the price has already carried past both the ceiling and the collector's bid, left out of both totals because they cannot be won without a new decision; `unconvertibleLots` are in a currency with no rate into this one and are left out rather than added at par. It covers the same lots `list_auction_watchlist` lists.",
  },
  handler: async (context) => readAuctionExposure(context),
};

// ── find_tracked_auction_lots ────────────────────────────────────────────────

export interface AgentTrackedListingsResponse {
  readonly listings: readonly AgentTrackedListing[];
}

export async function readTrackedAuctionLots(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentTrackedListingsResponse> {
  const listings = stringList(params, "listings");
  // **Refused rather than trimmed**, the list conventions' rule (#706): the domain lookup slices at
  // this ceiling silently, and a listing past it would come back `not_tracked` — a confident answer
  // to a question nothing asked.
  if (listings.length > AUCTION_LOT_LISTING_LOOKUP_LIMIT) {
    throw invalidRequest(
      `At most ${AUCTION_LOT_LISTING_LOOKUP_LIMIT} listings can be asked about at once and ${listings.length} were sent. Ask in batches.`
    );
  }
  await loadCollectionHeader(context);

  const numbers = [
    ...new Set(listings.map(listingOfferNumber).filter((n): n is string => n !== null)),
  ];
  const matches =
    numbers.length === 0
      ? []
      : await findLotsForListings(context.ownerId, context.collectionId, numbers);
  return { listings: trackedListings(listings, matches) };
}

export const findTrackedAuctionLotsOperation: Operation = {
  name: "find_tracked_auction_lots",
  method: "GET",
  path: "/auctions/tracked",
  description:
    "Whether the collection already follows the auctions behind some listings — send each listing's link or its offer number, as many as a mail holds, and learn for each whether a lot records it, which lot, and how it stands. This is how a listing reported yesterday is told from a new one. It is the same lookup the Stamporama browser extension makes on a listing page, so the two cannot disagree. It only reads: a listing that is not tracked stays untracked until the collector adds it.",
  writes: false,
  parameters: [
    {
      name: "listings",
      in: "query",
      type: "string[]",
      required: true,
      description: `The listings to ask about, up to ${AUCTION_LOT_LISTING_LOOKUP_LIMIT}: each a link to the listing (\`https://allegro.pl/oferta/…-18795065609\`) or its offer number (\`18795065609\`). Values are separated by commas, so send a link without its query string — the offer number is in the path.`,
    },
  ],
  result: {
    kind: "object",
    description:
      "`listings` answers every listing sent, in the order sent. `verdict` is `tracked` — a lot records it, and `lotId`, `lotNumber`, `name`, `sale`, `outcome` and `path` say which and how it stands — or `not_tracked`, where the listing names an offer number and no lot answers for it, or `unrecognized`, where nothing in the string is an offer number, so nothing was looked up and nothing is known either way. `outcome` is `pending` while the lot is still open (its figures are in `list_auction_watchlist`) and `won`, `lost`, `observed` (tracked without a bid, to record what it fetched) or `cancelled` once the collector has closed it. An offer number is matched against the number stored on a lot of the collection's Allegro platform, and against the address stored on any lot at the address's own boundaries, so one number is never found inside a longer one. A house's catalogue position (`Lot 42`) is not an offer number and is never matched.",
  },
  handler: async (context, params) => readTrackedAuctionLots(context, params),
};
