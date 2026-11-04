// A proposal's rules (#2287; ADR-0075) — pure, no Prisma.
//
// A proposal is an offer prepared for one contact: lots chosen and priced for that person on the
// collection's Direct platform, sent to them, and then sold as whichever lots they take (#2289) or
// declined. The lots are ordinary offers; what is a proposal's own is its status, here.

import { CLOSED_OFFER_STATES, type OfferListingType, type OfferState } from "./offer-rules";
import { priceMargin, type PriceMargin } from "./offer-price-table";
import { parsePrice as parseSalePrice } from "./sale-rules";

/**
 * `preparing` while lots and prices change; `sent` once it has gone to the buyer, and fixed as it went
 * until it is reopened (#2307); `sold` once converted into a sale (#2289) and `declined` by hand —
 * both final.
 */
export type ProposalStatus = "preparing" | "sent" | "sold" | "declined";

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ["preparing", "sent", "sold", "declined"];

/** The statuses a proposal is still open in — its lots still hold their copies for the buyer. */
export const OPEN_PROPOSAL_STATUSES: readonly ProposalStatus[] = ["preparing", "sent"];

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

/** Whether a proposal is still open — not yet sold or declined, so it can still be sold or declined. */
export function isProposalOpen(status: ProposalStatus): boolean {
  return status === "preparing" || status === "sent";
}

/**
 * Whether a proposal takes lots and changes to them (#2307): only while it is being prepared. A sent
 * one stays as it went to the buyer — no lot added or taken out, no lot's title or price changed —
 * until it is reopened.
 */
export function proposalTakesLots(status: ProposalStatus): boolean {
  return status === "preparing";
}

/** The moves a collector makes by hand. *Sold* is not one: it is reached by selling the lots (#2289). */
export type ProposalMove = "send" | "reopen" | "decline";

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
    case "reopen":
      return status === "sent" ? null : "This proposal is already being prepared.";
    case "decline":
      return null;
  }
}

/** The status a move leads to. */
export function proposalStatusAfter(move: ProposalMove): ProposalStatus {
  switch (move) {
    case "send":
      return "sent";
    case "reopen":
      return "preparing";
    case "decline":
      return "declined";
  }
}

/** The sentence a sent proposal answers any change to its lots with (#2307). */
export const SENT_PROPOSAL_FIXED =
  "This proposal has been sent — it stays as the buyer saw it. Reopen it to change its lots or their prices.";

/** Why a proposal in `status` takes no lots or changes to them, or null while it does (#2307). */
export function proposalLotsRefusal(status: ProposalStatus): string | null {
  if (proposalTakesLots(status)) return null;
  if (status === "sent") return SENT_PROPOSAL_FIXED;
  return `This proposal is ${PROPOSAL_STATUS_LABEL[status].toLowerCase()} — its lots do not change any more.`;
}

/**
 * Why an offer that is a lot of a sent proposal cannot have its title, price, format or platform
 * changed (#2307) — asked wherever an offer is edited, so the lot cannot drift from what the buyer
 * was sent by way of the offer's own screen.
 */
export function sentProposalLotRefusal(facts: { offerNo: number; proposalNo: number; lotNo: number | null }): string {
  const lot = facts.lotNo === null ? "a lot" : `lot ${facts.lotNo}`;
  return `Offer #${facts.offerNo} is ${lot} of proposal #${facts.proposalNo}, which has been sent — reopen the proposal to change it.`;
}

/**
 * Whether taking a lot out renumbers the rest (#2288): only while the buyer holds no numbers yet. A
 * proposal reopened after it was sent (#2307) keeps them, since the buyer still has the earlier
 * version and its numbers.
 */
export function proposalRenumbersLots(status: ProposalStatus, everSent: boolean): boolean {
  return status === "preparing" && !everSent;
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

/** Why a lot cannot be ticked in *Convert to sale…* (#2336), said on its greyed row, or null when it
 *  can: sold already, withdrawn, or with every set's copies gone elsewhere. */
export function proposalSaleLotNote(state: OfferState, setsToSell: number): string | null {
  if (state === "sold") return "Already sold";
  if (state === "withdrawn") return "Withdrawn";
  if (setsToSell === 0) return "Nothing left to sell — its copies have gone elsewhere";
  return null;
}

/** A ticked lot as the convert window's footer sums it. */
export interface ProposalSaleTotalsLot {
  /** The price typed for it — each of its sets sells at it. */
  price: string;
  setsToSell: number;
  copiesToSell: number;
  /** What one of its sets cost (its price table's Cost), or null when that is not known. */
  costPrice: string | null;
}

export interface ProposalSaleTotals {
  lots: number;
  sets: number;
  copies: number;
  /** The typed prices, each times the lot's sets — null while one of them is not a price. */
  total: string | null;
  /** What the sets cost, over the lots whose cost is known; null when none's is. */
  cost: string | null;
  costLots: number;
  /** The prices against the cost, over the lots with both — null when none has, or while a typed
   *  price is not one. */
  profit: PriceMargin | null;
}

const toCents = (amount: number) => Math.round(amount * 100);

/** What the ticked lots come to (#2336): lots, sets and copies, the price total, and the profit or
 *  loss against their cost, as a proposal's summary weighs it (#2326). */
export function proposalSaleTotals(lots: readonly ProposalSaleTotalsLot[]): ProposalSaleTotals {
  let total: number | null = 0;
  let cost = 0;
  let costLots = 0;
  let bothPrice = 0;
  let bothCost = 0;
  let both = 0;
  for (const lot of lots) {
    const price = parseSalePrice(lot.price);
    const lotTotal = price.ok ? toCents(Number(price.value)) * lot.setsToSell : null;
    total = total === null || lotTotal === null ? null : total + lotTotal;
    const perSet = lot.costPrice === null ? NaN : Number(lot.costPrice);
    if (!Number.isFinite(perSet) || perSet < 0) continue;
    const lotCost = toCents(perSet) * lot.setsToSell;
    cost += lotCost;
    costLots++;
    if (lotTotal !== null) {
      bothPrice += lotTotal;
      bothCost += lotCost;
      both++;
    }
  }
  return {
    lots: lots.length,
    sets: lots.reduce((n, l) => n + l.setsToSell, 0),
    copies: lots.reduce((n, l) => n + l.copiesToSell, 0),
    total: total === null ? null : (total / 100).toFixed(2),
    cost: costLots > 0 ? (cost / 100).toFixed(2) : null,
    costLots,
    profit: total !== null && both > 0 ? priceMargin(bothPrice / 100, bothCost / 100) : null,
  };
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
