// When a quick buy needs posting again (#1718) — pure, no Prisma and no `server-only`: the settings
// fields and the offer rows both read it in the browser.
//
// A quick-buy post on Facebook a few days old is seen by nobody, and a Delcampe listing sinks; the
// collector deletes it and posts it again. A platform (on Facebook, a group) therefore states after
// how many days that is due, and an **active quick buy** past it is marked and can be found. An
// auction ends of its own accord and is never marked; nor is a paused listing, which is in front of
// nobody.
//
// The days are counted from when the listing was **last posted** — its last *Repost*, else the date
// it was first listed. The first listing stays what it was, since time to sale is counted from it.

import type { OfferListingType, OfferState } from "./offer-rules";

/** The longest threshold taken: a year. Nothing sets one, and this only stops a typo. */
export const REFRESH_QUICK_BUYS_DAYS_MAX = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A threshold held to its shape: a whole number of days from 1 to a year, or null for never. */
export function cleanRefreshQuickBuysAfterDays(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  if (!Number.isInteger(value) || value < 1 || value > REFRESH_QUICK_BUYS_DAYS_MAX) {
    throw new Error(
      `Refresh quick buys after must be a whole number of days between 1 and ${REFRESH_QUICK_BUYS_DAYS_MAX}, or empty for never.`
    );
  }
  return value;
}

/** When the listing was last put in front of buyers: the later of its listing date and its last
 *  repost, or null when neither is known. The later rather than the repost alone, so a listing taken
 *  down and published afresh counts from its new listing date. */
export function lastPostedOn(listingDate: Date | null, lastPostedAt: Date | null): Date | null {
  if (!listingDate) return lastPostedAt;
  if (!lastPostedAt) return listingDate;
  return lastPostedAt > listingDate ? lastPostedAt : listingDate;
}

/** Whole days since `since`, never negative. */
export function daysUpSince(since: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS));
}

/** The instant a listing posted at or before is past a threshold of `days`. */
export function refreshCutoff(days: number, now: Date): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Whether an offer is the kind a refresh threshold is about: an active quick buy. */
export function countsForRefresh(offer: { state: OfferState; listingType: OfferListingType }): boolean {
  return offer.state === "active" && offer.listingType === "fixed";
}

/**
 * How many days an active quick buy past its platform's threshold has been up, or null where none
 * is due — not a quick buy, not active, no threshold, no date to count from, or not yet past it.
 */
export function quickBuyRefreshDue(
  offer: {
    state: OfferState;
    listingType: OfferListingType;
    listingDate: Date | null;
    lastPostedAt: Date | null;
  },
  thresholdDays: number | null,
  now: Date
): number | null {
  if (thresholdDays === null || !countsForRefresh(offer)) return null;
  const since = lastPostedOn(offer.listingDate, offer.lastPostedAt);
  if (!since) return null;
  const days = daysUpSince(since, now);
  return days >= thresholdDays ? days : null;
}
