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

/** Read a proposal's number off its address (`/offers/proposals/4`), or undefined. */
export function parseProposalNo(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
