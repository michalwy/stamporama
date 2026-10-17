// Selling an offer from the phone (#2009, ADR-0072 §5): a buyer and a price, recorded as the desk's
// *Sell* records them — a new sale on the offer's platform, the offer's set on it at the price given.
//
// Pure, so the unit suite holds it. **One set at a time** (decided with the collector on 2026-10-17):
// an offer at quantity 3 is three interchangeable sets, and a buyer at a fair or on a Facebook quick
// buy takes one of them. The phone takes the first one still left, and when others were left too it
// says so on the line — **picked, not chosen** (#697, `SaleLine.setChoicePending`) — so which copy
// goes is the collector's choice at the packing table, through the desk's set picker.

/** A set the offer still has to sell, as `listSellableOffers` serves it — in the offer's set order. */
export interface PhoneSellableSet {
  offerSetId: string;
  itemIds: string[];
}

/** The one sale line the phone records for the offer. */
export interface PhoneSaleLine {
  offerId: string;
  offerSetId: string;
  price: string;
  itemIds: string[];
  setChoicePending: boolean;
}

/** The line selling one set of the offer at `price`, or null when it has no set left to sell. */
export function phoneSaleLine(
  offerId: string,
  setsLeft: readonly PhoneSellableSet[],
  price: string
): PhoneSaleLine | null {
  const first = setsLeft[0];
  if (!first) return null;
  return {
    offerId,
    offerSetId: first.offerSetId,
    price,
    itemIds: [...first.itemIds],
    // A pick among interchangeable sets is not a choice; the only set left is.
    setChoicePending: setsLeft.length > 1,
  };
}

/**
 * The price the form starts at: the offer's own, which is what the desk's *Sell* puts on the line.
 * An offer with no price yet — an unbid auction, an unpriced listing (#449) — starts blank, so the
 * figure agreed is typed rather than a zero accepted.
 */
export function phoneSalePriceDefault(offerPrice: string): string {
  return Number(offerPrice) === 0 ? "" : offerPrice;
}

/** The form's line about the sets, when the offer has more than one left — null with one. */
export function phoneSaleSetsNote(setsLeft: number): string | null {
  if (setsLeft <= 1) return null;
  return `One of the ${setsLeft} sets left is sold. Which copy goes is chosen at the desk, when packing.`;
}
