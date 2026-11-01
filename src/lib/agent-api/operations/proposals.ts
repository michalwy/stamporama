import "server-only";
import { prisma } from "../../db";
import { OfferActionBlockedError, patchOffer } from "../../offers";
import { OPEN_OFFER_STATES, isAuctionListing, normalizeListingType } from "../../offer-rules";
import { formatItemNo } from "../../item-number";
import {
  addProposalLots,
  convertProposalToSaleThroughApi,
  countProposals,
  createProposal,
  getProposalSaleOptions,
  getProposalScreen,
  listProposalsPaginated,
  makeProposalLots,
  removeProposalLot,
} from "../../proposals";
import { readProposalMessage } from "../../proposal-handout";
import { proposalLotsRefusal, type ProposalLotPacking, type ProposalStatus } from "../../proposal-rules";
import { invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow } from "../list";
import { optionalString, requiredString, stringList } from "../params";
import { resolveSeller } from "../purchase-reads";
import { parseSaleRef } from "../conversation-log-reads";
import {
  AGENT_PROPOSAL_LOT_PACKINGS,
  AGENT_PROPOSAL_STATUSES,
  NEW_SALE,
  parseLotNo,
  parseLotPrice,
  parseOfferRef,
  parseProposalRef,
  parseProposalSaleLots,
  proposalRecord,
  proposalRow,
  proposalSaleOptions,
} from "../proposal-reads";
import { readSaleById } from "./sales";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import type { AgentProposal, AgentProposalRow, AgentProposalSaleOptions, ProposalLotFacts } from "../proposal-reads";
import type { AgentSale } from "../sale-reads";
import type { ListResponse } from "../list";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// Proposals (#2303; ADR-0075) — an offer prepared for one contact, its lots priced on the Direct
// platform, sent to them and sold as whichever lots they take. The app's proposals (#2287–#2289,
// #2299) reached by an agent: a buyer who wrote asking for more is answered by putting lots together,
// and their *I'll take 2 and 5* is recorded as a sale.
//
// ## What it writes, and the boundary
//
// **Every write is the screen's own.** `create_proposal` is *New proposal*, `add_proposal_lots` is
// *Add offers…*, `make_proposal_lots` is *New lots…* (#2299), `remove_proposal_lot` is the lot's
// *Take out*, `set_proposal_lot_price` is the lot's price field — `patchOffer`, the figure the seller
// states, as `set_offer_price` writes it — and `convert_proposal_to_sale` is *Convert to sale…*
// (#2289) through `convertProposalToSaleThroughApi`, which runs the dialog's conversion and marks the
// sale *to review* (#1948) in its transaction, as `sell_offer` does. The proposal's rules are the
// domain's and are not restated: a lot is an open Direct offer in no other proposal, lots and their
// prices change only while a proposal is being prepared — a sent one is fixed until the collector
// reopens it in the app (#2307) — and each refusal is the app's own sentence.
//
// **No send, no decline, no link.** Marking a proposal sent, declining it, and the buyer's link and
// document stay in the app — the collector decided on 2026-11-01 that what reaches the buyer is
// theirs. Reading the message here does **not** mark the proposal sent — nor does copying it in the
// app (#2329): handing it over and marking it sent are the collector's acts.
// `tests/unit/agent-api-operation-boundary.test.ts` holds all of it as a fact about imports.
//
// ## Naming
//
// **A proposal by number or id, a lot by its lot number** — the one the buyer answers with (#2288) —
// and an offer that is not a lot yet by its offer number or id. A contact is named exactly or not at
// all, over every contact rather than the buyers only: a proposal is often a buyer's first purchase.

// ── Loading what a call is about ─────────────────────────────────────────────

const PROPOSAL_PARAMETER: ParameterSpec = {
  name: "proposal",
  in: "path",
  type: "string",
  required: true,
  description: "The proposal: its number as the collector calls it (`4` or `p4`), or its id from `list_proposals`.",
};

/** The proposal named, proved to be in the token's collection. */
async function resolveProposal(
  context: OperationContext,
  value: string
): Promise<{ id: string; proposalNo: number; status: ProposalStatus }> {
  const ref = parseProposalRef(value);
  const row = await prisma.proposal.findFirst({
    where: {
      collectionId: context.collectionId,
      collection: { ownerId: context.ownerId },
      ...(ref.kind === "number" ? { proposalNo: ref.proposalNo } : { id: ref.id }),
    },
    select: { id: true, proposalNo: true, status: true },
  });
  if (!row) {
    throw notFound(
      `No proposal ${ref.kind === "number" ? `numbered ${ref.proposalNo}` : `with id "${ref.id}"`} is in this token's collection. Use \`list_proposals\` to find it.`
    );
  }
  return { id: row.id, proposalNo: row.proposalNo, status: row.status as ProposalStatus };
}

/** Every contact, reduced to what a contact is matched against. */
async function resolveContactParam(context: OperationContext, value: string, parameter: string): Promise<string> {
  const candidates = await prisma.contact.findMany({
    where: { collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { id: true, name: true, fullName: true },
    orderBy: { name: "asc" },
  });
  return resolveSeller(value, candidates, parameter, { who: "contact", operation: "find_or_create_buyer" });
}

/** A domain refusal as one the agent can act on: the proposal's own sentence, as `invalid_request`. */
async function refusingDomainGuards<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OfferActionBlockedError) throw invalidRequest(error.message);
    throw error;
  }
}

/** The proposal in `get_proposal`'s shape, read fresh — every write answers with what it left. */
async function loadProposal(context: OperationContext, proposalId: string): Promise<AgentProposal> {
  const [screen, header, message] = await Promise.all([
    getProposalScreen(context.ownerId, proposalId),
    loadCollectionHeader(context),
    readProposalMessage(context.ownerId, proposalId, context.collectionId),
  ]);
  if (!screen || screen.collectionId !== context.collectionId) {
    throw notFound("That proposal is not in this token's collection any more. Use `list_proposals` to find it.");
  }
  const sets = await prisma.offerSet.findMany({
    where: { offerId: { in: screen.lots.map((lot) => lot.offerId) } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { offerId: true, items: { select: { item: { select: { itemNo: true } } } } },
  });
  const copies = new Map<string, string[]>();
  for (const set of sets) {
    const list = copies.get(set.offerId) ?? [];
    list.push(...set.items.map((entry) => formatItemNo(entry.item.itemNo)));
    copies.set(set.offerId, list);
  }
  return proposalRecord(
    screen,
    copies,
    message.text,
    collectionPath(header, `/offers/proposals/${screen.proposalNo}`)
  );
}

/** The lot numbered `lotNo` on the proposal, or a refusal naming the lots it has. */
function lotNumbered(lots: readonly ProposalLotFacts[], lotNo: number, proposalNo: number): ProposalLotFacts {
  const lot = lots.find((candidate) => candidate.lotNo === lotNo);
  if (!lot) {
    throw notFound(
      lots.length === 0
        ? `Proposal #${proposalNo} has no lots yet.`
        : `Proposal #${proposalNo} has no lot ${lotNo}. Its lots are ${lots.map((l) => l.lotNo).join(", ")} — \`get_proposal\` lists them.`
    );
  }
  return lot;
}

async function proposalLots(context: OperationContext, proposalId: string): Promise<readonly ProposalLotFacts[]> {
  const screen = await getProposalScreen(context.ownerId, proposalId);
  return screen?.lots ?? [];
}

// ── list_proposals ───────────────────────────────────────────────────────────

export async function readProposals(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentProposalRow>> {
  const contactValue = optionalString(params, "contact");
  const statuses = stringList(params, "status");
  const filters = {
    ...(contactValue !== null ? { contactId: await resolveContactParam(context, contactValue, "contact") } : {}),
    ...(statuses.length > 0 ? { statuses: [...statuses] as ProposalStatus[] } : {}),
  };
  const window = parseListWindow(params);
  const [page, total, header] = await Promise.all([
    listProposalsPaginated(context.ownerId, context.collectionId, {
      ...filters,
      offset: window.offset,
      pageSize: window.limit,
    }),
    // The match count and never `items.length` (#706).
    countProposals(context.ownerId, context.collectionId, filters),
    loadCollectionHeader(context),
  ]);
  return listResponse(
    page.items.map((item) => proposalRow(item, collectionPath(header, `/offers/proposals/${item.proposalNo}`))),
    total,
    window
  );
}

export const listProposalsOperation: Operation = {
  name: "list_proposals",
  method: "GET",
  path: "/proposals",
  description:
    "The proposals in this collection, newest first — offers prepared for one contact, their lots priced on the Direct platform — narrowed to a contact or to statuses. This is how a proposal is found, and how to see whether a buyer asking for more already has one open.",
  writes: false,
  parameters: [
    {
      name: "contact",
      in: "query",
      type: "string",
      required: false,
      description:
        "Restrict to one contact's proposals. Takes the contact's name or id; a name that matches nobody is refused with the contacts close to it.",
    },
    {
      name: "status",
      in: "query",
      type: "string[]",
      required: false,
      description:
        "Restrict to these statuses: `preparing` (being put together — the only one whose lots change), `sent` (gone to the buyer, fixed as it went), `sold` (turned into a sale) and `declined`. Left out, every status.",
      values: AGENT_PROPOSAL_STATUSES,
    },
  ],
  result: {
    kind: "list",
    description:
      "The proposals. `lots` counts every lot and `openLots` those still offered; `total` is the lots not withdrawn at their prices, in `currency`, and `unpriced` counts the lots it leaves out for having no price yet.",
  },
  handler: async (context, params) => readProposals(context, params),
};

// ── get_proposal ─────────────────────────────────────────────────────────────

const PROPOSAL_RESULT_DESCRIPTION =
  "The proposal: its status, its contact, the Direct platform its lots are on, and the sale it became once `sold`. Each lot carries its `lotNo` — the number the buyer is sent and answers with — its offer's number and id, title, state, listing type, price (null while it has none), sets and the copies on it by copy number. `total` is the lots not withdrawn at their prices and `unpriced` counts those with no price. `message` is the text for the buyer from the Direct platform's template — null when the platform has none, since nothing is generated without one; reading it here does not mark the proposal sent.";

export const getProposalOperation: Operation = {
  name: "get_proposal",
  method: "GET",
  path: "/proposals/{proposal}",
  description:
    "One proposal in full: its contact, status, every lot with its number, offer, copies and price, the total, the message text for the buyer, and the sale it became.",
  writes: false,
  parameters: [PROPOSAL_PARAMETER],
  result: { kind: "object", description: PROPOSAL_RESULT_DESCRIPTION },
  handler: async (context, params) =>
    loadProposal(context, (await resolveProposal(context, requiredString(params, "proposal"))).id),
};

// ── get_proposal_sale_options ────────────────────────────────────────────────

export async function readProposalSaleOptions(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentProposalSaleOptions> {
  const proposal = await resolveProposal(context, requiredString(params, "proposal"));
  return proposalSaleOptions(await getProposalSaleOptions(context.ownerId, proposal.id));
}

export const getProposalSaleOptionsOperation: Operation = {
  name: "get_proposal_sale_options",
  method: "GET",
  path: "/proposals/{proposal}/sale-options",
  description:
    "What a proposal can be turned into a sale with, as the app's Convert to sale… lists it: the lots still open, with what each would sell, and the contact's sales not yet sent — on any marketplace — that the lots could join instead of a new sale. Read it before `convert_proposal_to_sale`.",
  writes: false,
  parameters: [PROPOSAL_PARAMETER],
  result: {
    kind: "object",
    description:
      "`lots` are the open lots, by `lotNo`, each with its price (null while it has none) and `setsToSell` — the sets whose copies have not left, each selling at the lot's price. `sales` are the contact's sales still open, newest first, each with its marketplace, day, status, currency and line count; a sale in another currency than the lots is refused. `newSalePlatform` is where a new sale is recorded.",
  },
  handler: async (context, params) => readProposalSaleOptions(context, params),
};

// ── create_proposal ──────────────────────────────────────────────────────────

export async function startProposal(context: OperationContext, params: ParsedParams): Promise<AgentProposal> {
  const contactId = await resolveContactParam(context, requiredString(params, "contact"), "contact");
  const { proposalId } = await createProposal(context.ownerId, context.collectionId, contactId);
  return loadProposal(context, proposalId);
}

export const createProposalOperation: Operation = {
  name: "create_proposal",
  method: "POST",
  path: "/proposals",
  description:
    "Start a proposal for one contact — an offer prepared for that person, empty and `preparing`. Give it lots with `add_proposal_lots` or `make_proposal_lots`. Check `list_proposals` first: a buyer may already have one open.",
  writes: true,
  parameters: [
    {
      name: "contact",
      in: "body",
      type: "string",
      required: true,
      description:
        "Who it is for: a contact's name or id. A name that matches nobody is refused with the close ones — nothing is created from here; a new buyer is added with `find_or_create_buyer`.",
    },
  ],
  result: { kind: "object", description: `The new proposal, in \`get_proposal\`'s shape. ${PROPOSAL_RESULT_DESCRIPTION}` },
  handler: async (context, params) => startProposal(context, params),
};

// ── add_proposal_lots ────────────────────────────────────────────────────────

export async function addLots(context: OperationContext, params: ParsedParams): Promise<AgentProposal> {
  const proposal = await resolveProposal(context, requiredString(params, "proposal"));
  const values = stringList(params, "offers");
  if (values.length === 0) {
    throw invalidRequest('Send the offers to add as "offers" — their numbers or ids. Nothing was added.');
  }
  const offerIds: string[] = [];
  for (const value of values) {
    const ref = parseOfferRef(value);
    const offer = await prisma.offer.findFirst({
      where: {
        collectionId: context.collectionId,
        collection: { ownerId: context.ownerId },
        ...(ref.kind === "number" ? { offerNo: ref.offerNo } : { id: ref.id }),
      },
      select: { id: true },
    });
    if (!offer) {
      throw notFound(
        `No offer ${ref.kind === "number" ? `#${ref.offerNo}` : `with id "${ref.id}"`} is in this token's collection. Nothing was added.`
      );
    }
    offerIds.push(offer.id);
  }
  await refusingDomainGuards(() => addProposalLots(context.ownerId, proposal.id, offerIds));
  return loadProposal(context, proposal.id);
}

export const addProposalLotsOperation: Operation = {
  name: "add_proposal_lots",
  method: "POST",
  path: "/proposals/{proposal}/lots",
  description:
    "Make offers already listed on the Direct platform lots of a proposal, as the app's Add offers… does. Each must be an open Direct offer in no other proposal; one that is not refuses the call by name and nothing is added. Only a proposal being prepared takes lots: a sent one stays as the buyer saw it until the collector reopens it. The new lots take the next lot numbers. For copies with no offer yet, use `make_proposal_lots`.",
  writes: true,
  parameters: [
    PROPOSAL_PARAMETER,
    {
      name: "offers",
      in: "body",
      type: "string[]",
      required: true,
      description: "The offers to add, each by its number (`2680` or `#2680`) or its id from `list_offers`.",
    },
  ],
  result: { kind: "object", description: "The proposal as it now stands, in `get_proposal`'s shape." },
  handler: async (context, params) => addLots(context, params),
};

// ── make_proposal_lots ───────────────────────────────────────────────────────

/** What `make_proposal_lots` made, and the proposal it left. */
export interface AgentProposalNewLots {
  readonly made: number;
  /** The new lots with no estimate to be priced at — price them with `set_proposal_lot_price`. */
  readonly unpriced: number;
  readonly proposal: AgentProposal;
}

export async function makeLots(context: OperationContext, params: ParsedParams): Promise<AgentProposalNewLots> {
  const proposal = await resolveProposal(context, requiredString(params, "proposal"));
  const copyIds = [...new Set(stringList(params, "copy_ids"))];
  if (copyIds.length === 0) {
    throw invalidRequest('Send the copies as "copy_ids" — from `find_unlisted_copies` or `search_collection`. No lot was made.');
  }
  const held = await prisma.item.findMany({
    where: { id: { in: copyIds }, collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { id: true },
  });
  const missing = copyIds.filter((id) => !held.some((item) => item.id === id));
  if (missing.length > 0) {
    throw notFound(
      `No copy with id ${missing.map((id) => `"${id}"`).join(", ")} is in this token's collection. No lot was made.`
    );
  }
  const packing = requiredString(params, "packing") as ProposalLotPacking;
  const result = await refusingDomainGuards(() => makeProposalLots(context.ownerId, proposal.id, copyIds, packing));
  return { made: result.lots, unpriced: result.unpriced, proposal: await loadProposal(context, proposal.id) };
}

export const makeProposalLotsOperation: Operation = {
  name: "make_proposal_lots",
  method: "POST",
  path: "/proposals/{proposal}/lots/new",
  description:
    "Make new lots of a proposal from copies, as the app's New lots… does: new offers on the Direct platform, titled from its templates and priced at their estimate where the copies have one, become the proposal's next lots. A copy sold or already on an open Direct offer refuses the call and nothing is made, as does a proposal that is not being prepared.",
  writes: true,
  parameters: [
    PROPOSAL_PARAMETER,
    {
      name: "copy_ids",
      in: "body",
      type: "string[]",
      required: true,
      description: "The copies, by id — from `find_unlisted_copies` or `search_collection`.",
    },
    {
      name: "packing",
      in: "body",
      type: "string",
      required: true,
      description:
        "`each` makes an offer of each copy, one lot per copy; `together` makes one offer holding every copy as one set — one lot, sold as a whole.",
      values: AGENT_PROPOSAL_LOT_PACKINGS,
    },
  ],
  result: {
    kind: "object",
    description:
      "`made` counts the new lots, `unpriced` those with no estimate to be priced at — price them with `set_proposal_lot_price` — and `proposal` is the proposal as it now stands, in `get_proposal`'s shape.",
  },
  handler: async (context, params) => makeLots(context, params),
};

// ── remove_proposal_lot ──────────────────────────────────────────────────────

const LOT_PARAMETER: ParameterSpec = {
  name: "lot",
  in: "path",
  type: "string",
  required: true,
  description: "The lot's number in the proposal, `lotNo` in `get_proposal`.",
};

export async function removeLot(context: OperationContext, params: ParsedParams): Promise<AgentProposal> {
  const proposal = await resolveProposal(context, requiredString(params, "proposal"));
  const lot = lotNumbered(await proposalLots(context, proposal.id), parseLotNo(requiredString(params, "lot"), "lot"), proposal.proposalNo);
  await refusingDomainGuards(() => removeProposalLot(context.ownerId, proposal.id, lot.offerId));
  return loadProposal(context, proposal.id);
}

export const removeProposalLotOperation: Operation = {
  name: "remove_proposal_lot",
  method: "DELETE",
  path: "/proposals/{proposal}/lots/{lot}",
  description:
    "Take a lot out of a proposal being prepared. The offer stays, an ordinary Direct offer. The lots after it move up a number — unless the proposal was sent before and reopened, when they keep theirs, since the buyer holds them. A sent proposal is refused: it stays as the buyer saw it until the collector reopens it.",
  writes: true,
  parameters: [PROPOSAL_PARAMETER, LOT_PARAMETER],
  result: { kind: "object", description: "The proposal as it now stands, in `get_proposal`'s shape — renumbered if it was." },
  handler: async (context, params) => removeLot(context, params),
};

// ── set_proposal_lot_price ───────────────────────────────────────────────────

export async function setLotPrice(context: OperationContext, params: ParsedParams): Promise<AgentProposal> {
  const proposal = await resolveProposal(context, requiredString(params, "proposal"));
  const closed = proposalLotsRefusal(proposal.status);
  if (closed) throw invalidRequest(closed);
  const lot = lotNumbered(await proposalLots(context, proposal.id), parseLotNo(requiredString(params, "lot"), "lot"), proposal.proposalNo);
  if (!(OPEN_OFFER_STATES as readonly string[]).includes(lot.state)) {
    throw invalidRequest(`Lot ${lot.lotNo} (offer #${lot.offerNo}) is ${lot.state} — only an open lot is priced.`);
  }
  const price = parseLotPrice(requiredString(params, "price"), "price");
  // The figure the seller states, as `set_offer_price` writes it: an auction's opening price.
  await refusingDomainGuards(() =>
    patchOffer(context.ownerId, lot.offerId, isAuctionListing(normalizeListingType(lot.listingType)) ? { startingPrice: price } : { price })
  );
  return loadProposal(context, proposal.id);
}

export const setProposalLotPriceOperation: Operation = {
  name: "set_proposal_lot_price",
  method: "PATCH",
  path: "/proposals/{proposal}/lots/{lot}/price",
  description:
    "Price one lot of a proposal, as its price field on the proposal's screen does, in the lot's own currency. Only an open lot is priced, and only on a proposal being prepared; a sent one, fixed as the buyer saw it until the collector reopens it, and a closed one are refused with the reason. The figure is the offer's own, so the lot's offer shows it everywhere.",
  writes: true,
  parameters: [
    PROPOSAL_PARAMETER,
    LOT_PARAMETER,
    {
      name: "price",
      in: "body",
      type: "string",
      required: true,
      description: "The amount, with at most two decimal places, in the lot's currency. Send it as text so nothing is lost rounding it.",
    },
  ],
  result: { kind: "object", description: "The proposal as it now stands, in `get_proposal`'s shape." },
  handler: async (context, params) => setLotPrice(context, params),
};

// ── convert_proposal_to_sale ─────────────────────────────────────────────────

/** Both after a conversion: the proposal, now sold, and the sale its lots went into. */
export interface AgentProposalConversion {
  readonly proposal: AgentProposal;
  readonly sale: AgentSale;
}

export async function convertToSale(context: OperationContext, params: ParsedParams): Promise<AgentProposalConversion> {
  const proposal = await resolveProposal(context, requiredString(params, "proposal"));
  const specs = parseProposalSaleLots(stringList(params, "lots"), "lots");
  if (specs.length === 0) {
    throw invalidRequest(
      'Send the lots the buyer took as "lots". If they took none, the proposal is declined — which stays with the collector. Nothing was sold.'
    );
  }
  const lots = await proposalLots(context, proposal.id);
  const sold = specs.map((spec) => {
    const lot = lotNumbered(lots, spec.lotNo, proposal.proposalNo);
    const price = spec.price ?? lot.price;
    if (price === null) {
      throw invalidRequest(
        `Lot ${lot.lotNo} has no price. Send the price agreed with it — \`${lot.lotNo}=35.00\` — or price it first with \`set_proposal_lot_price\`. Nothing was sold.`
      );
    }
    return { offerId: lot.offerId, price };
  });

  const saleValue = requiredString(params, "sale").trim();
  let target: { saleId: string } | { newSale: true } = { newSale: true };
  if (saleValue.toLocaleLowerCase() !== NEW_SALE) {
    const ref = parseSaleRef(saleValue);
    if (ref.kind === "none") {
      throw invalidRequest(`"sale" takes \`${NEW_SALE}\` or a sale's number or id. Nothing was sold.`);
    }
    const sale = await prisma.sale.findFirst({
      where: {
        collectionId: context.collectionId,
        collection: { ownerId: context.ownerId },
        ...(ref.kind === "number" ? { saleNo: ref.saleNo } : { id: ref.id }),
      },
      select: { id: true },
    });
    if (!sale) {
      throw notFound(
        `No sale ${ref.kind === "number" ? `numbered ${ref.saleNo}` : `with id "${ref.id}"`} is in this token's collection. \`get_proposal_sale_options\` lists the contact's open sales. Nothing was sold.`
      );
    }
    target = { saleId: sale.id };
  }

  const result = await refusingDomainGuards(() =>
    convertProposalToSaleThroughApi(context.ownerId, proposal.id, { lots: sold, target })
  );
  const [proposalAfter, sale] = await Promise.all([
    loadProposal(context, proposal.id),
    readSaleById(context, result.saleId),
  ]);
  return { proposal: proposalAfter, sale };
}

export const convertProposalToSaleOperation: Operation = {
  name: "convert_proposal_to_sale",
  method: "POST",
  path: "/proposals/{proposal}/sale",
  description:
    "Record which lots of a proposal the buyer took, as the app's Convert to sale… does: every set each still has is sold at the lot's price — or the price agreed — into a new Direct sale for the proposal's contact, dated today, or into one of their sales not yet sent on any marketplace, in the lots' currency. The lots not named are withdrawn and the proposal becomes `sold`; none of it can be undone from here. The sale waits for the collector's review. Read `get_proposal_sale_options` first.",
  writes: true,
  parameters: [
    PROPOSAL_PARAMETER,
    {
      name: "lots",
      in: "body",
      type: "string[]",
      required: true,
      description:
        "The lots the buyer took, by lot number: `2` sells lot 2 at its own price, `2=35.00` at the price agreed instead, in the lot's currency. At least one; a buyer who took none has declined, which is the collector's to record.",
    },
    {
      name: "sale",
      in: "body",
      type: "string",
      required: true,
      description: `Where the lots go: \`${NEW_SALE}\` for a new sale on the Direct platform, or the number (\`12\` or \`s12\`) or id of one of the contact's sales not yet sent, from \`get_proposal_sale_options\`.`,
    },
  ],
  result: {
    kind: "object",
    description:
      "`proposal`, now `sold` and naming its sale, in `get_proposal`'s shape, and `sale`, the sale the lots went into, in `get_sale`'s shape — marked `toReview` with what was recorded.",
  },
  handler: async (context, params) => convertToSale(context, params),
};
