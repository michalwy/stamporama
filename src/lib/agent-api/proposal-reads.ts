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
//    notes — a private person's details, out of these projections' reach as a buyer's are (#1949);
//    `get_contact` is the one read that carries them (#2610).
//    The projections name their fields; **do not replace a mapper here with a spread**.
//  - **The buyer's picks are read, never written** (#2607). What the buyer ticked on the live page
//    (#2601) is theirs: `get_proposal` reads it, `list_proposals` narrows to it, and
//    `convert_proposal_to_sale` takes the word `picked` for *every lot the buyer picked that can
//    still be sold* — as *Convert to sale…* opens with them ticked. Nothing here ticks or unticks.
//  - **A proposal made from a Facebook post names its post** (#2608): its lots are the post's own,
//    numbered as the post numbers them (#2602), so `post` says which post and group they stay in.
//  - **Deleting is weighed as *Delete proposal…* weighs it** (#2642): `proposalDeletionRecord` is the
//    dialog's facts and its own sentences — `proposalDeleteRefusal`, `proposalDeletionText` — so the
//    agent is told exactly what the collector would be.

import { OPEN_OFFER_STATES } from "../offer-rules";
import {
  PROPOSAL_LOT_PACKINGS,
  PROPOSAL_STATUSES,
  proposalDeleteRefusal,
  proposalDeletionText,
  type ProposalDeletion,
} from "../proposal-rules";
import { invalidRequest } from "./errors";

/** The statuses, in lifecycle order — `list_proposals`' closed vocabulary. */
export const AGENT_PROPOSAL_STATUSES: readonly string[] = PROPOSAL_STATUSES;

/** How `make_proposal_lots` packs the copies: an offer each, or one offer of them all. */
export const AGENT_PROPOSAL_LOT_PACKINGS: readonly string[] = PROPOSAL_LOT_PACKINGS;

/** The word for *a new sale*, where the sale a proposal becomes is named. */
export const NEW_SALE = "new";

/** The word for *the lots the buyer picked*, where the lots a proposal sells are named (#2607). */
export const BUYER_PICKS = "picked";

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

/** A lot as the conversion resolves `picked` against it: its number and the buyer's pick, as
 *  `proposalLotPick` reads it — `picked` while it can still be sold, `unavailable` once it cannot. */
export interface ProposalPickFacts {
  readonly lotNo: number;
  readonly pick: string | null;
}

/**
 * The lots `convert_proposal_to_sale` sells, as it is sent them (#2607). Without the word `picked`
 * this is `parseProposalSaleLots`. With it, every lot the buyer picked that can still be sold is
 * added at its own price — *Convert to sale…* opens with exactly those ticked — and a lot also named
 * on its own keeps what it was named with, so `picked, 5=30.00` sells the picks with lot 5 at the
 * price agreed, and `picked, 3` adds lot 3 to them. A pick no longer available is passed over, as
 * the dialog passes it over. `picked` with no pick left to sell is refused rather than selling only
 * what else was named. The lots come back in lot order.
 */
export function proposalSaleLotsWithPicks(
  values: readonly string[],
  lots: readonly ProposalPickFacts[],
  parameter: string,
  proposalNo: number
): ProposalSaleLotSpec[] {
  const isPicks = (value: string) => value.trim().toLocaleLowerCase() === BUYER_PICKS;
  const named = values.filter((value) => !isPicks(value));
  const picksAsked = values.length - named.length;
  if (picksAsked > 1) {
    throw invalidRequest(`\`${BUYER_PICKS}\` is named twice in "${parameter}". Name it once. Nothing was sold.`);
  }
  const specs = parseProposalSaleLots(named, parameter);
  if (picksAsked === 0) return specs;
  const picked = lots.filter((lot) => lot.pick === "picked");
  if (picked.length === 0) {
    const unavailable = lots.filter((lot) => lot.pick !== null).map((lot) => lot.lotNo);
    throw invalidRequest(
      unavailable.length === 0
        ? `The buyer has picked no lot of proposal #${proposalNo}. Name the lots they took by number. Nothing was sold.`
        : `The lots the buyer picked on proposal #${proposalNo} — ${unavailable.join(", ")} — are no longer available. Name the lots they took by number. Nothing was sold.`
    );
  }
  const seen = new Set(specs.map((spec) => spec.lotNo));
  const all = [...specs, ...picked.filter((lot) => !seen.has(lot.lotNo)).map((lot) => ({ lotNo: lot.lotNo, price: null }))];
  return all.sort((a, b) => a.lotNo - b.lotNo);
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
  pickedLotCount: number;
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
  /** The lots the buyer ticked on the live page (#2601), the ones since sold or withdrawn included. */
  readonly pickedLots: number;
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
    pickedLots: item.pickedLotCount,
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
  /** The buyer's pick (#2601): `picked`, `unavailable` — picked, then sold or withdrawn — or null. */
  pick: string | null;
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
  /** The Facebook post it was made from (#2602), or null. */
  post: { postId: string; postNo: number; title: string | null; groupName: string } | null;
  sale: { saleId: string; saleNo: number; platformName: string } | null;
  lots: readonly ProposalLotFacts[];
  total: string;
  unpriced: number;
  currency: string;
  buyerPicks: { count: number; changedAt: string | null } | null;
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
  /** Whether the buyer ticked it on the live page (#2601): `picked`, `unavailable` once it was sold
   *  elsewhere or withdrawn after they did — as the proposal's screen marks it — or null. */
  readonly pick: string | null;
}

/** What the buyer ticked on the live page (#2601): the lots, by number — every one ticked, those no
 *  longer available included — and when the buyer last ticked or unticked one (ISO). */
export interface AgentProposalBuyerPicks {
  readonly lots: readonly number[];
  readonly changedAt: string | null;
}

/** The Facebook post a proposal was made from (#2602, #2608): its lots are the post's own, in the
 *  post's `group`, numbered as the post numbers them. */
export interface AgentProposalPost {
  readonly id: string;
  readonly postNo: number;
  readonly title: string | null;
  readonly group: string;
}

/** One proposal in full, as `get_proposal` and every proposal write answer. */
export interface AgentProposal {
  readonly id: string;
  readonly proposalNo: number;
  readonly status: string;
  readonly contact: { readonly id: string; readonly name: string };
  readonly platform: { readonly id: string; readonly name: string };
  /** The Facebook post it was made from (#2608), or null for a proposal of Direct offers. */
  readonly post: AgentProposalPost | null;
  readonly createdOn: string;
  readonly sentOn: string | null;
  readonly closedOn: string | null;
  readonly sale: { readonly id: string; readonly saleNo: number; readonly platform: string } | null;
  readonly lots: readonly AgentProposalLot[];
  /** What the buyer picked, null while no lot is ticked — as the screen's *Buyer picked 3 lots*. */
  readonly buyerPicks: AgentProposalBuyerPicks | null;
  readonly total: string;
  readonly unpriced: number;
  readonly currency: string;
  /** The message for the buyer from the Direct platform's template, or null with no template. */
  readonly message: string | null;
  /** The language `message` is in (#2609): the buyer's, else Direct's listing language, else the
   *  collection's — or the one asked for. */
  readonly language: string | null;
  /** The languages the message can be asked for in: the ones the collection uses (#2603). */
  readonly languages: readonly string[];
  readonly path: string;
}

/** The message as the handout reads it, typed structurally. */
export interface ProposalMessageFacts {
  readonly text: string | null;
  readonly language: string | null;
  readonly languages: readonly string[];
}

export function proposalRecord(
  screen: ProposalScreenFacts,
  copiesByOffer: ReadonlyMap<string, readonly string[]>,
  message: ProposalMessageFacts,
  path: string
): AgentProposal {
  return {
    id: screen.proposalId,
    proposalNo: screen.proposalNo,
    status: screen.status,
    contact: { id: screen.contact.id, name: screen.contact.name },
    platform: { id: screen.platform.id, name: screen.platform.name },
    post: screen.post && {
      id: screen.post.postId,
      postNo: screen.post.postNo,
      title: screen.post.title,
      group: screen.post.groupName,
    },
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
      pick: lot.pick,
    })),
    buyerPicks: screen.buyerPicks && {
      lots: screen.lots.filter((lot) => lot.pick !== null).map((lot) => lot.lotNo),
      changedAt: screen.buyerPicks.changedAt,
    },
    total: screen.total,
    unpriced: screen.unpriced,
    currency: screen.currency,
    message: message.text,
    language: message.language,
    languages: [...message.languages],
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
    picked: boolean;
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
  /** For a proposal made from a post (#2602): the post and its group — a new sale is made there, and
   *  the lots not taken stay in the post. Null for any other proposal. */
  post: { postNo: number; groupName: string } | null;
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
    /** Whether the buyer ticked it on the live page (#2601) — what `picked` sells. */
    readonly picked: boolean;
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
  /** The platform a new sale is on: Direct, or the post's for a proposal made from one. */
  readonly newSalePlatform: string;
  /** For a proposal made from a Facebook post (#2608): the post, whose lots not taken stay in it rather
   *  than being withdrawn, and its group. Null for any other proposal. */
  readonly post: { readonly postNo: number; readonly group: string } | null;
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
      picked: lot.picked,
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
    post: options.post && { postNo: options.post.postNo, group: options.post.groupName },
  };
}

// ── preview_proposal_delete / delete_proposal (#2642) ────────────────────────

/** What deleting a proposal would do, as *Delete proposal…* shows it before the collector confirms. */
export interface AgentProposalDeletion {
  readonly id: string;
  readonly proposalNo: number;
  readonly contactName: string;
  readonly status: string;
  /** Whether it can be deleted at all — any but a sold one. */
  readonly deletable: boolean;
  /** The app's sentence for why not, or null when it can be. */
  readonly refusal: string | null;
  /** The lots deleted with it, the copies staying in the inventory — none for a proposal made from a post. */
  readonly lotsDeleted: number;
  /** Lots with a sold set: they stay with their sale, no longer in a proposal. */
  readonly soldLotsKept: number;
  /** The post it was made from, whose lots stay in it as they are. Null for any other proposal. */
  readonly post: { readonly postNo: number; readonly lotsKept: number } | null;
  /** Whether the buyer's live link stops working — a sent proposal, or any with a link made. */
  readonly linkStopsWorking: boolean;
  /** The dialog's confirmation, a paragraph each; empty when the proposal cannot be deleted. */
  readonly confirmation: readonly string[];
}

export function proposalDeletionRecord(id: string, deletion: ProposalDeletion): AgentProposalDeletion {
  const refusal = proposalDeleteRefusal(deletion.status);
  return {
    id,
    proposalNo: deletion.proposalNo,
    contactName: deletion.contactName,
    status: deletion.status,
    deletable: refusal === null,
    refusal,
    lotsDeleted: deletion.lotCount,
    soldLotsKept: deletion.soldLotCount,
    post: deletion.post && { postNo: deletion.post.postNo, lotsKept: deletion.post.lotCount },
    // `proposalDeletionText`'s own condition for saying so.
    linkStopsWorking: deletion.status === "sent" || deletion.hasLink,
    confirmation: refusal === null ? proposalDeletionText(deletion) : [],
  };
}
