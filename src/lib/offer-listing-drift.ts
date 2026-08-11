/**
 * Which changes to an offer leave its **live listing out of step** (#542) — pure, Prisma-free, so
 * the one rule decides it on the server and can be reasoned about without a database.
 *
 * What this is for
 * ----------------
 * #513 gave the collector somewhere to put a stamp that belongs on an offer they already have: rather
 * than a second listing for the same thing, the set joins the existing offer. Where that offer was
 * still being prepared, nothing follows. Where it was **already up on the platform**, the live entry
 * now sells something it does not mention — and nothing in the app said so, because an offer knows
 * its own composition and knows nothing about when it was last posted.
 *
 * This is the missing half: a rule for *when* a change to an offer means the live listing has to be
 * gone back to. It answers the question #462's update flow needs answered — "which of these do I have
 * to re-post?" — which that flow deliberately left open, having no way to tell.
 *
 * What it is not
 * --------------
 * It is **not** a comparison against what was posted. #462 declined to store a snapshot of the last
 * listing, and that call stands: an update reloads every field precisely so that no second copy of
 * the offer has to be kept honest, and a stored copy that fell behind would be worse than none. This
 * asks a smaller question — did anything change here since it went up — which one timestamp answers
 * and which cannot disagree with the offer itself.
 *
 * Nor is it the photos' out-of-date signal (#311). That one compares a fingerprint of the *renderer's
 * inputs* against the images on disk, says so on the offer's Photos card, and is about files that
 * would have to be re-rendered. This is about the listing's own text and contents, and says so on the
 * offer. Two questions, two answers — repeating either in the other's place would turn a signal into
 * a warning about something the collector cannot act on from where they are standing.
 */

import { isAuctionListing, type OfferListingType, type OfferState } from "./offer-rules";

/**
 * The states in which a change is drift at all: the offer is **up on the platform**.
 *
 * `paused` is in, beside `active`, because a paused listing has not left the marketplace — it is
 * suspended, and resuming it puts exactly what is there back in front of buyers. A change made while
 * paused is therefore the same problem as one made while live, arriving a little earlier.
 *
 * Everything else is out, and each for its own reason: `preparing` and `ready` are an offer that has
 * never been posted, so there is nothing to be out of step with; `sold` and `withdrawn` are history,
 * and what a closed listing said is a record rather than a claim.
 */
export const LISTED_OFFER_STATES: readonly OfferState[] = ["active", "paused"];

/** Whether an offer in this state has a live listing a change could leave behind. */
export function isListedState(state: OfferState): boolean {
  return state === "active" || state === "paused";
}

/**
 * The parts of an offer's **header** a change to which the platform would show differently.
 *
 * Composition changes are not listed here — every one of them counts, without exception, and they
 * are recorded where they happen. What needs a rule is the header, because one of its fields moves
 * for a reason that has nothing to do with the listing.
 */
export interface ListingHeaderChange {
  /** The listing's own format, which decides how its two price fields are read. */
  listingType: OfferListingType;
  /** The **current** price changed — the asking price of a quick buy, the standing bid of an auction. */
  priceChanged: boolean;
  /** The **starting** price changed (auctions only): the figure the seller states. */
  startingPriceChanged: boolean;
  /** The title, description or private note changed — what the listing actually says. */
  textChanged: boolean;
}

/**
 * Whether a header change means the live listing no longer matches.
 *
 * The whole rule is the **auction price exception**. An auction's current price is an *observation of
 * the bidding* — that is what the column means everywhere else in the app (#449), and it is written
 * by the collector noting a bid and by the platform sync reading one (#481). Neither is a change to
 * the listing; a bid arriving is the listing working. Flagging it would fill the filter with every
 * auction anyone had bid on and bury the offers that genuinely need re-posting.
 *
 * A quick buy's price is the opposite: nothing moves it but the seller, so a new figure *is* a change
 * to what is on the platform. And an auction's **starting** price is the seller's own statement in the
 * same way, so it counts on an auction exactly as the asking price counts on a quick buy.
 *
 * Texts count on both: the title, the description and the private note are what the entry says.
 */
export function headerChangeIsDrift(change: ListingHeaderChange): boolean {
  if (change.textChanged) return true;
  if (isAuctionListing(change.listingType)) return change.startingPriceChanged;
  return change.priceChanged;
}
