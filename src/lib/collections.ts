import "server-only";
import { prisma } from "./db";
import { nameToSlugBase } from "./slug";
import { normalizeLanguage } from "./languages";
import { MAX_ITEM_NO_PAD, MIN_ITEM_NO_PAD, parseItemNoPad } from "./item-number";
import { MAX_BID_PERCENT, MIN_BID_PERCENT, parseBidPercent } from "./bid-recommendation";
import { parseClosedOfferPhotoTtlSetting } from "./offer-photo-cleanup-rules";
import { parseScanSheetTtlSetting } from "./scan-sheet-cleanup-rules";
import { seedDemoData, wipeDemoData } from "./demo";
import {
  recomputeIssueSortKeys,
  recomputeStampSortKeys,
} from "./catalog-sort-key-recompute";

/** Populate the denormalized catalog sort key (#181) for a whole collection after demo data is
 * seeded. Runs post-commit (the recompute reads through the plain client), which is fine for
 * seeding: nothing reads the collection's lists until the create/reset call returns. */
async function recomputeCollectionSortKeys(collectionId: string): Promise<void> {
  await recomputeIssueSortKeys(collectionId);
  await recomputeStampSortKeys(collectionId);
}
import { seedDefaultConditions } from "./conditions";
import { seedDefaultFormats } from "./stamp-formats";
import { seedDefaultSubtypes } from "./subtypes";

export async function generateUniqueSlug(
  ownerId: string,
  name: string
): Promise<string> {
  const base = nameToSlugBase(name) || "collection";

  const existing = await prisma.collection.findMany({
    where: { ownerId, slug: { startsWith: base } },
    select: { slug: true },
  });
  const existingSet = new Set(existing.map((c) => c.slug));

  if (!existingSet.has(base)) return base;
  let n = 2;
  while (existingSet.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export interface CreateCollectionResult {
  id: string;
  slug: string;
  name: string;
}

export async function createCollection(
  ownerId: string,
  name: string,
  baseCurrency: string,
  options?: { seedDemo?: boolean }
): Promise<CreateCollectionResult> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Collection name is required.");

  const slug = await generateUniqueSlug(ownerId, trimmed);

  const created = await prisma.$transaction(
    async (tx) => {
      const created = await tx.collection.create({
        data: { ownerId, name: trimmed, slug, baseCurrency },
        select: { id: true, slug: true, name: true },
      });
      await seedDefaultConditions(created.id, tx as never);
      await seedDefaultFormats(created.id, tx as never);
      await seedDefaultSubtypes(created.id, tx as never);
      if (options?.seedDemo) {
        await seedDemoData(created.id, tx as never);
      }
      return created;
    },
    // Demo seeding writes the full catalog plus a large inventory; the default
    // 5s interactive-transaction timeout is not enough.
    { timeout: 120_000, maxWait: 10_000 }
  );
  if (options?.seedDemo) await recomputeCollectionSortKeys(created.id);
  return created;
}

export async function resetCollectionToDemo(
  ownerId: string,
  collectionId: string
): Promise<void> {
  const owned = await prisma.collection.findUnique({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!owned) throw new Error("Collection not found or access denied.");

  await prisma.$transaction(
    async (tx) => {
      await wipeDemoData(collectionId, tx as never);
      await seedDemoData(collectionId, tx as never);
    },
    // Wipe + full reseed (catalog + large inventory); needs more than the
    // default 5s interactive-transaction timeout.
    { timeout: 120_000, maxWait: 10_000 }
  );
  await recomputeCollectionSortKeys(collectionId);
}

/**
 * Set the language the collection's own entity text is written in (#293). Platforms listing in
 * this language need no translations — it is excluded from the per-language inputs and resolves
 * straight to each entity's default column. Changing it does not move any text: existing
 * translation rows stay as they are, so the new default language's rows (if any) simply become
 * redundant rather than being merged in.
 */
export async function setCollectionDefaultLanguage(
  ownerId: string,
  collectionId: string,
  language: string
): Promise<void> {
  const code = normalizeLanguage(language);
  if (!code) throw new Error("A default language is required.");
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  await prisma.collection.update({
    where: { id: collectionId },
    data: { defaultLanguage: code },
  });
}

/**
 * Set how many digits an internal copy number (#268) is padded to for display. Display only: the
 * stored `Item.itemNo` is the bare integer, so this rewrites no rows and never changes which copy
 * a number points at. Listing templates may still override it per token (`{itemNo:3}`).
 */
export async function setCollectionItemNoPad(
  ownerId: string,
  collectionId: string,
  pad: number
): Promise<void> {
  const value = parseItemNoPad(pad);
  if (value === null) {
    throw new Error(
      `Width must be a whole number between ${MIN_ITEM_NO_PAD} and ${MAX_ITEM_NO_PAD}.`
    );
  }
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  await prisma.collection.update({
    where: { id: collectionId },
    data: { itemNoPad: value },
  });
}

/** The collection's configured copy-number width (#268), for the client surfaces that render one.
 * Owner-scoped like every other collection read. */
export async function getCollectionItemNoPad(
  ownerId: string,
  collectionId: string
): Promise<number> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, itemNoPad: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  return col.itemNoPad;
}

/**
 * Set how long this collection's closed offers keep their generated listing images (#577), or clear
 * the setting so the collection defers to the instance again.
 *
 * The stored value is the environment variable's own vocabulary — `off` for keep for ever, `0` to
 * purge at the next sweep, otherwise days — canonicalized here so nothing but a value the parser
 * understands ever reaches the column. `null` is not an absence of an answer to be defaulted away:
 * it *is* the answer "use the instance's", which is what the column exists to be able to say.
 */
export async function setCollectionClosedOfferPhotoTtl(
  ownerId: string,
  collectionId: string,
  raw: string | null
): Promise<void> {
  const value = parseClosedOfferPhotoTtlSetting(raw);
  if (value === undefined) {
    throw new Error(
      'Retention must be a number of days (0 or more), or "off" to keep the images for ever.'
    );
  }
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  await prisma.collection.update({
    where: { id: collectionId },
    data: { closedOfferPhotoTtlDays: value },
  });
}

/**
 * Set how long this collection keeps the retained card scans of a batch it has finished with (#578),
 * or clear the setting so the collection defers to the instance again.
 *
 * The same shape as the closed-offer period above and the same grammar — `off` for keep for ever,
 * `0` to sweep at the next pass, otherwise days — but its own column, because a collector may keep
 * card scans for ever while purging offer images weekly.
 */
export async function setCollectionScanSheetTtl(
  ownerId: string,
  collectionId: string,
  raw: string | null
): Promise<void> {
  const value = parseScanSheetTtlSetting(raw);
  if (value === undefined) {
    throw new Error(
      'Retention must be a number of days (0 or more), or "off" to keep the scans for ever.'
    );
  }
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  await prisma.collection.update({
    where: { id: collectionId },
    data: { scanSheetTtlDays: value },
  });
}

/** The three percentages a bid recommendation is built from (#508). Every one optional, so the
 * settings form can save the field that changed rather than rewriting all three. */
export interface BidPercentPatch {
  bidFloorPercent?: number;
  bidCeilingPercent?: number;
  bidFallbackPercent?: number;
}

/**
 * Set a collection's bid-recommendation percentages (#508; ADR-0029 §3, §4).
 *
 * Each is validated on its own as a positive whole percentage. Floor ≤ 100 ≤ ceiling is
 * deliberately **not** enforced: a collector may legitimately keep a band entirely below the fair
 * figure, and a rule that refused it would be this app stating a market opinion.
 */
export async function setCollectionBidPercents(
  ownerId: string,
  collectionId: string,
  patch: BidPercentPatch
): Promise<void> {
  const data: BidPercentPatch = {};
  for (const key of ["bidFloorPercent", "bidCeilingPercent", "bidFallbackPercent"] as const) {
    const raw = patch[key];
    if (raw === undefined) continue;
    const value = parseBidPercent(raw);
    if (value === null) {
      throw new Error(
        `A percentage must be a whole number between ${MIN_BID_PERCENT} and ${MAX_BID_PERCENT}.`
      );
    }
    data[key] = value;
  }
  if (Object.keys(data).length === 0) return;

  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  await prisma.collection.update({ where: { id: collectionId }, data });
}

export async function getCollectionsByOwner(ownerId: string) {
  return prisma.collection.findMany({
    where: { ownerId },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, name: true, baseCurrency: true, createdAt: true },
  });
}

export async function getCollectionBySlug(ownerId: string, slug: string) {
  return prisma.collection.findUnique({
    where: { ownerId_slug: { ownerId, slug } },
    select: {
      id: true,
      name: true,
      slug: true,
      baseCurrency: true,
      defaultLanguage: true,
      duplicateCatalogMode: true,
      itemNoPad: true,
      bidFloorPercent: true,
      bidCeilingPercent: true,
      bidFallbackPercent: true,
      closedOfferPhotoTtlDays: true,
      scanSheetTtlDays: true,
    },
  });
}
