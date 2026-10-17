// Following a Facebook group auction's bid (#1545; ADR-0061 §4) — the one rule the offer's Facebook
// card at the desk and the phone offer screen (#2010, ADR-0072) both draw from, so the two show the
// bidding at the same moments and call it closed at the same instant.
//
// Pure, so the unit suite holds it. The caller has already established that the offer is in a
// Facebook group: off Facebook a bid is read from the platform, never typed.

import { isAuctionListing, type OfferListingType, type OfferState } from "./offer-rules";

export interface FacebookBidding {
  /** The closing time has passed: the bid typed now is the winning one, and the auction waits to be
   *  sold to the winner or withdrawn (#1777). */
  closed: boolean;
  /** A bid has been recorded — the offer's price is the running bid, and a zero is *no bid*. */
  hasBid: boolean;
}

/**
 * Whether the offer's bidding is followed now, and where it stands — null when there is no bidding
 * to follow: a quick buy (#1671), or an auction that is not up in the group, which includes one still
 * waiting for the group's administrator (#1778), since nobody bids on a post nobody can see.
 */
export function facebookBidding(
  offer: { listingType: OfferListingType; state: OfferState; endsAt: Date | string | null; price: string },
  now: Date
): FacebookBidding | null {
  if (!isAuctionListing(offer.listingType)) return null;
  if (offer.state !== "active" && offer.state !== "paused") return null;
  return {
    closed: offer.endsAt !== null && new Date(offer.endsAt).getTime() <= now.getTime(),
    hasBid: offer.price !== "0.00",
  };
}

/** The bid button's words: once closed, what is typed is the figure *Sell* puts on the sale. */
export function recordBidLabel(closed: boolean): string {
  return closed ? "Record winning bid" : "Record bid";
}

/** What a closed auction asks of the collector, after *Closed …* — the same on both screens. */
export const FACEBOOK_CLOSED_ADVICE = "sell it to the winner, or withdraw it if nobody bid.";
