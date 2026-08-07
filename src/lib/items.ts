import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  buildDescendantMap,
  buildEffectivePrimaryCatalogMap,
  getCollectionBaseCurrency,
  safeRateMap,
} from "./pricing";
import type { RawCatalogPrice } from "./catalog-price";
import { makeFormatFactorLookup } from "./format-pricing";
import {
  valuateCopy,
  aggregateHoldings,
  type CopyValuation,
  type HoldingsSummary,
} from "./valuation";
import { aggregateCostBasis, type CostBasisInput } from "./cost-basis";
import {
  childIsVariant,
  isUnknownVariantStamp,
  subtypeLabel,
  VARIANT_FLAG_SELECT,
  type SubtypeLabel,
} from "./variant-classification";
import { deletePhotoBytesForItem, sortPhotos, type PhotoSummary } from "./photos";
import { CLOSED_OFFER_STATES } from "./offer-rules";
import { getCollectionAreas } from "./areas";
import { buildAreaVendorMaps, deriveLotLabel } from "./area-vendor";
import { loadIssuePrefixMap } from "./issue-prefix";
import { sortCopies } from "./copy-sort";
import { parseItemNoSearch } from "./item-number";
import { isDeliveryState, isDelivered, UNAVAILABLE_DELIVERY_STATES } from "./delivery-state";
import {
  disposalNoteRequired,
  isDisposalReason,
  isHeld,
  type DisposalReason,
} from "./disposal";
import {
  copyGroupKey,
  encodeCopyGroupKey,
  mixedAxes,
  DEFAULT_GROUP_AXES,
  type CopyGroupAxes,
  type CopyGroupKey,
} from "./copy-groups";
import {
  compareLocationGroups,
  locationGroupKey,
  NO_LOCATION,
  NO_LOCATION_REF,
  type LocationGroupBy,
} from "./location-groups";
import {
  compareIssueGroups,
  issueGroupLabel,
  NO_ISSUE,
  type SortableIssueGroup,
} from "./issue-groups";
import { buildLocationPath } from "./location-path";

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

/** The location ids a filter narrows to: null when no location is selected, the subtree by
 * default (#56), or that one node when the collector has scoped the filter to it (#385). Every
 * read that filters by location goes through this, so the list, its holdings bar and its year
 * facets can never disagree about what "in Klaser A" means. */
async function resolveLocationScope(
  collectionId: string,
  filters: { locationId?: string; locationExact?: boolean }
): Promise<string[] | null> {
  // The unfiled bucket (#421) is not a subtree — `buildItemWhere` turns it into `locationId: null`.
  if (!filters.locationId || filters.locationId === NO_LOCATION) return null;
  if (filters.locationExact) return [filters.locationId];
  return resolveLocationSubtree(collectionId, filters.locationId);
}

/** Hand out `count` consecutive internal copy numbers for a collection (#268).
 *
 * The counter lives on `Collection.nextItemNo` and is bumped in one statement, so concurrent
 * creates can never collide (the `UPDATE` takes a row lock) and a whole bulk intake costs a single
 * round trip. It is deliberately not `max(itemNo) + 1`: a number written on a physical piece must
 * not be handed to a different copy after the first one is deleted.
 *
 * Pass the surrounding transaction client when the copies are created inside one, so a rolled-back
 * intake also rolls back the numbers it reserved. */
export async function allocateItemNumbers(
  client: Prisma.TransactionClient,
  collectionId: string,
  count: number
): Promise<number[]> {
  if (count < 1) return [];
  const rows = await client.$queryRaw<{ nextItemNo: number }[]>`
    UPDATE "collection"
    SET "nextItemNo" = "nextItemNo" + ${count}
    WHERE "id" = ${collectionId}
    RETURNING "nextItemNo"
  `;
  if (rows.length === 0) throw new Error("Collection not found.");
  // The statement returns the value *after* the bump, so the reserved range ends just below it.
  const end = rows[0].nextItemNo;
  const start = end - count;
  return Array.from({ length: count }, (_, i) => start + i);
}

/** Convenience wrapper for the common single-copy case. */
export async function allocateItemNumber(
  client: Prisma.TransactionClient,
  collectionId: string
): Promise<number> {
  const [itemNo] = await allocateItemNumbers(client, collectionId, 1);
  return itemNo;
}

/** Hand out the next short listing number for a collection (#416) — `Offer.offerNo`.
 *
 * Deliberately the same statement as {@link allocateItemNumbers}, off its own counter
 * (`Collection.nextOfferNo`): a number that has been published in a marketplace private note must
 * never come to mean a different listing, so it is not `max(offerNo) + 1` and a deleted offer
 * retires its number. Offers are created one at a time — even a duplicate run creates one — so
 * there is no range variant to mirror.
 *
 * Must be called with the transaction that creates the offer, so a rolled-back creation also rolls
 * back the number it reserved. */
export async function allocateOfferNumber(
  client: Prisma.TransactionClient,
  collectionId: string
): Promise<number> {
  const rows = await client.$queryRaw<{ nextOfferNo: number }[]>`
    UPDATE "collection"
    SET "nextOfferNo" = "nextOfferNo" + 1
    WHERE "id" = ${collectionId}
    RETURNING "nextOfferNo"
  `;
  if (rows.length === 0) throw new Error("Collection not found.");
  // The statement returns the value *after* the bump, so the reserved number is the one below it.
  return rows[0].nextOfferNo - 1;
}

/** The collection counters that hand out a short per-entity number (#432), keyed by the entity they
 * count. Adding one is a column here and a `<entity>No` on the row — nothing else in this file. */
const ENTITY_NUMBER_COUNTERS = {
  issue: "nextIssueNo",
  purchase: "nextPurchaseNo",
  sale: "nextSaleNo",
  auctionLot: "nextAuctionLotNo",
} as const;

export type NumberedEntity = keyof typeof ENTITY_NUMBER_COUNTERS;

/** Hand out the next short number for one of the remaining major entities (#432) — an issue, a
 * purchase, a sale or an auction lot.
 *
 * The same statement as {@link allocateItemNumbers} against a different column, and the same
 * reasoning: never `max + 1`, so a deleted row retires its number instead of passing it on. A
 * number a collector has quoted — typed into the quick-jump box (#431), written on a parcel — must
 * not later mean something else.
 *
 * Must be called with the transaction that creates the row, so a rolled-back creation also rolls
 * back the number it reserved. */
export async function allocateEntityNumber(
  client: Prisma.TransactionClient,
  collectionId: string,
  entity: NumberedEntity
): Promise<number> {
  // The column name is chosen here from a closed set, never taken from a caller's string, so the
  // interpolation below cannot carry anything but one of the four identifiers above.
  const column = ENTITY_NUMBER_COUNTERS[entity];
  const rows = await client.$queryRawUnsafe<{ next: number }[]>(
    `UPDATE "collection" SET "${column}" = "${column}" + 1 WHERE "id" = $1 RETURNING "${column}" AS next`,
    collectionId
  );
  if (rows.length === 0) throw new Error("Collection not found.");
  // The statement returns the value *after* the bump, so the reserved number is the one below it.
  return rows[0].next - 1;
}

export interface ItemData {
  id: string;
  collectionId: string;
  /** Internal copy number (#268): per-collection, assigned on creation, never editable. */
  itemNo: number;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  /** Physical format; null = single. */
  formatId: string | null;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  /** Acquisition link: the `PurchaseLot` this copy came from (ADR-0009), or null when
   * the copy entered via another channel. */
  lotId: string | null;
  /** Physical delivery axis (ADR-0009 §5): in_transit | delivered | not_delivered | damaged. */
  deliveryState: string;
  /** Disposal axis (#394): when the copy left the collector's hands after arriving, or null
   * while it is still held. */
  disposedAt: Date | null;
  /** Why it left: lost | damaged | other, or null while the copy is held. */
  disposalReason: string | null;
  /** Free-text detail; required when the reason is `other`. */
  disposalNote: string | null;
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

/** Supplier + date — the pair the purchases list leads with — naming the order a copy came from
 * (#387), so its row menu says *which* purchase before navigating to it. */
function purchaseLabel(p: {
  purchasedAt: Date;
  contact: { name: string } | null;
}): string {
  const date = p.purchasedAt.toISOString().slice(0, 10);
  return p.contact?.name ? `${p.contact.name} · ${date}` : date;
}

const ITEM_SELECT = {
  id: true,
  collectionId: true,
  itemNo: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
  inCollection: true,
  forSale: true,
  forTrade: true,
  lotId: true,
  deliveryState: true,
  disposedAt: true,
  disposalReason: true,
  disposalNote: true,
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
  itemNo: number;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  lotId: string | null;
  deliveryState: string;
  disposedAt: Date | null;
  disposalReason: string | null;
  disposalNote: string | null;
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
  /** Physical format; null or absent = single. A multiple is one copy in one format and is
   *  never recorded as, or counted as, several single copies. */
  formatId?: string | null;
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
  /** Platforms this copy is never to be listed on (#506) — a copy can be added already knowing it
   * is not for one of them, so the add form asks the same question the edit form does. */
  excludedPlatformIds?: string[];
}

// The delivery axis values a copy may carry live in `./delivery-state` (ADR-0009 §5). Both
// `ordered` and `to_sort` stay in the lot for allocation (only `not_delivered` is dropped)
// and keep the copy out of the collection until it is sorted.

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
  /** Physical format; null = single (a copy that is one stamp on its own). */
  formatId?: string | null;
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
  /** The platforms this copy is never to be listed on (#506). Absent leaves the set alone; a list —
   * including an empty one — **replaces** it, which is what the edit dialog's multi-select means by
   * unticking the last platform. */
  excludedPlatformIds?: string[];
  /** Optional reason recorded on the ItemVariantHistory row when `stampId` changes. */
  variantChangeNote?: string | null;
}

export interface ItemListFilters {
  conditionId?: string;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
}

/** The platform contacts of this collection among `ids` (#506). Anything else is **dropped**, not
 * refused: an id a form carries for a platform since deleted, or one belonging to another
 * collection, says the same thing as no exclusion at all, and a copy edit is no place to fail over
 * it. Deduplicated — the exclusions are a set. */
async function resolvePlatformIds(
  collectionId: string,
  ids: readonly string[]
): Promise<string[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await prisma.contact.findMany({
    where: { id: { in: unique }, collectionId, platform: true },
    select: { id: true },
  });
  return rows.map((r) => r.id);
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
  const deliveryState = isDeliveryState(data.deliveryState) ? data.deliveryState : "delivered";
  const excludedPlatformIds = data.excludedPlatformIds
    ? await resolvePlatformIds(collectionId, data.excludedPlatformIds)
    : [];
  const itemNo = await allocateItemNumber(prisma, collectionId);
  const item = await prisma.item.create({
    data: {
      platformExclusions: {
        create: excludedPlatformIds.map((platformId) => ({ platformId })),
      },
      collectionId,
      itemNo,
      stampId: data.stampId,
      conditionId: data.conditionId,
      certificateStatusId: data.certificateStatusId ?? null,
      formatId: data.formatId ?? null,
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

/** Fetch one copy enriched as an {@link ItemListItem} — identical shape and valuation to
 * the Copies list. Used by the quick-offer flow (#241) to hand the freshly created copy to
 * the offer step without re-fetching the whole list. */
export async function getItemListItem(
  ownerId: string,
  itemId: string
): Promise<ItemListItem> {
  const collectionId = await resolveItemCollection(itemId);
  await assertCollectionOwner(ownerId, collectionId);
  const row = await prisma.item.findUniqueOrThrow({
    where: { id: itemId },
    select: ITEM_LIST_SELECT,
  });
  const [item] = await enrichItemRows(collectionId, [row]);
  return item;
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

  // Absent leaves the exclusions alone — every caller that is not the copy form (#506) has no
  // opinion on them, and a missing field must not read as "clear them".
  const excludedPlatformIds =
    data.excludedPlatformIds === undefined
      ? null
      : await resolvePlatformIds(collectionId, data.excludedPlatformIds);

  // `fields` is read key by key below, so the exclusions riding along in it reach no `update`.
  const { variantChangeNote, ...fields } = data;
  const updateData = {
    ...(fields.stampId !== undefined ? { stampId: fields.stampId } : {}),
    ...(fields.conditionId !== undefined ? { conditionId: fields.conditionId } : {}),
    ...(fields.certificateStatusId !== undefined
      ? { certificateStatusId: fields.certificateStatusId }
      : {}),
    ...(fields.formatId !== undefined ? { formatId: fields.formatId } : {}),
    ...(fields.inCollection !== undefined ? { inCollection: fields.inCollection } : {}),
    ...(fields.forSale !== undefined ? { forSale: fields.forSale } : {}),
    ...(fields.forTrade !== undefined ? { forTrade: fields.forTrade } : {}),
    ...(isDeliveryState(fields.deliveryState)
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
    if (excludedPlatformIds) {
      // A replace, expressed as a delete of what is no longer ticked plus a create of what is:
      // `skipDuplicates` leaves the rows that survive untouched, so an exclusion keeps the date it
      // was made on rather than being re-stamped by an unrelated edit.
      await tx.itemPlatformExclusion.deleteMany({
        where: { itemId, platformId: { notIn: excludedPlatformIds } },
      });
      if (excludedPlatformIds.length > 0) {
        await tx.itemPlatformExclusion.createMany({
          data: excludedPlatformIds.map((platformId) => ({ itemId, platformId })),
          skipDuplicates: true,
        });
      }
    }
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

/**
 * Set or clear the "never list this copy here" flag (#506) over one platform and any number of
 * copies — the row's own ⋮ entry passes one id, the bulk bar passes a whole selection, and both are
 * the same write, because a decision taken about one copy and about a thousand is the same decision.
 *
 * **Idempotent in both directions**: excluding is a `createMany … skipDuplicates`, allowing is a
 * `deleteMany`, so re-running either changes nothing. That is what makes it safe to point at a
 * selection whose copies are in a mix of states — which is the normal case when working through the
 * worklist, where some rows were already set aside.
 *
 * The copies are narrowed to the collection before anything is written, so an id from elsewhere is
 * ignored rather than trusted; an unknown platform, by contrast, is a **refusal**, since the whole
 * point of the call is that one platform. Returns how many copies the write actually addressed, for
 * the confirmation the bulk bar shows.
 */
export async function setItemPlatformExclusion(
  ownerId: string,
  collectionId: string,
  itemIds: readonly string[],
  platformId: string,
  excluded: boolean
): Promise<number> {
  await assertCollectionOwner(ownerId, collectionId);
  const [platform] = await resolvePlatformIds(collectionId, [platformId]);
  if (!platform) throw new Error("Platform not found in this collection.");

  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const rows = await prisma.item.findMany({
    where: { id: { in: ids }, collectionId },
    select: { id: true },
  });
  if (rows.length === 0) return 0;

  if (excluded) {
    await prisma.itemPlatformExclusion.createMany({
      data: rows.map((r) => ({ itemId: r.id, platformId: platform })),
      skipDuplicates: true,
    });
  } else {
    await prisma.itemPlatformExclusion.deleteMany({
      where: { itemId: { in: rows.map((r) => r.id) }, platformId: platform },
    });
  }
  return rows.length;
}

/** What a disposal records (#394): why the copy stopped being held, plus free-text detail that is
 * **required** for `other` — `lost` and `damaged` say what happened on their own, while `other`
 * says only that something did. */
export interface ItemDisposalInput {
  reason: DisposalReason;
  note?: string | null;
}

/** Names the offers a copy sits in that would have to be withdrawn first, most-recent first.
 * Non-terminal only: a sold or withdrawn listing holds nothing back. */
async function blockingOfferLabels(itemId: string): Promise<string[]> {
  const rows = await prisma.offerSetItem.findMany({
    where: {
      itemId,
      offerSet: { offer: { state: { notIn: [...CLOSED_OFFER_STATES] } } },
    },
    select: {
      offerSet: {
        select: {
          offer: {
            select: { name: true, createdAt: true, platform: { select: { name: true } } },
          },
        },
      },
    },
  });
  return rows
    .map((r) => r.offerSet.offer)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((o) => o.name ?? `the ${o.platform.name} listing`);
}

/**
 * Record that a copy is no longer held (#394) — lost, damaged in storage, discarded.
 *
 * Two preconditions, both of which explain themselves to the collector (#395):
 *
 *  - **Only a delivered copy can be disposed of.** Something that never arrived is the delivery
 *    axis's business (`not_delivered` / `damaged`), and #122 already gives it a different
 *    treatment — it leaves the lot and its share redistributes.
 *  - **A copy in a live offer must have that offer withdrawn first**, or the listing would be
 *    advertising something the collector cannot ship.
 *
 * The acquisition is deliberately untouched: `costBasis`, `lotId`, `itemNo`, photos and the
 * variant history all stay, because the cost really was incurred. That retained basis is what the
 * holdings bar reports as a write-off (#396), and `itemNo` is retired rather than reused for the
 * same reason a deleted copy's is.
 */
export async function disposeItem(
  ownerId: string,
  itemId: string,
  input: ItemDisposalInput
): Promise<ItemData> {
  const current = await prisma.item.findUnique({
    where: { id: itemId },
    select: { collectionId: true, deliveryState: true, disposedAt: true },
  });
  if (!current) throw new Error("Item not found.");
  await assertCollectionOwner(ownerId, current.collectionId);

  if (!isDisposalReason(input.reason)) {
    throw new Error("Pick why this copy is no longer held.");
  }
  const note = input.note?.trim() || null;
  if (disposalNoteRequired(input.reason) && !note) {
    throw new Error("Describe what happened to this copy.");
  }
  if (current.disposedAt != null) {
    throw new Error("This copy is already marked as no longer held.");
  }
  if (!isDelivered(current.deliveryState)) {
    throw new Error(
      "Only a delivered copy can be marked as no longer held — this one has not arrived yet."
    );
  }
  const offers = await blockingOfferLabels(itemId);
  if (offers.length > 0) {
    throw new Error(
      `This copy is listed on ${offers.join(", ")}. Withdraw ${
        offers.length > 1 ? "those offers" : "that offer"
      } first.`
    );
  }

  const item = await prisma.item.update({
    where: { id: itemId },
    data: { disposedAt: new Date(), disposalReason: input.reason, disposalNote: note },
    select: ITEM_SELECT,
  });
  return toItemData(item);
}

/** Reverse a disposal — the copy turned up again (#394). Clears all three columns, so a restored
 * copy is indistinguishable from one that was never disposed of: the axis records possession, not
 * a history of it. */
export async function restoreItem(ownerId: string, itemId: string): Promise<ItemData> {
  const current = await prisma.item.findUnique({
    where: { id: itemId },
    select: { collectionId: true, disposedAt: true },
  });
  if (!current) throw new Error("Item not found.");
  await assertCollectionOwner(ownerId, current.collectionId);
  if (current.disposedAt == null) {
    throw new Error("This copy is not marked as no longer held.");
  }
  const item = await prisma.item.update({
    where: { id: itemId },
    data: { disposedAt: null, disposalReason: null, disposalNote: null },
    select: ITEM_SELECT,
  });
  return toItemData(item);
}

/** A copy is reported under **one** issue, even though issue membership is many-to-many: the first
 * one its stamp was added to. Ordering the `take: 1` explicitly is what makes it *one* answer — an
 * unordered take returns whatever the database hands back, so the row, the valuation and #424's
 * issue groups could each name a different issue for the same copy, and a group's count would stop
 * matching the rows under it. `issueId` ascending is creation order (a cuid carries its timestamp),
 * which is the only signal a membership row carries. */
const FIRST_ISSUE_MEMBERSHIP = { orderBy: { issueId: "asc" }, take: 1 } as const;

export type ItemSortBy = "created";

export interface ItemListFiltersPaginated extends Omit<ItemListFilters, "conditionId"> {
  /** Restrict to copies in any of these conditions (#425) — an **OR**, empty/absent meaning every
   *  condition. A list rather than the single id the axis used to carry, because the question the
   *  Copies list asks of it is routinely "the mint grades" rather than one grade; a duplicate group
   *  addressing its own members passes the one condition it grouped on, which is the same filter
   *  with one entry in it and needs no second knob on the axis. */
  conditionIds?: string[];
  /** Restrict to copies carrying any of these certificate statuses (#428) — an **OR**, empty/absent
   *  meaning every status. The literal `"none"` is a tickable value like any other and matches the
   *  copies with no certificate: null *is* a value here (ADR-0006 §2), exactly as `"single"` is for
   *  format, and an absent filter cannot express it. A duplicate group addressing its own members
   *  passes the one status it grouped on (#372). */
  certificateStatusIds?: string[];
  /** Restrict to copies of any of these physical formats (#343, #427) — an **OR**, empty/absent
   *  meaning every format. The literal `"single"` is a tickable value like any other and matches the
   *  copies with no format: null *is* the single (ADR-0020), and an absent filter cannot express it.
   *  A duplicate group addressing its own members passes the one format it grouped on. */
  formatIds?: string[];
  /** Restrict to copies whose linked stamp belongs to any of these areas (the selected
   * area plus its descendants, resolved by the caller). Mirrors the stamps list area
   * sidebar (#106): matched via `Item.stamp` → `StampCollectionArea`. */
  areaIds?: string[];
  /** Free-text search over the linked stamp's name, its issue name, its catalog numbers, and
   * the copy's own `locationRef` (case-insensitive substring). Mirrors the stamps list search
   * (#106); the location ref is matched too so a copy can be found by where it is filed (#303). */
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
  /** Restrict to copies stored in this location or any of its descendants (#56). The literal
   *  {@link NO_LOCATION} matches the copies filed **nowhere** — null *is* a value here, exactly as
   *  `"single"` is for format, and an absent filter cannot express it. Needed to address the
   *  unfiled bucket of a location grouping (#421). */
  locationId?: string;
  /** Narrow {@link locationId} to that location **alone**, dropping its descendants (#385).
   * Absent / false keeps #56's subtree behaviour, which is what a collector browsing a tree
   * expects; this is the explicit "this location only" reading. */
  locationExact?: boolean;
  /** Restrict to copies carrying this exact in-location ref (#421) — the identifier written on the
   *  shelf (`A234`). Matched exactly rather than as a substring (the search box already does
   *  substrings, #303), so a ref group and its members can never disagree. The literal
   *  {@link NO_LOCATION_REF} matches the copies with none, blank refs included. */
  locationRef?: string;
  /** Restrict to copies identified into a single purchase lot (intake view, #121). */
  lotId?: string;
  /** Restrict to a fixed set of copy ids (e.g. the members of a sale lot, #164). */
  ids?: string[];
  /** Exclude a fixed set of copy ids (e.g. copies already represented in a quantity lot's
   * sub-lots, #164). */
  excludeIds?: string[];
  /** Restrict to copies in any of these physical delivery states (ADR-0009 §5, #427) — an **OR**,
   * empty/absent meaning every state. A list because "everything still on its way to me" is
   * *Ordered*, *In transit* and *To sort* together, and asking it three times over is not the same
   * question; a caller pinning one state (the sale-lot composition picker, #164, which only offers
   * copies actually in hand) passes a single-entry list through the same field. */
  deliveryStates?: string[];
  /** Exclude copies that have already left on a sale line (the no-double-sale guard,
   * ADR-0013). Used by the offer composition picker. */
  excludeSold?: boolean;
  /** Include copies disposed of after delivery (#394/#395). The list answers "what do I have",
   * so they are **hidden by default** — exactly as sold copies are (#207) — and this brings them
   * back. Mirrored on the years and valuation reads so the panel, its facets and its total never
   * disagree about which copies are in scope. */
  includeDisposed?: boolean;
  /** Exclude copies already packaged into any set of this offer (ADR-0013), so the composition
   * picker only offers copies not yet in the offer being built. */
  notInOfferId?: string;
  /** Restrict to the copies this lot could take on (#388): not already on it, and either on no
   * lot at all or on one still **open**. A copy on a closed lot is left out because its cost
   * basis has been frozen into that lot's split (ADR-0009 §3) — moving it would under-cost the
   * copies that stayed, so that lot has to be reopened first. */
  attachableToLotId?: string;
  /** Restrict to copies whose linked stamp has this issued year. A number matches
   * `stamp.issuedYear`; `"none"` matches stamps with no issued year. Mirrors the
   * stamps list year filter (#142). */
  year?: number | "none";
  /** Restrict to copies with no attached photos (#177), so users can find pieces that
   * still need photographing (#112). */
  noPhotos?: boolean;
  /** Restrict to copies whose catalog valuation is `unpriced` — no price recorded for the
   * copy's own condition × certificate (#229), so users can find and fix pricing gaps. Since
   * "unpriced" is derived (no column carries it), the reads valuate the matching set once and
   * narrow to the resulting ids (see {@link resolveMissingCatalogItemIds}). */
  missingCatalogValue?: boolean;
  /** Restrict to for-sale copies not yet offered on this platform (#259): copies with no
   * *non-terminal* offer (any state except sold/withdrawn) on the given platform. A copy listed on
   * a different platform still matches — multi-platform listing is expected (#165) — unless that
   * offer is in active bidding (#215), which commits the copy to a pending sale and so excludes it
   * everywhere (#334). Implies the `forSale` disposition, so it surfaces exactly what still needs
   * listing there.
   *
   * Copies **excluded** from that platform (#506) are left out: the collector has already answered
   * for them, and a worklist that keeps asking is one nobody can work through. */
  notOfferedPlatformId?: string;
  /** The other half of {@link notOfferedPlatformId} (#506): the copies flagged as never to be listed
   * on this platform. The way back — auditing what was set aside, and undoing it — so it is the
   * exclusion and **nothing else**: no `forSale` implication, because a copy taken out of the
   * worklist and then taken off sale would otherwise vanish from both readings at once. */
  excludedPlatformId?: string;
  sortBy?: ItemSortBy;
  sortDir?: "asc" | "desc";
  offset?: number;
  pageSize?: number;
}

/** Build the Prisma `where` shared by `listItemsPaginated` and `getHoldingsValuation`, so
 * the list and its holdings total filter over exactly the same copies. `locationIds` is
 * the pre-resolved location subtree (or null when no location filter is set) since it
 * needs an async lookup the caller already did. */
/**
 * The `where` fragment for a multi-value axis whose **null is a value** (#427, #428) — format, where
 * `"single"` is the absence of one (ADR-0020), and certificate, where `"none"` is (ADR-0006 §2).
 * Not a plain `in` like condition or delivery state, because a null can never be a member of an `in`
 * list: ticking the sentinel alongside a real value is two branches ORed together, and ticking it
 * alone is the null test on its own — the reading each single-select already had.
 *
 * Returns null when the filter is off. An `OR` goes to the caller's **AND list** rather than to the
 * top level, where the search's own `OR` would collide with it.
 */
function nullableIdWhere(
  field: "formatId" | "certificateStatusId",
  ids: readonly string[] | undefined,
  nullSentinel: string
): Prisma.ItemWhereInput | null {
  if (!ids || ids.length === 0) return null;
  const wantsNull = ids.includes(nullSentinel);
  const real = ids.filter((id) => id !== nullSentinel);
  if (!wantsNull) return { [field]: { in: real } };
  if (real.length === 0) return { [field]: null };
  return { OR: [{ [field]: null }, { [field]: { in: real } }] };
}

function buildItemWhere(
  collectionId: string,
  filters: ItemListFiltersPaginated,
  locationIds: string[] | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // Constraints on the linked stamp (issue membership, area membership, year) live under a
  // single `stamp` relation filter so they compose without clobbering each other.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stampWhere: any = {};
  if (filters.issueId) {
    // `NO_ISSUE` is a value on this axis, not the absence of the filter (#424): it is what an
    // issue group of copies belonging to no series addresses its own members with.
    stampWhere.issueMemberships =
      filters.issueId === NO_ISSUE ? { none: {} } : { some: { issueId: filters.issueId } };
  }
  if (filters.areaIds && filters.areaIds.length > 0) {
    stampWhere.stampAreaLinks = { some: { collectionAreaId: { in: filters.areaIds } } };
  }
  if (filters.year !== undefined) {
    stampWhere.issuedYear = filters.year === "none" ? null : filters.year;
  }
  // Constraints that would otherwise collide on the same top-level key (several
  // `offerSetMemberships` filters, the search `OR`) are collected here and AND-ed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const and: any[] = [];
  if (filters.search) {
    const s = filters.search;
    // Free text spans two levels — the linked stamp's identity and the copy's own filing
    // reference (#303) — so the OR sits on the item, not inside `stampWhere` (whose other
    // entries must stay AND-ed).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const or: any[] = [
      { stamp: { name: { contains: s, mode: "insensitive" } } },
      {
        stamp: {
          issueMemberships: { some: { issue: { name: { contains: s, mode: "insensitive" } } } },
        },
      },
      { stamp: { catalogNumbers: { some: { number: { contains: s, mode: "insensitive" } } } } },
      { locationRef: { contains: s, mode: "insensitive" } },
    ];
    // Internal copy number (#268): a purely numeric entry also looks up the copy by its own
    // number, in whichever form the collector read off the label (`123`, `00123`, `#00123`).
    // Added to the OR rather than replacing it — `200` is a plausible catalog number too.
    const itemNo = parseItemNoSearch(s);
    if (itemNo !== null) or.push({ itemNo });
    // Prefixed catalog input (#146): match the parsed number (narrowed to a vendor
    // when one was recognized) so "Mi PL 200" resolves even though the raw text
    // isn't a substring of the stored "200".
    if (filters.catalogNumber) {
      or.push({
        stamp: {
          catalogNumbers: {
            some: {
              number: { contains: filters.catalogNumber, mode: "insensitive" },
              ...(filters.catalogVendorId ? { catalogVendorId: filters.catalogVendorId } : {}),
            },
          },
        },
      });
    }
    and.push({ OR: or });
  }
  if (filters.notOfferedPlatformId) {
    // "For sale, not yet offered on platform X" (#259): exclude copies already sitting in a
    // non-terminal offer on that platform…
    and.push({
      offerSetMemberships: {
        none: {
          offerSet: {
            offer: {
              platformId: filters.notOfferedPlatformId,
              state: { notIn: [...CLOSED_OFFER_STATES] },
            },
          },
        },
      },
    });
    // …and copies held by an offer in active bidding on *any* platform (#334). A bid commits
    // the copy to a pending sale, so listing it again elsewhere would risk double-selling —
    // the same availability principle that hides sold copies (#207).
    and.push({
      offerSetMemberships: {
        none: { offerSet: { offer: { state: "active", inActiveBidding: true } } },
      },
    });
    // …and copies that never arrived or arrived damaged: they are paid for but not in hand and
    // never will be, so they can't be listed. The in-flight states stay — a copy still on its
    // way is exactly what one plans a listing for.
    and.push({ deliveryState: { notIn: [...UNAVAILABLE_DELIVERY_STATES] } });
    // …and the copies the collector has decided are never listed there (#506). Every other clause
    // here says a copy *cannot* be listed yet; this one says the question has been answered.
    and.push({
      platformExclusions: { none: { platformId: filters.notOfferedPlatformId } },
    });
  }
  // The review read (#506) — what was set aside on this platform, so it can be audited and undone.
  // Deliberately not paired with a disposition: this filter answers about the decision itself.
  if (filters.excludedPlatformId) {
    and.push({
      platformExclusions: { some: { platformId: filters.excludedPlatformId } },
    });
  }
  const formats = nullableIdWhere("formatId", filters.formatIds, "single");
  if (formats) and.push(formats);
  const certificates = nullableIdWhere(
    "certificateStatusId",
    filters.certificateStatusIds,
    "none"
  );
  if (certificates) and.push(certificates);
  // "No ref" (#421) is two stored values — null, and the empty string a cleared field can leave —
  // so it goes in the AND list rather than as a top-level `OR` the search would collide with.
  if (filters.locationRef === NO_LOCATION_REF) {
    and.push({ OR: [{ locationRef: null }, { locationRef: "" }] });
  }
  if (filters.attachableToLotId) {
    // Two branches rather than one `lotId: { not: … }`: a copy on no lot must pass, and an
    // inequality is not a reliable way to say that about a nullable column.
    and.push({
      OR: [
        { lotId: null },
        {
          AND: [
            { lotId: { not: filters.attachableToLotId } },
            { lot: { status: "open" } },
          ],
        },
      ],
    });
  }

  return {
    collectionId,
    // One condition or several, one shape (#425): a single-entry `in` is what a duplicate group's
    // member read passes, so the axis has exactly one filter on it.
    ...(filters.conditionIds && filters.conditionIds.length > 0
      ? { conditionId: { in: filters.conditionIds } }
      : {}),
    ...(filters.stampId ? { stampId: filters.stampId } : {}),
    ...(filters.ids ? { id: { in: filters.ids } } : {}),
    ...(filters.excludeIds && filters.excludeIds.length > 0
      ? { id: { notIn: filters.excludeIds } }
      : {}),
    ...(Object.keys(stampWhere).length > 0 ? { stamp: stampWhere } : {}),
    // The unfiled bucket is a value, not the absence of a filter (#421); a resolved subtree is the
    // ordinary case (#56/#385).
    ...(filters.locationId === NO_LOCATION
      ? { locationId: null }
      : locationIds
        ? { locationId: { in: locationIds } }
        : {}),
    ...(filters.locationRef && filters.locationRef !== NO_LOCATION_REF
      ? { locationRef: filters.locationRef }
      : {}),
    ...(filters.lotId ? { lotId: filters.lotId } : {}),
    ...(filters.deliveryStates && filters.deliveryStates.length > 0
      ? { deliveryState: { in: filters.deliveryStates } }
      : {}),
    ...(filters.excludeSold ? { saleLineItems: { none: {} } } : {}),
    // Disposed copies are hidden unless asked for (#395) — `disposedAt` doubles as the flag, so
    // this stays a plain `where` rather than a derived narrowing.
    ...(filters.includeDisposed ? {} : { disposedAt: null }),
    ...(filters.notInOfferId
      ? { offerSetMemberships: { none: { offerSet: { offerId: filters.notInOfferId } } } }
      : {}),
    ...(filters.inCollection !== undefined ? { inCollection: filters.inCollection } : {}),
    ...(filters.forTrade !== undefined ? { forTrade: filters.forTrade } : {}),
    ...(filters.noPhotos ? { photos: { none: {} } } : {}),
    // The not-offered-on-platform filter (#259) implies the for-sale disposition; its offer
    // exclusions live in `and` above. Merged with the explicit forSale toggle so both being
    // set is a no-op, not a clobbered constraint.
    ...(filters.notOfferedPlatformId
      ? { forSale: true }
      : filters.forSale !== undefined
        ? { forSale: filters.forSale }
        : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

/** The ids of copies matching `baseWhere` whose catalog valuation is `unpriced` — no price
 * recorded for the copy's own condition × certificate (#229). "Unpriced" is derived (no column
 * carries it), so this valuates the whole matching set once; callers then narrow their read to
 * `id IN (…)`, keeping pagination/aggregation in SQL and the list, holdings total, and year
 * facets consistent under the "missing catalog value" filter. */
async function resolveMissingCatalogItemIds(
  collectionId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseWhere: any
): Promise<string[]> {
  const rows = await prisma.item.findMany({
    where: baseWhere,
    select: {
      id: true,
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      stamp: { select: { parentId: true, variants: { select: VARIANT_FLAG_SELECT } } },
    },
  });
  const valuationRows: ValuationRow[] = rows.map((row) => ({
    id: row.id,
    stampId: row.stampId,
    conditionId: row.conditionId,
    certificateStatusId: row.certificateStatusId,
    formatId: row.formatId,
    unknownVariant:
      isUnknownVariantStamp(row.stamp),
  }));
  const valuations = await valuateItemRows(collectionId, valuationRows);
  return rows.filter((row) => valuations.get(row.id)!.unpriced).map((row) => row.id);
}

/** Wrap a base `where` so it also matches only copies missing a catalog value, when the filter
 * is set (#229). Returns the base `where` untouched otherwise. Kept as a helper so the list,
 * holdings, and year-facet reads narrow identically. */
async function withMissingCatalogFilter(
  collectionId: string,
  filters: ItemListFiltersPaginated,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseWhere: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (!filters.missingCatalogValue) return baseWhere;
  const ids = await resolveMissingCatalogItemIds(collectionId, baseWhere);
  return { AND: [baseWhere, { id: { in: ids } }] };
}

/** A copy enriched with the display data the list screen needs: the linked stamp's
 * identity (catalog numbers, name, issued date, owning issue), condition and
 * certificate labels, disposition flags, and acquisition/purchase fields. */
export interface ItemListItem {
  id: string;
  /** Internal copy number (#268): per-collection, assigned on creation, never editable.
   *  Rendered through `formatItemNo` (`#00123`). */
  itemNo: number;
  stampId: string;
  stampName: string | null;
  /** True when the copy links to a base stamp (parentId === null) that has variants,
   * i.e. the specific variant is unknown (ADR-0007 §2). */
  unknownVariant: boolean;
  /** The linked stamp's subtype for display (#340), or null for a base stamp. */
  subtype: SubtypeLabel | null;
  /** True when the copy has at least one `ItemVariantHistory` entry (has been refined). */
  hasHistory: boolean;
  /** True when the copy has left on a sale line (#166). Sold copies are hidden by default and only
   * appear when *Include sold* is on (#207), which is exactly when the row needs to say so (#393).
   * Soldness stays outside `isHeld` (#394) — it has its own mechanism at every reader. */
  sold: boolean;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  catalogNumbers: { catalogVendorId: string; number: string }[];
  /** The stamp's Colnect Marketplace item-ID (#247), or null when unset — shown as a
   *  link to its Colnect page next to the catalog numbers (#290). */
  colnectId: string | null;
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
  /** Physical format; null = single. A multiple is one row, never N single rows. */
  formatId: string | null;
  formatName: string | null;
  formatAbbreviation: string | null;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  /** Platforms this copy is never to be listed on (#506) — the collector's own decision, not a
   * property of the goods. Ids only: the row resolves the names from the collection's contacts,
   * exactly as it resolves locations. */
  excludedPlatformIds: string[];
  /** Acquisition link: the `PurchaseLot` this copy came from (ADR-0009), or null. */
  lotId: string | null;
  /** Owning lot's lifecycle status (`open | closed`), or null when the copy has no lot.
   * Feeds `resolveCostBasis` so a null cost-basis on an open lot reads as **pending**
   * rather than "no cost" (#123). */
  lotStatus: string | null;
  /** The purchase order the owning lot belongs to (#387), or null when the copy has no lot.
   * `label` is what the row menu names it by — supplier + date, the same pair the purchases
   * list leads with — so "Go to purchase" says *which* purchase before it navigates. */
  purchase: { id: string; label: string } | null;
  /** Physical delivery axis (ADR-0009 §5): in_transit | delivered | not_delivered | damaged. */
  deliveryState: string;
  /** Disposal axis (#394): when this copy stopped being held, or null while it still is. */
  disposedAt: Date | null;
  /** Why it stopped being held: lost | damaged | other, or null. */
  disposalReason: string | null;
  /** Free-text detail on the disposal; required when the reason is `other`. */
  disposalNote: string | null;
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

/** Prisma select producing every field {@link toItemListItem} needs to build an
 * `ItemListItem`. Shared by the Copies list and the lot-intake reads (#172) so every
 * screen enriches copies identically. */
const ITEM_LIST_SELECT = {
  id: true,
  itemNo: true,
  stampId: true,
  inCollection: true,
  forSale: true,
  forTrade: true,
  lotId: true,
  lot: {
    select: {
      status: true,
      // The owning order, for the copy's "Go to purchase" action (#387).
      purchase: {
        select: { id: true, purchasedAt: true, contact: { select: { name: true } } },
      },
    },
  },
  deliveryState: true,
  disposedAt: true,
  disposalReason: true,
  disposalNote: true,
  costBasis: true,
  notes: true,
  locationId: true,
  locationRef: true,
  createdAt: true,
  // `variantHistory` drives the "refined" marker; `saleLineItems` is the copy's soldness (#393) —
  // the very relation `excludeSold` filters on (#207), so the chip and the filter cannot disagree.
  _count: { select: { variantHistory: true, saleLineItems: true } },
  // The platforms this copy is kept off (#506) — the same relation the *not offered on X* filter
  // narrows by, so the row's chip and the worklist can never disagree.
  platformExclusions: { select: { platformId: true } },
  photos: { select: { id: true, role: true, title: true, sortOrder: true } },
  condition: { select: { id: true, name: true, abbreviation: true } },
  certificateStatus: { select: { id: true, name: true } },
  format: { select: { id: true, name: true, abbreviation: true } },
  stamp: {
    select: {
      parentId: true,
      name: true,
      issuedDay: true,
      issuedMonth: true,
      issuedYear: true,
      catalogNumbers: { select: { catalogVendorId: true, number: true } },
      colnectId: true,
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      variants: { select: VARIANT_FLAG_SELECT },
      // The copy's own stamp's subtype, for the row's chip (#340).
      subtype: { select: { name: true, isDefault: true } },
      issueMemberships: {
        ...FIRST_ISSUE_MEMBERSHIP,
        select: { issue: { select: { id: true, name: true, year: true } } },
      },
    },
  },
} satisfies Prisma.ItemSelect;

type ItemListRow = Prisma.ItemGetPayload<{ select: typeof ITEM_LIST_SELECT }>;

/** The valuation input for one enriched copy row — its stamp/condition/certificate/format plus
 * the unknown-variant flag — as consumed by {@link valuateItemRows}. */
function valuationInputFromRow(row: ItemListRow): ValuationRow {
  return {
    id: row.id,
    stampId: row.stampId,
    conditionId: row.condition.id,
    certificateStatusId: row.certificateStatus?.id ?? null,
    formatId: row.format?.id ?? null,
    unknownVariant:
      isUnknownVariantStamp(row.stamp),
  };
}

/** Map an enriched copy row plus its resolved catalog valuation into the list-item shape. */
function toItemListItem(row: ItemListRow, valuation: CopyValuation): ItemListItem {
  const firstIssue = row.stamp.issueMemberships[0]?.issue ?? null;
  const primaryLink = row.stamp.stampAreaLinks.find((l) => l.isPrimary);
  const areaId =
    primaryLink?.collectionAreaId ?? row.stamp.stampAreaLinks[0]?.collectionAreaId ?? null;
  return {
    id: row.id,
    itemNo: row.itemNo,
    stampId: row.stampId,
    stampName: row.stamp.name,
    unknownVariant:
      isUnknownVariantStamp(row.stamp),
    subtype: subtypeLabel(row.stamp),
    hasHistory: row._count.variantHistory > 0,
    sold: row._count.saleLineItems > 0,
    issuedDay: row.stamp.issuedDay,
    issuedMonth: row.stamp.issuedMonth,
    issuedYear: row.stamp.issuedYear,
    catalogNumbers: row.stamp.catalogNumbers,
    colnectId: row.stamp.colnectId,
    areaId,
    issueId: firstIssue?.id ?? null,
    issueName: firstIssue?.name ?? null,
    issueYear: firstIssue?.year ?? null,
    conditionId: row.condition.id,
    conditionName: row.condition.name,
    conditionAbbreviation: row.condition.abbreviation,
    certificateStatusId: row.certificateStatus?.id ?? null,
    certificateStatusName: row.certificateStatus?.name ?? null,
    formatId: row.format?.id ?? null,
    formatName: row.format?.name ?? null,
    formatAbbreviation: row.format?.abbreviation ?? null,
    inCollection: row.inCollection,
    forSale: row.forSale,
    forTrade: row.forTrade,
    excludedPlatformIds: row.platformExclusions.map((e) => e.platformId),
    lotId: row.lotId,
    lotStatus: row.lot?.status ?? null,
    purchase: row.lot?.purchase
      ? { id: row.lot.purchase.id, label: purchaseLabel(row.lot.purchase) }
      : null,
    deliveryState: row.deliveryState,
    disposedAt: row.disposedAt,
    disposalReason: row.disposalReason,
    disposalNote: row.disposalNote,
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
    value: valuation,
  };
}

/** Valuate a set of enriched copy rows and map them to list items, preserving row order. */
async function enrichItemRows(
  collectionId: string,
  rows: ItemListRow[]
): Promise<ItemListItem[]> {
  const valuations = await valuateItemRows(collectionId, rows.map(valuationInputFromRow));
  return rows.map((row) => toItemListItem(row, valuations.get(row.id)!));
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

  const locationIds = await resolveLocationScope(collectionId, filters);

  const where = await withMissingCatalogFilter(
    collectionId,
    filters,
    buildItemWhere(collectionId, filters, locationIds)
  );
  const rows = await prisma.item.findMany({
    where,
    orderBy,
    take: pageSize + 1,
    skip: offset,
    select: ITEM_LIST_SELECT,
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const items = await enrichItemRows(collectionId, page);

  const nextCursor = hasMore ? String(offset + pageSize) : null;
  return { items, nextCursor };
}

// ── Duplicate groups (#372) ──────────────────────────────────────────────────

/** The eligibility every duplicate group is computed over: **for sale, delivered, unsold** — the
 * offer composition picker's own eligibility, because listing the group is the only thing a group
 * is for. Forced rather than merged, so the panel's delivery-state / include-sold controls cannot
 * silently produce a group nothing in it could be listed from. */
const GROUP_ELIGIBILITY = {
  forSale: true,
  deliveryStates: ["delivered"],
  excludeSold: true,
} as const satisfies Partial<ItemListFiltersPaginated>;

/** One row of the grouped Copies list: a bag of interchangeable copies (see `copy-groups.ts` for
 * what "interchangeable" means and why condition is never optional). Carries the stamp identity a
 * copy row shows, plus what the group adds — how many, how many are already listed, and where its
 * members disagree. */
export interface CopyGroupRow {
  /** Encoded {@link CopyGroupKey} + axes — the React key, and the token the row action expands. */
  key: string;
  stampId: string;
  stampName: string | null;
  unknownVariant: boolean;
  subtype: SubtypeLabel | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  catalogNumbers: { catalogVendorId: string; number: string }[];
  colnectId: string | null;
  areaId: string | null;
  issueId: string | null;
  issueName: string | null;
  issueYear: number | null;
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  /** Set only when the Format axis joins the key; null both for "single" and for "not grouped on". */
  formatId: string | null;
  formatName: string | null;
  formatAbbreviation: string | null;
  /** Set only when the Certificate axis joins the key. */
  certificateStatusId: string | null;
  certificateStatusName: string | null;
  /** How many eligible copies the group holds. */
  count: number;
  /** How many of them already sit in a non-terminal offer (any platform) — `3 of 10 already
   * listed`. Informational: which are free *for a given platform* is the listing dialog's question,
   * and it asks the copies query with `notOfferedPlatformId`. */
  listedCount: number;
  /** Members disagree on an axis currently set to *any*. Derived, never stored: with the axis
   * joined to the key this cannot occur by construction. */
  mixedFormat: boolean;
  mixedCertificate: boolean;
  /** The per-copy catalog value, when every member values identically — which is guaranteed with
   * both axes joined, since the key is then the key `valuateItemRows` is computed on. Null when
   * the members disagree; {@link CopyGroupRow.valueVaries} tells that apart from "no members". */
  value: CopyValuation | null;
  valueVaries: boolean;
}

export interface PaginatedCopyGroupsResult {
  groups: CopyGroupRow[];
  nextCursor: string | null;
}

/** The stamp identity a group row shows — the stamp half of {@link ITEM_LIST_SELECT}, resolved once
 * per page of groups rather than per member copy. */
const GROUP_STAMP_SELECT = {
  id: true,
  parentId: true,
  name: true,
  issuedDay: true,
  issuedMonth: true,
  issuedYear: true,
  catalogNumbers: { select: { catalogVendorId: true, number: true } },
  colnectId: true,
  stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
  variants: { select: VARIANT_FLAG_SELECT },
  subtype: { select: { name: true, isDefault: true } },
  issueMemberships: {
    ...FIRST_ISSUE_MEMBERSHIP,
    select: { issue: { select: { id: true, name: true, year: true } } },
  },
} satisfies Prisma.StampSelect;

/** Two valuations describing the same figure. Compared field by field rather than by identity —
 * the members are valued independently, so a group agrees when the *results* agree. */
function sameValuation(a: CopyValuation, b: CopyValuation): boolean {
  return (
    a.unpriced === b.unpriced &&
    a.uncertain === b.uncertain &&
    a.amount === b.amount &&
    a.currency === b.currency &&
    a.baseAmountDisplay === b.baseAmountDisplay
  );
}

/**
 * The Copies list collapsed to **one row per duplicate key** (#372). Grouping is computed here and
 * not in the client because the list is offset-paginated: a client-side grouping would split a
 * group across a page boundary and report two half-counts.
 *
 * Ordered **count descending**, then `stampId` — deterministic under pagination, and the order the
 * feature exists for (biggest stack of duplicates first). Which axes join the key comes from
 * `axes`; the panel's own condition / format / certificate *filters* still narrow which copies are
 * grouped at all, since grouping and filtering answer different questions.
 *
 * The page's member copies are read once (bounded: a page of groups is a page of copies) and carry
 * three things at once — the counts, the mixed markers, and the valuation agreement — so no
 * per-group query exists.
 */
export async function listItemDuplicateGroups(
  ownerId: string,
  collectionId: string,
  filters: ItemListFiltersPaginated & { axes?: CopyGroupAxes } = {}
): Promise<PaginatedCopyGroupsResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const axes = filters.axes ?? DEFAULT_GROUP_AXES;
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;

  const eligible: ItemListFiltersPaginated = { ...filters, ...GROUP_ELIGIBILITY };
  const locationIds = await resolveLocationScope(collectionId, eligible);
  const where = await withMissingCatalogFilter(
    collectionId,
    eligible,
    buildItemWhere(collectionId, eligible, locationIds)
  );

  // `by` is chosen at runtime from the axes, which Prisma's generic `groupBy` signature cannot
  // express — the alternative is four literal call sites of the same query.
  const by = [
    "stampId",
    "conditionId",
    ...(axes.format ? ["formatId"] : []),
    ...(axes.certificate ? ["certificateStatusId"] : []),
  ];
  const grouped: {
    stampId: string;
    conditionId: string;
    formatId?: string | null;
    certificateStatusId?: string | null;
  }[] =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.item.groupBy as any)({
      by,
      where,
      // Selected because it is what the ordering reads: biggest stack of duplicates first, then
      // `stampId` so the order is total and pagination cannot repeat or skip a group.
      _count: { id: true },
      orderBy: [{ _count: { id: "desc" } }, { stampId: "asc" }],
      take: pageSize + 1,
      skip: offset,
    });

  const hasMore = grouped.length > pageSize;
  const page = hasMore ? grouped.slice(0, pageSize) : grouped;
  const nextCursor = hasMore ? String(offset + pageSize) : null;
  if (page.length === 0) return { groups: [], nextCursor };

  const keys: CopyGroupKey[] = page.map((g) => ({
    stampId: g.stampId,
    conditionId: g.conditionId,
    formatId: axes.format ? (g.formatId ?? null) : null,
    certificateStatusId: axes.certificate ? (g.certificateStatusId ?? null) : null,
  }));

  // Every member of this page's groups, in one read narrowed by the same `where` — so a member can
  // never be one the filters excluded. `offerSetMemberships` is probed (take 1) rather than
  // counted: the row reports *how many copies* are listed, not how many listings each is in.
  const members = await prisma.item.findMany({
    where: { AND: [where, { OR: keys.map((k) => memberWhere(k, axes)) }] },
    select: {
      id: true,
      stampId: true,
      conditionId: true,
      formatId: true,
      certificateStatusId: true,
      stamp: { select: { parentId: true, variants: { select: VARIANT_FLAG_SELECT } } },
      offerSetMemberships: {
        where: { offerSet: { offer: { state: { notIn: [...CLOSED_OFFER_STATES] } } } },
        select: { itemId: true },
        take: 1,
      },
    },
  });

  const valuations = await valuateItemRows(
    collectionId,
    members.map((m) => ({
      id: m.id,
      stampId: m.stampId,
      conditionId: m.conditionId,
      certificateStatusId: m.certificateStatusId,
      formatId: m.formatId,
      unknownVariant: isUnknownVariantStamp(m.stamp),
    }))
  );

  const membersByKey = new Map<string, typeof members>();
  for (const m of members) {
    const encoded = encodeCopyGroupKey(copyGroupKey(m, axes), axes);
    const bucket = membersByKey.get(encoded);
    if (bucket) bucket.push(m);
    else membersByKey.set(encoded, [m]);
  }

  const [stamps, conditions, formats, certificates] = await Promise.all([
    prisma.stamp.findMany({
      where: { id: { in: [...new Set(keys.map((k) => k.stampId))] } },
      select: GROUP_STAMP_SELECT,
    }),
    prisma.stampCondition.findMany({
      where: { id: { in: [...new Set(keys.map((k) => k.conditionId))] } },
      select: { id: true, name: true, abbreviation: true },
    }),
    axes.format
      ? prisma.stampFormat.findMany({
          where: { id: { in: compactIds(keys.map((k) => k.formatId)) } },
          select: { id: true, name: true, abbreviation: true },
        })
      : Promise.resolve([]),
    axes.certificate
      ? prisma.certificateStatus.findMany({
          where: { id: { in: compactIds(keys.map((k) => k.certificateStatusId)) } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const stampById = new Map(stamps.map((s) => [s.id, s]));
  const conditionById = new Map(conditions.map((c) => [c.id, c]));
  const formatById = new Map(formats.map((f) => [f.id, f]));
  const certificateById = new Map(certificates.map((c) => [c.id, c]));

  const groups: CopyGroupRow[] = [];
  for (const key of keys) {
    const encoded = encodeCopyGroupKey(key, axes);
    const bucket = membersByKey.get(encoded) ?? [];
    const stamp = stampById.get(key.stampId);
    const condition = conditionById.get(key.conditionId);
    // A group whose stamp or condition vanished between the two reads has nothing to render.
    if (!stamp || !condition) continue;
    const firstIssue = stamp.issueMemberships[0]?.issue ?? null;
    const primaryLink = stamp.stampAreaLinks.find((l) => l.isPrimary);
    const format = key.formatId ? formatById.get(key.formatId) : undefined;
    const certificate = key.certificateStatusId
      ? certificateById.get(key.certificateStatusId)
      : undefined;
    const mixed = mixedAxes(bucket, axes);
    const values = bucket.map((m) => valuations.get(m.id)!).filter(Boolean);
    const agreed = values.length > 0 && values.every((v) => sameValuation(v, values[0]));
    groups.push({
      key: encoded,
      stampId: key.stampId,
      stampName: stamp.name,
      unknownVariant: isUnknownVariantStamp(stamp),
      subtype: subtypeLabel(stamp),
      issuedDay: stamp.issuedDay,
      issuedMonth: stamp.issuedMonth,
      issuedYear: stamp.issuedYear,
      catalogNumbers: stamp.catalogNumbers,
      colnectId: stamp.colnectId,
      areaId:
        primaryLink?.collectionAreaId ?? stamp.stampAreaLinks[0]?.collectionAreaId ?? null,
      issueId: firstIssue?.id ?? null,
      issueName: firstIssue?.name ?? null,
      issueYear: firstIssue?.year ?? null,
      conditionId: condition.id,
      conditionName: condition.name,
      conditionAbbreviation: condition.abbreviation,
      formatId: key.formatId,
      formatName: format?.name ?? null,
      formatAbbreviation: format?.abbreviation ?? null,
      certificateStatusId: key.certificateStatusId,
      certificateStatusName: certificate?.name ?? null,
      count: bucket.length,
      listedCount: bucket.filter((m) => m.offerSetMemberships.length > 0).length,
      mixedFormat: mixed.format,
      mixedCertificate: mixed.certificate,
      value: agreed ? values[0] : null,
      valueVaries: values.length > 0 && !agreed,
    });
  }
  return { groups, nextCursor };
}

// ── Filing groups: by location and by ref (#421) ─────────────────────────────

/** One row of the Copies list grouped by where its copies are filed. Deliberately thin next to
 * {@link CopyGroupRow}: a filing group is a *place*, so the row states the place and how many
 * copies are in it, and the copies themselves are what the expanded members show. */
export interface LocationGroupRow {
  /** Stable per-group key — the React key. Built, never parsed: members are addressed by the
   * row's own fields. */
  key: string;
  /** Null is the unfiled bucket — copies with no location at all. */
  locationId: string | null;
  /** Breadcrumb path (`Szafa 1 › Klaser A`), resolved once for the whole page. */
  locationPath: string | null;
  /** The location's own name, for the row's lead line. */
  locationName: string | null;
  /** Set in `ref` mode only; null is "no ref written on these copies". */
  locationRef: string | null;
  /** How many copies of the *filtered* set this group holds. */
  count: number;
}

export interface PaginatedLocationGroupsResult {
  groups: LocationGroupRow[];
  nextCursor: string | null;
}

/**
 * The Copies list collapsed to **one row per storage location** — or, in `ref` mode, per
 * `(location, ref)` pair (#421). Grouped server-side for the same reason duplicate groups are
 * (#372): the list is offset-paginated, and a client-side grouping would split a group at a page
 * boundary and report two half-counts.
 *
 * Unlike duplicate grouping this forces **no eligibility**. Where a copy is filed is a question
 * about the whole list — the sold copy still on the shelf is exactly the one being looked for — so
 * the panel's own filters are all that narrow it, `Include sold` and `Include no longer held`
 * included.
 *
 * The groups are read **whole** and paged in memory, because the reading order is by location path
 * and then by {@link compareLocationRef}'s prefix-then-number rule (#330), neither of which SQL can
 * express. That is affordable and bounded: a collection has as many groups as it has locations
 * (times the refs actually in use), not as many as it has copies. The order is total, so paging over
 * it can neither repeat nor skip a group.
 */
export async function listItemLocationGroups(
  ownerId: string,
  collectionId: string,
  filters: ItemListFiltersPaginated & { by?: LocationGroupBy } = {}
): Promise<PaginatedLocationGroupsResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const by: LocationGroupBy = filters.by ?? "location";
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;

  const locationIds = await resolveLocationScope(collectionId, filters);
  const where = await withMissingCatalogFilter(
    collectionId,
    filters,
    buildItemWhere(collectionId, filters, locationIds)
  );

  const [grouped, locations] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.item.groupBy as any)({
      by: by === "ref" ? ["locationId", "locationRef"] : ["locationId"],
      where,
      _count: { id: true },
    }) as Promise<
      { locationId: string | null; locationRef?: string | null; _count: { id: number } }[]
    >,
    prisma.location.findMany({
      where: { collectionId },
      select: { id: true, name: true, parentId: true },
    }),
  ]);

  const locationById = new Map(locations.map((l) => [l.id, l]));

  // Fold the raw buckets into the rows the list shows. A blank ref and a null one are one group —
  // "nothing is written on these" — which the database cannot merge for us.
  const rows = new Map<string, LocationGroupRow>();
  for (const g of grouped) {
    const locationRef = by === "ref" ? (g.locationRef?.trim() || null) : null;
    const key = locationGroupKey({ locationId: g.locationId, locationRef }, by);
    const existing = rows.get(key);
    if (existing) {
      existing.count += g._count.id;
      continue;
    }
    rows.set(key, {
      key,
      locationId: g.locationId,
      locationPath: buildLocationPath(locations, g.locationId),
      locationName: g.locationId ? (locationById.get(g.locationId)?.name ?? null) : null,
      locationRef,
      count: g._count.id,
    });
  }

  const ordered = [...rows.values()].sort(compareLocationGroups);
  const page = ordered.slice(offset, offset + pageSize);
  const nextCursor = offset + pageSize < ordered.length ? String(offset + pageSize) : null;
  return { groups: page, nextCursor };
}

// ── Issue groups (#424) ──────────────────────────────────────────────────────

/** One row of the Copies list grouped by the issue its copies belong to. Thin like a filing group
 * (#421) and for the same reason: a series is a *subject*, so the row names it and counts what is
 * held under it, and what those copies are is the question the member rows answer. */
export interface IssueGroupRow {
  /** Stable per-group key — the React key, and the value the members are read back with: an issue
   * id, or `NO_ISSUE` for the copies whose stamp is in no issue. */
  key: string;
  /** Null is the issue-less bucket. */
  issueId: string | null;
  /** Ready-made label (`Chopin (1949)`), written by the shared `issueGroupLabel`. */
  label: string;
  issueName: string | null;
  issueYear: number | null;
  /** How many copies of the *filtered* set this group holds. */
  count: number;
}

export interface PaginatedIssueGroupsResult {
  groups: IssueGroupRow[];
  nextCursor: string | null;
}

/**
 * The Copies list collapsed to **one row per issue** (#424) — "what have I got of this series",
 * which is the reading a collector works a set through. Grouped server-side for the same reason the
 * duplicate (#372) and filing (#421) groups are: the list is offset-paginated, and a client-side
 * grouping would split a group at a page boundary and report two half-counts.
 *
 * Like the filing groups and unlike the duplicate ones this forces **no eligibility** — what a
 * collector holds of a series includes the copy that has sold and the one no longer held, if the
 * panel's own filters let them through.
 *
 * A group is *counted* on the first membership and its members are *read back* through the ordinary
 * `issueId` filter, which matches **any** membership — the same pair the lot intake's issue groups
 * have carried since #172, and deliberately not a third rule. They differ only for a stamp filed in
 * two issues, which is not how the model is used in practice (the valuation read says as much), and
 * the alternative — an issue filter meaning "and no earlier one" — would make the sidebar's own
 * issue filter answer a question nobody asks of it.
 *
 * The issue lives on the *stamp*, which `groupBy` cannot reach, so the matching copies are read and
 * counted in memory — the same shape `listItemYearFacets` uses for the year, which is on the stamp
 * for the same reason. Only the two ids come back per row, so the cost is one narrow scan of the
 * filtered set rather than a page of enriched copies.
 *
 * The groups are then read **whole** and paged in memory, because the reading order is the Issues
 * list's own (`compareIssueGroups`) and the counts are the whole point. That is bounded by the
 * number of issues a collection has entered, not by its copies. The order is total, so paging over
 * it can neither repeat nor skip a group.
 */
export async function listItemIssueGroups(
  ownerId: string,
  collectionId: string,
  filters: ItemListFiltersPaginated = {}
): Promise<PaginatedIssueGroupsResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = filters.pageSize ?? 50;
  const offset = filters.offset ?? 0;

  const locationIds = await resolveLocationScope(collectionId, filters);
  const where = await withMissingCatalogFilter(
    collectionId,
    filters,
    buildItemWhere(collectionId, filters, locationIds)
  );

  const rows = await prisma.item.findMany({
    where,
    select: {
      stamp: {
        select: {
          // A copy is reported under **one** issue — its stamp's first membership, the same one
          // `ItemListItem.issueId` reports and the lot intake groups on (#172) — so the groups
          // partition the list and their counts add up to it.
          issueMemberships: {
            ...FIRST_ISSUE_MEMBERSHIP,
            select: {
              issue: {
                select: { id: true, name: true, year: true, primaryCatalogSortKey: true },
              },
            },
          },
        },
      },
    },
  });

  const groups = new Map<string, IssueGroupRow & SortableIssueGroup>();
  for (const row of rows) {
    const issue = row.stamp.issueMemberships[0]?.issue ?? null;
    const key = issue?.id ?? NO_ISSUE;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(key, {
      key,
      issueId: issue?.id ?? null,
      label: issueGroupLabel(issue?.id ?? null, issue?.name ?? null, issue?.year ?? null),
      issueName: issue?.name ?? null,
      issueYear: issue?.year ?? null,
      catalogSortKey: issue?.primaryCatalogSortKey ?? null,
      count: 1,
    });
  }

  const ordered = [...groups.values()].sort(compareIssueGroups);
  const page = ordered.slice(offset, offset + pageSize);
  const nextCursor = offset + pageSize < ordered.length ? String(offset + pageSize) : null;
  // `catalogSortKey` is an ordering input, not something a row states — it is a denormalized
  // column, and a screen has the catalog numbers themselves.
  return {
    groups: page.map(({ key, issueId, label, issueName, issueYear, count }) => ({
      key,
      issueId,
      label,
      issueName,
      issueYear,
      count,
    })),
    nextCursor,
  };
}

/** The `where` addressing exactly one group's members. Only the axes that joined the key are
 * constrained — an axis set to *any* must not narrow, or the group's own members would be split. */
function memberWhere(key: CopyGroupKey, axes: CopyGroupAxes): Prisma.ItemWhereInput {
  return {
    stampId: key.stampId,
    conditionId: key.conditionId,
    ...(axes.format ? { formatId: key.formatId } : {}),
    ...(axes.certificate ? { certificateStatusId: key.certificateStatusId } : {}),
  };
}

function compactIds(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => !!id))];
}

// Delivery states that still await the sort pass — the close-confirmation warning's count
// (#121). Deliberately wider than the "to sort" chip: a lot whose copies are still `ordered`
// has not been through the sort pass either, and closing it should still warn.
const UNSORTED_DELIVERY_STATES = new Set(["ordered", "to_sort", "in_transit"]);

// The one state the "to sort" chip and its filter address (#375). A copy still `ordered` or
// `in_transit` has not arrived, so it is not waiting on the collector's sort pass — counting it
// under "to sort" sent them looking for a copy that is not on the table yet.
const TO_SORT_DELIVERY_STATE = "to_sort";

/** A staying copy that blocks a lot close: it is not excluded from the allocation
 * (delivery ≠ not_delivered) yet carries no base-currency catalog weight (#121). */
function isBlockingCopy(item: ItemListItem): boolean {
  return item.deliveryState !== "not_delivered" && item.value.baseAmount == null;
}

export type LotCopySort = "added" | "year" | "catalog" | "price" | "name";
export type LotCopyFilter = "none" | "unpriced" | "to-sort" | "no-photos";

export interface LotIntakePageOptions {
  sort?: LotCopySort;
  sortDir?: "asc" | "desc";
  filter?: LotCopyFilter;
  /** Restrict to a single issue group: an issue id, or `"__none__"` for copies with no issue.
   * Feeds the grouped-by-issue lot view's per-group pagination (#172). */
  issueKey?: string;
  offset?: number;
  pageSize?: number;
}

/** Prisma `where` fragment narrowing intake reads to a single lot or a whole purchase's lots. */
function issueKeyWhere(issueKey: string | undefined): Prisma.ItemWhereInput {
  if (!issueKey) return {};
  return issueKey === "__none__"
    ? { stamp: { issueMemberships: { none: {} } } }
    : { stamp: { issueMemberships: { some: { issueId: issueKey } } } };
}

/** One page of copies within a scope (a lot, or a whole purchase's lots), ordered/filtered
 * server-side so pagination is correct at any size (#172). `scopeWhere` is the collection-scoped
 * base (`{ lotId }` or `{ lot: { purchaseId } }`). `nextCursor` is the next offset or null. */
async function getIntakePage(
  ownerId: string,
  collectionId: string,
  scopeWhere: Prisma.ItemWhereInput,
  opts: LotIntakePageOptions
): Promise<PaginatedItemsResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const sort = opts.sort ?? "added";
  const sortDir = opts.sortDir ?? "asc";
  const filter = opts.filter ?? "none";
  const pageSize = opts.pageSize ?? 50;
  const offset = opts.offset ?? 0;
  const issueWhere = issueKeyWhere(opts.issueKey);

  // Fast path: the natural "added" order plus column-expressible filters page directly in SQL,
  // valuating only the returned page. Sorting by catalog/price or filtering "unpriced" depends
  // on each copy's derived valuation, which no single column carries, so those fall back to
  // enriching the whole scope and applying the shared `sortCopies` before slicing — byte-for-byte
  // identical to the client ordering, at the cost of valuing the scope per page fetch.
  const needsWholeSet = sort !== "added" || filter === "unpriced";

  if (!needsWholeSet) {
    const rows = await prisma.item.findMany({
      where: {
        collectionId,
        ...scopeWhere,
        ...issueWhere,
        ...(filter === "to-sort" ? { deliveryState: TO_SORT_DELIVERY_STATE } : {}),
        ...(filter === "no-photos" ? { photos: { none: {} } } : {}),
      },
      // `id` breaks ties on the non-unique `createdAt` so offset pagination is stable — bulk
      // intake can stamp many copies with near-identical timestamps (#172).
      orderBy: [{ createdAt: sortDir }, { id: sortDir }],
      take: pageSize + 1,
      skip: offset,
      select: ITEM_LIST_SELECT,
    });
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const items = await enrichItemRows(collectionId, page);
    return { items, nextCursor: hasMore ? String(offset + pageSize) : null };
  }

  const rows = await prisma.item.findMany({
    where: { collectionId, ...scopeWhere, ...issueWhere },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: ITEM_LIST_SELECT,
  });
  const all = await enrichItemRows(collectionId, rows);
  const areas = await getCollectionAreas(ownerId, collectionId);
  const { primaryVendorByArea } = buildAreaVendorMaps(areas);

  const filtered =
    filter === "unpriced"
      ? all.filter(isBlockingCopy)
      : filter === "to-sort"
        ? all.filter((i) => i.deliveryState === TO_SORT_DELIVERY_STATE)
        : filter === "no-photos"
          ? all.filter((i) => i.photos.length === 0)
          : all;
  const sorted = sortCopies(filtered, sort, sortDir, primaryVendorByArea);
  const slice = sorted.slice(offset, offset + pageSize);
  const hasMore = offset + pageSize < sorted.length;
  return { items: slice, nextCursor: hasMore ? String(offset + pageSize) : null };
}

/** One page of a lot's copies, ordered/filtered server-side so pagination is correct at any
 * lot size (#172), replacing the old 1000-copy cap. */
export async function getLotIntakePage(
  ownerId: string,
  collectionId: string,
  lotId: string,
  opts: LotIntakePageOptions = {}
): Promise<PaginatedItemsResult> {
  return getIntakePage(ownerId, collectionId, { lotId }, opts);
}

/** One page of a whole purchase's copies (across all its lots), for the order-level intake view
 * with "By lot" grouping off — a single globally-ordered flat/by-issue stream (#172). */
export async function getPurchaseIntakePage(
  ownerId: string,
  collectionId: string,
  purchaseId: string,
  opts: LotIntakePageOptions = {}
): Promise<PaginatedItemsResult> {
  return getIntakePage(ownerId, collectionId, { lot: { purchaseId } }, opts);
}

/** One issue group within a lot, for the grouped-by-issue view's headers (#121/#172). */
export interface LotIssueGroupSummary {
  /** Issue id, or `"__none__"` for copies with no issue. */
  key: string;
  label: string;
  /** Copies in this lot under this issue. */
  count: number;
  /** Of those, copies whose owning lot is still open (bulk-action target scope). */
  openCount: number;
}

/** Bundle catalog value + actual purchase cost over a set of already-enriched copies into a
 * `HoldingsSummary` (#179), reusing the same pure aggregators as the holdings bar (#134) so the
 * lot/PO summaries compare paid-vs-catalog exactly the way the Copies screen does. No extra
 * query — every enriched copy already carries its `value`, `costBasis`, and `lotStatus`. */
function summarizeHoldings(items: ItemListItem[], baseCurrency: string): HoldingsSummary {
  // Same held/gone partition as `makeHoldingsSummarizer` (#396) — a purchase's own screens value
  // what arrived, and report what did not as a write-off rather than as a hole in the total.
  const held = items.filter(isHeld);
  const gone = items.filter((i) => !isHeld(i));
  const costOf = (i: ItemListItem): CostBasisInput => ({
    costBasis: i.costBasis,
    lotId: i.lotId,
    lotStatus: i.lotStatus,
  });
  return {
    ...aggregateHoldings(
      held.map((i) => i.value),
      baseCurrency
    ),
    cost: aggregateCostBasis(held.map(costOf), baseCurrency),
    writeOff: {
      cost: aggregateCostBasis(gone.map(costOf), baseCurrency),
      count: gone.length,
    },
  };
}

/** Whole-lot aggregates the paginated intake views need but can no longer compute client-side
 * once copies stream in pages (#172): header counts, the live cost-estimate denominator, the
 * derived lot label, and the issue-group headers. Computed by enriching the whole lot once. */
export interface LotIntakeSummary {
  totalCount: number;
  /** Copies actually in the `to_sort` state — the "N to sort" chip and its filter (#375). */
  toSortCount: number;
  /** Copies still awaiting the sort pass (ordered / to sort / in transit) — the wider count
   * the close confirmation warns on. */
  unsortedCount: number;
  /** Staying copies with no base-currency catalog weight — these block a close. */
  blockingCount: number;
  /** Copies with no attached photos (#177) — the "no photos" filter's target count. */
  noPhotoCount: number;
  /** Σ positive base-currency catalog weight over staying copies; the denominator for the
   * per-copy live cost estimate (`poolBase * weight / estimateWeightBase`). */
  estimateWeightBase: number;
  /** Label derived from the lot's copies' catalog numbers, or null for an empty lot. The UI
   * still prefers a stored lot title over this. */
  derivedLabel: string | null;
  /** Issue groups in first-added order, for the grouped-by-issue view headers. */
  issueGroups: LotIssueGroupSummary[];
  /** Catalog value vs. actual purchase cost over the lot's copies (#179), for the CV-vs-cost
   * bar. Same shape/aggregators as the holdings bar (#134). */
  holdings: HoldingsSummary;
}

export async function getLotIntakeSummary(
  ownerId: string,
  collectionId: string,
  lotId: string
): Promise<LotIntakeSummary> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.item.findMany({
    where: { collectionId, lotId },
    orderBy: { createdAt: "asc" },
    select: ITEM_LIST_SELECT,
  });
  const all = await enrichItemRows(collectionId, rows);
  const areas = await getCollectionAreas(ownerId, collectionId);
  // The derived lot label prints catalog numbers, so it needs the per-issue prefix overrides (#377)
  // as well as the area tree — one load for the whole lot, not one per copy.
  const maps = buildAreaVendorMaps(areas, await loadIssuePrefixMap(collectionId));
  const baseCurrency = await getCollectionBaseCurrency(collectionId);

  const staying = all.filter((i) => i.deliveryState !== "not_delivered");
  const estimateWeightBase = staying.reduce(
    (sum, i) =>
      sum + (i.value.baseAmount != null && i.value.baseAmount > 0 ? i.value.baseAmount : 0),
    0
  );

  const order: string[] = [];
  const byKey = new Map<string, LotIssueGroupSummary>();
  for (const it of all) {
    const key = it.issueId ?? "__none__";
    let group = byKey.get(key);
    if (!group) {
      const label =
        it.issueId == null
          ? "No issue"
          : [it.issueName || null, it.issueYear ? `(${it.issueYear})` : null]
              .filter(Boolean)
              .join(" ") || "Untitled issue";
      group = { key, label, count: 0, openCount: 0 };
      byKey.set(key, group);
      order.push(key);
    }
    group.count += 1;
    if (it.lotStatus === "open") group.openCount += 1;
  }

  return {
    totalCount: all.length,
    toSortCount: all.filter((i) => i.deliveryState === TO_SORT_DELIVERY_STATE).length,
    unsortedCount: all.filter((i) => UNSORTED_DELIVERY_STATES.has(i.deliveryState)).length,
    blockingCount: staying.filter((i) => i.value.baseAmount == null).length,
    noPhotoCount: all.filter((i) => i.photos.length === 0).length,
    estimateWeightBase,
    derivedLabel: deriveLotLabel(all, maps),
    issueGroups: order.map((k) => byKey.get(k)!),
    holdings: summarizeHoldings(all, baseCurrency),
  };
}

/** Whole-purchase aggregates for the order-level intake view with "By lot" grouping off (#172):
 * the per-copy cost-estimate denominator **per lot** (each copy's estimate uses its own lot's
 * pool and weight base), and the issue groups merged across every lot of the purchase. */
export interface PurchaseIntakeSummary {
  totalCount: number;
  /** lot id → Σ positive base-currency catalog weight over that lot's staying copies. The
   * client computes a copy's estimate as `poolBase(lot) * weight / lotWeightBase[lotId]`. */
  lotWeightBase: Record<string, number>;
  /** Issue groups merged across all the purchase's lots, in first-added order. `openCount` is
   * copies whose owning lot is still open (the bulk-action target across the order). */
  issueGroups: LotIssueGroupSummary[];
  /** Catalog value vs. actual purchase cost over the whole order's copies (#179), for the
   * order-level CV-vs-cost bar. Same shape/aggregators as the holdings bar (#134). */
  holdings: HoldingsSummary;
}

export async function getPurchaseIntakeSummary(
  ownerId: string,
  collectionId: string,
  purchaseId: string
): Promise<PurchaseIntakeSummary> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.item.findMany({
    where: { collectionId, lot: { purchaseId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: ITEM_LIST_SELECT,
  });
  const all = await enrichItemRows(collectionId, rows);
  const baseCurrency = await getCollectionBaseCurrency(collectionId);

  const lotWeightBase: Record<string, number> = {};
  const order: string[] = [];
  const byKey = new Map<string, LotIssueGroupSummary>();
  for (const it of all) {
    if (
      it.lotId &&
      it.deliveryState !== "not_delivered" &&
      it.value.baseAmount != null &&
      it.value.baseAmount > 0
    ) {
      lotWeightBase[it.lotId] = (lotWeightBase[it.lotId] ?? 0) + it.value.baseAmount;
    }
    const key = it.issueId ?? "__none__";
    let group = byKey.get(key);
    if (!group) {
      const label =
        it.issueId == null
          ? "No issue"
          : [it.issueName || null, it.issueYear ? `(${it.issueYear})` : null]
              .filter(Boolean)
              .join(" ") || "Untitled issue";
      group = { key, label, count: 0, openCount: 0 };
      byKey.set(key, group);
      order.push(key);
    }
    group.count += 1;
    if (it.lotStatus === "open") group.openCount += 1;
  }

  return {
    totalCount: all.length,
    lotWeightBase,
    issueGroups: order.map((k) => byKey.get(k)!),
    holdings: summarizeHoldings(all, baseCurrency),
  };
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

/**
 * Minimal projection needed to value one thing from the catalog.
 *
 * Nothing here is copy-specific: it is a **stamp × condition × certificate × format**, of which a
 * physical copy is one instance and an auction lot's composition line (#353) is another. `id` is
 * only the key the result map is returned under, so a caller may key by whatever it holds.
 */
export interface ValuationRow {
  id: string;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  /** The copy's physical format (#343); null is the single. */
  formatId: string | null;
  /** True when the copy links to a base stamp that has variants (variant unknown). */
  unknownVariant: boolean;
}

const VALUATION_PRICE_SELECT = {
  price: true,
  currency: true,
  conditionId: true,
  certificateStatusId: true,
  // Required by `RawCatalogPrice` (ADR-0020): a copy is valued against prices of *its own*
  // format, and omitting the column here would let a block's price stand in for a single's.
  formatId: true,
  catalogEdition: { select: { year: true, catalogNameId: true } },
} as const;

/** Value a set of {@link ValuationRow}s. Loads the stamp prices, area primary catalogs, descendant
 * variant prices, format factors and currency rates **once** for the whole set, then applies the
 * pure `valuateCopy` rule — which is why every caller batches rather than valuing row by row.
 * Caller must have already asserted collection ownership. Returns id → valuation.
 *
 * Exported for the auction lot composition (#353), whose lines are the same shape at a null
 * certificate: re-deriving the unknown-variant rollup and the format factors there would be two
 * copies of ADR-0020 and #238 to keep in step. */
export async function valuateItemRows(
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

  const [stamps, factorLookup] = await Promise.all([
    prisma.stamp.findMany({
      where: { id: { in: [...stampIds] } },
      select: {
        id: true,
        catalogPrices: { select: VALUATION_PRICE_SELECT },
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
        // The issue anchors a format multiplier (#343) — the narrowest anchor a catalog prints one
        // against. A stamp belongs to at most one issue in practice.
        issueMemberships: { select: { issueId: true }, take: 1 },
        ...VARIANT_FLAG_SELECT,
      },
    }),
    makeFormatFactorLookup(collectionId),
  ]);

  const pricesByStamp = new Map<string, RawCatalogPrice[]>();
  const primaryCatalogByStamp = new Map<string, string | null>();
  const areaByStamp = new Map<string, string | null>();
  const issueByStamp = new Map<string, string | null>();
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
    areaByStamp.set(s.id, areaId);
    issueByStamp.set(s.id, s.issueMemberships[0]?.issueId ?? null);
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
        formatId: r.formatId,
        // Resolved against the copy's *own* stamp — a variant child's price, when the rollup uses
        // one, is scaled by the same rule, since it shares the umbrella's issue and area.
        formatFactor: factorLookup(
          r.formatId,
          areaByStamp.get(r.stampId) ?? null,
          issueByStamp.get(r.stampId) ?? null,
          r.conditionId
        ),
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
      formatId: true,
      stamp: { select: { parentId: true, variants: { select: VARIANT_FLAG_SELECT } } },
    },
  });
  const valuationRows: ValuationRow[] = rows.map((row) => ({
    id: row.id,
    stampId: row.stampId,
    conditionId: row.conditionId,
    certificateStatusId: row.certificateStatusId,
    formatId: row.formatId,
    unknownVariant:
      isUnknownVariantStamp(row.stamp),
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

  const locationIds = await resolveLocationScope(collectionId, filters);

  // The disposal exclusion is deliberately lifted here (#396). Disposed copies are hidden from the
  // list by default, so a write-off summed over the *visible* set would read 0.00 in exactly the
  // case it exists for. The bar still sums one scope — it just partitions it into held and gone,
  // which is what the write-off line makes legible. Everything else, `excludeSold` included, is
  // taken as the list left it: a realised sale is not a write-off (#168 is where it belongs).
  const where = await withMissingCatalogFilter(
    collectionId,
    { ...filters, includeDisposed: true },
    buildItemWhere(collectionId, { ...filters, includeDisposed: true }, locationIds)
  );
  const rows = await prisma.item.findMany({
    where,
    select: HOLDINGS_ROW_SELECT,
  });

  return (await makeHoldingsSummarizer(collectionId, rows))();
}

/** The copy fields a holdings summary is computed from — everything {@link makeHoldingsSummarizer}
 * reads, so any query feeding it can be checked against one shape. */
const HOLDINGS_ROW_SELECT = {
  id: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
  costBasis: true,
  lotId: true,
  lot: { select: { status: true } },
  // The two axes `isHeld` reads (#396) — which side of the summary a copy lands on.
  disposedAt: true,
  deliveryState: true,
  stamp: { select: { parentId: true, variants: { select: VARIANT_FLAG_SELECT } } },
} as const;

type HoldingsRow = Prisma.ItemGetPayload<{ select: typeof HOLDINGS_ROW_SELECT }>;

/**
 * Value an already-fetched copy set **once** (#134), then summarize it — whole, or any subset of
 * it. Split out of {@link getHoldingsValuation} because the offer summary bar (#317) needs the same
 * two totals over an explicit copy list *and* over each platform's slice of it: the valuation is
 * the expensive part (catalog prices, format factors, rates), and doing it per slice would repeat
 * it for every platform.
 *
 * The returned function takes copy ids and ignores any it was not given rows for, so a caller may
 * pass a slice's ids without pre-intersecting them.
 */
async function makeHoldingsSummarizer(
  collectionId: string,
  rows: HoldingsRow[]
): Promise<(itemIds?: string[]) => HoldingsSummary> {
  // Which copies the collector still has (#396). Everything the predicate rejects is moved to the
  // write-off side rather than dropped: a copy that is gone is worth nothing to its owner whatever
  // the catalog says, but it did cost what it cost.
  const heldIds = new Set(rows.filter(isHeld).map((r) => r.id));
  const valuationRows: ValuationRow[] = rows.map((row) => ({
    id: row.id,
    stampId: row.stampId,
    conditionId: row.conditionId,
    certificateStatusId: row.certificateStatusId,
    formatId: row.formatId,
    unknownVariant: isUnknownVariantStamp(row.stamp),
  }));

  // Actual purchase cost-basis over the same copy set (#134). Snapshots are frozen in
  // the base currency, so this needs no rate handling — unlike the catalog valuation above.
  const costById = new Map<string, CostBasisInput>(
    rows.map((row) => [
      row.id,
      {
        costBasis: row.costBasis == null ? null : row.costBasis.toString(),
        lotId: row.lotId,
        lotStatus: row.lot?.status ?? null,
      },
    ])
  );

  const valuations = await valuateItemRows(collectionId, valuationRows);
  const baseCurrency = await getCollectionBaseCurrency(collectionId);

  return (itemIds) => {
    const ids = itemIds ?? rows.map((r) => r.id);
    const held = ids.filter((id) => heldIds.has(id));
    const gone = ids.filter((id) => !heldIds.has(id) && costById.has(id));
    const writeOffCost = aggregateCostBasis(
      gone.map((id) => costById.get(id)!),
      baseCurrency
    );
    return {
      ...aggregateHoldings(
        held.map((id) => valuations.get(id)).filter((v) => v !== undefined),
        baseCurrency
      ),
      cost: aggregateCostBasis(
        held.map((id) => costById.get(id)).filter((c) => c !== undefined),
        baseCurrency
      ),
      writeOff: { cost: writeOffCost, count: gone.length },
    };
  };
}

/** Holdings summary over an explicit set of copy ids (#317) — the copies sitting under a set of
 * offers, deduplicated by the caller. Ownership is the caller's to assert; ids are still scoped to
 * the collection here so a stray id cannot pull a foreign copy into the total. */
export async function getHoldingsValuationForItems(
  collectionId: string,
  itemIds: string[]
): Promise<HoldingsSummary> {
  return (await getHoldingsValuationByGroup(collectionId, [{ key: "", itemIds }])).get("")!;
}

/** Holdings summaries for several overlapping copy sets at once (#317): the offer summary's whole
 * filtered set alongside each platform's slice of it. Every copy is fetched and valued once, so
 * adding a platform costs an aggregation, not a valuation. Returned as group key → summary; a group
 * with no copies gets an all-zero summary rather than being absent. */
export async function getHoldingsValuationByGroup(
  collectionId: string,
  groups: { key: string; itemIds: string[] }[]
): Promise<Map<string, HoldingsSummary>> {
  const allIds = [...new Set(groups.flatMap((g) => g.itemIds))];
  const rows =
    allIds.length === 0
      ? []
      : await prisma.item.findMany({
          where: { id: { in: allIds }, collectionId },
          select: HOLDINGS_ROW_SELECT,
        });
  const summarize = await makeHoldingsSummarizer(collectionId, rows);
  return new Map(groups.map((g) => [g.key, summarize(g.itemIds)]));
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
  const locationIds = await resolveLocationScope(collectionId, filters);
  const where = await withMissingCatalogFilter(
    collectionId,
    filters,
    buildItemWhere(collectionId, filters, locationIds)
  );
  const rows = await prisma.item.findMany({
    where,
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
