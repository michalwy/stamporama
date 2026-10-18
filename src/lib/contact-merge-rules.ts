// What a contact is after another is merged into it (#2043) — pure, so the merge dialog previews
// exactly what `mergeContacts` writes.
//
// **The remaining contact keeps its own name and details**; a detail it lacks is taken from the
// other. Roles are the union of both, the other's notes go under its own, and every Facebook profile
// of either stays on it, so a later sale to either account finds it (#2042). The other's name is not
// kept: a buyer is recognised by profile, not by name.

/** The fields of a contact a merge reads. */
export interface ContactMergeDetails {
  name: string;
  notes: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  market: string | null;
  facebookProfileUrls: string[];
  buyer: boolean;
  seller: boolean;
  exchangePartner: boolean;
  auctionHouse: boolean;
  other: boolean;
  defaultCurrency: string | null;
  defaultShippingCost: string | null;
  buyerPremiumPercent: string | null;
  buyerPremiumFixed: string | null;
}

/** The seller defaults for auction sales (#350): one set of terms, so they are taken together. */
const SELLER_DEFAULT_FIELDS = [
  "defaultCurrency",
  "defaultShippingCost",
  "buyerPremiumPercent",
  "buyerPremiumFixed",
] as const;

/** The remaining contact as it is once `other` is merged into it. */
export function mergedContactDetails(
  remaining: ContactMergeDetails,
  other: ContactMergeDetails
): ContactMergeDetails {
  // The auction defaults are one seller's terms — a currency with its fees — so a contact that has
  // any of its own keeps them all, rather than pairing its currency with the other's premium.
  const sellerDefaultsFrom = SELLER_DEFAULT_FIELDS.some((field) => remaining[field] != null)
    ? remaining
    : other;
  return {
    name: remaining.name,
    notes: mergedNotes(remaining.notes, other.notes),
    fullName: remaining.fullName ?? other.fullName,
    email: remaining.email ?? other.email,
    phone: remaining.phone ?? other.phone,
    market: remaining.market ?? other.market,
    facebookProfileUrls: [
      ...remaining.facebookProfileUrls,
      ...other.facebookProfileUrls.filter((url) => !remaining.facebookProfileUrls.includes(url)),
    ],
    buyer: remaining.buyer || other.buyer,
    seller: remaining.seller || other.seller,
    exchangePartner: remaining.exchangePartner || other.exchangePartner,
    auctionHouse: remaining.auctionHouse || other.auctionHouse,
    other: remaining.other || other.other,
    defaultCurrency: sellerDefaultsFrom.defaultCurrency,
    defaultShippingCost: sellerDefaultsFrom.defaultShippingCost,
    buyerPremiumPercent: sellerDefaultsFrom.buyerPremiumPercent,
    buyerPremiumFixed: sellerDefaultsFrom.buyerPremiumFixed,
  };
}

/** The remaining contact's notes with the other's under them, a blank line between. */
export function mergedNotes(remaining: string | null, other: string | null): string | null {
  const own = remaining?.trim() || null;
  const theirs = other?.trim() || null;
  if (own && theirs) return `${own}\n\n${theirs}`;
  return own ?? theirs;
}
