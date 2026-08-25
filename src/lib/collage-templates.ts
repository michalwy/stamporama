import "server-only";
import { prisma } from "./db";
import type { CollageTemplateInput } from "./collage-template-rules";

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

async function resolveTemplateCollection(templateId: string): Promise<string> {
  const template = await prisma.collageTemplate.findUnique({
    where: { id: templateId },
    select: { collectionId: true },
  });
  if (!template) throw new Error("Collage template not found.");
  return template.collectionId;
}

export interface CollageTemplateData {
  id: string;
  name: string;
  /** `fixed` | `auto` (#413) — how `rows` / `columns` are read. */
  gridMode: string;
  /** Whether a cell holds a stamp's front and back side by side (#694). */
  pairSides: boolean;
  rows: number;
  columns: number;
  gapPercent: number;
  background: string;
  labelPercent: number;
}

/** The collection's collage templates (#307), ordered by name. */
export async function getCollageTemplates(
  ownerId: string,
  collectionId: string
): Promise<CollageTemplateData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.collageTemplate.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      gridMode: true,
      pairSides: true,
      rows: true,
      columns: true,
      gapPercent: true,
      background: true,
      labelPercent: true,
    },
  });
}

export async function createCollageTemplate(
  ownerId: string,
  collectionId: string,
  data: CollageTemplateInput
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.collageTemplate.create({ data: { collectionId, ...data } });
}

export async function updateCollageTemplate(
  ownerId: string,
  templateId: string,
  data: CollageTemplateInput
): Promise<void> {
  const collectionId = await resolveTemplateCollection(templateId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.collageTemplate.update({ where: { id: templateId }, data });
}

/**
 * Deletes a template. No offer references it: a template seeds its numbers onto an offer (#308)
 * rather than being pointed at, so deleting one cannot affect offers already prepared and there is
 * no in-use check to make. A platform pointing at it as its default (`Contact.defaultCollageTemplateId`)
 * is `onDelete: SetNull` — it simply loses its default and new offers start without collage numbers.
 */
export async function deleteCollageTemplate(
  ownerId: string,
  templateId: string
): Promise<void> {
  const collectionId = await resolveTemplateCollection(templateId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.collageTemplate.delete({ where: { id: templateId } });
}
