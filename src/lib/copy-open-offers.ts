// Whether a copy is already in an open offer (#2337), as its row says it on the Copies list and in
// every copy picker — so a copy listed elsewhere is not picked when another of the same stamp, listed
// nowhere, could go instead. Pure (no React / Prisma): the server reads the offers, the row draws the
// chip, and the rules between the two are unit-tested here.

import { OFFER_STATE_LABEL, OPEN_OFFER_STATES, type OfferState } from "./offer-rules";

/** One open offer a copy sits in — `ItemListItem.openOffers`. */
export interface ItemOpenOffer {
  offerId: string;
  offerNo: number;
  platformName: string;
  state: OfferState;
  /** The proposal the offer is a lot of (#2287), or null. */
  proposalId: string | null;
  /** The Facebook post the offer is a lot of, or null. */
  facebookPostId: string | null;
}

/** The offer or the lots of the screen a picker is opened from — never named by the chip, since the
 *  copy being in them is what the screen is editing. */
export interface OwnOffers {
  offerId?: string | null;
  proposalId?: string | null;
  facebookPostId?: string | null;
}

/** The open states, least advanced first — the chip takes the colour of the furthest along. Paused
 *  sits below the live pair, unlike in `OPEN_OFFER_STATES`: it was up, but it is not selling now, and
 *  a copy also on a live listing must read as live. */
export const OPEN_OFFER_ADVANCE: readonly OfferState[] = ["preparing", "ready", "paused", "pending", "active"];

export function isOwnOffer(offer: ItemOpenOffer, own: OwnOffers | null | undefined): boolean {
  if (!own) return false;
  return (
    (!!own.offerId && offer.offerId === own.offerId) ||
    (!!own.proposalId && offer.proposalId === own.proposalId) ||
    (!!own.facebookPostId && offer.facebookPostId === own.facebookPostId)
  );
}

/** How one offer is named: its platform and number — *Facebook #3012*. */
export function openOfferLabel(offer: Pick<ItemOpenOffer, "platformName" | "offerNo">): string {
  return `${offer.platformName} #${offer.offerNo}`;
}

export interface OpenOfferChip {
  /** *Facebook #3012* for one offer, *On 2 offers* for several. */
  label: string;
  /** The most advanced state among them — the chip's colour. */
  state: OfferState;
  /** The offers it stands for, most advanced first, then by number. */
  offers: ItemOpenOffer[];
}

/**
 * The chip a copy's row shows, or null when it is in no open offer outside the screen's own. A sold
 * or withdrawn offer never counts, whatever the caller hands in — open is the complement of those.
 */
export function openOfferChip(
  offers: readonly ItemOpenOffer[],
  own?: OwnOffers | null
): OpenOfferChip | null {
  const seen = new Set<string>();
  const counted = offers.filter((o) => {
    if (!(OPEN_OFFER_STATES as readonly string[]).includes(o.state)) return false;
    if (isOwnOffer(o, own) || seen.has(o.offerId)) return false;
    seen.add(o.offerId);
    return true;
  });
  if (counted.length === 0) return null;
  const rank = (s: OfferState) => OPEN_OFFER_ADVANCE.indexOf(s);
  const sorted = [...counted].sort((a, b) => rank(b.state) - rank(a.state) || a.offerNo - b.offerNo);
  return {
    label: sorted.length === 1 ? openOfferLabel(sorted[0]) : `On ${sorted.length} offers`,
    state: sorted[0].state,
    offers: sorted,
  };
}

/** The chip's hover hint: every offer it stands for, with its state, and what a click does. */
export function openOfferHint(chip: OpenOfferChip): string {
  const lines = chip.offers.map((o) => `${openOfferLabel(o)} · ${OFFER_STATE_LABEL[o.state]}`);
  return `In an open offer: ${lines.join(", ")}. Click to view its offers.`;
}
