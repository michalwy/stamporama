// What the proposal operations answer with, the projections that build it, and the grammar of what
// they are sent (#2303).
//
// **Pure, and structurally typed on purpose**, the shape every `*-reads.ts` beside it has and for
// their reason (`agent-api.md`, *The module layout is the Prisma-free split*). No Prisma, no
// `server-only`, so `pnpm test:unit` holds every decision below.
//
// Three of them are worth a test:
//
//  - **A lot is named by its lot number** — the one the buyer's photos, document and message carry
//    (#2288), so *I'll take 2, 5 and 7* is sent as said. An offer that is not a lot yet is named by
//    its offer number or id, as everywhere else.
//  - **A lot sold at its own price is the lot number alone**, and at another price `2=35.00` — the
//    *Convert to sale…* dialog's own default, the lot's price, and its own correction, a figure typed
//    over it. An unpriced lot named alone is refused rather than sold at nought.
//  - **The contact is two fields.** The contact behind a proposal also carries an email, a phone and
//    an address — a private person's details, out of this surface's reach as a buyer's are (#1949).
//    The projections name their fields; **do not replace a mapper here with a spread**.

import { OPEN_OFFER_STATES } from "../offer-rules";
import { PROPOSAL_LOT_PACKINGS, PROPOSAL_STATUSES } from "../proposal-rules";
import { invalidRequest } from "./errors";

/** The statuses, in lifecycle order — `list_proposals`' closed vocabulary. */
export const AGENT_PROPOSAL_STATUSES: readonly string[] = PROPOSAL_STATUSES;

/** How `make_proposal_lots` packs the copies: an offer each, or one offer of them all. */
export const AGENT_PROPOSAL_LOT_PACKINGS: readonly string[] = PROPOSAL_LOT_PACKINGS;

/** The word for *a new sale*, where the sale a proposal becomes is named. */
export const NEW_SALE = "new";

// ── Naming ───────────────────────────────────────────────────────────────────

/** How a proposal was named: its short number, or its id. */
export type ProposalRef = { kind: "number"; proposalNo: number } | { kind: "id"; id: string };

/** A proposal as the agent names it — its number as the collector calls it (`4`, `p4`, `#4`), or its
 *  id from `list_proposals`. */
export function parseProposalRef(value: string): ProposalRef {
  const text = value.trim();
  const numbered = /^[p#]?(\d+)$/i.exec(text);
  if (numbered) return { kind: "number", proposalNo: Number(numbered[1]) };
  return { kind: "id", id: text };
}

/** How an offer was named: its short number, or its id. */
export type OfferRef = { kind: "number"; offerNo: number } | { kind: "id"; id: string };

/** An offer as the agent names it — its number (`2680`, `#2680`) or its id from `list_offers`. */
export function parseOfferRef(value: string): OfferRef {
  const text = value.trim();
  const numbered = /^#?(\d+)$/.exec(text);
  if (numbered) return { kind: "number", offerNo: Number(numbered[1]) };
  return { kind: "id", id: text };
}

/** A lot number as sent in a path (`2`, `#2`), or a refusal. */
export function parseLotNo(value: string, parameter: string): number {
  const text = value.trim();
  const numbered = /^#?(\d+)$/.exec(text);
  const lotNo = numbered ? Number(numbered[1]) : NaN;
  if (!Number.isSafeInteger(lotNo) || lotNo < 1) {
    throw invalidRequest(
      `"${text}" is not a lot number for "${parameter}". Send the lot's number in the proposal — \`get_proposal\` lists them as \`lotNo\`.`
    );
  }
  return lotNo;
}

/** An amount with at most two decimals and a period, normalised to two, or null when it is not one. */
function amountOf(text: string): string | null {
  return /^\d+(\.\d{1,2})?$/.test(text) ? Number(text).toFixed(2) : null;
}

/** A price as a lot is asked for, two decimals, or a refusal. */
export function parseLotPrice(value: string, parameter: string): string {
  const text = value.trim();
  const amount = amountOf(text);
  if (amount === null) {
    throw invalidRequest(
      `"${text}" is not a price for "${parameter}". Send an amount with at most two decimal places and a period as the separator — "15.00" — in the lot's own currency.`
    );
  }
  return amount;
}

/** One lot the buyer took: its number, and the price it sells at — null for its own. */
export interface ProposalSaleLotSpec {
  readonly lotNo: number;
  readonly price: string | null;
}

/**
 * The lots the buyer took, as `convert_proposal_to_sale` is sent them: `2` sells lot 2 at its own
 * price, `2=35.00` at 35.00. A lot named twice is refused rather than one of the two being kept.
 */
export function parseProposalSaleLots(values: readonly string[], parameter: string): ProposalSaleLotSpec[] {
  const specs: ProposalSaleLotSpec[] = [];
  const seen = new Set<number>();
  for (const raw of values) {
    const text = raw.trim();
    const match = /^#?(\d+)\s*(?:=\s*(\S+))?$/.exec(text);
    const lotNo = match ? Number(match[1]) : NaN;
    if (!match || !Number.isSafeInteger(lotNo) || lotNo < 1) {
      throw invalidRequest(
        `"${text}" is not a lot for "${parameter}". Send the lot's number — \`2\` to sell it at its own price — or its number and the price agreed, \`2=35.00\`. Nothing was sold.`
      );
    }
    const price = match[2] === undefined ? null : amountOf(match[2]);
    if (match[2] !== undefined && price === null) {
      throw invalidRequest(
        `"${match[2]}" is not a price for lot ${lotNo}. Send an amount with at most two decimal places and a period as the separator — \`${lotNo}=35.00\`. Nothing was sold.`
      );
    }
    if (seen.has(lotNo)) {
      throw invalidRequest(`Lot ${lotNo} is named twice in "${parameter}". Name each lot once. Nothing was sold.`);
    }
    seen.add(lotNo);
    specs.push({ lotNo, price });
  }
  return specs;
}

// ── list_proposals ───────────────────────────────────────────────────────────

/** A proposal as the list of proposals reads it, typed structurally. */
export interface ProposalListItemFacts {
  proposalId: string;
  proposalNo: number;
  contact: { id: string; name: string };
  status: string;
  lotCount: number;
  openLotCount: number;
  total: string;
  unpriced: number;
  currency: string;
  createdOn: string;
  sentOn: string | null;
}

/** One proposal as `list_proposals` states it. */
export interface AgentProposalRow {
  readonly id: string;
  readonly proposalNo: number;
  readonly contact: { readonly id: string; readonly name: string };
  readonly status: string;
  readonly lots: number;
  readonly openLots: number;
  readonly total: string;
  readonly unpriced: number;
  readonly currency: string;
  readonly createdOn: string;
  readonly sentOn: string | null;
  readonly path: string;
}

export function proposalRow(item: ProposalListItemFacts, path: string): AgentProposalRow {
  return {
    id: item.proposalId,
    proposalNo: item.proposalNo,
    contact: { id: item.contact.id, name: item.contact.name },
    status: item.status,
    lots: item.lotCount,
    openLots: item.openLotCount,
    total: item.total,
    unpriced: item.unpriced,
    currency: item.currency,
    createdOn: item.createdOn,
    sentOn: item.sentOn,
    path,
  };
}

// ── get_proposal ─────────────────────────────────────────────────────────────

/** One lot as the proposal's screen reads it, typed structurally. */
export interface ProposalLotFacts {
  offerId: string;
  offerNo: number;
  lotNo: number;
  title: string;
  state: string;
  listingType: string;
  price: string | null;
  currency: string;
  setCount: number;
}

/** The proposal as its screen reads it, typed structurally. */
export interface ProposalScreenFacts {
  proposalId: string;
  proposalNo: number;
  status: string;
  contact: { id: string; name: string };
  createdOn: string;
  sentOn: string | null;
  closedOn: string | null;
  platform: { id: string; name: string };
  sale: { saleId: string; saleNo: number; platformName: string } | null;
  lots: readonly ProposalLotFacts[];
  total: string;
  unpriced: number;
  currency: string;
}

/** One lot as `get_proposal` states it. */
export interface AgentProposalLot {
  readonly lotNo: number;
  readonly offerId: string;
  readonly offerNo: number;
  readonly title: string;
  readonly state: string;
  readonly listingType: string;
  readonly price: string | null;
  readonly currency: string;
  readonly sets: number;
  /** The copies on it, by their copy numbers (`#123`). */
  readonly copies: readonly string[];
}

/** One proposal in full, as `get_proposal` and every proposal write answer. */
export interface AgentProposal {
  readonly id: string;
  readonly proposalNo: number;
  readonly status: string;
  readonly contact: { readonly id: string; readonly name: string };
  readonly platform: { readonly id: string; readonly name: string };
  readonly createdOn: string;
  readonly sentOn: string | null;
  readonly closedOn: string | null;
  readonly sale: { readonly id: string; readonly saleNo: number; readonly platform: string } | null;
  readonly lots: readonly AgentProposalLot[];
  readonly total: string;
  readonly unpriced: number;
  readonly currency: string;
  /** The message for the buyer from the Direct platform's template, or null with no template. */
  readonly message: string | null;
  readonly path: string;
}

export function proposalRecord(
  screen: ProposalScreenFacts,
  copiesByOffer: ReadonlyMap<string, readonly string[]>,
  message: string | null,
  path: string
): AgentProposal {
  return {
    id: screen.proposalId,
    proposalNo: screen.proposalNo,
    status: screen.status,
    contact: { id: screen.contact.id, name: screen.contact.name },
    platform: { id: screen.platform.id, name: screen.platform.name },
    createdOn: screen.createdOn,
    sentOn: screen.sentOn,
    closedOn: screen.closedOn,
    sale: screen.sale && { id: screen.sale.saleId, saleNo: screen.sale.saleNo, platform: screen.sale.platformName },
    lots: screen.lots.map((lot) => ({
      lotNo: lot.lotNo,
      offerId: lot.offerId,
      offerNo: lot.offerNo,
      title: lot.title,
      state: lot.state,
      listingType: lot.listingType,
      price: lot.price,
      currency: lot.currency,
      sets: lot.setCount,
      copies: [...(copiesByOffer.get(lot.offerId) ?? [])],
    })),
    total: screen.total,
    unpriced: screen.unpriced,
    currency: screen.currency,
    message,
    path,
  };
}

// ── get_proposal_sale_options ────────────────────────────────────────────────

/** What *Convert to sale…* offers, typed structurally. */
export interface ProposalSaleOptionsFacts {
  lots: readonly {
    offerId: string;
    offerNo: number;
    lotNo: number;
    title: string;
    state: string;
    price: string | null;
    currency: string;
    setsToSell: number;
  }[];
  sales: readonly {
    saleId: string;
    saleNo: number;
    platformName: string;
    soldOn: string;
    status: string;
    currency: string;
    lineCount: number;
  }[];
  platformName: string;
}

const isOpenLot = (lot: { state: string }) => (OPEN_OFFER_STATES as readonly string[]).includes(lot.state);

/** What a proposal can be sold as: its open lots and the contact's sales still open. */
export interface AgentProposalSaleOptions {
  readonly lots: readonly {
    readonly lotNo: number;
    readonly offerNo: number;
    readonly title: string;
    readonly state: string;
    readonly price: string | null;
    readonly currency: string;
    readonly setsToSell: number;
  }[];
  readonly sales: readonly {
    readonly id: string;
    readonly saleNo: number;
    readonly platform: string;
    readonly soldOn: string;
    readonly status: string;
    readonly currency: string;
    readonly lines: number;
  }[];
  /** The platform a new sale is on. */
  readonly newSalePlatform: string;
}

export function proposalSaleOptions(options: ProposalSaleOptionsFacts): AgentProposalSaleOptions {
  return {
    // The open lots only: the convert window lists every lot, greying the ones it cannot sell (#2336).
    lots: options.lots.filter(isOpenLot).map((lot) => ({
      lotNo: lot.lotNo,
      offerNo: lot.offerNo,
      title: lot.title,
      state: lot.state,
      price: lot.price,
      currency: lot.currency,
      setsToSell: lot.setsToSell,
    })),
    sales: options.sales.map((sale) => ({
      id: sale.saleId,
      saleNo: sale.saleNo,
      platform: sale.platformName,
      soldOn: sale.soldOn,
      status: sale.status,
      currency: sale.currency,
      lines: sale.lineCount,
    })),
    newSalePlatform: options.platformName,
  };
}
