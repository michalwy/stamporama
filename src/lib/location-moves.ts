import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma, type DbTransaction } from "./db";
import { buildLocationPath } from "./location-path";
import { buildLocationCode } from "./location-code";
import { intakeDocumentName } from "./purchase-kind";
import {
  locationMoveDirection,
  locationSubtreeIds,
  moveDayRange,
  type LocationMoveDirection,
  type LocationMoveSource,
} from "./location-move-rules";

// A copy's moves between locations (#2277, ADR-0074). The entries are written by the database — the
// `item_record_location_move` trigger, on every insert of a copy and every change of its location or
// ref — so this module never writes one. It does two things: it tells the trigger *what* is moving
// the copies of the current transaction (`setMoveSourceTx`), and it reads the history back, for a
// copy and for a location.

/** What is moving copies: the source an entry records, and what it names where it names one — the
 *  purchase, for `purchase`. */
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

export interface LocationMoveEntry {
  id: string;
  /** ISO timestamp. */
  movedAt: string;
  from: LocationMovePlace;
  to: LocationMovePlace;
  source: LocationMoveSource;
  /** The purchase a `purchase` entry names, when it still exists. */
  purchase: { id: string; label: string } | null;
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

/** The purchases the entries name, labelled as the copy's own Purchase card labels its order. */
async function purchaseLabels(
  collectionId: string,
  rows: EntryRow[]
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(rows.filter((r) => r.source === "purchase" && r.sourceId).map((r) => r.sourceId!)),
  ];
  if (ids.length === 0) return new Map();
  const purchases = await prisma.purchase.findMany({
    where: { id: { in: ids }, collectionId },
    select: { id: true, kind: true, title: true, purchasedAt: true, contact: { select: { name: true } } },
  });
  return new Map(
    purchases.map((p) => {
      const date = p.purchasedAt.toISOString().slice(0, 10);
      const name = intakeDocumentName({
        kind: p.kind,
        title: p.title,
        contactName: p.contact?.name ?? null,
      });
      return [p.id, name ? `${name} · ${date}` : date];
    })
  );
}

function toEntry(
  row: EntryRow,
  locations: LocationNode[],
  purchases: Map<string, string>
): LocationMoveEntry {
  const purchaseLabel = row.source === "purchase" && row.sourceId ? purchases.get(row.sourceId) : undefined;
  return {
    id: row.id,
    movedAt: row.movedAt.toISOString(),
    from: place(locations, row.fromLocationId, row.fromLocationName, row.fromRef),
    to: place(locations, row.toLocationId, row.toLocationName, row.toRef),
    source: row.source,
    purchase: purchaseLabel ? { id: row.sourceId!, label: purchaseLabel } : null,
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
  const purchases = await purchaseLabels(collectionId, rows);
  return rows.map((r) => toEntry(r, locations, purchases));
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
  const purchases = await purchaseLabels(collectionId, page);
  return {
    items: page.map((r) => ({
      ...toEntry(r, locations, purchases),
      // Never null: every row read touches the subtree at one end or the other.
      direction: locationMoveDirection(r, subtreeSet) ?? "within",
    })),
    nextCursor: rows.length > pageSize ? page[page.length - 1].id : null,
  };
}
