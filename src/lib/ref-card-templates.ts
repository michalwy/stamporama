import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import type { RefCardGeometry, RefCardTemplateInput } from "./ref-card-template-rules";

// The collection's ref-card formats (#569) — `collage-templates.ts`'s shape, this being the second
// named dictionary of its kind, with one difference that runs through the whole module: a ref-card
// template is **read live** by the sheet at print time and copied nowhere.
//
// So there is nothing to seed and nothing to check. Editing one changes what the *next* print looks
// like, which is correct — a template describes the collector's stationery, and stationery does not
// change retroactively.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function resolveTemplateCollection(templateId: string): Promise<string> {
  const template = await prisma.refCardTemplate.findUnique({
    where: { id: templateId },
    select: { collectionId: true },
  });
  if (!template) throw new Error("Ref card template not found.");
  return template.collectionId;
}

/** Raised on `@@unique([collectionId, name])`, so the panel can say which half of the save failed
 *  instead of reporting the generic "please try again" a constraint violation otherwise becomes
 *  (`AcceptanceProfileNameTakenError`'s rule, #533). */
export class RefCardTemplateNameTakenError extends Error {
  constructor(name: string) {
    super(`A ref card template called "${name}" already exists.`);
    this.name = "RefCardTemplateNameTakenError";
  }
}

export interface RefCardTemplateData extends RefCardGeometry {
  id: string;
  name: string;
}

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  cardWidthMm: true,
  cardHeightMm: true,
  fontSizeMm: true,
  paddingTopMm: true,
} satisfies Prisma.RefCardTemplateSelect;

/** The collection's ref-card templates, ordered by name — the collage templates' order, and for the
 *  same reason: a handful of named formats, picked by name. */
export async function getRefCardTemplates(
  ownerId: string,
  collectionId: string
): Promise<RefCardTemplateData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.refCardTemplate.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: TEMPLATE_SELECT,
  });
}

function rethrowNameClash(err: unknown, name: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new RefCardTemplateNameTakenError(name);
  }
  throw err;
}

export async function createRefCardTemplate(
  ownerId: string,
  collectionId: string,
  data: RefCardTemplateInput
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  try {
    await prisma.refCardTemplate.create({ data: { collectionId, ...data } });
  } catch (err) {
    rethrowNameClash(err, data.name);
  }
}

/**
 * Renames a template and replaces its measurements.
 *
 * **Nothing already printed changes**, and that is a property of paper rather than of anything this
 * function is careful about: a sheet is recorded nowhere, so there is no stored copy an edit could
 * contradict.
 */
export async function updateRefCardTemplate(
  ownerId: string,
  templateId: string,
  data: RefCardTemplateInput
): Promise<void> {
  const collectionId = await resolveTemplateCollection(templateId);
  await assertCollectionOwner(ownerId, collectionId);
  try {
    await prisma.refCardTemplate.update({ where: { id: templateId }, data });
  } catch (err) {
    rethrowNameClash(err, data.name);
  }
}

/** Deletes a template. Nothing points at one — the sheet reads it at print time and keeps no
 *  reference — so there is no in-use check to make. */
export async function deleteRefCardTemplate(
  ownerId: string,
  templateId: string
): Promise<void> {
  const collectionId = await resolveTemplateCollection(templateId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.refCardTemplate.delete({ where: { id: templateId } });
}
