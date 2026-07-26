import "server-only";
import { prisma } from "./db";
import { nameToSlugBase } from "./slug";
import { normalizeLanguage } from "./languages";
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
    },
  });
}
