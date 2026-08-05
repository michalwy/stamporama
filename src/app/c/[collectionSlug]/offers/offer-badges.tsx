"use client";

import {
  type OfferListingType,
  type OfferState,
  OFFER_STATE_LABEL,
  isAuctionListing,
} from "@/lib/offer-rules";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

// Shared chip presentation for an offer's lifecycle state (ADR-0012, #165), reused by the list
// rows, the lot detail panel's Offers section, and the dialog header so an offer reads
// identically everywhere.

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

function tinted(token: string, label: string, title?: string) {
  return (
    <Tooltip content={title}>
      <span
        style={{
          ...CHIP,
          color: `var(--color-${token})`,
          borderColor: `var(--color-${token}-border, var(--color-border))`,
          background: `var(--color-${token}-soft, var(--color-bg-page))`,
        }}
      >
        {label}
      </span>
    </Tooltip>
  );
}

const STATE: Record<OfferState, { token: string | null; title: string }> = {
  preparing: { token: "info", title: "Still being composed — not yet published" },
  ready: { token: "info", title: "Fully prepared — ready to post to the platform" },
  active: { token: "accent", title: "Live on the platform" },
  paused: { token: "warning", title: "Temporarily suspended on the platform" },
  sold: { token: "success", title: "Sold through this offer" },
  withdrawn: { token: null, title: "Taken down; not for sale here" },
};

export function OfferStateChip({ state }: { state: OfferState }) {
  const meta = STATE[state];
  const label = OFFER_STATE_LABEL[state];
  if (!meta.token)
    return (
      <Tooltip content={meta.title}>
        <span style={CHIP}>{label}</span>
      </Tooltip>
    );
  return tinted(meta.token, label, meta.title);
}

/** Derived overlay (ADR-0013 §4): an active offer holding a set whose copy sold elsewhere — go to
 * the platform, remove the dead set (decrement) or withdraw. */
export function NeedsActionChip({ soldCopyCount }: { soldCopyCount: number }) {
  const copies = soldCopyCount === 1 ? "1 copy" : `${soldCopyCount} copies`;
  return tinted(
    "error",
    "Needs action",
    `${copies} in this offer sold elsewhere — remove the sold set(s) on the platform, or withdraw`
  );
}

/**
 * How the listing is sold (#449). Shown **only** for an auction: a quick buy is what an offer
 * ordinarily is, and a chip on every row saying so would be noise on the one screen that is a long
 * list. It is there because the price beside it means something different — a standing bid rather
 * than a figure the seller chose.
 *
 * Distinct from {@link InActiveBiddingChip}, which they sit next to: this says the listing *is* an
 * auction, that one says somebody has bid and the collector is committed (#215).
 */
export function ListingTypeChip({ listingType }: { listingType: OfferListingType }) {
  if (!isAuctionListing(listingType)) return null;
  return tinted("info", "Auction", "Sold by bidding — the price shown is where the bidding stands");
}

/**
 * An auction that **ended with a bid on it** and has not been resolved (#490).
 *
 * Nothing in the app transitions such a listing: it closed with somebody committed to buying, and
 * only the collector can say whether it sold — which starts the sale flow — or went unsold and has
 * to be relisted. Until they do, the copies in it are promised to a buyer the record does not have.
 *
 * `error`-tinted like *Needs action* and for the same reason: the stock is committed in a place the
 * app cannot see, and every day it sits there is a day it could also sell somewhere else.
 */
export function AuctionEndedChip() {
  return tinted(
    "error",
    "Ended, unresolved",
    "This auction closed with a bid on it — record the sale, or mark it unsold and relist"
  );
}

/** "In active bidding" (#215): an auction bid has been placed on this offer, committing the
 * collector before the sale is actually recorded. */
export function InActiveBiddingChip() {
  return tinted(
    "warning",
    "In bidding",
    "A bid has been placed — withdraw this copy from other platforms before the auction closes"
  );
}
