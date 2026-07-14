import "server-only";
import { prisma } from "./db";
import { nameToSlugBase } from "./slug";

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
  name: string
): Promise<CreateCollectionResult> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Collection name is required.");

  const slug = await generateUniqueSlug(ownerId, trimmed);

  return prisma.collection.create({
    data: { ownerId, name: trimmed, slug },
    select: { id: true, slug: true, name: true },
  });
}

export async function getCollectionsByOwner(ownerId: string) {
  return prisma.collection.findMany({
    where: { ownerId },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, name: true, createdAt: true },
  });
}

export async function getCollectionBySlug(ownerId: string, slug: string) {
  return prisma.collection.findUnique({
    where: { ownerId_slug: { ownerId, slug } },
    select: { id: true, name: true, slug: true },
  });
}
