import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma, type DbTransaction } from "./db";
import { buildLocationPath } from "./location-path";
import { buildLocationCode } from "./location-code";
import { intakeDocumentName } from "./purchase-kind";
import { formatEntityNo } from "./quick-jump";
import {
  locationMoveDirection,
  locationSubtreeIds,
  moveDayRange,
  type LocationMoveDirection,
  type LocationMoveSource,
} from "./location-move-rules";

// A copy's moves between locations (#2277, ADR-0074). The entries are written by the database — the
// `item_record_location_move` trigger, on every insert of a copy and every change of its location or
// ref — so this module never writes one. It does three things: it tells the trigger *what* is moving
// the copies of the current transaction (`setMoveSourceTx`), it takes copies that are leaving off
// their locations (`takeOffLocationTx`, #2278), and it reads the history back, for a copy and for a
// location.

/** What is moving copies: the source an entry records, and what it names where it names one — the
 *  purchase for `purchase`, the sale for `sale_packing`, the trade for `trade_packing`. */
export interface MoveSource {
  source: LocationMoveSource;
  sourceId?: string | null;
}

/**
 * Name what the rest of this transaction moves copies by. The settings are transaction-local
 * (`set_config(…, true)`), so they end with the transaction and can never leak to the next write on
 * the pooled connection — which is also why this only means anything **inside** a `$transaction`:
 * outside one, the setting would end with this statement. A transaction that moves copies by two
 * acts calls it again between them.
 */
export async function setMoveSourceTx(tx: DbTransaction, move: MoveSource): Promise<void> {
  await tx.$executeRaw`SELECT set_config('stamporama.move_source', ${move.source}, true),
                              set_config('stamporama.move_source_id', ${move.sourceId ?? ""}, true)`;
}

/**
 * Take copies off their locations because they are leaving (#2278): packed for a sale, packed for a
 * trade they are given away in, written off. Location and ref are both cleared, so a location counts
 * only the copies physically in it, and the trigger records where each one was taken from — which is
 * what the packing list reads back ({@link packedFromPlaces}). A copy already off its location is
 * left alone, so it gains no entry. Nothing ever puts a copy back: unpacked or come back, it is filed
 * anew.
 */
export async function takeOffLocationTx(
  tx: DbTransaction,
  where: Prisma.ItemWhereInput,
  move: MoveSource
): Promise<void> {
  await setMoveSourceTx(tx, move);
  await tx.item.updateMany({
    where: { AND: [where, { OR: [{ locationId: { not: null } }, { locationRef: { not: null } }] }] },
    data: { locationId: null, locationRef: null },
  });
}

/**
 * Where packed copies were taken from (#2278): for each copy given that is off its location, the
 * place its latest entry took it off — a location still there, and the ref it had. A packing list
 * keeps saying where to pull each copy from with it, so a stamp found missing from the parcel can
 * still be looked for where it was. A copy taken off a location since deleted has no place to name.
 */
export async function packedFromPlaces(
  collectionId: string,
  itemIds: readonly string[]
): Promise<Map<string, { locationId: string; locationRef: string | null }>> {
  if (itemIds.length === 0) return new Map();
  const rows = await prisma.itemLocationMove.findMany({
    where: {
      collectionId,
      itemId: { in: [...itemIds] },
      toLocationId: null,
      fromLocationId: { not: null },
    },
    orderBy: NEWEST_FIRST,
    select: { itemId: true, fromLocationId: true, fromRef: true },
  });
  const places = new Map<string, { locationId: string; locationRef: string | null }>();
  for (const r of rows) {
    if (!places.has(r.itemId)) {
      places.set(r.itemId, { locationId: r.fromLocationId!, locationRef: r.fromRef });
    }
  }
  return places;
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** One end of a move. `locationId` is null for *no location*, and for a location since deleted —
 *  which `name` then still names. */
export interface LocationMovePlace {
  locationId: string | null;
  /** The location's path as it reads now (`Szafa 1 › Klaser A`), or its name when it was written
   *  for a location since deleted; null for no location. */
  label: string | null;
  /** The location's full code now (#2235); null for no location or a deleted one. */
  code: string | null;
  /** True when the entry named a location that has since been deleted. */
  deleted: boolean;
  ref: string | null;
}

/** A purchase, a sale or a trade an entry names, as its link reads. */
export interface LocationMoveNamed {
  kind: "purchase" | "sale" | "trade";
  id: string;
  label: string;
}

export interface LocationMoveEntry {
  id: string;
  /** ISO timestamp. */
  movedAt: string;
  from: LocationMovePlace;
  to: LocationMovePlace;
  source: LocationMoveSource;
  /** What the entry names, when it still exists: the purchase of a `purchase` entry, the sale of a
   *  `sale_packing` one, the trade of a `trade_packing` one. */
  named: LocationMoveNamed | null;
  copy: { id: string; itemNo: number; stampName: string | null };
}

export interface LocationHistoryEntry extends LocationMoveEntry {
  /** Which way it went, seen from the location asked about and everything under it. */
  direction: LocationMoveDirection;
}

const ENTRY_SELECT = {
  id: true,
  movedAt: true,
  fromLocationId: true,
  fromLocationName: true,
  fromRef: true,
  toLocationId: true,
  toLocationName: true,
  toRef: true,
  source: true,
  sourceId: true,
  item: { select: { id: true, itemNo: true, stamp: { select: { name: true } } } },
} satisfies Prisma.ItemLocationMoveSelect;

type EntryRow = Prisma.ItemLocationMoveGetPayload<{ select: typeof ENTRY_SELECT }>;

type LocationNode = { id: string; name: string; code: string; parentId: string | null };

async function collectionLocations(collectionId: string): Promise<LocationNode[]> {
  return prisma.location.findMany({
    where: { collectionId },
    select: { id: true, name: true, code: true, parentId: true },
  });
}

function place(
  locations: LocationNode[],
  locationId: string | null,
  name: string | null,
  ref: string | null
): LocationMovePlace {
  if (locationId) {
    return {
      locationId,
      label: buildLocationPath(locations, locationId) ?? name,
      code: buildLocationCode(locations, locationId),
      deleted: false,
      ref,
    };
  }
  // An entry naming a location carries its name; one whose id is gone named a deleted location.
  return { locationId: null, label: name, code: null, deleted: name != null, ref };
}

const NAMED_KIND: Partial<Record<LocationMoveSource, LocationMoveNamed["kind"]>> = {
  purchase: "purchase",
  sale_packing: "sale",
  trade_packing: "trade",
};

function idsNaming(rows: EntryRow[], kind: LocationMoveNamed["kind"]): string[] {
  return [
    ...new Set(rows.filter((r) => NAMED_KIND[r.source] === kind && r.sourceId).map((r) => r.sourceId!)),
  ];
}

/** What the entries name, keyed by kind and id: a purchase labelled as the copy's own Purchase card
 *  labels its order, a sale by its number and platform, a trade by its number and partner. */
async function namedLabels(collectionId: string, rows: EntryRow[]): Promise<Map<string, string>> {
  const purchaseIds = idsNaming(rows, "purchase");
  const saleIds = idsNaming(rows, "sale");
  const tradeIds = idsNaming(rows, "trade");
  const [purchases, sales, trades] = await Promise.all([
    purchaseIds.length === 0
      ? []
      : prisma.purchase.findMany({
          where: { id: { in: purchaseIds }, collectionId },
          select: { id: true, kind: true, title: true, purchasedAt: true, contact: { select: { name: true } } },
        }),
    saleIds.length === 0
      ? []
      : prisma.sale.findMany({
          where: { id: { in: saleIds }, collectionId },
          select: { id: true, saleNo: true, platform: { select: { name: true } } },
        }),
    tradeIds.length === 0
      ? []
      : prisma.trade.findMany({
          where: { id: { in: tradeIds }, collectionId },
          select: { id: true, tradeNo: true, partner: { select: { name: true } } },
        }),
  ]);
  const labels = new Map<string, string>();
  for (const p of purchases) {
    const date = p.purchasedAt.toISOString().slice(0, 10);
    const name = intakeDocumentName({
      kind: p.kind,
      title: p.title,
      contactName: p.contact?.name ?? null,
    });
    labels.set(`purchase:${p.id}`, name ? `${name} · ${date}` : date);
  }
  for (const sale of sales) {
    labels.set(`sale:${sale.id}`, `${formatEntityNo(sale.saleNo)} · ${sale.platform.name}`);
  }
  for (const t of trades) {
    labels.set(`trade:${t.id}`, `${formatEntityNo(t.tradeNo)} · ${t.partner.name}`);
  }
  return labels;
}

function toEntry(
  row: EntryRow,
  locations: LocationNode[],
  labels: Map<string, string>
): LocationMoveEntry {
  const kind = NAMED_KIND[row.source];
  const label = kind && row.sourceId ? labels.get(`${kind}:${row.sourceId}`) : undefined;
  return {
    id: row.id,
    movedAt: row.movedAt.toISOString(),
    from: place(locations, row.fromLocationId, row.fromLocationName, row.fromRef),
    to: place(locations, row.toLocationId, row.toLocationName, row.toRef),
    source: row.source,
    named: kind && label ? { kind, id: row.sourceId!, label } : null,
    copy: { id: row.item.id, itemNo: row.item.itemNo, stampName: row.item.stamp.name },
  };
}

// Newest first; the id breaks a tie between two entries of one instant, so a page boundary never
// drops or repeats one.
const NEWEST_FIRST = [{ movedAt: "desc" }, { id: "desc" }] satisfies Prisma.ItemLocationMoveOrderByWithRelationInput[];

/** Where one copy has been, newest first. A copy has few moves, so they are read whole. */
export async function getCopyLocationMoves(
  ownerId: string,
  collectionId: string,
  itemId: string
): Promise<LocationMoveEntry[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const [rows, locations] = await Promise.all([
    prisma.itemLocationMove.findMany({
      where: { collectionId, itemId },
      orderBy: NEWEST_FIRST,
      select: ENTRY_SELECT,
    }),
    collectionLocations(collectionId),
  ]);
  const labels = await namedLabels(collectionId, rows);
  return rows.map((r) => toEntry(r, locations, labels));
}

export interface LocationHistoryQuery {
  /** Only entries with this ref at the location's end of them, letter case aside. */
  ref?: string | null;
  /** `YYYY-MM-DD`, both ends whole days, either open. */
  from?: string | null;
  to?: string | null;
  cursor?: string | null;
  pageSize?: number;
}

export interface LocationHistoryPage {
  items: LocationHistoryEntry[];
  nextCursor: string | null;
}

/**
 * What came into a location and what left it, newest first, a page at a time: a location holds as
 * many starting entries as it held copies on the day the history began, so it is not read whole. A
 * location that groups others answers for everything under it.
 */
export async function listLocationHistory(
  ownerId: string,
  collectionId: string,
  locationId: string,
  query: LocationHistoryQuery = {}
): Promise<LocationHistoryPage> {
  await assertCollectionOwner(ownerId, collectionId);
  const locations = await collectionLocations(collectionId);
  if (!locations.some((l) => l.id === locationId)) {
    throw new Error("Location not found or access denied.");
  }
  const subtree = locationSubtreeIds(locations, locationId);
  const subtreeSet = new Set(subtree);
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

  // The ref is matched at the end of the entry that is in the location: a copy that left card 12
  // for another box is found under 12, and one that came onto card 12 from elsewhere too.
  const ref = query.ref?.trim() || null;
  const refEquals = ref ? { equals: ref, mode: "insensitive" as const } : undefined;
  const ends: Prisma.ItemLocationMoveWhereInput[] = [
    { fromLocationId: { in: subtree }, ...(refEquals ? { fromRef: refEquals } : {}) },
    { toLocationId: { in: subtree }, ...(refEquals ? { toRef: refEquals } : {}) },
  ];
  const range = moveDayRange(query.from ?? null, query.to ?? null);

  const rows = await prisma.itemLocationMove.findMany({
    where: {
      collectionId,
      OR: ends,
      ...(range.gte || range.lt ? { movedAt: range } : {}),
    },
    orderBy: NEWEST_FIRST,
    select: ENTRY_SELECT,
    take: pageSize + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, pageSize);
  const labels = await namedLabels(collectionId, page);
  return {
    items: page.map((r) => ({
      ...toEntry(r, locations, labels),
      // Never null: every row read touches the subtree at one end or the other.
      direction: locationMoveDirection(r, subtreeSet) ?? "within",
    })),
    nextCursor: rows.length > pageSize ? page[page.length - 1].id : null,
  };
}
