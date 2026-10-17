import { isAuctionListing, type OfferListingType } from "@/lib/offer-rules";

/**
 * An offer's price on the phone (#2008), read as the desk's offer row reads it: the figure in the
 * offer's currency with its base-currency conversion beside it, and an unbid auction or an unpriced
 * offer named rather than shown as a zero (#449).
 *
 * Without `"use client"`, so the list (a client screen) and the offer screen (a server page) share it.
 */
export function PhoneOfferPrice({
  offer,
}: {
  offer: {
    price: string;
    currency: string;
    priceBase: string | null;
    baseCurrency: string;
    listingType: OfferListingType;
  };
}) {
  if (offer.price === "0.00") {
    return (
      <span style={{ color: "var(--color-text-muted)" }}>
        {isAuctionListing(offer.listingType) ? "No bids yet" : "No price yet"}
      </span>
    );
  }
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
        {offer.price} {offer.currency}
      </span>
      {offer.priceBase && (
        <span style={{ marginLeft: "0.375rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          ≈ {offer.priceBase} {offer.baseCurrency}
        </span>
      )}
    </span>
  );
}
