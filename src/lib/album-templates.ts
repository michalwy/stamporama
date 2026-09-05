import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  asAlbumBorderStyle,
  asAlbumBoxBorderStyle,
  asAlbumLabelPosition,
  type AlbumRenderPreset,
  type AlbumTemplateInput,
} from "./album-template-rules";

// The collection's album templates (#766) — `ref-card-templates.ts`'s shape, with
// `collage-templates.ts`'s seeding semantics.
//
// **Seeded, never referenced** (#308). Choosing a template on an album copies its values onto the
// album (#767); no album points back here. So a template stays freely deletable, there is no in-use
// check to make, and editing one changes nothing that has already been planned — which is the whole
// point, because the thing already planned may be in a binder with stamps glued to it.
//
// The values themselves are `AlbumRenderPreset` from the pure rules module. This file only moves
// them; every decision about what is a valid preset lives there.

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
  const template = await prisma.albumTemplate.findUnique({
    where: { id: templateId },
    select: { collectionId: true },
  });
  if (!template) throw new Error("Album template not found.");
  return template.collectionId;
}

/** Raised on `@@unique([collectionId, name])` — its own error rather than the generic "please try
 *  again" a constraint violation otherwise becomes (`RefCardTemplateNameTakenError`'s rule, #569).
 *  A template is picked by name when an album seeds from it, so two of one name is a dictionary
 *  nobody can read. */
export class AlbumTemplateNameTakenError extends Error {
  constructor(name: string) {
    super(`An album template called "${name}" already exists.`);
    this.name = "AlbumTemplateNameTakenError";
  }
}

export interface AlbumTemplateData extends AlbumRenderPreset {
  id: string;
  name: string;
}

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  pageWidthMm: true,
  pageHeightMm: true,
  marginTopMm: true,
  marginRightMm: true,
  marginBottomMm: true,
  marginLeftMm: true,
  columns: true,
  columnGapMm: true,
  borderStyle: true,
  borderWidthMm: true,
  borderInsetMm: true,
  boxGapXMm: true,
  boxGapYMm: true,
  headingSpaceAboveMm: true,
  headingSpaceBelowMm: true,
  verticalClearanceMm: true,
  horizontalMarginMm: true,
  titleFace: true,
  titleSizePt: true,
  chapterFace: true,
  chapterSizePt: true,
  headingFace: true,
  headingSizePt: true,
  labelFace: true,
  labelSizePt: true,
  footerFace: true,
  footerSizePt: true,
  boxBorderStyle: true,
  boxBorderWidthMm: true,
  labelPosition: true,
  printPhotos: true,
  photoOpacityPercent: true,
  chapterTemplate: true,
  checklistTemplate: true,
  boxLabelTemplate: true,
  footerTemplate: true,
} satisfies Prisma.AlbumTemplateSelect;

type TemplateRow = Prisma.AlbumTemplateGetPayload<{ select: typeof TEMPLATE_SELECT }>;

/** The three choice columns come back as `string`; everything else is already its own type. */
function toData(row: TemplateRow): AlbumTemplateData {
  return {
    ...row,
    borderStyle: asAlbumBorderStyle(row.borderStyle),
    boxBorderStyle: asAlbumBoxBorderStyle(row.boxBorderStyle),
    labelPosition: asAlbumLabelPosition(row.labelPosition),
  };
}

/** The collection's templates, ordered by name — the collage and ref-card templates' order, and for
 *  the same reason: a handful of named presets, picked by name. */
export async function getAlbumTemplates(
  ownerId: string,
  collectionId: string
): Promise<AlbumTemplateData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.albumTemplate.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: TEMPLATE_SELECT,
  });
  return rows.map(toData);
}

function rethrowNameClash(err: unknown, name: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new AlbumTemplateNameTakenError(name);
  }
  throw err;
}

export async function createAlbumTemplate(
  ownerId: string,
  collectionId: string,
  data: AlbumTemplateInput
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  try {
    await prisma.albumTemplate.create({ data: { collectionId, ...data } });
  } catch (err) {
    rethrowNameClash(err, data.name);
  }
}

/** Updates a template. Nothing that was seeded from it changes — an album carries its own copy of
 *  these values (#767), which is the rule this whole model exists under. */
export async function updateAlbumTemplate(
  ownerId: string,
  templateId: string,
  data: AlbumTemplateInput
): Promise<void> {
  const collectionId = await resolveTemplateCollection(templateId);
  await assertCollectionOwner(ownerId, collectionId);
  try {
    await prisma.albumTemplate.update({ where: { id: templateId }, data });
  } catch (err) {
    rethrowNameClash(err, data.name);
  }
}

/** Deletes a template. No in-use check, because nothing is ever in use: an album holds a copy, not
 *  a reference. */
export async function deleteAlbumTemplate(ownerId: string, templateId: string): Promise<void> {
  const collectionId = await resolveTemplateCollection(templateId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.albumTemplate.delete({ where: { id: templateId } });
}
