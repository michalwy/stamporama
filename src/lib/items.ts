import "server-only";
import { prisma } from "./db";
import {
  buildEffectivePrimaryCatalogMap,
  getCollectionBaseCurrency,
  safeRateMap,
} from "./pricing";
import type { RawCatalogPrice } from "./catalog-price";
import {
  valuateCopy,
  aggregateHoldings,
  type CopyValuation,
  type HoldingsSummary,
} from "./valuation";
import { aggregateCostBasis, type CostBasisInput } from "./cost-basis";
import { childIsVariant, VARIANT_FLAG_SELECT } from "./variant-classification";
import { deletePhotoBytesForItem, sortPhotos, type PhotoSummary } from "./photos";

// Server-side CRUD for physical copies (`Item`), collection-scoped. See ADR-0007
// and #98. One Item row per physical copy owned; `stampId` links to a stamp at any
// variant-tree level (base = unknown variant, variant row = identified). Updating
// `stampId` re-points the copy in place and appends an `ItemVariantHistory` row in
// the same transaction (variant refinement, ADR-0007 §6).

async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function resolveItemCollection(itemId: string): Promise<string> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { collectionId: true },
  });
  if (!item) throw new Error("Item not found.");
  return item.collectionId;
}

/** Every referenced entity (stamp, condition, certificate status) must live in the
 * same collection as the item, otherwise a copy could point at another user's data. */
async function assertStampInCollection(collectionId: string, stampId: string): Promise<void> {
  const stamp = await prisma.stamp.findFirst({
    where: { id: stampId, collectionId },
    select: { id: true },
  });
  if (!stamp) throw new Error("Stamp not found in this collection.");
}

async function assertConditionInCollection(
  collectionId: string,
  conditionId: string
): Promise<void> {
  const condition = await prisma.stampCondition.findFirst({
    where: { id: conditionId, collectionId },
    select: { id: true },
  });
  if (!condition) throw new Error("Condition not found in this collection.");
}

async function assertCertificateStatusInCollection(
  collectionId: string,
  certificateStatusId: string
): Promise<void> {
  const cert = await prisma.certificateStatus.findFirst({
    where: { id: certificateStatusId, collectionId },
    select: { id: true },
  });
  if (!cert) throw new Error("Certificate status not found in this collection.");
}

/** A copy can only be filed in a location that lives in the same collection and is
 * marked `assignable` (grouping-only nodes cannot hold copies, #56). */
async function assertLocationAssignable(
  collectionId: string,
  locationId: string
): Promise<void> {
  const location = await prisma.location.findFirst({
    where: { id: locationId, collectionId },
    select: { assignable: true },
  });
  if (!location) throw new Error("Location not found in this collection.");
  if (!location.assignable) {
    throw new Error("This location cannot hold copies. Pick an assignable location.");
  }
}

/** The set of a location's own id plus every descendant id, for subtree filtering
 * ("show all copies in Klaser A", including nested locations). Built from one flat
 * read of the collection's locations. */
async function resolveLocationSubtree(
  collectionId: string,
  locationId: string
): Promise<string[]> {
  const all = await prisma.location.findMany({
    where: { collectionId },
    select: { id: true, parentId: true },
  });
  const childrenByParent = new Map<string, string[]>();
  for (const l of all) {
    if (!l.parentId) continue;
    const arr = childrenByParent.get(l.parentId) ?? [];
    arr.push(l.id);
    childrenByParent.set(l.parentId, arr);
  }
  const ids = new Set<string>([locationId]);
  const queue = [locationId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const child of childrenByParent.get(id) ?? []) {
      if (!ids.has(child)) {
        ids.add(child);
        queue.push(child);
      }
    }
  }
  return [...ids];
}

export interface ItemData {
  id: string;
  collectionId: string;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  /** Acquisition link: the `PurchaseLot` this copy came from (ADR-0009), or null when
   * the copy entered via another channel. */
  lotId: string | null;
  /** Physical delivery axis (ADR-0009 §5): in_transit | delivered | not_delivered | damaged. */
  deliveryState: string;
  /** Base-currency cost-basis snapshot (ADR-0009). Null = pending. */
  costBasis: string | null;
  notes: string | null;
  /** Assignable storage location this copy is filed in (#56), or null. */
  locationId: string | null;
  /** Free-text identifier within the location (e.g. `A234`), or null. */
  locationRef: string | null;
  createdAt: Date;
}

export interface ItemVariantHistoryData {
  id: string;
  itemId: string;
  fromStampId: string;
  toStampId: string;
  /** Display label (catalog numbers + name) of the stamp the copy was re-pointed from. */
  fromStampLabel: string;
  /** Display label of the stamp the copy was re-pointed to. */
  toStampLabel: string;
  changedAt: Date;
  note: string | null;
}

/** Build a human label for a stamp from its catalog numbers and name, mirroring the
 * client-side `stampNodeLabel`. Kept here so history can be enriched server-side. */
function stampLabel(stamp: {
  name: string | null;
  catalogNumbers: { number: string }[];
}): string {
  const cn = stamp.catalogNumbers.map((c) => c.number).join(", ");
  const parts = [cn || null, stamp.name || null].filter(Boolean);
  return parts.join(" · ") || "(unnamed)";
}

const ITEM_SELECT = {
  id: true,
  collectionId: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  inCollection: true,
  forSale: true,
  forTrade: true,
  lotId: true,
  deliveryState: true,
  costBasis: true,
  notes: true,
  locationId: true,
  locationRef: true,
  createdAt: true,
} as const;

/** Prisma row → ItemData, normalizing the Decimal cost-basis to a string so it
 * crosses the server/client boundary cleanly (mirrors catalog-price handling). */
function toItemData(row: {
  id: string;
  collectionId: string;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  lotId: string | null;
  deliveryState: string;
  costBasis: { toString(): string } | null;
  notes: string | null;
  locationId: string | null;
  locationRef: string | null;
  createdAt: Date;
}): ItemData {
  return {
    ...row,
    costBasis: row.costBasis == null ? null : row.costBasis.toString(),
  };
}

export interface ItemCreateInput {
  stampId: string;
  conditionId: string;
  certificateStatusId?: string | null;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  notes?: string | null;
  /** Assignable storage location id (#56). Must be `assignable = true`. */
  locationId?: string | null;
  locationRef?: string | null;
  /** Acquisition link: the open `PurchaseLot` this copy is being identified into during
   * intake (ADR-0009 §5, #121). When set, the lot must live in the same collection and be
   * `open`; the copy's cost-basis stays pending (null) until the lot is closed. */
  lotId?: string | null;
  /** Physical delivery axis (ADR-0009 §5): in_transit | delivered | not_delivered |
   * damaged. Defaults to `delivered` (a manually added copy is in hand); intake passes
   * `in_transit`. */
  deliveryState?: string | null;
}

/** The delivery axis values a copy may carry (ADR-0009 §5). Lifecycle for a purchased copy:
 * `ordered` (intake default, #121) → `to_sort` (arrived, awaiting sorting) → `delivered`
 * (sorted / in hand / in collection), with `not_delivered` and `damaged` as outcomes found
 * while sorting. Both `ordered` and `to_sort` stay in the lot for allocation (only
 * `not_delivered` is dropped) and keep the copy out of the collection until it is sorted. */
const VALID_DELIVERY_STATES = new Set([
  "ordered",
  "to_sort",
  "in_transit",
  "delivered",
  "not_delivered",
  "damaged",
]);

/** A lot referenced during intake must belong to this collection and be open — a copy
 * cannot be identified into another user's lot, nor into a lot whose cost is already
 * frozen (ADR-0009 §5). Returns nothing; throws with a friendly message otherwise. */
async function assertLotOpenInCollection(
  collectionId: string,
  lotId: string
): Promise<void> {
  const lot = await prisma.purchaseLot.findFirst({
    where: { id: lotId, purchase: { collectionId } },
    select: { status: true },
  });
  if (!lot) throw new Error("Lot not found in this collection.");
  if (lot.status !== "open") {
    throw new Error("This lot is closed. Reopen it before identifying more copies.");
  }
}

export interface ItemUpdateInput {
  stampId?: string;
  conditionId?: string;
  certificateStatusId?: string | null;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  notes?: string | null;
  /** Assignable storage location id (#56). Must be `assignable = true`. */
  locationId?: string | null;
  locationRef?: string | null;
  /** Physical delivery axis (ADR-0009 §5): ordered | to_sort | in_transit | delivered |
   * not_delivered | damaged. Ignored when not one of those. */
  deliveryState?: string | null;
  /** Optional reason recorded on the ItemVariantHistory row when `stampId` changes. */
  variantChangeNote?: string | null;
}

export interface ItemListFilters {
  conditionId?: string;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
}

export async function createItem(
  ownerId: string,
  collectionId: string,
  data: ItemCreateInput
): Promise<ItemData> {
  await assertCollectionOwner(ownerId, collectionId);
  await assertStampInCollection(collectionId, data.stampId);
  await assertConditionInCollection(collectionId, data.conditionId);
  if (data.certificateStatusId) {
    await assertCertificateStatusInCollection(collectionId, data.certificateStatusId);
  }
  if (data.locationId) {
    await assertLocationAssignable(collectionId, data.locationId);
  }
  if (data.lotId) {
    await assertLotOpenInCollection(collectionId, data.lotId);
  }
  const deliveryState =
    data.deliveryState && VALID_DELIVERY_STATES.has(data.deliveryState)
      ? data.deliveryState
      : "delivered";
  const item = await prisma.item.create({
    data: {
      collectionId,
      stampId: data.stampId,
      conditionId: data.conditionId,
      certificateStatusId: data.certificateStatusId ?? null,
      inCollection: data.inCollection ?? true,
      forSale: data.forSale ?? false,
      forTrade: data.forTrade ?? false,
      notes: data.notes ?? null,
      locationId: data.locationId ?? null,
      // A ref only makes sense with a location; drop it when none is set.
      locationRef: data.locationId ? (data.locationRef ?? null) : null,
      lotId: data.lotId ?? null,
      deliveryState,
    },
    select: ITEM_SELECT,
  });
  return toItemData(item);
}

export async function getItem(ownerId: string, itemId: string): Promise<ItemData> {
  const collectionId = await resolveItemCollection(itemId);
  await assertCollectionOwner(ownerId, collectionId);
  const item = await prisma.item.findUniqueOrThrow({
    where: { id: itemId },
    select: ITEM_SELECT,
  });
  return toItemData(item);
}

export async function listItems(
  ownerId: string,
  collectionId: string,
  filters?: ItemListFilters
): Promise<ItemData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const items = await prisma.item.findMany({
    where: {
      collectionId,
      ...(filters?.conditionId ? { conditionId: filters.conditionId } : {}),
      ...(filters?.inCollection !== undefined ? { inCollection: filters.inCollection } : {}),
      ...(filters?.forSale !== undefined ? { forSale: filters.forSale } : {}),
      ...(filters?.forTrade !== undefined ? { forTrade: filters.forTrade } : {}),
    },
    select: ITEM_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return items.map(toItemData);
}

export async function updateItem(
  ownerId: string,
  itemId: string,
  data: ItemUpdateInput
): Promise<ItemData> {
  const current = await prisma.item.findUnique({
    where: { id: itemId },
    select: { collectionId: true, stampId: true },
  });
  if (!current) throw new Error("Item not found.");
  const collectionId = current.collectionId;
  await assertCollectionOwner(ownerId, collectionId);

  if (data.stampId !== undefined) {
    await assertStampInCollection(collectionId, data.stampId);
  }
  if (data.conditionId !== undefined) {
    await assertConditionInCollection(collectionId, data.conditionId);
  }
  if (data.certificateStatusId) {
    await assertCertificateStatusInCollection(collectionId, data.certificateStatusId);
  }
  if (data.locationId) {
    await assertLocationAssignable(collectionId, data.locationId);
  }

  const repointing =
    data.stampId !== undefined && data.stampId !== current.stampId;

  const { variantChangeNote, ...fields } = data;
  const updateData = {
    ...(fields.stampId !== undefined ? { stampId: fields.stampId } : {}),
    ...(fields.conditionId !== undefined ? { conditionId: fields.conditionId } : {}),
    ...(fields.certificateStatusId !== undefined
      ? { certificateStatusId: fields.certificateStatusId }
      : {}),
    ...(fields.inCollection !== undefined ? { inCollection: fields.inCollection } : {}),
    ...(fields.forSale !== undefined ? { forSale: fields.forSale } : {}),
    ...(fields.forTrade !== undefined ? { forTrade: fields.forTrade } : {}),
    ...(fields.deliveryState && VALID_DELIVERY_STATES.has(fields.deliveryState)
      ? { deliveryState: fields.deliveryState }
      : {}),
    ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
    ...(fields.locationId !== undefined ? { locationId: fields.locationId } : {}),
    // A ref only makes sense with a location; clear it whenever the location is
    // cleared, and only persist a ref update when a location is present.
    ...(fields.locationId !== undefined && !fields.locationId
      ? { locationRef: null }
      : fields.locationRef !== undefined
        ? { locationRef: fields.locationRef }
        : {}),
  };

  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.item.update({
      where: { id: itemId },
      data: updateData,
      select: ITEM_SELECT,
    });
    if (repointing) {
      await tx.itemVariantHistory.create({
        data: {
          itemId,
          fromStampId: current.stampId,
          toStampId: data.stampId!,
          note: variantChangeNote ?? null,
        },
      });
    }
    return updated;
  });
  return toItemData(item);
}

export type ItemSortBy = "created";

export interface ItemListFiltersPaginated extends ItemListFilters {
  certificateStatusId?: string;
  /** Restrict to copies whose linked stamp belongs to any of these areas (the selected
   * area plus its descendants, resolved by the caller). Mirrors the stamps list area
   * sidebar (#106): matched via `Item.stamp` → `StampCollectionArea`. */
  areaIds?: string[];
  /** Free-text search over the linked stamp's name, its issue name, and catalog numbers
   * (case-insensitive substring). Mirrors the stamps list search (#106). */
  search?: string;
  /** Parsed from the search box when it reads as a prefixed catalog number (#146):
   * the bare number, optionally narrowed to a vendor resolved from a leading
   * abbreviation. Matched in addition to `search` so "Mi PL 200" finds vendor Mi's
   * #200 even though the raw string isn't a substring of the stored number. */
  catalogVendorId?: string;
  catalogNumber?: string;
  /** Restrict to copies of a single stamp (used by the stamp-level inventory popup, #110). */
  stampId?: string;
  /** Restrict to copies of any stamp belonging to an issue (issue-level inventory popup, #110). */
  issueId?: string;
  /** Restrict to copies stored in this location or any of its descendants (#56). */
  locationId?: string;
  /** Restrict to copies identified into a single purchase lot (intake view, #121). */
  lotId?: string;
  /** Restrict to a fixed set of copy ids (e.g. the members of a sale lot, #164). */
  ids?: string[];
  /** Exclude a fixed set of copy ids (e.g. copies already represented in a quantity lot's
   * sub-lots, #164). */
  excludeIds?: string[];
  /** Restrict to copies in this physical delivery state (ADR-0009 §5), e.g. `"delivered"`
   * for copies actually in hand — the sale-lot composition picker only offers those (#164). */
  deliveryState?: string;
  /** Exclude copies that have already left on a sale line (the no-double-sale guard,
   * ADR-0012 §5). Used by the sale-lot composition picker (#164). */
  excludeSold?: boolean;
  /** Exclude copies already packaged into this sale `Lot` (#164), so the picker only
   * offers copies not yet in the lot being composed. */
  notInSaleLotId?: string;
  /** Restrict to copies whose linked stamp has this issued year. A number matches
   * `stamp.issuedYear`; `"none"` matches stamps with no issued year. Mirrors the
   * stamps list year filter (#142). */
  year?: number | "none";
  sortBy?: ItemSortBy;
  sortDir?: "asc" | "desc";
  offset?: number;
  pageSize?: number;
}

/** Build the Prisma `where` shared by `listItemsPaginated` and `getHoldingsValuation`, so
 * the list and its holdings total filter over exactly the same copies. `locationIds` is
 * the pre-resolved location subtree (or null when no location filter is set) since it
 * needs an async lookup the caller already did. */
function buildItemWhere(
  collectionId: string,
  filters: ItemListFiltersPaginated,
  locationIds: string[] | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // Constraints on the linked stamp (issue membership, area membership, text search) live
  // under a single `stamp` relation filter so they compose without clobbering each other.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stampWhere: any = {};
  if (filters.issueId) {
    stampWhere.issueMemberships = { some: { issueId: filters.issueId } };
  }
  if (filters.areaIds && filters.areaIds.length > 0) {
    stampWhere.stampAreaLinks = { some: { collectionAreaId: { in: filters.areaIds } } };
  }
  if (filters.year !== undefined) {
    stampWhere.issuedYear = filters.year === "none" ? null : filters.year;
  }
  if (filters.search) {
    const s = filters.search;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const or: any[] = [
      { name: { contains: s, mode: "insensitive" } },
      { issueMemberships: { some: { issue: { name: { contains: s, mode: "insensitive" } } } } },
      { catalogNumbers: { some: { number: { contains: s, mode: "insensitive" } } } },
    ];
    // Prefixed catalog input (#146): match the parsed number (narrowed to a vendor
    // when one was recognized) so "Mi PL 200" resolves even though the raw text
    // isn't a substring of the stored "200".
    if (filters.catalogNumber) {
      or.push({
        catalogNumbers: {
          some: {
            number: { contains: filters.catalogNumber, mode: "insensitive" },
            ...(filters.catalogVendorId ? { catalogVendorId: filters.catalogVendorId } : {}),
          },
        },
      });
    }
    stampWhere.OR = or;
  }
  return {
    collectionId,
    ...(filters.conditionId ? { conditionId: filters.conditionId } : {}),
    ...(filters.certificateStatusId
      ? { certificateStatusId: filters.certificateStatusId }
      : {}),
    ...(filters.stampId ? { stampId: filters.stampId } : {}),
    ...(filters.ids ? { id: { in: filters.ids } } : {}),
    ...(filters.excludeIds && filters.excludeIds.length > 0
      ? { id: { notIn: filters.excludeIds } }
      : {}),
    ...(Object.keys(stampWhere).length > 0 ? { stamp: stampWhere } : {}),
    ...(locationIds ? { locationId: { in: locationIds } } : {}),
    ...(filters.lotId ? { lotId: filters.lotId } : {}),
    ...(filters.deliveryState ? { deliveryState: filters.deliveryState } : {}),
    ...(filters.excludeSold ? { saleLineItems: { none: {} } } : {}),
    ...(filters.notInSaleLotId
      ? { lotMemberships: { none: { lotId: filters.notInSaleLotId } } }
      : {}),
    ...(filters.inCollection !== undefined ? { inCollection: filters.inCollection } : {}),
    ...(filters.forSale !== undefined ? { forSale: filters.forSale } : {}),
    ...(filters.forTrade !== undefined ? { forTrade: filters.forTrade } : {}),
  };
}

/** A copy enriched with the display data the list screen needs: the linked stamp's
 * identity (catalog numbers, name, issued date, owning issue), condition and
 * certificate labels, disposition flags, and acquisition/purchase fields. */
export interface ItemListItem {
  id: string;
  stampId: string;
  stampName: string | null;
  /** True when the copy links to a base stamp (parentId === null) that has variants,
   * i.e. the specific variant is unknown (ADR-0007 §2). */
  unknownVariant: boolean;
  /** True when the copy has at least one `ItemVariantHistory` entry (has been refined). */
  hasHistory: boolean;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  catalogNumbers: { catalogVendorId: string; number: string }[];
  /** Area the stamp is primarily linked to, used to resolve catalog-vendor display. */
  areaId: string | null;
  issueId: string | null;
  issueName: string | null;
  issueYear: number | null;
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  certificateStatusId: string | null;
  certificateStatusName: string | null;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  /** Acquisition link: the `PurchaseLot` this copy came from (ADR-0009), or null. */
  lotId: string | null;
  /** Owning lot's lifecycle status (`open | closed`), or null when the copy has no lot.
   * Feeds `resolveCostBasis` so a null cost-basis on an open lot reads as **pending**
   * rather than "no cost" (#123). */
  lotStatus: string | null;
  /** Physical delivery axis (ADR-0009 §5): in_transit | delivered | not_delivered | damaged. */
  deliveryState: string;
  /** Base-currency cost-basis snapshot (ADR-0009), or null when pending. */
  costBasis: string | null;
  notes: string | null;
  /** Assignable storage location this copy is filed in (#56), or null. The display
   * name/path is resolved client-side from the collection's locations list. */
  locationId: string | null;
  /** Free-text identifier within the location (e.g. `A234`), or null. */
  locationRef: string | null;
  createdAt: Date;
  /** Attached photos (#112), ordered front, back, then extras by sortOrder. Metadata only —
   * the collection-scoped serving route addresses variant bytes by photo id. */
  photos: PhotoSummary[];
  /** Catalog valuation of this copy (ADR-0007 §7). Uncertain for unknown variants. */
  value: CopyValuation;
}

export interface PaginatedItemsResult {
  items: ItemListItem[];
  nextCursor: string | null;
}

/** Paginated, enriched copy list for the Copies screen. Filters by disposition flags,
 * condition, and certificate status; sorts by added or acquired date; offset-paginated
 * to feed the shared infinite-scroll primitive (mirrors `listStampsPaginated`). */
export async function listItemsPaginated(
  ownerId: string,
  collectionId: string,
  filters: ItemListFiltersPaginated = {}
): Promise<PaginatedItemsResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;
  const dir = filters.sortDir ?? "asc";
  const orderBy = [{ createdAt: dir }];

  // A location filter matches the location and all its descendants (subtree, #56).
  const locationIds = filters.locationId
    ? await resolveLocationSubtree(collectionId, filters.locationId)
    : null;

  const rows = await prisma.item.findMany({
    where: buildItemWhere(collectionId, filters, locationIds),
    orderBy,
    take: pageSize + 1,
    skip: offset,
    select: {
      id: true,
      stampId: true,
      inCollection: true,
      forSale: true,
      forTrade: true,
      lotId: true,
      lot: { select: { status: true } },
      deliveryState: true,
      costBasis: true,
      notes: true,
      locationId: true,
      locationRef: true,
      createdAt: true,
      _count: { select: { variantHistory: true } },
      photos: { select: { id: true, role: true, title: true, sortOrder: true } },
      condition: { select: { id: true, name: true, abbreviation: true } },
      certificateStatus: { select: { id: true, name: true } },
      stamp: {
        select: {
          parentId: true,
          name: true,
          issuedDay: true,
          issuedMonth: true,
          issuedYear: true,
          catalogNumbers: { select: { catalogVendorId: true, number: true } },
          stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
          variants: { select: VARIANT_FLAG_SELECT },
          issueMemberships: {
            select: { issue: { select: { id: true, name: true, year: true } } },
            take: 1,
          },
        },
      },
    },
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  const valuations = await valuateItemRows(
    collectionId,
    page.map((row) => ({
      id: row.id,
      stampId: row.stampId,
      conditionId: row.condition.id,
      certificateStatusId: row.certificateStatus?.id ?? null,
      unknownVariant:
        row.stamp.parentId === null && row.stamp.variants.some(childIsVariant),
    }))
  );

  const items: ItemListItem[] = page.map((row) => {
    const firstIssue = row.stamp.issueMemberships[0]?.issue ?? null;
    const primaryLink = row.stamp.stampAreaLinks.find((l) => l.isPrimary);
    const areaId =
      primaryLink?.collectionAreaId ?? row.stamp.stampAreaLinks[0]?.collectionAreaId ?? null;
    return {
      id: row.id,
      stampId: row.stampId,
      stampName: row.stamp.name,
      unknownVariant:
        row.stamp.parentId === null && row.stamp.variants.some(childIsVariant),
      hasHistory: row._count.variantHistory > 0,
      issuedDay: row.stamp.issuedDay,
      issuedMonth: row.stamp.issuedMonth,
      issuedYear: row.stamp.issuedYear,
      catalogNumbers: row.stamp.catalogNumbers,
      areaId,
      issueId: firstIssue?.id ?? null,
      issueName: firstIssue?.name ?? null,
      issueYear: firstIssue?.year ?? null,
      conditionId: row.condition.id,
      conditionName: row.condition.name,
      conditionAbbreviation: row.condition.abbreviation,
      certificateStatusId: row.certificateStatus?.id ?? null,
      certificateStatusName: row.certificateStatus?.name ?? null,
      inCollection: row.inCollection,
      forSale: row.forSale,
      forTrade: row.forTrade,
      lotId: row.lotId,
      lotStatus: row.lot?.status ?? null,
      deliveryState: row.deliveryState,
      costBasis: row.costBasis == null ? null : row.costBasis.toString(),
      notes: row.notes,
      locationId: row.locationId,
      locationRef: row.locationRef,
      createdAt: row.createdAt,
      photos: row.photos
        .map((p) => ({
          id: p.id,
          role: (p.role === "front" || p.role === "back" ? p.role : null) as
            | "front"
            | "back"
            | null,
          title: p.title,
          sortOrder: p.sortOrder,
        }))
        .sort(sortPhotos),
      value: valuations.get(row.id)!,
    };
  });

  const nextCursor = hasMore ? String(offset + pageSize) : null;
  return { items, nextCursor };
}

/** Every copy identified into a single lot, fully enriched (same shape and catalog-vendor
 * valuation as the Copies screen), oldest first — for the lot intake view (#121). A lot
 * holds a bounded set of copies, so this returns them all rather than paginating. */
export async function listLotCopies(
  ownerId: string,
  collectionId: string,
  lotId: string
): Promise<ItemListItem[]> {
  const { items } = await listItemsPaginated(ownerId, collectionId, {
    lotId,
    sortDir: "asc",
    pageSize: 1000,
  });
  return items;
}

export async function deleteItem(ownerId: string, itemId: string): Promise<void> {
  const collectionId = await resolveItemCollection(itemId);
  await assertCollectionOwner(ownerId, collectionId);
  // Prisma cascade removes the copy's `Photo` rows, but not their stored bytes. Delete the
  // files first so no orphans are left behind (#112).
  await deletePhotoBytesForItem(itemId);
  await prisma.item.delete({ where: { id: itemId } });
}

/** Variant refinement trail for a copy, oldest change first. Each entry carries the
 * from/to stamp labels so the UI can render the change without extra lookups. */
export async function getItemVariantHistory(
  ownerId: string,
  itemId: string
): Promise<ItemVariantHistoryData[]> {
  const collectionId = await resolveItemCollection(itemId);
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.itemVariantHistory.findMany({
    where: { itemId },
    orderBy: { changedAt: "asc" },
    select: {
      id: true,
      itemId: true,
      fromStampId: true,
      toStampId: true,
      changedAt: true,
      note: true,
      fromStamp: { select: { name: true, catalogNumbers: { select: { number: true } } } },
      toStamp: { select: { name: true, catalogNumbers: { select: { number: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    itemId: row.itemId,
    fromStampId: row.fromStampId,
    toStampId: row.toStampId,
    fromStampLabel: stampLabel(row.fromStamp),
    toStampLabel: stampLabel(row.toStamp),
    changedAt: row.changedAt,
    note: row.note,
  }));
}

/** First-class variant refinement (ADR-0007 §6): re-point an unknown-variant copy from
 * its base stamp to a **descendant** variant and append an `ItemVariantHistory` row, in
 * one transaction. The descendant guard keeps this a genuine refinement — a copy can only
 * be resolved to a more specific variant of the same stamp, never re-pointed elsewhere. */
export async function resolveItemVariant(
  ownerId: string,
  itemId: string,
  toStampId: string,
  note?: string | null
): Promise<ItemData> {
  const current = await prisma.item.findUnique({
    where: { id: itemId },
    select: { collectionId: true, stampId: true },
  });
  if (!current) throw new Error("Item not found.");
  await assertCollectionOwner(ownerId, current.collectionId);
  if (toStampId === current.stampId) {
    throw new Error("Pick a variant different from the current stamp.");
  }
  await assertStampInCollection(current.collectionId, toStampId);
  if (!(await isDescendantStamp(toStampId, current.stampId))) {
    throw new Error("A copy can only be resolved to a variant of its current stamp.");
  }

  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.item.update({
      where: { id: itemId },
      data: { stampId: toStampId },
      select: ITEM_SELECT,
    });
    await tx.itemVariantHistory.create({
      data: {
        itemId,
        fromStampId: current.stampId,
        toStampId,
        note: note ?? null,
      },
    });
    return updated;
  });
  return toItemData(item);
}

/** True when `stampId` is a descendant (child, grandchild, …) of `ancestorId` by walking
 * the variant tree upward. Bounded by the tree depth; the collection scope is already
 * asserted by the caller. */
async function isDescendantStamp(
  stampId: string,
  ancestorId: string
): Promise<boolean> {
  let cursor: string | null = stampId;
  // Guard against cycles/very deep trees; variant trees are shallow in practice.
  for (let hops = 0; cursor && hops < 50; hops++) {
    const node: { parentId: string | null } | null = await prisma.stamp.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!node) return false;
    if (node.parentId === ancestorId) return true;
    cursor = node.parentId;
  }
  return false;
}

// ── Copy valuation (ADR-0007 §7) ────────────────────────────────────────────
// Assembles the inputs the pure `valuateCopy` needs (area primary catalog, own +
// descendant-variant prices, currency rates) and delegates the rule to `valuation.ts`.

/** Minimal copy projection needed to value it. */
interface ValuationRow {
  id: string;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  /** True when the copy links to a base stamp that has variants (variant unknown). */
  unknownVariant: boolean;
}

const VALUATION_PRICE_SELECT = {
  price: true,
  currency: true,
  conditionId: true,
  certificateStatusId: true,
  catalogEdition: { select: { year: true, catalogNameId: true } },
} as const;

/** For each ancestor stamp id, the set of all descendant stamp ids (children,
 * grandchildren, …). Built from one flat read of the collection's variant tree so
 * unknown-variant valuation can gather every child's prices. Empty when no ancestors. */
async function buildDescendantMap(
  collectionId: string,
  ancestorIds: Set<string>
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (ancestorIds.size === 0) return result;
  const all = await prisma.stamp.findMany({
    where: { collectionId },
    select: { id: true, parentId: true },
  });
  const childrenByParent = new Map<string, string[]>();
  for (const s of all) {
    if (!s.parentId) continue;
    const arr = childrenByParent.get(s.parentId) ?? [];
    arr.push(s.id);
    childrenByParent.set(s.parentId, arr);
  }
  for (const ancestor of ancestorIds) {
    const acc = new Set<string>();
    const queue = [...(childrenByParent.get(ancestor) ?? [])];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (acc.has(id)) continue;
      acc.add(id);
      for (const child of childrenByParent.get(id) ?? []) queue.push(child);
    }
    result.set(ancestor, acc);
  }
  return result;
}

/** Value a set of copies. Loads the stamp prices, area primary catalogs, descendant
 * variant prices, and currency rates once, then applies the pure `valuateCopy` rule.
 * Caller must have already asserted collection ownership. Returns id → valuation. */
async function valuateItemRows(
  collectionId: string,
  rows: ValuationRow[]
): Promise<Map<string, CopyValuation>> {
  if (rows.length === 0) return new Map();

  const [primaryCatalogByArea, baseCurrency] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    getCollectionBaseCurrency(collectionId),
  ]);

  const unknownStampIds = new Set(
    rows.filter((r) => r.unknownVariant).map((r) => r.stampId)
  );
  const descendantsByStamp = await buildDescendantMap(collectionId, unknownStampIds);

  // Every stamp whose prices/area we must load: the copies' own stamps plus the
  // descendant variants of any unknown-variant copy.
  const stampIds = new Set<string>();
  for (const r of rows) stampIds.add(r.stampId);
  for (const set of descendantsByStamp.values()) {
    for (const id of set) stampIds.add(id);
  }

  const stamps = await prisma.stamp.findMany({
    where: { id: { in: [...stampIds] } },
    select: {
      id: true,
      catalogPrices: { select: VALUATION_PRICE_SELECT },
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      ...VARIANT_FLAG_SELECT,
    },
  });

  const pricesByStamp = new Map<string, RawCatalogPrice[]>();
  const primaryCatalogByStamp = new Map<string, string | null>();
  // Which descendants count as variants (ADR-0010 §3): only variant-kind children
  // feed the lowest-child price; distinct-entry descendants are excluded.
  const isVariantByStamp = new Map<string, boolean>();
  const currencies: string[] = [];
  for (const s of stamps) {
    pricesByStamp.set(s.id, s.catalogPrices);
    isVariantByStamp.set(s.id, childIsVariant(s));
    for (const p of s.catalogPrices) currencies.push(p.currency);
    const link = s.stampAreaLinks.find((l) => l.isPrimary) ?? s.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    primaryCatalogByStamp.set(
      s.id,
      areaId ? (primaryCatalogByArea.get(areaId) ?? null) : null
    );
  }

  const rates = await safeRateMap(collectionId, baseCurrency, currencies);

  const result = new Map<string, CopyValuation>();
  for (const r of rows) {
    const descendants = r.unknownVariant
      ? [...(descendantsByStamp.get(r.stampId) ?? new Set<string>())].filter(
          (id) => isVariantByStamp.get(id) ?? false
        )
      : null;
    result.set(
      r.id,
      valuateCopy({
        conditionId: r.conditionId,
        certificateStatusId: r.certificateStatusId,
        unknownVariant: r.unknownVariant,
        primaryCatalogNameId: primaryCatalogByStamp.get(r.stampId) ?? null,
        ownPrices: pricesByStamp.get(r.stampId) ?? [],
        variantPrices: descendants
          ? descendants.map((id) => pricesByStamp.get(id) ?? [])
          : undefined,
        baseCurrency,
        rates,
      })
    );
  }
  return result;
}

/** Value a set of copies by id, resolving each copy's condition, certificate, and
 * unknown-variant flag from the database, then applying the same primary-catalog
 * price-for-condition×certificate rule the Copies screen uses. Returned as id →
 * valuation; ids not found are simply absent. The lot-close flow (#121) reads
 * `baseAmount` off each valuation as the allocation weight (ADR-0009 §3.3). Caller
 * must have already asserted collection ownership. */
export async function valuateItemsByIds(
  collectionId: string,
  itemIds: string[]
): Promise<Map<string, CopyValuation>> {
  if (itemIds.length === 0) return new Map();
  const rows = await prisma.item.findMany({
    where: { id: { in: itemIds }, collectionId },
    select: {
      id: true,
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      stamp: { select: { parentId: true, variants: { select: VARIANT_FLAG_SELECT } } },
    },
  });
  const valuationRows: ValuationRow[] = rows.map((row) => ({
    id: row.id,
    stampId: row.stampId,
    conditionId: row.conditionId,
    certificateStatusId: row.certificateStatusId,
    unknownVariant:
      row.stamp.parentId === null && row.stamp.variants.some(childIsVariant),
  }));
  return valuateItemRows(collectionId, valuationRows);
}

/** Aggregate holdings valuation over every copy matching the given filters (the whole
 * filtered set, not one page). Mirrors the disposition/condition/certificate filters of
 * `listItemsPaginated` so the total reflects what the Copies screen is showing. */
export async function getHoldingsValuation(
  ownerId: string,
  collectionId: string,
  filters: ItemListFiltersPaginated = {}
): Promise<HoldingsSummary> {
  await assertCollectionOwner(ownerId, collectionId);

  const locationIds = filters.locationId
    ? await resolveLocationSubtree(collectionId, filters.locationId)
    : null;

  const rows = await prisma.item.findMany({
    where: buildItemWhere(collectionId, filters, locationIds),
    select: {
      id: true,
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      costBasis: true,
      lotId: true,
      lot: { select: { status: true } },
      stamp: { select: { parentId: true, variants: { select: VARIANT_FLAG_SELECT } } },
    },
  });

  const valuationRows: ValuationRow[] = rows.map((row) => ({
    id: row.id,
    stampId: row.stampId,
    conditionId: row.conditionId,
    certificateStatusId: row.certificateStatusId,
    unknownVariant:
      row.stamp.parentId === null && row.stamp.variants.some(childIsVariant),
  }));

  // Actual purchase cost-basis over the same filtered set (#134). Snapshots are frozen in
  // the base currency, so this needs no rate handling — unlike the catalog valuation above.
  const costInputs: CostBasisInput[] = rows.map((row) => ({
    costBasis: row.costBasis == null ? null : row.costBasis.toString(),
    lotId: row.lotId,
    lotStatus: row.lot?.status ?? null,
  }));

  const valuations = await valuateItemRows(collectionId, valuationRows);
  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  return {
    ...aggregateHoldings([...valuations.values()], baseCurrency),
    cost: aggregateCostBasis(costInputs, baseCurrency),
  };
}

export interface ItemYearFacet {
  /** null represents the "No year" bucket. */
  year: number | null;
  count: number;
}

/** Distinct issued years (of the linked stamps) present in the copy list for the
 * given filters (year filter itself is ignored), each with a count of matching
 * copies. Sorted descending, null ("No year") last. Mirrors the stamps list year
 * facets (#142); the year lives on the related stamp so counts are aggregated in
 * memory rather than via `groupBy` (which cannot group by a relation field). */
export async function listItemYearFacets(
  ownerId: string,
  collectionId: string,
  filters: Omit<ItemListFiltersPaginated, "year" | "offset" | "pageSize" | "sortBy" | "sortDir">
): Promise<ItemYearFacet[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const locationIds = filters.locationId
    ? await resolveLocationSubtree(collectionId, filters.locationId)
    : null;
  const rows = await prisma.item.findMany({
    where: buildItemWhere(collectionId, filters, locationIds),
    select: { stamp: { select: { issuedYear: true } } },
  });
  const counts = new Map<number | null, number>();
  for (const row of rows) {
    const y = row.stamp.issuedYear;
    counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => {
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return b.year - a.year;
    });
}
