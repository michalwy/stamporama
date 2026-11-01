import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type DbTransaction } from "./db";
import { allocateEntityNumber } from "./items";
import { OPEN_OFFER_STATES, type OfferListingType, type OfferState } from "./offer-rules";
import { offerNumberLabel } from "./offer-set-rules";
import { OfferActionBlockedError, readPrepareOffers, setOfferState, type PrepareOffer } from "./offers";
import { DIRECT_PLATFORM_MODULE } from "./platform-modules";
import { ensureModulePlatforms } from "./platforms";
import {
  isProposalOpen,
  proposalLotRefusal,
  proposalLotsRefusal,
  proposalMoveRefusal,
  proposalStatusAfter,
  proposalStatusOf,
  proposalTotal,
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
export async function listProposalsPaginated(
  ownerId: string,
  collectionId: string,
  filters: ProposalListFilters = {}
): Promise<{ items: ProposalListItem[]; nextCursor: string | null }> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;
  const rows = await prisma.proposal.findMany({
    where: {
      collectionId,
      ...(filters.statuses?.length ? { status: { in: [...filters.statuses] } } : {}),
      ...(filters.contactId ? { contactId: filters.contactId } : {}),
    },
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
      lots: {
        orderBy: { offerNo: "asc" },
        select: {
          id: true,
          offerNo: true,
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
    lots: row.lots.map((lot, i) => {
      const f = figures[i]!;
      const stated = f.listingType === "auction" ? f.startingPrice : f.price;
      return {
        offerId: lot.id,
        offerNo: lot.offerNo,
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
    select: { status: true, lots: { select: { id: true }, orderBy: { offerNo: "asc" } } },
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
}

export async function listProposalLotCandidates(ownerId: string, proposalId: string): Promise<ProposalLotCandidate[]> {
  const { collectionId } = await assertProposalOwner(ownerId, proposalId);
  const direct = await getDirectPlatform(collectionId);
  const rows = await prisma.offer.findMany({
    where: { collectionId, platformId: direct.id, proposalId: null, state: { in: [...OPEN_OFFER_STATES] } },
    orderBy: { offerNo: "desc" },
    select: { id: true, offerNo: true, name: true, ...LOT_FIGURES_SELECT },
  });
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
    };
  });
}

/**
 * Make `offerIds` lots of the proposal, inside `tx` — what *Add offers…* and the offer generator
 * (#1287) both write through. Every offer is asked `proposalLotRefusal` first, and one refused
 * refuses them all by name, so nothing is half added.
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
  await tx.offer.updateMany({ where: { id: { in: [...offerIds] } }, data: { proposalId } });
}

/** *Add offers…* on the proposal's screen: existing Direct offers become its lots. */
export async function addProposalLots(ownerId: string, proposalId: string, offerIds: readonly string[]): Promise<void> {
  const { collectionId } = await assertProposalOwner(ownerId, proposalId);
  if (offerIds.length === 0) throw new OfferActionBlockedError("empty", "Pick at least one offer to add.");
  await prisma.$transaction((tx) => writeProposalLots(tx, collectionId, proposalId, offerIds));
}

/** Take a lot out of an open proposal: the offer stays, an ordinary Direct offer. */
export async function removeProposalLot(ownerId: string, proposalId: string, offerId: string): Promise<void> {
  const { collectionId, status } = await assertProposalOwner(ownerId, proposalId);
  const closed = proposalLotsRefusal(status);
  if (closed) throw new OfferActionBlockedError("not-eligible", closed);
  const { count } = await prisma.offer.updateMany({
    where: { id: offerId, collectionId, proposalId },
    data: { proposalId: null },
  });
  if (count === 0) throw new OfferActionBlockedError("not-eligible", "That offer is not a lot of this proposal.");
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
    orderBy: { offerNo: "asc" },
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
