import "server-only";
import { prisma } from "./db";
import type { PrismaClient } from "@/generated/prisma/client";

// The physical-format dictionary — pairs, blocks, strips. Same shape and lifecycle as
// `conditions.ts`: seeded on collection creation, then fully the collector's to edit.
//
// There is no "single" row and none is seeded. A null `formatId` **means single**, exactly as a
// null `certificateStatusId` means "no certificate" (ADR-0006 §2), so the list here holds only
// the multiples.

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

async function resolveFormatCollection(formatId: string): Promise<string> {
  const format = await prisma.stampFormat.findUnique({
    where: { id: formatId },
    select: { collectionId: true },
  });
  if (!format) throw new Error("Stamp format not found.");
  return format.collectionId;
}

export interface StampFormatData {
  id: string;
  name: string;
  abbreviation: string;
  sortOrder: number;
}

/**
 * Default formats seeded into every new collection, in display order. Kept in sync with the
 * backfill in `20260727090000_stamp_format_multiples`. Users can add, edit, reorder and delete
 * these afterwards — the vocabulary a collector needs depends entirely on what they collect.
 */
export const DEFAULT_FORMATS: ReadonlyArray<{
  name: string;
  abbreviation: string;
}> = [
  { name: "Horizontal pair", abbreviation: "HPair" },
  { name: "Vertical pair", abbreviation: "VPair" },
  { name: "Strip of 3", abbreviation: "Str3" },
  { name: "Block of 4", abbreviation: "Blk4" },
  { name: "Corner block of 4", abbreviation: "CB4" },
  { name: "Margin copy", abbreviation: "Marg" },
];

/**
 * Seeds the default format set for a freshly created collection. Runs inside the
 * collection-creation transaction, so it receives the transactional client.
 */
export async function seedDefaultFormats(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  await tx.stampFormat.createMany({
    data: DEFAULT_FORMATS.map((f, i) => ({
      collectionId,
      name: f.name,
      abbreviation: f.abbreviation,
      sortOrder: i,
    })),
  });
}

export async function getStampFormats(
  ownerId: string,
  collectionId: string
): Promise<StampFormatData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.stampFormat.findMany({
    where: { collectionId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, abbreviation: true, sortOrder: true },
  });
}

export async function createStampFormat(
  ownerId: string,
  collectionId: string,
  data: { name: string; abbreviation: string }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const last = await prisma.stampFormat.findFirst({
    where: { collectionId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  await prisma.stampFormat.create({
    data: {
      collectionId,
      name: data.name,
      abbreviation: data.abbreviation,
      sortOrder: last ? last.sortOrder + 1 : 0,
    },
  });
}

export async function updateStampFormat(
  ownerId: string,
  formatId: string,
  data: { name: string; abbreviation: string }
): Promise<void> {
  const collectionId = await resolveFormatCollection(formatId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampFormat.update({
    where: { id: formatId },
    data: { name: data.name, abbreviation: data.abbreviation },
  });
}

/**
 * Whether a format is referenced by a catalog price or a recorded copy, and therefore cannot be
 * deleted. Both FKs are `onDelete: Restrict`; this check surfaces a friendly error before the
 * constraint fires. Factor rows are deliberately **not** counted — they cascade, because a factor
 * is a rule *about* the format with no meaning once it is gone, unlike a price or a copy.
 */
export async function isFormatInUse(formatId: string): Promise<boolean> {
  const [prices, items] = await Promise.all([
    prisma.stampCatalogPrice.count({ where: { formatId } }),
    prisma.item.count({ where: { formatId } }),
  ]);
  return prices > 0 || items > 0;
}

export class FormatInUseError extends Error {
  constructor() {
    super("Format is in use by catalog prices or copies.");
    this.name = "FormatInUseError";
  }
}

export async function deleteStampFormat(
  ownerId: string,
  formatId: string
): Promise<void> {
  const collectionId = await resolveFormatCollection(formatId);
  await assertCollectionOwner(ownerId, collectionId);
  if (await isFormatInUse(formatId)) {
    throw new FormatInUseError();
  }
  await prisma.stampFormat.delete({ where: { id: formatId } });
}

/**
 * Persists a new display order. `orderedIds` must contain exactly the collection's format ids.
 * Rewrites `sortOrder` to match array position.
 */
export async function reorderStampFormats(
  ownerId: string,
  collectionId: string,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const existing = await prisma.stampFormat.findMany({
    where: { collectionId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((f) => f.id));
  if (
    orderedIds.length !== existingIds.size ||
    !orderedIds.every((id) => existingIds.has(id))
  ) {
    throw new Error("Reorder list does not match the collection's formats.");
  }
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.stampFormat.update({ where: { id }, data: { sortOrder: i } })
    )
  );
}
