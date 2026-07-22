import "server-only";
import { prisma } from "./db";
import { listItemsPaginated, valuateItemsByIds, type ItemListItem } from "./items";
import { getOrFetchRate } from "./exchange-rates";
import {
  type OfferState,
  isOfferState,
  canTransition,
  isTerminalState,
} from "./offer-rules";
import { deriveSetLabel, deriveOfferLabel } from "./offer-set-rules";

// Server-side domain logic for **offer-owned composition** (ADR-0013, supersedes ADR-0012 §1–§2).
// An `Offer` is a listing on one platform that **owns its composition directly**: it holds N
// `OfferSet`s, each an atomic sellable unit (one or more copies that leave together — a series
// never breaks apart). Nothing is shared between offers; the same physical copy listed elsewhere
// is a separate offer with its own sets, and the `Item` is the cross-platform thread.
//
// This module owns: offer create / edit / delete + the manual lifecycle (active ↔ paused →
// withdrawn; `sold` is set by the sale flow, #166), set add / rename / remove, the paginated
// offers list + the offer detail read model, the composable-copies picker, the non-blocking
// collision warning, and the derived **"needs action"** overlay (an active offer holding a set
// whose copy has already sold elsewhere — ADR-0013 §4). The pure state machine lives in
// `offer-rules.ts`, the label rules in `offer-set-rules.ts`. All access is owner-scoped.

// ── Errors ────────────────────────────────────────────────────────────────

export type OfferBlockReason =
  | "not-eligible"
  | "terminal"
  | "bad-transition"
  | "no-platform"
  | "empty"
  | "sold-set";

/** Raised when an offer action is refused by a domain guard. `message` is user-facing; the
 * server action maps it to an `{ status: "error" }` response. */
export class OfferActionBlockedError extends Error {
  readonly reason: OfferBlockReason;
  constructor(reason: OfferBlockReason, message: string) {
    super(message);
    this.name = "OfferActionBlockedError";
    this.reason = reason;
  }
}

// ── Ownership helpers ───────────────────────────────────────────────────────

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

interface OfferRef {
  collectionId: string;
  platformId: string;
  state: OfferState;
}

async function assertOfferOwner(ownerId: string, offerId: string): Promise<OfferRef> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      collectionId: true,
      platformId: true,
      state: true,
      collection: { select: { ownerId: true } },
    },
  });
  if (!offer || offer.collection.ownerId !== ownerId) {
    throw new Error("Offer not found or access denied.");
  }
  return {
    collectionId: offer.collectionId,
    platformId: offer.platformId,
    state: (isOfferState(offer.state) ? offer.state : "active") as OfferState,
  };
}

interface OfferSetRef {
  offerId: string;
  collectionId: string;
  offerState: OfferState;
}

async function assertOfferSetOwner(ownerId: string, setId: string): Promise<OfferSetRef> {
  const set = await prisma.offerSet.findUnique({
    where: { id: setId },
    select: {
      offerId: true,
      offer: { select: { collectionId: true, state: true, collection: { select: { ownerId: true } } } },
    },
  });
  if (!set || set.offer.collection.ownerId !== ownerId) {
    throw new Error("Offer set not found or access denied.");
  }
  return {
    offerId: set.offerId,
    collectionId: set.offer.collectionId,
    offerState: (isOfferState(set.offer.state) ? set.offer.state : "active") as OfferState,
  };
}

/** Verify a contact exists in the collection and carries the `platform` role. */
async function assertPlatform(collectionId: string, platformId: string): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: { id: platformId, collectionId, platform: true },
    select: { id: true },
  });
  if (!contact) {
    throw new OfferActionBlockedError("no-platform", "Choose a platform to list on.");
  }
}

// ── Labels ────────────────────────────────────────────────────────────────

/** Short copy label from a stamp select — primary catalog number, else name. */
function copyLabel(stamp: { name: string | null; catalogNumbers: { number: string }[] }): string {
  return stamp.catalogNumbers[0]?.number ?? stamp.name ?? "Copy";
}

const STAMP_LABEL_SELECT = {
  stamp: { select: { name: true, catalogNumbers: { select: { number: true }, take: 1 } } },
} as const;

const OFFER_SETS_SELECT = {
  id: true,
  title: true,
  items: { select: { itemId: true, item: { select: STAMP_LABEL_SELECT } } },
  saleLines: { select: { id: true }, take: 1 },
} as const;

type OfferSetRow = {
  id: string;
  title: string | null;
  items: { itemId: string; item: { stamp: { name: string | null; catalogNumbers: { number: string }[] } } }[];
  saleLines: { id: string }[];
};

function setLabel(set: OfferSetRow): string {
  return deriveSetLabel(set.title, set.items.map((li) => copyLabel(li.item.stamp)));
}

function offerLabel(sets: OfferSetRow[]): string {
  return deriveOfferLabel(sets.map(setLabel));
}

// ── "Needs action" derivation (ADR-0013 §4) ──────────────────────────────────

/**
 * Per active offer, the number of copies held in a set that has already sold elsewhere — a set
 * whose copy is on a `sale_line_item` but **not** through that set's own sale line. Such an offer
 * is stale on its platform: the collector removes the dead set (decrement) or withdraws. A set
 * that sold through its own line is not counted (it is the sale, not a collision), and fully-sold
 * offers are already `sold` (#166), so only `active` offers are considered.
 *
 * One batched `sale_line_item` lookup across every candidate copy — no per-offer query.
 */
async function needsActionCounts(
  offers: { id: string; state: string; sets: OfferSetRow[] }[]
): Promise<Map<string, number>> {
  const active = offers.filter((o) => o.state === "active");
  const allIds = [...new Set(active.flatMap((o) => o.sets.flatMap((s) => s.items.map((li) => li.itemId))))];
  if (allIds.length === 0) return new Map();

  // Which candidate copies have sold, and through which set (so a set's own sale is not a collision).
  const soldRows = await prisma.saleLineItem.findMany({
    where: { itemId: { in: allIds } },
    select: { itemId: true, saleLine: { select: { offerSetId: true } } },
  });
  const soldViaSet = new Map<string, string>(); // itemId -> the offerSetId it sold through
  for (const r of soldRows) soldViaSet.set(r.itemId, r.saleLine.offerSetId);

  const counts = new Map<string, number>();
  for (const o of active) {
    let dead = 0;
    for (const s of o.sets) {
      for (const li of s.items) {
        const soldSet = soldViaSet.get(li.itemId);
        if (soldSet && soldSet !== s.id) dead++;
      }
    }
    if (dead > 0) counts.set(o.id, dead);
  }
  return counts;
}

// ── Collision lookup (non-blocking warning) ─────────────────────────────────

export interface OfferCollision {
  offerId: string;
  offerLabel: string;
  platformName: string;
  /** How many of the candidate copies this active offer also lists. */
  sharedCount: number;
}

/**
 * **Active** offers on the same platform whose sets already list one of `itemIds` (ADR-0013 —
 * you normally keep at most one active listing of a copy per platform). A *warning* the compose
 * dialog surfaces; nothing is blocked. `excludeOfferId` skips the offer being composed.
 */
export async function findOfferCollisions(
  ownerId: string,
  collectionId: string,
  itemIds: string[],
  platformId: string,
  excludeOfferId?: string
): Promise<OfferCollision[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const targets = new Set(itemIds);
  if (targets.size === 0) return [];

  const offers = await prisma.offer.findMany({
    where: {
      collectionId,
      platformId,
      state: "active",
      ...(excludeOfferId ? { id: { not: excludeOfferId } } : {}),
      sets: { some: { items: { some: { itemId: { in: itemIds } } } } },
    },
    select: {
      id: true,
      platform: { select: { name: true } },
      sets: { select: OFFER_SETS_SELECT },
    },
  });

  const collisions: OfferCollision[] = [];
  for (const offer of offers) {
    const items = new Set(offer.sets.flatMap((s) => s.items.map((li) => li.itemId)));
    const shared = [...targets].filter((id) => items.has(id)).length;
    if (shared > 0) {
      collisions.push({
        offerId: offer.id,
        offerLabel: offerLabel(offer.sets),
        platformName: offer.platform.name,
        sharedCount: shared,
      });
    }
  }
  return collisions;
}

// ── Read models ─────────────────────────────────────────────────────────────

export interface OfferListItem {
  id: string;
  label: string;
  platformId: string;
  platformName: string;
  url: string | null;
  price: string;
  currency: string;
  state: OfferState;
  /** How many sellable sets the offer holds (its "quantity"). */
  setCount: number;
  /** Total physical copies across all sets. */
  itemCount: number;
  /** Derived (ADR-0013 §4): an active offer holding ≥1 set whose copy sold elsewhere. */
  needsAction: boolean;
  /** How many of its copies have sold elsewhere (drives the badge tooltip). */
  soldCopyCount: number;
  createdAt: Date;
}

const OFFER_SELECT = {
  id: true,
  platformId: true,
  url: true,
  price: true,
  currency: true,
  state: true,
  createdAt: true,
  platform: { select: { name: true } },
  sets: { select: OFFER_SETS_SELECT },
} as const;

type OfferRow = {
  id: string;
  platformId: string;
  url: string | null;
  price: unknown;
  currency: string;
  state: string;
  createdAt: Date;
  platform: { name: string };
  sets: OfferSetRow[];
};

function toListItem(row: OfferRow, soldCopyCount = 0): OfferListItem {
  return {
    id: row.id,
    label: offerLabel(row.sets),
    platformId: row.platformId,
    platformName: row.platform.name,
    url: row.url,
    price: String(row.price),
    currency: row.currency,
    state: (isOfferState(row.state) ? row.state : "active") as OfferState,
    setCount: row.sets.length,
    itemCount: row.sets.reduce((n, s) => n + s.items.length, 0),
    needsAction: soldCopyCount > 0,
    soldCopyCount,
    createdAt: row.createdAt,
  };
}

/** Enrich a fetched page of offer rows with their derived "needs action" counts in one batched
 * query (only `active` offers can need action). */
async function withNeedsAction(rows: OfferRow[]): Promise<OfferListItem[]> {
  const counts = await needsActionCounts(rows.map((r) => ({ id: r.id, state: r.state, sets: r.sets })));
  return rows.map((r) => toListItem(r, counts.get(r.id) ?? 0));
}

export interface OfferListFilters {
  platformId?: string;
  state?: OfferState;
  /** The derived "needs action" overlay (ADR-0013 §4): active offers holding a set whose copy sold
   * elsewhere. Takes precedence over `state`. */
  needsAction?: boolean;
  offset?: number;
  pageSize?: number;
}

export interface PaginatedOffersResult {
  items: OfferListItem[];
  nextCursor: string | null;
}

/** Paginated offers list for the Offers screen (ADR-0013). Filters by platform + state; the
 * derived "needs action" filter is applied in memory (it can't be a DB `where`). */
export async function listOffersPaginated(
  ownerId: string,
  collectionId: string,
  filters: OfferListFilters = {}
): Promise<PaginatedOffersResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;

  if (filters.needsAction) {
    const rows = await prisma.offer.findMany({
      where: {
        collectionId,
        state: "active",
        ...(filters.platformId ? { platformId: filters.platformId } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: OFFER_SELECT,
    });
    const counts = await needsActionCounts(rows.map((r) => ({ id: r.id, state: r.state, sets: r.sets })));
    const flagged = rows.filter((r) => counts.has(r.id));
    const page = flagged.slice(offset, offset + pageSize);
    return {
      items: page.map((r) => toListItem(r, counts.get(r.id) ?? 0)),
      nextCursor: flagged.length > offset + pageSize ? String(offset + pageSize) : null,
    };
  }

  const rows = await prisma.offer.findMany({
    where: {
      collectionId,
      ...(filters.platformId ? { platformId: filters.platformId } : {}),
      ...(filters.state ? { state: filters.state } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    skip: offset,
    select: OFFER_SELECT,
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  return {
    items: await withNeedsAction(page),
    nextCursor: hasMore ? String(offset + pageSize) : null,
  };
}

/** Distinct platforms that currently have at least one offer, for the list-screen filter. */
export async function listOfferPlatforms(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string }[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.offer.findMany({
    where: { collectionId },
    select: { platform: { select: { id: true, name: true } } },
    distinct: ["platformId"],
    orderBy: { platform: { name: "asc" } },
  });
  return rows.map((r) => r.platform);
}

export interface OfferDetailSet {
  id: string;
  title: string | null;
  label: string;
  itemIds: string[];
  copyLabels: string[];
  /** This set has left on a sale (sold through this offer). */
  sold: boolean;
  /** A copy of this set has sold **elsewhere** — the set is stale and should be removed. */
  needsAction: boolean;
}

export interface OfferDetail {
  id: string;
  collectionId: string;
  label: string;
  platformId: string;
  platformName: string;
  url: string | null;
  price: string;
  currency: string;
  state: OfferState;
  needsAction: boolean;
  /** Derived suggested asking price **in the offer's currency**: the average catalog value per set
   * (a buyer takes one set), converted from base at the current FX rate. Null when nothing is
   * valued or no rate is available. */
  suggestedPrice: string | null;
  /** Sets with no computable catalog value (excluded from the average). */
  suggestedUnpricedSets: number;
  sets: OfferDetailSet[];
  createdAt: Date;
}

/** Full offer read model for the detail / compose screen (ADR-0013): the offer header plus each
 * of its sets, with per-set sold / needs-action status. */
export async function getOfferDetail(ownerId: string, offerId: string): Promise<OfferDetail | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      collectionId: true,
      platformId: true,
      url: true,
      price: true,
      currency: true,
      state: true,
      createdAt: true,
      collection: { select: { ownerId: true, baseCurrency: true } },
      platform: { select: { name: true } },
      sets: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          title: true,
          items: { select: { itemId: true, item: { select: STAMP_LABEL_SELECT } } },
          saleLines: { select: { id: true }, take: 1 },
        },
      },
    },
  });
  if (!offer || offer.collection.ownerId !== ownerId) return null;

  const state = (isOfferState(offer.state) ? offer.state : "active") as OfferState;
  const baseCurrency = offer.collection.baseCurrency;
  // Which copies across this offer sold, and through which set (own sale vs. collision).
  const allIds = offer.sets.flatMap((s) => s.items.map((li) => li.itemId));
  const soldRows =
    allIds.length > 0
      ? await prisma.saleLineItem.findMany({
          where: { itemId: { in: allIds } },
          select: { itemId: true, saleLine: { select: { offerSetId: true } } },
        })
      : [];
  const soldViaSet = new Map(soldRows.map((r) => [r.itemId, r.saleLine.offerSetId]));

  const sets: OfferDetailSet[] = offer.sets.map((s) => {
    const sold = s.saleLines.length > 0;
    const needs =
      state === "active" &&
      !sold &&
      s.items.some((li) => {
        const via = soldViaSet.get(li.itemId);
        return via != null && via !== s.id;
      });
    return {
      id: s.id,
      title: s.title,
      label: setLabel(s),
      itemIds: s.items.map((li) => li.itemId),
      copyLabels: s.items.map((li) => copyLabel(li.item.stamp)),
      sold,
      needsAction: needs,
    };
  });

  // Suggested asking price: average base-currency catalog value per set (a buyer takes one set),
  // converted to the offer's currency at the current rate.
  const valuations = await valuateItemsByIds(offer.collectionId, allIds);
  let sumSetCV = 0;
  let valuedSets = 0;
  for (const s of offer.sets) {
    let setTotal = 0;
    let anyValued = false;
    for (const li of s.items) {
      const base = valuations.get(li.itemId)?.baseAmount;
      if (base != null) {
        setTotal += base;
        anyValued = true;
      }
    }
    if (anyValued) {
      sumSetCV += setTotal;
      valuedSets++;
    }
  }
  let suggestedPrice: string | null = null;
  if (valuedSets > 0) {
    const avgBase = sumSetCV / valuedSets;
    try {
      const { rate } = await getOrFetchRate(offer.collectionId, baseCurrency, offer.currency);
      suggestedPrice = (avgBase * rate).toFixed(2);
    } catch {
      suggestedPrice = null; // no rate to the offer currency → no suggestion
    }
  }

  return {
    id: offer.id,
    collectionId: offer.collectionId,
    label: offerLabel(offer.sets),
    platformId: offer.platformId,
    platformName: offer.platform.name,
    url: offer.url,
    price: String(offer.price),
    currency: offer.currency,
    state,
    needsAction: sets.some((s) => s.needsAction),
    suggestedPrice,
    suggestedUnpricedSets: offer.sets.length - valuedSets,
    sets,
    createdAt: offer.createdAt,
  };
}

/** Distinct issue ids across every copy in an offer's sets, for the sets view's issue-group
 * headers (loaded once on the page, mirrors the sale/purchase views). */
export async function getOfferIssueIds(offerId: string): Promise<string[]> {
  const rows = await prisma.issueMember.findMany({
    where: {
      stamp: { items: { some: { offerSetMemberships: { some: { offerSet: { offerId } } } } } },
    },
    select: { issueId: true },
    distinct: ["issueId"],
  });
  return rows.map((r) => r.issueId);
}

/** Every physical copy across an offer's sets, enriched as `ItemListItem`s (same shape as the
 * Copies screen). An offer is one listing, so its copy count is bounded — loaded in one query and
 * grouped by set client-side for the rich sets view. */
export async function listOfferCopies(ownerId: string, offerId: string): Promise<ItemListItem[]> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      collectionId: true,
      collection: { select: { ownerId: true } },
      sets: { select: { items: { select: { itemId: true } } } },
    },
  });
  if (!offer || offer.collection.ownerId !== ownerId) {
    throw new Error("Offer not found or access denied.");
  }
  const ids = [...new Set(offer.sets.flatMap((s) => s.items.map((i) => i.itemId)))];
  if (ids.length === 0) return [];
  const { items } = await listItemsPaginated(ownerId, offer.collectionId, { ids, pageSize: ids.length });
  return items;
}

/** Copies eligible to add to an offer set (composition picker): *For sale*, delivered, not sold,
 * and not already in a set of this offer. */
export async function listComposableCopies(
  ownerId: string,
  collectionId: string,
  opts: { offerId?: string; areaIds?: string[]; search?: string; year?: number | "none" } = {}
): Promise<ItemListItem[]> {
  const { items } = await listItemsPaginated(ownerId, collectionId, {
    forSale: true,
    deliveryState: "delivered",
    excludeSold: true,
    notInOfferId: opts.offerId,
    areaIds: opts.areaIds,
    search: opts.search,
    year: opts.year,
    sortDir: "asc",
    pageSize: 1000,
  });
  return items;
}

// ── Mutations ────────────────────────────────────────────────────────────────

export interface OfferInput {
  platformId: string;
  url: string | null;
  price: string;
  currency: string;
}

/** Create an `active` offer on a platform (ADR-0013). Its sets are composed afterwards on the
 * offer detail screen. */
export async function createOffer(
  ownerId: string,
  collectionId: string,
  input: OfferInput
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  await assertPlatform(collectionId, input.platformId);
  const offer = await prisma.offer.create({
    data: {
      collectionId,
      platformId: input.platformId,
      url: input.url,
      price: input.price,
      currency: input.currency,
      state: "active",
    },
    select: { id: true },
  });
  return offer.id;
}

/** Edit an offer's platform / URL / price / currency. Terminal offers (sold / withdrawn) are
 * frozen. */
export async function updateOffer(
  ownerId: string,
  offerId: string,
  input: OfferInput
): Promise<void> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (isTerminalState(ref.state)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.state} offer is read-only and cannot be edited.`);
  }
  await assertPlatform(ref.collectionId, input.platformId);
  await prisma.offer.update({
    where: { id: offerId },
    data: {
      platformId: input.platformId,
      url: input.url,
      price: input.price,
      currency: input.currency,
    },
  });
}

export interface OfferPatch {
  platformId?: string;
  url?: string | null;
  price?: string;
  currency?: string;
}

/** Patch one or more offer header fields in place (ADR-0013) — the detail screen edits price /
 * currency / URL individually. Terminal offers are frozen; a changed platform is re-validated. */
export async function patchOffer(ownerId: string, offerId: string, patch: OfferPatch): Promise<void> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (isTerminalState(ref.state)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.state} offer is read-only and cannot be edited.`);
  }
  if (patch.platformId !== undefined) {
    await assertPlatform(ref.collectionId, patch.platformId);
  }
  await prisma.offer.update({
    where: { id: offerId },
    data: {
      ...(patch.platformId !== undefined ? { platformId: patch.platformId } : {}),
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.price !== undefined ? { price: patch.price } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
    },
  });
}

/** Move an offer through its manual lifecycle (active ↔ paused → withdrawn). `sold` is owned by
 * the sale flow (#166) and rejected here. */
export async function setOfferState(ownerId: string, offerId: string, to: OfferState): Promise<void> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (to === "sold") {
    throw new OfferActionBlockedError("bad-transition", "An offer is marked sold by recording a sale, not directly.");
  }
  if (!canTransition(ref.state, to)) {
    throw new OfferActionBlockedError("bad-transition", `Cannot move an offer from ${ref.state} to ${to}.`);
  }
  await prisma.offer.update({ where: { id: offerId }, data: { state: to } });
}

/** Delete an offer and all its sets (the underlying copies are untouched). Blocked when any set
 * has sold — the sale record must survive (`sale_line.offerSetId` is `Restrict`). */
export async function deleteOffer(ownerId: string, offerId: string): Promise<void> {
  await assertOfferOwner(ownerId, offerId);
  const soldSets = await prisma.saleLine.count({ where: { offerSet: { offerId } } });
  if (soldSets > 0) {
    throw new OfferActionBlockedError(
      "sold-set",
      "This offer has sold sets and cannot be deleted. Withdraw it instead."
    );
  }
  await prisma.offer.delete({ where: { id: offerId } });
}

/** Verify copies are addable to a set: they belong to the collection and have not already sold.
 * Returns the valid, addable ids. */
async function assertAddableCopies(collectionId: string, itemIds: string[]): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const valid = await prisma.item.findMany({
    where: { id: { in: itemIds }, collectionId },
    select: { id: true },
  });
  const validIds = new Set(valid.map((v) => v.id));
  const sold = await prisma.saleLineItem.findMany({
    where: { itemId: { in: [...validIds] } },
    select: { itemId: true },
  });
  const soldIds = new Set(sold.map((r) => r.itemId));
  return [...validIds].filter((id) => !soldIds.has(id));
}

/** Add one set (holding `itemIds`, sold together) to an offer. A single copy makes a single-item
 * set; several copies make a komplet. Returns the new set id. */
export async function addOfferSet(
  ownerId: string,
  offerId: string,
  itemIds: string[],
  title?: string | null
): Promise<string> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (isTerminalState(ref.state)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.state} offer is read-only.`);
  }
  const addable = await assertAddableCopies(ref.collectionId, itemIds);
  if (addable.length === 0) {
    throw new OfferActionBlockedError("empty", "Add at least one available copy to the set.");
  }
  const set = await prisma.offerSet.create({
    data: {
      offerId,
      title: title?.trim() || null,
      items: { create: addable.map((itemId) => ({ itemId })) },
    },
    select: { id: true },
  });
  return set.id;
}

/** Add each copy as its **own** single-item set — the fast path for a stock of duplicates (a
 * "quantity" listing of interchangeable singles). Returns the new set ids. */
export async function addOfferSetsPerCopy(
  ownerId: string,
  offerId: string,
  itemIds: string[]
): Promise<string[]> {
  const ref = await assertOfferOwner(ownerId, offerId);
  if (isTerminalState(ref.state)) {
    throw new OfferActionBlockedError("terminal", `A ${ref.state} offer is read-only.`);
  }
  const addable = await assertAddableCopies(ref.collectionId, itemIds);
  if (addable.length === 0) {
    throw new OfferActionBlockedError("empty", "Add at least one available copy.");
  }
  const ids: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const itemId of addable) {
      const set = await tx.offerSet.create({
        data: { offerId, items: { create: [{ itemId }] } },
        select: { id: true },
      });
      ids.push(set.id);
    }
  });
  return ids;
}

/** Rename a set (its label falls back to its copies when blank). */
export async function updateOfferSet(ownerId: string, setId: string, title: string | null): Promise<void> {
  await assertOfferSetOwner(ownerId, setId);
  await prisma.offerSet.update({ where: { id: setId }, data: { title: title?.trim() || null } });
}

/** Remove a set from its offer (its copies stay in inventory). This is the coordination action —
 * removing a set whose copy sold elsewhere decrements the listing. Blocked once the set itself has
 * sold (`sale_line.offerSetId` is `Restrict`). */
export async function removeOfferSet(ownerId: string, setId: string): Promise<void> {
  await assertOfferSetOwner(ownerId, setId);
  const soldLines = await prisma.saleLine.count({ where: { offerSetId: setId } });
  if (soldLines > 0) {
    throw new OfferActionBlockedError(
      "sold-set",
      "This set has sold and cannot be removed — its sale record references it."
    );
  }
  await prisma.offerSet.delete({ where: { id: setId } });
}
