import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma, type DbTransaction } from "./db";
import { stampLabel } from "./items";
import { DEFAULT_ITEM_NO_PAD, formatItemNo } from "./item-number";
import { buildLocationPath } from "./location-path";
import type { PhotoSummary, PhotoRole } from "./photos";
import { TRADED_AWAY_LINE } from "./trade-exit";
import { heldCopiesWhere } from "./copy-counts";
import {
  compareReplacementPlace,
  copyMootReason,
  pairMootReason,
  replacementConflict,
  type MootReason,
  type ReplacementCopyState,
  type ReplacementSide,
  type ReplacementStatus,
} from "./replacement-rules";

// Replacement pairs (#1936, ADR-0070): a new copy replacing an old one, recorded once and settled on
// the Replacements screen. Every rule that needs no database is in `replacement-rules.ts`.
//
// **A pair closes as moot on read, not on the write that made it moot.** A copy leaves the
// collector's hands along four paths — sold (a dozen sale importers and the manual sale), traded
// away (a trade closing), disposed of, deleted — and hooking each of them is a hook that the next
// importer forgets. Instead every read and write here first closes the open pairs one of whose
// copies has gone ({@link closeMootReplacements}), so whatever the screen shows is already true, and
// a copy whose partner was sold is free to be paired again.

type Db = typeof prisma | DbTransaction;

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function itemNoPad(db: Db, collectionId: string): Promise<number> {
  const col = await db.collection.findUnique({
    where: { id: collectionId },
    select: { itemNoPad: true },
  });
  return col?.itemNoPad ?? DEFAULT_ITEM_NO_PAD;
}

/** What the moot test reads of a copy: whether it was sold, traded away or disposed of. */
const COPY_STATE_SELECT = {
  disposedAt: true,
  saleLineItems: { select: { saleLineId: true }, take: 1 },
  tradeLines: { where: TRADED_AWAY_LINE, select: { id: true }, take: 1 },
} satisfies Prisma.ItemSelect;

function copyState(
  row: {
    disposedAt: Date | null;
    saleLineItems: { saleLineId: string }[];
    tradeLines: { id: string }[];
  } | null
): ReplacementCopyState | null {
  if (!row) return null;
  return {
    sold: row.saleLineItems.length > 0,
    tradedAway: row.tradeLines.length > 0,
    disposed: row.disposedAt != null,
  };
}

/**
 * Close every open pair in the collection one of whose copies has left the collector's hands —
 * sold, traded away, disposed of or deleted — as moot, recording why and through which copy.
 * Returns how many it closed.
 */
export async function closeMootReplacements(db: Db, collectionId: string): Promise<number> {
  const open = await db.itemReplacement.findMany({
    where: { collectionId, status: "open" },
    select: {
      id: true,
      newItem: { select: COPY_STATE_SELECT },
      oldItem: { select: COPY_STATE_SELECT },
    },
  });
  const now = new Date();
  let closed = 0;
  for (const pair of open) {
    const moot = pairMootReason(copyState(pair.newItem), copyState(pair.oldItem));
    if (!moot) continue;
    // Conditional on still being open, so two reads racing to close the same pair close it once.
    const { count } = await db.itemReplacement.updateMany({
      where: { id: pair.id, status: "open" },
      data: { status: "moot", mootReason: moot.reason, mootSide: moot.side, closedAt: now },
    });
    closed += count;
  }
  return closed;
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** One copy of a pair as the screen draws it. */
export interface ReplacementCopyData {
  id: string;
  itemNo: number;
  stampId: string;
  stampLabel: string;
  conditionId: string;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  locationId: string | null;
  /** Where the copy lies: the location's full path, or null when it is stored nowhere. */
  locationPath: string | null;
  locationRef: string | null;
  photos: PhotoSummary[];
}

export interface ReplacementPairData {
  id: string;
  status: ReplacementStatus;
  mootReason: MootReason | null;
  mootSide: ReplacementSide | null;
  newItemNo: number;
  oldItemNo: number;
  /** Null once the copy has been deleted; the pair still names it by number. */
  newCopy: ReplacementCopyData | null;
  oldCopy: ReplacementCopyData | null;
  createdAt: string;
  closedAt: string | null;
}

const COPY_SELECT = {
  id: true,
  itemNo: true,
  stampId: true,
  conditionId: true,
  inCollection: true,
  forSale: true,
  forTrade: true,
  locationId: true,
  locationRef: true,
  stamp: { select: { name: true, catalogNumbers: { select: { number: true } } } },
  photos: {
    select: { id: true, role: true, title: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  },
} satisfies Prisma.ItemSelect;

type CopyRow = Prisma.ItemGetPayload<{ select: typeof COPY_SELECT }>;

const PAIR_SELECT = {
  id: true,
  status: true,
  mootReason: true,
  mootSide: true,
  newItemNo: true,
  oldItemNo: true,
  createdAt: true,
  closedAt: true,
  newItem: { select: COPY_SELECT },
  oldItem: { select: COPY_SELECT },
} satisfies Prisma.ItemReplacementSelect;

type PairRow = Prisma.ItemReplacementGetPayload<{ select: typeof PAIR_SELECT }>;

async function loadLocations(db: Db, collectionId: string) {
  return db.location.findMany({
    where: { collectionId },
    select: { id: true, name: true, parentId: true },
  });
}

function toCopy(
  row: CopyRow | null,
  locations: { id: string; name: string; parentId: string | null }[]
): ReplacementCopyData | null {
  if (!row) return null;
  return {
    id: row.id,
    itemNo: row.itemNo,
    stampId: row.stampId,
    stampLabel: stampLabel(row.stamp),
    conditionId: row.conditionId,
    inCollection: row.inCollection,
    forSale: row.forSale,
    forTrade: row.forTrade,
    locationId: row.locationId,
    locationPath: buildLocationPath(locations, row.locationId),
    locationRef: row.locationRef,
    photos: row.photos.map((p) => ({
      id: p.id,
      role: p.role as PhotoRole,
      title: p.title,
      sortOrder: p.sortOrder,
    })),
  };
}

function toPair(
  row: PairRow,
  locations: { id: string; name: string; parentId: string | null }[]
): ReplacementPairData {
  return {
    id: row.id,
    status: row.status as ReplacementStatus,
    mootReason: row.mootReason as MootReason | null,
    mootSide: row.mootSide as ReplacementSide | null,
    newItemNo: row.newItemNo,
    oldItemNo: row.oldItemNo,
    newCopy: toCopy(row.newItem, locations),
    oldCopy: toCopy(row.oldItem, locations),
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

/** How many closed pairs the screen shows under the open ones — the recent history, so a pair that
 * just closed as moot can be seen to have closed, not the whole archive. */
export const RECENT_CLOSED_PAIRS = 50;

export interface ReplacementsData {
  /** Open pairs, in the order to walk the storage in: by where the old copy lies. */
  open: ReplacementPairData[];
  /** The most recently closed pairs, newest first. */
  closed: ReplacementPairData[];
}

/** The Replacements screen: open pairs (moot ones closed first) and the recently closed. */
export async function listReplacements(
  ownerId: string,
  collectionId: string
): Promise<ReplacementsData> {
  await assertCollectionOwner(ownerId, collectionId);
  await closeMootReplacements(prisma, collectionId);
  const [openRows, closedRows, locations] = await Promise.all([
    prisma.itemReplacement.findMany({
      where: { collectionId, status: "open" },
      select: PAIR_SELECT,
    }),
    prisma.itemReplacement.findMany({
      where: { collectionId, status: { not: "open" } },
      select: PAIR_SELECT,
      orderBy: [{ closedAt: "desc" }, { id: "asc" }],
      take: RECENT_CLOSED_PAIRS,
    }),
    loadLocations(prisma, collectionId),
  ]);
  const open = openRows
    .map((r) => toPair(r, locations))
    .sort((a, b) =>
      compareReplacementPlace(
        {
          locationPath: a.oldCopy?.locationPath ?? null,
          locationRef: a.oldCopy?.locationRef ?? null,
          oldItemNo: a.oldItemNo,
        },
        {
          locationPath: b.oldCopy?.locationPath ?? null,
          locationRef: b.oldCopy?.locationRef ?? null,
          oldItemNo: b.oldItemNo,
        }
      )
    );
  return { open, closed: closedRows.map((r) => toPair(r, locations)) };
}

/** Every pair a copy is in, on either side, newest first — its replacement history. */
export async function listCopyReplacements(
  ownerId: string,
  collectionId: string,
  itemId: string
): Promise<ReplacementPairData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  await closeMootReplacements(prisma, collectionId);
  const [rows, locations] = await Promise.all([
    prisma.itemReplacement.findMany({
      where: { collectionId, OR: [{ newItemId: itemId }, { oldItemId: itemId }] },
      select: PAIR_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
    loadLocations(prisma, collectionId),
  ]);
  return rows.map((r) => toPair(r, locations));
}

/** A copy that could be the other half of a pair, with why it cannot when it cannot. */
export interface ReplacementCandidateData extends ReplacementCopyData {
  /** Why this copy cannot be chosen — already in an open pair on that side — or null. */
  unavailable: string | null;
}

/**
 * The copies that could pair with `itemId` on the other side: the collection's other held copies of
 * the same stamp. `side` is the side **`itemId`** takes — `new` asks *which copy does this one
 * replace*, `old` asks *which copy replaces this one*. A copy already in an open pair on the side it
 * would take is listed but unavailable, so the collector sees why it cannot be chosen.
 */
export async function listReplacementCandidates(
  ownerId: string,
  collectionId: string,
  itemId: string,
  side: ReplacementSide
): Promise<ReplacementCandidateData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  await closeMootReplacements(prisma, collectionId);
  const item = await prisma.item.findFirst({
    where: { id: itemId, collectionId },
    select: { stampId: true },
  });
  if (!item) throw new Error("Copy not found.");
  const [rows, locations, pad] = await Promise.all([
    prisma.item.findMany({
      where: { ...heldCopiesWhere(collectionId, [item.stampId]), id: { not: itemId } },
      select: {
        ...COPY_SELECT,
        replaces: { where: { status: "open" }, select: { oldItemNo: true } },
        replacedBy: { where: { status: "open" }, select: { newItemNo: true } },
      },
      orderBy: { itemNo: "asc" },
    }),
    loadLocations(prisma, collectionId),
    itemNoPad(prisma, collectionId),
  ]);
  const label = (n: number) => formatItemNo(n, pad);
  return (
    rows
      .map((row) => {
        // The candidate takes the other side: the old copy when `itemId` is new, and vice versa.
        const takenAsOld = side === "new" ? row.replacedBy[0] : undefined;
        const takenAsNew = side === "old" ? row.replaces[0] : undefined;
        const unavailable = takenAsOld
          ? `Already being replaced by ${label(takenAsOld.newItemNo)}`
          : takenAsNew
            ? `Already replaces ${label(takenAsNew.oldItemNo)}`
            : null;
        return { ...toCopy(row, locations)!, unavailable };
      })
      // The copies in the collection first: they are what a new copy replaces.
      .sort((a, b) => Number(b.inCollection) - Number(a.inCollection) || a.itemNo - b.itemNo)
  );
}

// ── Writing ──────────────────────────────────────────────────────────────────

export class ReplacementError extends Error {}

/** Record that `newItemId` replaces `oldItemId`. Moves nothing. */
export async function recordReplacement(
  ownerId: string,
  collectionId: string,
  input: { newItemId: string; oldItemId: string }
): Promise<{ id: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.$transaction(async (tx) => {
    await closeMootReplacements(tx, collectionId);
    const select = {
      id: true,
      itemNo: true,
      ...COPY_STATE_SELECT,
      replaces: { where: { status: "open" as const }, select: { id: true } },
      replacedBy: { where: { status: "open" as const }, select: { id: true } },
    } satisfies Prisma.ItemSelect;
    const [newRow, oldRow, pad] = await Promise.all([
      tx.item.findFirst({ where: { id: input.newItemId, collectionId }, select }),
      tx.item.findFirst({ where: { id: input.oldItemId, collectionId }, select }),
      itemNoPad(tx, collectionId),
    ]);
    if (!newRow || !oldRow) throw new ReplacementError("Copy not found.");
    const conflict = replacementConflict({
      newCopy: {
        itemNo: newRow.itemNo,
        gone: copyMootReason(copyState(newRow)),
        openAsNew: newRow.replaces.length > 0,
      },
      oldCopy: {
        itemNo: oldRow.itemNo,
        gone: copyMootReason(copyState(oldRow)),
        openAsOld: oldRow.replacedBy.length > 0,
      },
      copyLabel: (n) => formatItemNo(n, pad),
    });
    if (conflict) throw new ReplacementError(conflict);
    return tx.itemReplacement.create({
      data: {
        collectionId,
        newItemId: newRow.id,
        oldItemId: oldRow.id,
        newItemNo: newRow.itemNo,
        oldItemNo: oldRow.itemNo,
      },
      select: { id: true },
    });
  });
}

/** Withdraw an open pair. Neither copy is touched. */
export async function cancelReplacement(
  ownerId: string,
  collectionId: string,
  pairId: string
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.$transaction(async (tx) => {
    await closeMootReplacements(tx, collectionId);
    const { count } = await tx.itemReplacement.updateMany({
      where: { id: pairId, collectionId, status: "open" },
      data: { status: "cancelled", closedAt: new Date() },
    });
    if (count === 0) throw new ReplacementError("This replacement is no longer open.");
  });
}

/** The sale card the old copies go onto: an assignable location and, optionally, a ref on it. */
export interface CurrentCard {
  locationId: string;
  locationRef: string | null;
}

export interface SettleResult {
  /** Pairs settled now. */
  done: number;
  /** Pairs asked for that were no longer open — closed as moot meanwhile, or settled elsewhere. */
  skipped: number;
}

/**
 * **Done** on one or several pairs: each old copy goes onto the current card, out of the collection
 * and for sale; the pair is closed as done. Only the old copy's location, ref and those two
 * dispositions change — condition, photos and number stay — and the new copy is not touched.
 */
export async function settleReplacements(
  ownerId: string,
  collectionId: string,
  pairIds: string[],
  card: CurrentCard
): Promise<SettleResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const ids = [...new Set(pairIds)];
  if (ids.length === 0) return { done: 0, skipped: 0 };
  const location = await prisma.location.findFirst({
    where: { id: card.locationId, collectionId },
    select: { assignable: true },
  });
  if (!location) throw new ReplacementError("Location not found.");
  if (!location.assignable) {
    throw new ReplacementError("That location only groups others — choose one that holds copies.");
  }
  const locationRef = card.locationRef?.trim() || null;

  return prisma.$transaction(async (tx) => {
    await closeMootReplacements(tx, collectionId);
    const pairs = await tx.itemReplacement.findMany({
      where: { id: { in: ids }, collectionId, status: "open" },
      select: { id: true, oldItemId: true },
    });
    const now = new Date();
    for (const pair of pairs) {
      // Never null on an open pair: a deleted copy has just closed it as moot above.
      await tx.item.update({
        where: { id: pair.oldItemId! },
        data: { locationId: card.locationId, locationRef, inCollection: false, forSale: true },
      });
      await tx.itemReplacement.update({
        where: { id: pair.id },
        data: { status: "done", closedAt: now },
      });
    }
    return { done: pairs.length, skipped: ids.length - pairs.length };
  });
}
