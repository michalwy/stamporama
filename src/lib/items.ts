import "server-only";
import { prisma } from "./db";

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

async function assertContactInCollection(
  collectionId: string,
  contactId: string
): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, collectionId },
    select: { id: true },
  });
  if (!contact) throw new Error("Contact not found in this collection.");
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
  /** Acquisition source, referencing a `Contact` (ADR-0007 §5, #108). Null when
   * not recorded. */
  contactId: string | null;
  /** Full acquisition date as `YYYY-MM-DD` (ADR-0007 §5). Null when not recorded. */
  acquiredDate: string | null;
  purchasePrice: string | null;
  purchaseCurrency: string | null;
  notes: string | null;
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
  contactId: true,
  acquiredDate: true,
  purchasePrice: true,
  purchaseCurrency: true,
  notes: true,
  createdAt: true,
} as const;

/** Prisma row → ItemData, normalizing the Decimal purchase price to a string so it
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
  contactId: string | null;
  acquiredDate: Date | null;
  purchasePrice: { toString(): string } | null;
  purchaseCurrency: string | null;
  notes: string | null;
  createdAt: Date;
}): ItemData {
  return {
    ...row,
    acquiredDate: toDateString(row.acquiredDate),
    purchasePrice: row.purchasePrice == null ? null : row.purchasePrice.toString(),
  };
}

/** Prisma `@db.Date` → `YYYY-MM-DD` string for a clean server/client boundary. */
function toDateString(value: Date | null): string | null {
  return value == null ? null : value.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` (or null) → a UTC-midnight Date for a `@db.Date` column. */
function fromDateString(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

export interface ItemCreateInput {
  stampId: string;
  conditionId: string;
  certificateStatusId?: string | null;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  /** Acquisition source contact id (ADR-0007 §5, #108). */
  contactId?: string | null;
  /** Full acquisition date as `YYYY-MM-DD`. */
  acquiredDate?: string | null;
  purchasePrice?: string | null;
  purchaseCurrency?: string | null;
  notes?: string | null;
}

export interface ItemUpdateInput {
  stampId?: string;
  conditionId?: string;
  certificateStatusId?: string | null;
  inCollection?: boolean;
  forSale?: boolean;
  forTrade?: boolean;
  /** Acquisition source contact id (ADR-0007 §5, #108). */
  contactId?: string | null;
  /** Full acquisition date as `YYYY-MM-DD`. */
  acquiredDate?: string | null;
  purchasePrice?: string | null;
  purchaseCurrency?: string | null;
  notes?: string | null;
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
  if (data.contactId) {
    await assertContactInCollection(collectionId, data.contactId);
  }
  const item = await prisma.item.create({
    data: {
      collectionId,
      stampId: data.stampId,
      conditionId: data.conditionId,
      certificateStatusId: data.certificateStatusId ?? null,
      inCollection: data.inCollection ?? true,
      forSale: data.forSale ?? false,
      forTrade: data.forTrade ?? false,
      contactId: data.contactId ?? null,
      acquiredDate: fromDateString(data.acquiredDate),
      purchasePrice: data.purchasePrice ?? null,
      purchaseCurrency: data.purchaseCurrency ?? null,
      notes: data.notes ?? null,
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
  if (data.contactId) {
    await assertContactInCollection(collectionId, data.contactId);
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
    ...(fields.contactId !== undefined ? { contactId: fields.contactId } : {}),
    ...(fields.acquiredDate !== undefined
      ? { acquiredDate: fromDateString(fields.acquiredDate) }
      : {}),
    ...(fields.purchasePrice !== undefined ? { purchasePrice: fields.purchasePrice } : {}),
    ...(fields.purchaseCurrency !== undefined
      ? { purchaseCurrency: fields.purchaseCurrency }
      : {}),
    ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
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

export type ItemSortBy = "created" | "acquired";

export interface ItemListFiltersPaginated extends ItemListFilters {
  certificateStatusId?: string;
  sortBy?: ItemSortBy;
  sortDir?: "asc" | "desc";
  offset?: number;
  pageSize?: number;
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
  /** Acquisition source contact, or null. */
  contactId: string | null;
  contactName: string | null;
  /** Full acquisition date as `YYYY-MM-DD`, or null. */
  acquiredDate: string | null;
  purchasePrice: string | null;
  purchaseCurrency: string | null;
  notes: string | null;
  createdAt: Date;
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
  const orderBy =
    filters.sortBy === "acquired"
      ? [{ acquiredDate: dir }, { createdAt: dir }]
      : [{ createdAt: dir }];

  const rows = await prisma.item.findMany({
    where: {
      collectionId,
      ...(filters.conditionId ? { conditionId: filters.conditionId } : {}),
      ...(filters.certificateStatusId
        ? { certificateStatusId: filters.certificateStatusId }
        : {}),
      ...(filters.inCollection !== undefined ? { inCollection: filters.inCollection } : {}),
      ...(filters.forSale !== undefined ? { forSale: filters.forSale } : {}),
      ...(filters.forTrade !== undefined ? { forTrade: filters.forTrade } : {}),
    },
    orderBy,
    take: pageSize + 1,
    skip: offset,
    select: {
      id: true,
      stampId: true,
      inCollection: true,
      forSale: true,
      forTrade: true,
      contactId: true,
      acquiredDate: true,
      purchasePrice: true,
      purchaseCurrency: true,
      notes: true,
      createdAt: true,
      _count: { select: { variantHistory: true } },
      condition: { select: { id: true, name: true, abbreviation: true } },
      certificateStatus: { select: { id: true, name: true } },
      contact: { select: { name: true } },
      stamp: {
        select: {
          parentId: true,
          name: true,
          issuedDay: true,
          issuedMonth: true,
          issuedYear: true,
          catalogNumbers: { select: { catalogVendorId: true, number: true } },
          _count: { select: { variants: true } },
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

  const items: ItemListItem[] = page.map((row) => {
    const firstIssue = row.stamp.issueMemberships[0]?.issue ?? null;
    return {
      id: row.id,
      stampId: row.stampId,
      stampName: row.stamp.name,
      unknownVariant: row.stamp.parentId === null && row.stamp._count.variants > 0,
      hasHistory: row._count.variantHistory > 0,
      issuedDay: row.stamp.issuedDay,
      issuedMonth: row.stamp.issuedMonth,
      issuedYear: row.stamp.issuedYear,
      catalogNumbers: row.stamp.catalogNumbers,
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
      contactId: row.contactId,
      contactName: row.contact?.name ?? null,
      acquiredDate: toDateString(row.acquiredDate),
      purchasePrice: row.purchasePrice == null ? null : row.purchasePrice.toString(),
      purchaseCurrency: row.purchaseCurrency,
      notes: row.notes,
      createdAt: row.createdAt,
    };
  });

  const nextCursor = hasMore ? String(offset + pageSize) : null;
  return { items, nextCursor };
}

export async function deleteItem(ownerId: string, itemId: string): Promise<void> {
  const collectionId = await resolveItemCollection(itemId);
  await assertCollectionOwner(ownerId, collectionId);
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
