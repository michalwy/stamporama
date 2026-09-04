import "server-only";
import { prisma } from "./db";
import { Prisma } from "@/generated/prisma/client";
import {
  syncEntityTranslations,
  translationsByLanguage,
  type TranslationValueMap,
} from "./translations";
import {
  STAMP_ATTRIBUTE_KINDS,
  type StampAttributeKind,
  type StampAttributeLabels,
} from "./stamp-attribute-kinds";

// The four stamp-attribute dictionaries (#71/#72). Each is `StampSubtype`'s shape with the
// behaviour stripped — no `actsAsVariant`, no `isDefault` — so one module serves all four and
// dispatches over the kind: the lifecycle (append at the end, rename, reorder, delete refused
// while a stamp references the row, per-language names) is the same for a colour as for a paper,
// and only the Prisma delegate differs. Nothing is seeded into a new collection: unlike a
// condition there is no "usual colour", a stamp that states none simply has none.

/** The one translatable column (#72) — none of the four has an abbreviation. */
export const STAMP_ATTRIBUTE_TRANSLATION_FIELDS = ["name"] as const;

/**
 * What every read model selects to draw a stamp's attributes (#736/#737): the two printed strings,
 * and the four dictionary rows by name rather than by id. Selected as a fragment so the stamp list,
 * the issue tree and anything reaching for them later ask for the same six columns — and so a fifth
 * dictionary is one entry here rather than a hunt through the funnels.
 */
export const STAMP_ATTRIBUTE_DISPLAY_SELECT = {
  denomination: true,
  perforation: true,
  color: { select: { name: true } },
  watermark: { select: { name: true } },
  paper: { select: { name: true } },
  printing: { select: { name: true } },
} as const;

/** The shape {@link STAMP_ATTRIBUTE_DISPLAY_SELECT} returns. */
export interface StampAttributeDisplayRow {
  denomination: string | null;
  perforation: string | null;
  color: { name: string } | null;
  watermark: { name: string } | null;
  paper: { name: string } | null;
  printing: { name: string } | null;
}

/** A selected stamp's attributes as the screens want them (mirrors `subtypeLabel`). The default
 * language's name is what a list and a detail card read; the per-language names are listing text
 * and belong to the listing tokens (#738), not here. */
export function stampAttributeLabels(row: StampAttributeDisplayRow): StampAttributeLabels {
  return {
    denomination: row.denomination,
    perforation: row.perforation,
    color: row.color?.name ?? null,
    watermark: row.watermark?.name ?? null,
    paper: row.paper?.name ?? null,
    printing: row.printing?.name ?? null,
  };
}

/** The six values as stored — ids, not names — for seeding the stamp form's own fields (#736). */
export interface StampAttributeValues {
  denomination: string | null;
  perforation: string | null;
  colorId: string | null;
  watermarkId: string | null;
  paperId: string | null;
  printingId: string | null;
}

/**
 * One stamp's stored attribute values, fetched **by id** the way the subtype assignment and the
 * photos are (#736) — so no caller's row shape has to carry six more fields just to open the edit
 * dialog over it. Ownership is checked through the stamp's collection.
 */
export async function getStampAttributeValues(
  ownerId: string,
  stampId: string
): Promise<StampAttributeValues> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: stampId },
    select: {
      collectionId: true,
      denomination: true,
      perforation: true,
      colorId: true,
      watermarkId: true,
      paperId: true,
      printingId: true,
    },
  });
  if (!stamp) throw new Error("Stamp not found.");
  await assertCollectionOwner(ownerId, stamp.collectionId);
  return {
    denomination: stamp.denomination,
    perforation: stamp.perforation,
    colorId: stamp.colorId,
    watermarkId: stamp.watermarkId,
    paperId: stamp.paperId,
    printingId: stamp.printingId,
  };
}

export interface StampAttributeData {
  id: string;
  /** Default-language name; {@link nameByLanguage} overrides it per language. */
  name: string;
  /** Per-language overrides of {@link name}, keyed by ISO 639-1 code. Only languages with a
   * stored, non-blank value appear. */
  nameByLanguage: Record<string, string>;
  sortOrder: number;
}

/** Every dictionary of the collection at once — what the Settings tab and a stamp form read. */
export type StampAttributeLists = Record<StampAttributeKind, StampAttributeData[]>;

interface AttributeRow {
  id: string;
  name: string;
  sortOrder: number;
  translations: { language: string; name: string | null }[];
}

/** The per-kind Prisma calls, and nothing else: every rule lives in the functions below. */
interface AttributeStore {
  list(collectionId: string): Promise<AttributeRow[]>;
  find(id: string): Promise<{ collectionId: string } | null>;
  ids(collectionId: string): Promise<{ id: string }[]>;
  lastSortOrder(collectionId: string): Promise<number | null>;
  create(data: { collectionId: string; name: string; sortOrder: number }): Promise<{ id: string }>;
  rename(id: string, name: string): Promise<unknown>;
  setSortOrder(id: string, sortOrder: number): Prisma.PrismaPromise<unknown>;
  remove(id: string): Promise<unknown>;
  /** How many stamps reference the row — the count behind a refused delete. */
  stampsUsing(id: string): Promise<number>;
  upsertTranslation(id: string, language: string, name: string | null): Promise<unknown>;
  removeTranslation(id: string, language: string): Promise<unknown>;
}

const LIST_SELECT = {
  id: true,
  name: true,
  sortOrder: true,
  translations: { select: { language: true, name: true } },
} as const;

const STORES: Readonly<Record<StampAttributeKind, AttributeStore>> = {
  color: {
    list: (collectionId) =>
      prisma.stampColor.findMany({ where: { collectionId }, orderBy: { sortOrder: "asc" }, select: LIST_SELECT }),
    find: (id) => prisma.stampColor.findUnique({ where: { id }, select: { collectionId: true } }),
    ids: (collectionId) => prisma.stampColor.findMany({ where: { collectionId }, select: { id: true } }),
    lastSortOrder: async (collectionId) =>
      (await prisma.stampColor.findFirst({ where: { collectionId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } }))?.sortOrder ?? null,
    create: (data) => prisma.stampColor.create({ data, select: { id: true } }),
    rename: (id, name) => prisma.stampColor.update({ where: { id }, data: { name } }),
    setSortOrder: (id, sortOrder) => prisma.stampColor.update({ where: { id }, data: { sortOrder } }),
    remove: (id) => prisma.stampColor.delete({ where: { id } }),
    stampsUsing: (id) => prisma.stamp.count({ where: { colorId: id } }),
    upsertTranslation: (stampColorId, language, name) =>
      prisma.stampColorTranslation.upsert({
        where: { stampColorId_language: { stampColorId, language } },
        create: { stampColorId, language, name },
        update: { name },
      }),
    removeTranslation: (stampColorId, language) =>
      prisma.stampColorTranslation.deleteMany({ where: { stampColorId, language } }),
  },
  watermark: {
    list: (collectionId) =>
      prisma.stampWatermark.findMany({ where: { collectionId }, orderBy: { sortOrder: "asc" }, select: LIST_SELECT }),
    find: (id) => prisma.stampWatermark.findUnique({ where: { id }, select: { collectionId: true } }),
    ids: (collectionId) => prisma.stampWatermark.findMany({ where: { collectionId }, select: { id: true } }),
    lastSortOrder: async (collectionId) =>
      (await prisma.stampWatermark.findFirst({ where: { collectionId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } }))?.sortOrder ?? null,
    create: (data) => prisma.stampWatermark.create({ data, select: { id: true } }),
    rename: (id, name) => prisma.stampWatermark.update({ where: { id }, data: { name } }),
    setSortOrder: (id, sortOrder) => prisma.stampWatermark.update({ where: { id }, data: { sortOrder } }),
    remove: (id) => prisma.stampWatermark.delete({ where: { id } }),
    stampsUsing: (id) => prisma.stamp.count({ where: { watermarkId: id } }),
    upsertTranslation: (stampWatermarkId, language, name) =>
      prisma.stampWatermarkTranslation.upsert({
        where: { stampWatermarkId_language: { stampWatermarkId, language } },
        create: { stampWatermarkId, language, name },
        update: { name },
      }),
    removeTranslation: (stampWatermarkId, language) =>
      prisma.stampWatermarkTranslation.deleteMany({ where: { stampWatermarkId, language } }),
  },
  paper: {
    list: (collectionId) =>
      prisma.stampPaper.findMany({ where: { collectionId }, orderBy: { sortOrder: "asc" }, select: LIST_SELECT }),
    find: (id) => prisma.stampPaper.findUnique({ where: { id }, select: { collectionId: true } }),
    ids: (collectionId) => prisma.stampPaper.findMany({ where: { collectionId }, select: { id: true } }),
    lastSortOrder: async (collectionId) =>
      (await prisma.stampPaper.findFirst({ where: { collectionId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } }))?.sortOrder ?? null,
    create: (data) => prisma.stampPaper.create({ data, select: { id: true } }),
    rename: (id, name) => prisma.stampPaper.update({ where: { id }, data: { name } }),
    setSortOrder: (id, sortOrder) => prisma.stampPaper.update({ where: { id }, data: { sortOrder } }),
    remove: (id) => prisma.stampPaper.delete({ where: { id } }),
    stampsUsing: (id) => prisma.stamp.count({ where: { paperId: id } }),
    upsertTranslation: (stampPaperId, language, name) =>
      prisma.stampPaperTranslation.upsert({
        where: { stampPaperId_language: { stampPaperId, language } },
        create: { stampPaperId, language, name },
        update: { name },
      }),
    removeTranslation: (stampPaperId, language) =>
      prisma.stampPaperTranslation.deleteMany({ where: { stampPaperId, language } }),
  },
  printing: {
    list: (collectionId) =>
      prisma.stampPrinting.findMany({ where: { collectionId }, orderBy: { sortOrder: "asc" }, select: LIST_SELECT }),
    find: (id) => prisma.stampPrinting.findUnique({ where: { id }, select: { collectionId: true } }),
    ids: (collectionId) => prisma.stampPrinting.findMany({ where: { collectionId }, select: { id: true } }),
    lastSortOrder: async (collectionId) =>
      (await prisma.stampPrinting.findFirst({ where: { collectionId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } }))?.sortOrder ?? null,
    create: (data) => prisma.stampPrinting.create({ data, select: { id: true } }),
    rename: (id, name) => prisma.stampPrinting.update({ where: { id }, data: { name } }),
    setSortOrder: (id, sortOrder) => prisma.stampPrinting.update({ where: { id }, data: { sortOrder } }),
    remove: (id) => prisma.stampPrinting.delete({ where: { id } }),
    stampsUsing: (id) => prisma.stamp.count({ where: { printingId: id } }),
    upsertTranslation: (stampPrintingId, language, name) =>
      prisma.stampPrintingTranslation.upsert({
        where: { stampPrintingId_language: { stampPrintingId, language } },
        create: { stampPrintingId, language, name },
        update: { name },
      }),
    removeTranslation: (stampPrintingId, language) =>
      prisma.stampPrintingTranslation.deleteMany({ where: { stampPrintingId, language } }),
  },
};

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function resolveAttributeCollection(
  kind: StampAttributeKind,
  attributeId: string
): Promise<string> {
  const row = await STORES[kind].find(attributeId);
  if (!row) throw new Error("Stamp attribute not found.");
  return row.collectionId;
}

function toData(row: AttributeRow): StampAttributeData {
  return {
    id: row.id,
    name: row.name,
    nameByLanguage: translationsByLanguage(row.translations, (t) => t.name),
    sortOrder: row.sortOrder,
  };
}

/** One dictionary, in display order. */
export async function getStampAttributes(
  ownerId: string,
  collectionId: string,
  kind: StampAttributeKind
): Promise<StampAttributeData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return (await STORES[kind].list(collectionId)).map(toData);
}

/** All four dictionaries, in display order — one owner check, four reads. */
export async function getStampAttributeLists(
  ownerId: string,
  collectionId: string
): Promise<StampAttributeLists> {
  await assertCollectionOwner(ownerId, collectionId);
  const lists = await Promise.all(STAMP_ATTRIBUTE_KINDS.map((kind) => STORES[kind].list(collectionId)));
  return Object.fromEntries(
    STAMP_ATTRIBUTE_KINDS.map((kind, i) => [kind, lists[i].map(toData)])
  ) as StampAttributeLists;
}

/** Per-language `name` rows. Shared rules — blank clears the field, an all-blank language drops
 * the row, unlisted languages are untouched — live in {@link syncEntityTranslations}. */
async function syncAttributeTranslations(
  kind: StampAttributeKind,
  attributeId: string,
  values: TranslationValueMap | undefined
): Promise<void> {
  const store = STORES[kind];
  await syncEntityTranslations(values, {
    upsert: (language, fields) => store.upsertTranslation(attributeId, language, fields.name ?? null).then(() => undefined),
    remove: (language) => store.removeTranslation(attributeId, language).then(() => undefined),
  });
}

/** Appends a row to the dictionary: new rows land at the end, as in every other dictionary. */
export async function createStampAttribute(
  ownerId: string,
  collectionId: string,
  kind: StampAttributeKind,
  data: { name: string; translations?: TranslationValueMap }
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  const store = STORES[kind];
  const last = await store.lastSortOrder(collectionId);
  const created = await store.create({
    collectionId,
    name: data.name,
    sortOrder: last === null ? 0 : last + 1,
  });
  await syncAttributeTranslations(kind, created.id, data.translations);
  return created.id;
}

/** Renames a row, and rewrites its per-language names. */
export async function updateStampAttribute(
  ownerId: string,
  kind: StampAttributeKind,
  attributeId: string,
  data: { name: string; translations?: TranslationValueMap }
): Promise<void> {
  const collectionId = await resolveAttributeCollection(kind, attributeId);
  await assertCollectionOwner(ownerId, collectionId);
  await STORES[kind].rename(attributeId, data.name);
  await syncAttributeTranslations(kind, attributeId, data.translations);
}

/**
 * Whether a stamp references the row and it therefore cannot be deleted. The database also
 * enforces this through the `onDelete: Restrict` FK; this check surfaces a friendly error before
 * the constraint fires.
 */
export async function isStampAttributeInUse(
  kind: StampAttributeKind,
  attributeId: string
): Promise<boolean> {
  return (await STORES[kind].stampsUsing(attributeId)) > 0;
}

export class StampAttributeInUseError extends Error {
  constructor() {
    super("Stamp attribute is in use by stamps.");
    this.name = "StampAttributeInUseError";
  }
}

export async function deleteStampAttribute(
  ownerId: string,
  kind: StampAttributeKind,
  attributeId: string
): Promise<void> {
  const collectionId = await resolveAttributeCollection(kind, attributeId);
  await assertCollectionOwner(ownerId, collectionId);
  if (await isStampAttributeInUse(kind, attributeId)) throw new StampAttributeInUseError();
  await STORES[kind].remove(attributeId);
}

/**
 * Persists a new display order. `orderedIds` must contain exactly the collection's rows of that
 * kind. Rewrites `sortOrder` to match array position.
 */
export async function reorderStampAttributes(
  ownerId: string,
  collectionId: string,
  kind: StampAttributeKind,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const store = STORES[kind];
  const existingIds = new Set((await store.ids(collectionId)).map((r) => r.id));
  if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) {
    throw new Error("Reorder list does not match the collection's rows.");
  }
  await prisma.$transaction(orderedIds.map((id, i) => store.setSortOrder(id, i)));
}
