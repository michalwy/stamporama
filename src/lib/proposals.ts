import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type DbTransaction } from "./db";
import { allocateEntityNumber } from "./items";
import { OPEN_OFFER_STATES, type OfferListingType, type OfferState } from "./offer-rules";
import { offerNumberLabel } from "./offer-set-rules";
import { formatItemNo } from "./item-number";
import { readOfferPickerContents } from "./offer-picker-contents";
import type { OfferPickerContents } from "./offer-picker-contents-rules";
import {
  applyEstimatedPrices,
  GenerationChangedError,
  OfferActionBlockedError,
  readPrepareOffers,
  setOfferState,
  withdrawOpenOffersTx,
  writeGeneratedOffers,
  type PrepareOffer,
} from "./offers";
import { DIRECT_PLATFORM_MODULE } from "./platform-modules";
import { ensureModulePlatforms } from "./platforms";
import { parsePrice } from "./sale-rules";
import { isSaleSent, UNSENT_SALE_STATUSES, type SaleStatus } from "./sale-status";
import { markSaleWrittenByApi, recordProposalSaleLines, soldItemIds, type SaleLineDraft } from "./sales";
import { saleLineAddedAction } from "./sale-review";
import {
  isProposalOpen,
  proposalConversionRefusal,
  proposalLotCurrency,
  proposalLotRefusal,
  proposalSaleLotRefusal,
  proposalSaleTargetRefusal,
  proposalLotsRefusal,
  proposalMoveRefusal,
  proposalNewLotSets,
  proposalStatusAfter,
  proposalStatusOf,
  proposalTotal,
  type ProposalLotPacking,
  type ProposalMove,
  type ProposalStatus,
} from "./proposal-rules";

// Proposals (#2287; ADR-0075): an offer prepared for one contact — lots chosen and priced for that
// person on the collection's Direct platform, sent to them, then sold as whichever lots they take
// (#2289) or declined. Built like a Facebook post: the proposal is the workspace and its lots are
// ordinary offers (`Offer.proposalId`), so pricing, photos and texts are the offers' own and nothing
// here restates them. The rules are `proposal-rules.ts`.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<{ baseCurrency: string }> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { baseCurrency: true },
  });
  if (!collection) throw new Error("Collection not found");
  return collection;
}

async function assertProposalOwner(
  ownerId: string,
  proposalId: string
): Promise<{ collectionId: string; status: ProposalStatus }> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { collectionId: true, status: true },
  });
  if (!proposal) throw new Error("Proposal not found.");
  await assertCollectionOwner(ownerId, proposal.collectionId);
  return { collectionId: proposal.collectionId, status: proposalStatusOf(proposal.status) };
}

/**
 * The collection's Direct platform (#2287), switched on or not — a proposal's lots are on it whatever
 * its pickers offer. Made first where the collection does not hold it yet.
 */
export async function getDirectPlatform(collectionId: string): Promise<{ id: string; name: string; enabled: boolean }> {
  const find = () =>
    prisma.platform.findFirst({
      where: { collectionId, platformModule: DIRECT_PLATFORM_MODULE },
      select: { id: true, name: true, enabled: true },
    });
  const found = await find();
  if (found) return found;
  await ensureModulePlatforms(collectionId);
  const made = await find();
  if (!made) throw new Error("The Direct platform could not be made.");
  return made;
}

/** Make a proposal for `contactId`, empty and being prepared. */
export async function createProposal(
  ownerId: string,
  collectionId: string,
  contactId: string
): Promise<{ proposalId: string; proposalNo: number }> {
  await assertCollectionOwner(ownerId, collectionId);
  const contact = await prisma.contact.findFirst({ where: { id: contactId, collectionId }, select: { id: true } });
  if (!contact) throw new Error("That contact is not in this collection.");
  // Made now, so the proposal's screen can offer the platform its lots go on from the start.
  await getDirectPlatform(collectionId);
  return prisma.$transaction(async (tx) => {
    const proposalNo = await allocateEntityNumber(tx, collectionId, "proposal");
    const created = await tx.proposal.create({
      data: { collectionId, contactId, proposalNo },
      select: { id: true },
    });
    return { proposalId: created.id, proposalNo };
  });
}

/** The proposal numbered `proposalNo` in the collection, or null. */
export async function findProposalId(ownerId: string, collectionId: string, proposalNo: number): Promise<string | null> {
  await assertCollectionOwner(ownerId, collectionId);
  const row = await prisma.proposal.findUnique({
    where: { collectionId_proposalNo: { collectionId, proposalNo } },
    select: { id: true },
  });
  return row?.id ?? null;
}

// ── The list ─────────────────────────────────────────────────────────────────────────────────────

/** One proposal as the list of proposals and a contact's page draw it. */
export interface ProposalListItem {
  proposalId: string;
  proposalNo: number;
  contact: { id: string; name: string };
  status: ProposalStatus;
  lotCount: number;
  /** The lots still offered — neither sold nor withdrawn. */
  openLotCount: number;
  /** The lots not withdrawn, summed at their prices; see `proposalTotal`. */
  total: string;
  unpriced: number;
  currency: string;
  /** `YYYY-MM-DD`. */
  createdOn: string;
  sentOn: string | null;
}

export interface ProposalListFilters {
  /** Any of these statuses; empty is every one. */
  statuses?: readonly ProposalStatus[];
  contactId?: string;
  offset?: number;
  pageSize?: number;
}

const LOT_FIGURES_SELECT = {
  state: true,
  listingType: true,
  price: true,
  startingPrice: true,
  currency: true,
} as const;

const LIST_SELECT = {
  id: true,
  proposalNo: true,
  status: true,
  createdAt: true,
  sentAt: true,
  contact: { select: { id: true, name: true } },
  lots: { select: LOT_FIGURES_SELECT },
} as const;

type LotFigures = {
  state: string;
  listingType: string;
  price: Prisma.Decimal;
  startingPrice: Prisma.Decimal | null;
  currency: string;
};

function totalLots(lots: readonly LotFigures[]) {
  return lots.map((lot) => ({
    state: lot.state as OfferState,
    listingType: lot.listingType as OfferListingType,
    price: lot.price.toFixed(2),
    startingPrice: lot.startingPrice?.toFixed(2) ?? null,
  }));
}

function toListItem(
  row: Prisma.ProposalGetPayload<{ select: typeof LIST_SELECT }>,
  currency: string
): ProposalListItem {
  const { total, unpriced } = proposalTotal(totalLots(row.lots));
  return {
    proposalId: row.id,
    proposalNo: row.proposalNo,
    contact: row.contact,
    status: proposalStatusOf(row.status),
    lotCount: row.lots.length,
    openLotCount: row.lots.filter((lot) => (OPEN_OFFER_STATES as readonly string[]).includes(lot.state)).length,
    total,
    unpriced,
    currency: row.lots[0]?.currency ?? currency,
    createdOn: row.createdAt.toISOString().slice(0, 10),
    sentOn: row.sentAt?.toISOString().slice(0, 10) ?? null,
  };
}

/** The currency a proposal with no lots yet states its total in: the Direct platform's, else the
 *  collection's. */
async function directCurrency(collectionId: string, baseCurrency: string): Promise<string> {
  const direct = await prisma.platform.findFirst({
    where: { collectionId, platformModule: DIRECT_PLATFORM_MODULE },
    select: { platformCurrency: true },
  });
  return direct?.platformCurrency ?? baseCurrency;
}

/** Every proposal of the collection, newest first, paged by offset like the other lists. */
/** What the list narrows by, built once so the page and its count cannot narrow differently. */
function proposalListWhere(collectionId: string, filters: ProposalListFilters): Prisma.ProposalWhereInput {
  return {
    collectionId,
    ...(filters.statuses?.length ? { status: { in: [...filters.statuses] } } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
  };
}

export async function listProposalsPaginated(
  ownerId: string,
  collectionId: string,
  filters: ProposalListFilters = {}
): Promise<{ items: ProposalListItem[]; nextCursor: string | null }> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;
  const rows = await prisma.proposal.findMany({
    where: proposalListWhere(collectionId, filters),
    orderBy: { proposalNo: "desc" },
    take: pageSize + 1,
    skip: offset,
    select: LIST_SELECT,
  });
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const currency = await directCurrency(collectionId, baseCurrency);
  return {
    items: page.map((row) => toListItem(row, currency)),
    nextCursor: hasMore ? String(offset + pageSize) : null,
  };
}

/** How many proposals the list's filters match — the agent API's `total` (#2303). */
export async function countProposals(
  ownerId: string,
  collectionId: string,
  filters: ProposalListFilters = {}
): Promise<number> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.proposal.count({ where: proposalListWhere(collectionId, filters) });
}

/** A contact's proposals, newest first — every one, as the contact's page lists them. The caller has
 *  asserted the contact's ownership. */
export async function listContactProposals(collectionId: string, contactId: string): Promise<ProposalListItem[]> {
  const { baseCurrency } = await prisma.collection.findUniqueOrThrow({
    where: { id: collectionId },
    select: { baseCurrency: true },
  });
  const rows = await prisma.proposal.findMany({
    where: { collectionId, contactId },
    orderBy: { proposalNo: "desc" },
    select: LIST_SELECT,
  });
  const currency = await directCurrency(collectionId, baseCurrency);
  return rows.map((row) => toListItem(row, currency));
}

/** The proposals still open — what the offer generator offers to put its new offers into. */
export async function listOpenProposals(
  ownerId: string,
  collectionId: string
): Promise<{ proposalId: string; proposalNo: number; contactName: string; status: ProposalStatus }[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.proposal.findMany({
    where: { collectionId, status: { in: ["preparing", "sent"] } },
    orderBy: { proposalNo: "desc" },
    select: { id: true, proposalNo: true, status: true, contact: { select: { name: true } } },
  });
  return rows.map((row) => ({
    proposalId: row.id,
    proposalNo: row.proposalNo,
    contactName: row.contact.name,
    status: proposalStatusOf(row.status),
  }));
}

// ── The screen ───────────────────────────────────────────────────────────────────────────────────

/** One lot as the proposal's screen lists it. */
export interface ProposalLot {
  offerId: string;
  offerNo: number;
  /** Its number in the proposal (#2288) — the one the buyer's photos, document and message carry. */
  lotNo: number;
  title: string;
  state: OfferState;
  listingType: OfferListingType;
  /** What it is offered at, or null while it has no price. */
  price: string | null;
  currency: string;
  setCount: number;
}

export interface ProposalScreen {
  proposalId: string;
  proposalNo: number;
  collectionId: string;
  status: ProposalStatus;
  contact: { id: string; name: string };
  /** `YYYY-MM-DD`. */
  createdOn: string;
  sentOn: string | null;
  closedOn: string | null;
  /** The Direct platform the lots are offered on. */
  platform: { id: string; name: string; enabled: boolean };
  /** The sale its accepted lots went into (#2289), once sold — null before, and if that sale was
   *  deleted since. */
  sale: { saleId: string; saleNo: number; platformName: string } | null;
  lots: ProposalLot[];
  total: string;
  unpriced: number;
  currency: string;
}

export async function getProposalScreen(ownerId: string, proposalId: string): Promise<ProposalScreen | null> {
  const row = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      proposalNo: true,
      collectionId: true,
      status: true,
      createdAt: true,
      sentAt: true,
      closedAt: true,
      contact: { select: { id: true, name: true } },
      sale: { select: { id: true, saleNo: true, platform: { select: { name: true } } } },
      lots: {
        orderBy: [{ proposalLotNo: "asc" }, { offerNo: "asc" }],
        select: {
          id: true,
          offerNo: true,
          proposalLotNo: true,
          name: true,
          ...LOT_FIGURES_SELECT,
          _count: { select: { sets: true } },
        },
      },
    },
  });
  if (!row) return null;
  const { baseCurrency } = await assertCollectionOwner(ownerId, row.collectionId);
  const platform = await getDirectPlatform(row.collectionId);
  const figures = totalLots(row.lots);
  const { total, unpriced } = proposalTotal(figures);
  const currency = row.lots[0]?.currency ?? (await directCurrency(row.collectionId, baseCurrency));
  return {
    proposalId: row.id,
    proposalNo: row.proposalNo,
    collectionId: row.collectionId,
    status: proposalStatusOf(row.status),
    contact: row.contact,
    createdOn: row.createdAt.toISOString().slice(0, 10),
    sentOn: row.sentAt?.toISOString().slice(0, 10) ?? null,
    closedOn: row.closedAt?.toISOString().slice(0, 10) ?? null,
    platform,
    sale: row.sale && { saleId: row.sale.id, saleNo: row.sale.saleNo, platformName: row.sale.platform.name },
    lots: row.lots.map((lot, i) => {
      const f = figures[i]!;
      const stated = f.listingType === "auction" ? f.startingPrice : f.price;
      return {
        offerId: lot.id,
        offerNo: lot.offerNo,
        lotNo: lot.proposalLotNo ?? i + 1,
        title: offerNumberLabel(lot.name, lot.offerNo),
        state: f.state,
        listingType: f.listingType,
        price: stated !== null && Number(stated) > 0 ? stated : null,
        currency: lot.currency,
        setCount: lot._count.sets,
      };
    }),
    total,
    unpriced,
    currency,
  };
}

/** The proposal's open lots as Prepare rows — what its screen prices them with, as a post's screen
 *  does (#2031). Empty once the proposal is closed. */
export async function getProposalLotsPrepare(
  ownerId: string,
  collectionId: string,
  proposalId: string
): Promise<Record<string, PrepareOffer>> {
  const proposal = await prisma.proposal.findFirst({
    where: { id: proposalId, collectionId },
    select: { status: true, lots: { select: { id: true }, orderBy: [{ proposalLotNo: "asc" }, { offerNo: "asc" }] } },
  });
  if (!proposal) throw new Error("Proposal not found.");
  await assertCollectionOwner(ownerId, collectionId);
  if (!isProposalOpen(proposalStatusOf(proposal.status))) return {};
  const rows = await readPrepareOffers(
    ownerId,
    collectionId,
    proposal.lots.map((lot) => lot.id),
    OPEN_OFFER_STATES
  );
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

// ── Lots ─────────────────────────────────────────────────────────────────────────────────────────

/** An offer *Add offers…* lists: open, on Direct, in no proposal. */
export interface ProposalLotCandidate {
  offerId: string;
  offerNo: number;
  title: string;
  state: OfferState;
  price: string | null;
  currency: string;
  /** What the row shows of it (#2309): its own title, photo and stamps, and what its search reaches. */
  contents: OfferPickerContents;
}

export async function listProposalLotCandidates(ownerId: string, proposalId: string): Promise<ProposalLotCandidate[]> {
  const { collectionId } = await assertProposalOwner(ownerId, proposalId);
  const direct = await getDirectPlatform(collectionId);
  const rows = await prisma.offer.findMany({
    where: { collectionId, platformId: direct.id, proposalId: null, state: { in: [...OPEN_OFFER_STATES] } },
    orderBy: { offerNo: "desc" },
    select: { id: true, offerNo: true, name: true, ...LOT_FIGURES_SELECT },
  });
  const contents = await readOfferPickerContents(
    collectionId,
    rows.map((row) => row.id)
  );
  return rows.map((row) => {
    const [f] = totalLots([row]);
    const stated = f!.listingType === "auction" ? f!.startingPrice : f!.price;
    return {
      offerId: row.id,
      offerNo: row.offerNo,
      title: offerNumberLabel(row.name, row.offerNo),
      state: f!.state,
      price: stated !== null && Number(stated) > 0 ? stated : null,
      currency: row.currency,
      contents: contents.get(row.id)!,
    };
  });
}

/**
 * Make `offerIds` lots of the proposal, inside `tx` — what *Add offers…* and the offer generator
 * (#1287) both write through. Every offer is asked `proposalLotRefusal` first, and one refused
 * refuses them all by name, so nothing is half added. The new lots take the next free lot numbers
 * (#2288), in offer-number order.
 */
export async function writeProposalLots(
  tx: DbTransaction,
  collectionId: string,
  proposalId: string,
  offerIds: readonly string[]
): Promise<void> {
  const proposal = await tx.proposal.findFirst({
    where: { id: proposalId, collectionId },
    select: { status: true },
  });
  if (!proposal) throw new OfferActionBlockedError("not-eligible", "That proposal is not in this collection.");
  const closed = proposalLotsRefusal(proposalStatusOf(proposal.status));
  if (closed) throw new OfferActionBlockedError("not-eligible", closed);
  if (offerIds.length === 0) return;
  const direct = await tx.platform.findFirst({
    where: { collectionId, platformModule: DIRECT_PLATFORM_MODULE },
    select: { id: true },
  });
  const offers = await tx.offer.findMany({
    where: { id: { in: [...offerIds] }, collectionId },
    select: { id: true, offerNo: true, platformId: true, state: true, proposalId: true },
  });
  if (offers.length !== new Set(offerIds).size) {
    throw new OfferActionBlockedError("not-eligible", "An offer asked for is not in this collection any more.");
  }
  for (const offer of offers) {
    const refusal = proposalLotRefusal(
      {
        offerNo: offer.offerNo,
        onDirect: direct !== null && offer.platformId === direct.id,
        state: offer.state as OfferState,
        proposalId: offer.proposalId,
      },
      proposalId
    );
    if (refusal) throw new OfferActionBlockedError("not-eligible", refusal);
  }
  const last = await tx.offer.aggregate({ where: { proposalId }, _max: { proposalLotNo: true } });
  const first = (last._max.proposalLotNo ?? 0) + 1;
  const joining = [...offers].sort((a, b) => a.offerNo - b.offerNo);
  for (const [index, offer] of joining.entries()) {
    await tx.offer.update({ where: { id: offer.id }, data: { proposalId, proposalLotNo: first + index } });
  }
}

/**
 * Number the proposal's lots 1…n again in their order (#2288) — after one is taken out of a proposal
 * still being prepared, so what the buyer is first sent has no gaps. Never once it is sent: the buyer
 * holds the numbers then. Through negatives first, since the unique index is checked row by row.
 */
async function renumberProposalLots(tx: DbTransaction, proposalId: string): Promise<void> {
  const lots = await tx.offer.findMany({
    where: { proposalId },
    orderBy: [{ proposalLotNo: "asc" }, { offerNo: "asc" }],
    select: { id: true },
  });
  for (const [index, lot] of lots.entries()) {
    await tx.offer.update({ where: { id: lot.id }, data: { proposalLotNo: -1 - index } });
  }
  for (const [index, lot] of lots.entries()) {
    await tx.offer.update({ where: { id: lot.id }, data: { proposalLotNo: index + 1 } });
  }
}

/** *Add offers…* on the proposal's screen: existing Direct offers become its lots. */
export async function addProposalLots(ownerId: string, proposalId: string, offerIds: readonly string[]): Promise<void> {
  const { collectionId } = await assertProposalOwner(ownerId, proposalId);
  if (offerIds.length === 0) throw new OfferActionBlockedError("empty", "Pick at least one offer to add.");
  await prisma.$transaction((tx) => writeProposalLots(tx, collectionId, proposalId, offerIds));
}

/** Take a lot out of an open proposal: the offer stays, an ordinary Direct offer. While the proposal
 *  is being prepared the lots after it move up a number; once it is sent they keep theirs (#2288). */
export async function removeProposalLot(ownerId: string, proposalId: string, offerId: string): Promise<void> {
  const { collectionId, status } = await assertProposalOwner(ownerId, proposalId);
  const closed = proposalLotsRefusal(status);
  if (closed) throw new OfferActionBlockedError("not-eligible", closed);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.offer.updateMany({
      where: { id: offerId, collectionId, proposalId },
      data: { proposalId: null, proposalLotNo: null },
    });
    if (count === 0) throw new OfferActionBlockedError("not-eligible", "That offer is not a lot of this proposal.");
    if (status === "preparing") await renumberProposalLots(tx, proposalId);
  });
}

/** What *New lots…* made: how many lots, and how many of them have no estimate to be priced at. */
export interface ProposalNewLotsResult {
  lots: number;
  unpriced: number;
}

/**
 * *New lots…* on the proposal's screen (#2299): the copies picked become new Direct offers that are
 * the proposal's next lots — an offer each, or one offer of them all (`proposalNewLotSets`). Each is
 * made exactly as Generate offers makes one (`writeGeneratedOffers`: Preparing, titled from Direct's
 * templates) and joins the proposal in the same transaction, so a proposal closed meanwhile, or a copy
 * sold or put on another Direct offer since it was picked, makes nothing. Each new lot then takes its
 * estimated price where it has one, as *Use estimated price* gives it, and is priced on the proposal
 * like any lot.
 */
export async function makeProposalLots(
  ownerId: string,
  proposalId: string,
  itemIds: readonly string[],
  packing: ProposalLotPacking
): Promise<ProposalNewLotsResult> {
  const { collectionId, status } = await assertProposalOwner(ownerId, proposalId);
  const closed = proposalLotsRefusal(status);
  if (closed) throw new OfferActionBlockedError("not-eligible", closed);
  const newOffers = proposalNewLotSets(itemIds, packing);
  if (newOffers.length === 0) throw new OfferActionBlockedError("empty", "Pick at least one copy.");
  const direct = await getDirectPlatform(collectionId);

  let createdOfferIds: string[];
  try {
    ({ createdOfferIds } = await writeGeneratedOffers(
      ownerId,
      collectionId,
      { platformId: direct.id, state: "preparing", facebookGroupId: null, endsAt: null, newOffers, additions: [] },
      { inTransaction: (tx, created) => writeProposalLots(tx, collectionId, proposalId, created) }
    ));
  } catch (e) {
    if (e instanceof GenerationChangedError && e.drift.kind === "copy") {
      const item = await prisma.item.findFirst({ where: { id: e.drift.itemId, collectionId }, select: { itemNo: true } });
      const copy = item ? `Copy ${formatItemNo(item.itemNo)}` : "A copy";
      throw new OfferActionBlockedError(
        "not-eligible",
        `${copy} has sold or gone onto another ${direct.name} offer since it was picked. No lot was made.`
      );
    }
    throw e;
  }
  const { skipped } = await applyEstimatedPrices(ownerId, collectionId, createdOfferIds);
  return { lots: createdOfferIds.length, unpriced: skipped.length };
}

// ── Moves ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Mark the proposal sent, or decline it. Declining withdraws every lot still open — each through the
 * offer's own transition, so a withdrawal is exactly what it is anywhere else — and then closes the
 * proposal; a lot that cannot be withdrawn refuses the decline with the proposal still open.
 */
export async function moveProposal(ownerId: string, proposalId: string, move: ProposalMove): Promise<void> {
  const { status } = await assertProposalOwner(ownerId, proposalId);
  const lots = await prisma.offer.findMany({
    where: { proposalId },
    orderBy: [{ proposalLotNo: "asc" }, { offerNo: "asc" }],
    select: { id: true, state: true },
  });
  const refusal = proposalMoveRefusal(status, move, lots.length);
  if (refusal) throw new OfferActionBlockedError("bad-transition", refusal);
  if (move === "decline") {
    for (const lot of lots) {
      if ((OPEN_OFFER_STATES as readonly string[]).includes(lot.state)) {
        await setOfferState(ownerId, lot.id, "withdrawn");
      }
    }
  }
  const now = new Date();
  await prisma.proposal.update({
    where: { id: proposalId },
    data: {
      status: proposalStatusAfter(move),
      ...(move === "send" ? { sentAt: now } : { closedAt: now }),
    },
  });
}

// ── Becoming a sale (#2289) ──────────────────────────────────────────────────────────────────────

/** A lot as *Convert to sale…* lists it: what it is offered at, and how many of its sets are still
 *  there to sell — each sells at the lot's price, as an offer's sets do. */
export interface ProposalSaleLot {
  offerId: string;
  offerNo: number;
  /** Its lot number (#2288) — the one the buyer answers with. */
  lotNo: number;
  title: string;
  state: OfferState;
  /** What it is offered at, or null while it has no price. */
  price: string | null;
  currency: string;
  setsToSell: number;
}

/** One of the contact's sales still open, on any platform, as the dialog offers it. */
export interface ProposalSaleCandidate {
  saleId: string;
  saleNo: number;
  platformName: string;
  /** `YYYY-MM-DD`. */
  soldOn: string;
  status: SaleStatus;
  currency: string;
  lineCount: number;
}

export interface ProposalSaleOptions {
  /** The lots still open, in lot order (#2288). */
  lots: ProposalSaleLot[];
  /** The contact's sales not yet sent, newest first. */
  sales: ProposalSaleCandidate[];
  /** The Direct platform a new sale is on. */
  platformName: string;
}

/** The sets of `offerIds` whose copies have not left yet, by offer — what each lot can still sell. */
async function setsToSell(offerIds: readonly string[]): Promise<Map<string, { offerSetId: string; itemIds: string[] }[]>> {
  const sets = await prisma.offerSet.findMany({
    where: { offerId: { in: [...offerIds] } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, offerId: true, items: { select: { itemId: true } } },
  });
  const sold = await soldItemIds([...new Set(sets.flatMap((set) => set.items.map((i) => i.itemId)))]);
  const byOffer = new Map<string, { offerSetId: string; itemIds: string[] }[]>();
  for (const set of sets) {
    // A set is whole or nothing: one copy gone retires it, as on every sale.
    if (set.items.length === 0 || set.items.some((i) => sold.has(i.itemId))) continue;
    const list = byOffer.get(set.offerId) ?? [];
    list.push({ offerSetId: set.id, itemIds: set.items.map((i) => i.itemId) });
    byOffer.set(set.offerId, list);
  }
  return byOffer;
}

/** What *Convert to sale…* offers: the lots still open, and the contact's sales still open. */
export async function getProposalSaleOptions(ownerId: string, proposalId: string): Promise<ProposalSaleOptions> {
  const { collectionId } = await assertProposalOwner(ownerId, proposalId);
  const proposal = await prisma.proposal.findUniqueOrThrow({
    where: { id: proposalId },
    select: {
      contactId: true,
      lots: {
        where: { state: { in: [...OPEN_OFFER_STATES] } },
        orderBy: [{ proposalLotNo: "asc" }, { offerNo: "asc" }],
        select: { id: true, offerNo: true, proposalLotNo: true, name: true, ...LOT_FIGURES_SELECT },
      },
    },
  });
  const sets = await setsToSell(proposal.lots.map((lot) => lot.id));
  const figures = totalLots(proposal.lots);
  const sales = await prisma.sale.findMany({
    where: { collectionId, buyerId: proposal.contactId, status: { in: [...UNSENT_SALE_STATUSES] } },
    orderBy: [{ soldAt: "desc" }, { saleNo: "desc" }],
    select: {
      id: true,
      saleNo: true,
      soldAt: true,
      status: true,
      currency: true,
      platform: { select: { name: true } },
      _count: { select: { lines: true } },
    },
  });
  const direct = await getDirectPlatform(collectionId);
  return {
    lots: proposal.lots.map((lot, i) => {
      const f = figures[i]!;
      const stated = f.listingType === "auction" ? f.startingPrice : f.price;
      return {
        offerId: lot.id,
        offerNo: lot.offerNo,
        lotNo: lot.proposalLotNo ?? i + 1,
        title: offerNumberLabel(lot.name, lot.offerNo),
        state: f.state,
        price: stated !== null && Number(stated) > 0 ? stated : null,
        currency: lot.currency,
        setsToSell: sets.get(lot.id)?.length ?? 0,
      };
    }),
    sales: sales.map((sale) => ({
      saleId: sale.id,
      saleNo: sale.saleNo,
      platformName: sale.platform.name,
      soldOn: sale.soldAt.toISOString().slice(0, 10),
      status: sale.status as SaleStatus,
      currency: sale.currency,
      lineCount: sale._count.lines,
    })),
    platformName: direct.name,
  };
}

/** What *Convert to sale…* is asked: the lots the buyer took, each at the price typed for it, and the
 *  sale they go into. */
export interface ProposalSaleInput {
  lots: readonly { offerId: string; price: string }[];
  target: { saleId: string } | { newSale: true };
}

export interface ProposalSaleResult {
  saleId: string;
  saleNo: number;
  /** A new Direct sale was started. */
  created: boolean;
}

/** Today at UTC midnight — the shape `Sale.soldAt` (`@db.Date`) stores. */
function todayUtcDate(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/**
 * *Convert to sale…* (#2289; ADR-0075 §6): the ticked lots are sold — every set each still has, at
 * the price typed for the lot — into a new sale on Direct for the proposal's contact, dated today, or
 * into one of the contact's sales not yet sent, **on any platform**, which keeps its platform, buyer,
 * currency and fees. The lots not ticked are withdrawn and the proposal closes as Sold, naming the
 * sale — all in the sale's own transaction, so nothing is half done. A currency the sale does not
 * share is refused, not converted.
 */
export async function convertProposalToSale(
  ownerId: string,
  proposalId: string,
  input: ProposalSaleInput
): Promise<ProposalSaleResult> {
  return sellProposalLots(ownerId, proposalId, input, null);
}

/**
 * *Convert to sale…* through the agent API (#2303): the same conversion under the same rules, and the
 * sale marked *to review* (#1948) — created or added to — in the conversion's own transaction, so a
 * sale the agent recorded cannot come out unmarked. Nothing here clears the marker.
 */
export async function convertProposalToSaleThroughApi(
  ownerId: string,
  proposalId: string,
  input: ProposalSaleInput
): Promise<ProposalSaleResult> {
  return sellProposalLots(ownerId, proposalId, input, (tx, saleId, created, actions) =>
    markSaleWrittenByApi(tx, saleId, { kind: created ? "created" : "changed", actions })
  );
}

/** What the agent API does in the conversion's transaction: the sale, whether it is new, and what
 *  was added to it, a line per lot. */
type ProposalSaleMark = (tx: DbTransaction, saleId: string, created: boolean, actions: string[]) => Promise<void>;

async function sellProposalLots(
  ownerId: string,
  proposalId: string,
  input: ProposalSaleInput,
  mark: ProposalSaleMark | null
): Promise<ProposalSaleResult> {
  const { collectionId, status } = await assertProposalOwner(ownerId, proposalId);
  const ticked = new Map(input.lots.map((lot) => [lot.offerId, lot.price]));
  const refusal = proposalConversionRefusal(status, ticked.size);
  if (refusal) throw new OfferActionBlockedError("bad-transition", refusal);

  const proposal = await prisma.proposal.findUniqueOrThrow({
    where: { id: proposalId },
    select: { contactId: true, lots: { select: { id: true, offerNo: true, state: true, currency: true } } },
  });
  const lotById = new Map(proposal.lots.map((lot) => [lot.id, lot]));
  const sets = await setsToSell([...ticked.keys()]);
  const drafts: SaleLineDraft[] = [];
  const currencies: string[] = [];
  const actions: string[] = [];
  for (const [offerId, rawPrice] of ticked) {
    const lot = lotById.get(offerId);
    const lotRefusal = proposalSaleLotRefusal({
      offerNo: lot?.offerNo ?? 0,
      state: (lot?.state ?? "withdrawn") as OfferState,
      inProposal: lot !== undefined,
      hasSetToSell: (sets.get(offerId)?.length ?? 0) > 0,
    });
    if (lotRefusal || !lot) throw new OfferActionBlockedError("not-eligible", lotRefusal ?? "That offer is not a lot of this proposal.");
    const price = parsePrice(rawPrice);
    if (!price.ok) throw new OfferActionBlockedError("unpriced", `Offer #${lot.offerNo}: ${price.message}`);
    currencies.push(lot.currency);
    actions.push(saleLineAddedAction({ offerNo: lot.offerNo, price: price.value, currency: lot.currency }));
    for (const set of sets.get(offerId)!) {
      drafts.push({ offerId, offerSetId: set.offerSetId, price: price.value, itemIds: set.itemIds });
    }
  }
  const currency = proposalLotCurrency(currencies);
  if (!currency.ok) throw new OfferActionBlockedError("not-eligible", currency.message);

  if ("saleId" in input.target) {
    const sale = await prisma.sale.findFirst({
      where: { id: input.target.saleId, collectionId },
      select: { saleNo: true, buyerId: true, status: true, currency: true },
    });
    if (!sale) throw new OfferActionBlockedError("not-eligible", "That sale is not in this collection.");
    const targetRefusal = proposalSaleTargetRefusal(
      { saleNo: sale.saleNo, buyerId: sale.buyerId, sent: isSaleSent(sale.status), currency: sale.currency },
      proposal.contactId,
      currency.currency
    );
    if (targetRefusal) throw new OfferActionBlockedError("not-eligible", targetRefusal);
  } else {
    // Whoever a proposal is sold to is a buyer from now on, as a Facebook buyer becomes one.
    await prisma.contact.update({ where: { id: proposal.contactId }, data: { buyer: true } });
  }

  const direct = await getDirectPlatform(collectionId);
  const notTaken = proposal.lots.filter((lot) => !ticked.has(lot.id)).map((lot) => lot.id);
  const { saleId, created } = await recordProposalSaleLines(
    ownerId,
    collectionId,
    "saleId" in input.target
      ? { saleId: input.target.saleId }
      : {
          header: {
            platformId: direct.id,
            buyerId: proposal.contactId,
            externalRef: null,
            transactionUrl: null,
            soldAt: todayUtcDate(),
            currency: currency.currency,
            buyerHandling: null,
            buyerPaidTotal: null,
            commission: null,
          },
          offerCurrency: currency.currency,
        },
    drafts,
    async (tx, saleId) => {
      // Closed only while still open: a proposal sold or declined meanwhile rolls the sale back.
      const { count } = await tx.proposal.updateMany({
        where: { id: proposalId, status: { in: ["preparing", "sent"] } },
        data: { status: "sold", closedAt: new Date(), saleId },
      });
      if (count === 0) {
        throw new OfferActionBlockedError("bad-transition", "This proposal was closed meanwhile — nothing was sold.");
      }
      await withdrawOpenOffersTx(tx, notTaken);
      if (mark) await mark(tx, saleId, !("saleId" in input.target), actions);
    }
  );
  const { saleNo } = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, select: { saleNo: true } });
  return { saleId, saleNo, created };
}

/**
 * Something was made for the buyer — the photos, the document or its link, or the message (#2288) —
 * so a proposal being prepared is now **Sent**, as *Mark sent* would make it. A proposal already sent
 * or closed, or one with no lots yet, is left as it is: this is a consequence of handing something
 * out, never a refusal of it. Returns whether it moved.
 */
export async function markProposalHandedOut(ownerId: string, proposalId: string): Promise<boolean> {
  const { status } = await assertProposalOwner(ownerId, proposalId);
  if (status !== "preparing") return false;
  const lots = await prisma.offer.count({ where: { proposalId } });
  if (proposalMoveRefusal(status, "send", lots)) return false;
  // Conditional on the status read, so two hand-outs at once move it once.
  const { count } = await prisma.proposal.updateMany({
    where: { id: proposalId, status: "preparing" },
    data: { status: proposalStatusAfter("send"), sentAt: new Date() },
  });
  return count > 0;
}
