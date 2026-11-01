// A proposal's rules (#2287; ADR-0075) — pure, no Prisma.
//
// A proposal is an offer prepared for one contact: lots chosen and priced for that person on the
// collection's Direct platform, sent to them, and then sold as whichever lots they take (#2289) or
// declined. The lots are ordinary offers; what is a proposal's own is its status, here.

import { CLOSED_OFFER_STATES, type OfferListingType, type OfferState } from "./offer-rules";

/**
 * `preparing` while lots and prices change; `sent` once it has gone to the buyer, prices still
 * editable; `sold` once converted into a sale (#2289) and `declined` by hand — both final.
 */
export type ProposalStatus = "preparing" | "sent" | "sold" | "declined";

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ["preparing", "sent", "sold", "declined"];

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  preparing: "Preparing",
  sent: "Sent",
  sold: "Sold",
  declined: "Declined",
};

export function isProposalStatus(value: unknown): value is ProposalStatus {
  return typeof value === "string" && (PROPOSAL_STATUSES as readonly string[]).includes(value);
}

/** The status a row carries, read leniently: an unknown value is shown as Preparing rather than
 *  refused, the way a stored offer state is. */
export function proposalStatusOf(value: string): ProposalStatus {
  return isProposalStatus(value) ? value : "preparing";
}

/** Whether a proposal is still open — its lots can be added, removed and priced. */
export function isProposalOpen(status: ProposalStatus): boolean {
  return status === "preparing" || status === "sent";
}

/** The moves a collector makes by hand. *Sold* is not one: it is reached by selling the lots (#2289). */
export type ProposalMove = "send" | "decline";

/** Why `move` cannot be made on a proposal in `status` with `lotCount` lots, or null when it can. */
export function proposalMoveRefusal(status: ProposalStatus, move: ProposalMove, lotCount: number): string | null {
  if (!isProposalOpen(status)) {
    return `This proposal is ${PROPOSAL_STATUS_LABEL[status].toLowerCase()} — it does not change any more.`;
  }
  switch (move) {
    case "send":
      if (status === "sent") return "This proposal has already been sent.";
      if (lotCount === 0) return "Add at least one lot before marking the proposal sent.";
      return null;
    case "decline":
      return null;
  }
}

/** The status a move leads to. */
export function proposalStatusAfter(move: ProposalMove): ProposalStatus {
  switch (move) {
    case "send":
      return "sent";
    case "decline":
      return "declined";
  }
}

/** Why a proposal in `status` takes no lots or changes to them, or null while it does. */
export function proposalLotsRefusal(status: ProposalStatus): string | null {
  return isProposalOpen(status)
    ? null
    : `This proposal is ${PROPOSAL_STATUS_LABEL[status].toLowerCase()} — its lots do not change any more.`;
}

/** What an offer must be to become a lot of a proposal: on the Direct platform, still open, and in no
 *  other proposal. */
export interface ProposalLotCandidateFacts {
  offerNo: number;
  onDirect: boolean;
  state: OfferState;
  /** The proposal it is a lot of already, or null. */
  proposalId: string | null;
}

/** Why the offer cannot join `proposalId`, or null when it can. */
export function proposalLotRefusal(facts: ProposalLotCandidateFacts, proposalId: string): string | null {
  const ref = `Offer #${facts.offerNo}`;
  if (!facts.onDirect) return `${ref} is not on the Direct platform — a proposal's lots are sold directly.`;
  if ((CLOSED_OFFER_STATES as readonly OfferState[]).includes(facts.state)) {
    return `${ref} is ${facts.state} — only an open offer can be a lot.`;
  }
  if (facts.proposalId === proposalId) return `${ref} is already a lot of this proposal.`;
  if (facts.proposalId !== null) return `${ref} is a lot of another proposal.`;
  return null;
}

/** What the total reads of one lot. */
export interface ProposalTotalLot {
  state: OfferState;
  listingType: OfferListingType;
  /** The asking price, `0.00` while there is none. */
  price: string;
  startingPrice: string | null;
}

/** The figure a lot is offered at: its asking price, or what an auction opens at — null while it has
 *  none. */
export function proposalLotPrice(lot: ProposalTotalLot): string | null {
  const figure = lot.listingType === "auction" ? lot.startingPrice : lot.price;
  if (figure === null || Number(figure) <= 0) return null;
  return Number(figure).toFixed(2);
}

/**
 * The proposal's total: the lots still offered — neither withdrawn nor, once some have sold, the ones
 * taken out — summed at their prices, two decimals. `unpriced` counts the offered lots with no price
 * yet, which the total leaves out rather than guessing.
 */
export function proposalTotal(lots: readonly ProposalTotalLot[]): { total: string; unpriced: number } {
  let cents = 0;
  let unpriced = 0;
  for (const lot of lots) {
    if (lot.state === "withdrawn") continue;
    const price = proposalLotPrice(lot);
    if (price === null) unpriced += 1;
    else cents += Math.round(Number(price) * 100);
  }
  return { total: (cents / 100).toFixed(2), unpriced };
}

// ── Becoming a sale (#2289) ──────────────────────────────────────────────────────────────────────
//
// *Convert to sale…* sells the lots the buyer took — ticked, at the price in the dialog — into a new
// Direct sale or one of the contact's sales still open on **any** platform (ADR-0075 §6), withdraws
// the rest and closes the proposal as Sold.

/** Why *Convert to sale…* cannot be made on a proposal in `status` with `ticked` lots ticked, or null
 *  when it can. Ticking nothing is not a conversion: a buyer who takes nothing has declined. */
export function proposalConversionRefusal(status: ProposalStatus, ticked: number): string | null {
  if (!isProposalOpen(status)) {
    return `This proposal is ${PROPOSAL_STATUS_LABEL[status].toLowerCase()} — it does not change any more.`;
  }
  if (ticked === 0) return "Tick the lots the buyer took. If they took none, decline the proposal instead.";
  return null;
}

/** A ticked lot as the conversion sees it. */
export interface ProposalSaleLotFacts {
  offerNo: number;
  state: OfferState;
  /** Whether the offer is a lot of this proposal. */
  inProposal: boolean;
  /** Whether it still has a set whose copies have not left. */
  hasSetToSell: boolean;
}

/** Why a ticked lot cannot be sold, or null when it can: a lot of this proposal, still open, with a
 *  set left to sell. */
export function proposalSaleLotRefusal(facts: ProposalSaleLotFacts): string | null {
  const ref = `Offer #${facts.offerNo}`;
  if (!facts.inProposal) return `${ref} is not a lot of this proposal.`;
  if ((CLOSED_OFFER_STATES as readonly OfferState[]).includes(facts.state)) {
    return `${ref} is ${facts.state} — only an open lot can be sold.`;
  }
  if (!facts.hasSetToSell) return `${ref} has nothing left to sell — its copies have gone elsewhere.`;
  return null;
}

/** An open sale the lots could join, as the conversion checks it. */
export interface ProposalSaleTargetFacts {
  saleNo: number;
  buyerId: string | null;
  /** The parcel has gone — *Sent* or *Delivered*. */
  sent: boolean;
  currency: string;
}

/**
 * Why the lots, in `lotCurrency`, cannot join the sale for the proposal's contact, or null when they
 * can. The sale may be on any platform; it must be the contact's, not yet sent, and in the lots'
 * currency — a mismatch is refused rather than converted.
 */
export function proposalSaleTargetRefusal(
  sale: ProposalSaleTargetFacts,
  contactId: string,
  lotCurrency: string
): string | null {
  const ref = `Sale #${sale.saleNo}`;
  if (sale.buyerId !== contactId) return `${ref} is not this contact's.`;
  if (sale.sent) return `${ref} has already been sent — choose an open sale or a new one.`;
  if (sale.currency !== lotCurrency) {
    return `${ref} is in ${sale.currency}, but the lots are in ${lotCurrency} — a sale is in one currency.`;
  }
  return null;
}

/** The one currency the ticked lots are in, or a refusal when they are in more than one. */
export function proposalLotCurrency(currencies: readonly string[]): { ok: true; currency: string } | { ok: false; message: string } {
  const distinct = [...new Set(currencies)];
  if (distinct.length === 1) return { ok: true, currency: distinct[0]! };
  if (distinct.length === 0) return { ok: false, message: "Tick the lots the buyer took." };
  return { ok: false, message: `The ticked lots are in ${distinct.join(" and ")} — a sale is in one currency.` };
}

// ── New lots from copies (#2299) ─────────────────────────────────────────────────────────────────

/** How *New lots…* makes offers of the copies picked: an offer each, or one offer holding them all. */
export type ProposalLotPacking = "each" | "together";

export const PROPOSAL_LOT_PACKINGS: readonly ProposalLotPacking[] = ["each", "together"];

/** The choice when none has been made in this collection yet. */
export const DEFAULT_PROPOSAL_LOT_PACKING: ProposalLotPacking = "each";

/** A stored or sent packing, or null when it is not one — the caller falls back or refuses. */
export function parseProposalLotPacking(raw: unknown): ProposalLotPacking | null {
  return typeof raw === "string" && (PROPOSAL_LOT_PACKINGS as readonly string[]).includes(raw)
    ? (raw as ProposalLotPacking)
    : null;
}

/**
 * The new offers the copies picked make, each as its sets of copies: an offer of one copy each, or one
 * offer of **one set** holding them all. One set, not a set each: a lot with several sets is sold as
 * that many at its price (#2289), so copies of different stamps sold together are one set. A copy
 * picked twice counts once; nothing picked makes nothing.
 */
export function proposalNewLotSets(itemIds: readonly string[], packing: ProposalLotPacking): string[][][] {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return [];
  return packing === "each" ? ids.map((id) => [[id]]) : [[ids]];
}

/** Read a proposal's number off its address (`/offers/proposals/4`), or undefined. */
export function parseProposalNo(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
