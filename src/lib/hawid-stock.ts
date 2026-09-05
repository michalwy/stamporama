import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { type HawidStripInput } from "./hawid";

// The collection's hawid stock (#765) — `ref-card-templates.ts`'s shape, with `StampFormat`'s
// drag order on top, because the collector's own order is what the rule breaks a tie with.
//
// **Nothing is seeded and nothing is copied.** A strip is read live by whatever is planning a page,
// exactly as a ref-card template is read live by the sheet: the stock is a statement about a drawer,
// and a drawer changes. What must not change under a printed page is the *page*, and that is the
// album's own frozen plan (#767) rather than anything held here.
//
// The rule itself lives in `hawid.ts` and knows nothing about this file.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function resolveStripCollection(stripId: string): Promise<string> {
  const strip = await prisma.hawidStrip.findUnique({
    where: { id: stripId },
    select: { collectionId: true },
  });
  if (!strip) throw new Error("Hawid strip not found.");
  return strip.collectionId;
}

/** Raised on `@@unique([collectionId, heightMm])`. Its own error rather than a generic failed save
 *  (`RefCardTemplateNameTakenError`'s rule, #569): the rule picks the shortest strip that fits, so a
 *  second row of the same height is one that could never be chosen — worth saying out loud. */
export class HawidStripHeightTakenError extends Error {
  constructor(heightMm: number) {
    super(`A ${heightMm} mm strip is already in the stock.`);
    this.name = "HawidStripHeightTakenError";
  }
}

export interface HawidStripData extends HawidStripInput {
  id: string;
  sortOrder: number;
}

const STRIP_SELECT = {
  id: true,
  heightMm: true,
  stockLengthMm: true,
  label: true,
  sortOrder: true,
} satisfies Prisma.HawidStripSelect;

/** The collection's stock in the collector's order — which is the order the box rule reads it in,
 *  and therefore the order that decides a tie between two equally short strips. */
export async function getHawidStrips(
  ownerId: string,
  collectionId: string
): Promise<HawidStripData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.hawidStrip.findMany({
    where: { collectionId },
    orderBy: { sortOrder: "asc" },
    select: STRIP_SELECT,
  });
}

function rethrowHeightClash(err: unknown, heightMm: number): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new HawidStripHeightTakenError(heightMm);
  }
  throw err;
}

export async function createHawidStrip(
  ownerId: string,
  collectionId: string,
  data: HawidStripInput
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const last = await prisma.hawidStrip.findFirst({
    where: { collectionId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  try {
    await prisma.hawidStrip.create({
      data: { collectionId, ...data, sortOrder: last ? last.sortOrder + 1 : 0 },
    });
  } catch (err) {
    rethrowHeightClash(err, data.heightMm);
  }
}

export async function updateHawidStrip(
  ownerId: string,
  stripId: string,
  data: HawidStripInput
): Promise<void> {
  const collectionId = await resolveStripCollection(stripId);
  await assertCollectionOwner(ownerId, collectionId);
  try {
    await prisma.hawidStrip.update({ where: { id: stripId }, data });
  } catch (err) {
    rethrowHeightClash(err, data.heightMm);
  }
}

/** Deletes a strip. Nothing points at one — a box is planned from the stock at read time and holds
 *  no reference — so there is no in-use check to make. What it changes is the *next* plan: a page
 *  already printed is paper, and a page already frozen (#767) keeps the plan it was frozen with. */
export async function deleteHawidStrip(ownerId: string, stripId: string): Promise<void> {
  const collectionId = await resolveStripCollection(stripId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.hawidStrip.delete({ where: { id: stripId } });
}

/** Persists a new order. `orderedIds` must be exactly the collection's strips; `sortOrder` is
 *  rewritten to match array position, as `reorderStampFormats` does. */
export async function reorderHawidStrips(
  ownerId: string,
  collectionId: string,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const existing = await prisma.hawidStrip.findMany({
    where: { collectionId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((s) => s.id));
  if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) {
    throw new Error("Reorder list does not match the collection's hawid stock.");
  }
  await prisma.$transaction(
    orderedIds.map((id, i) => prisma.hawidStrip.update({ where: { id }, data: { sortOrder: i } }))
  );
}
