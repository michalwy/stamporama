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
import { normalizeColnectAttribute } from "./colnect-attributes";
import { formatSizeMm, type StampSizeFields } from "./stamp-size";

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

/** The size columns (#763), a fragment of their own rather than part of the six above: they are
 * numbers where those are names, they are drawn as one figure rather than as two rows, and a read
 * model that has no use for a box should not have to carry them. */
export const STAMP_SIZE_SELECT = { widthMm: true, heightMm: true } as const;

/** A selected stamp's size as the screens want it — `Decimal` turned into the plain numbers every
 * pure rule and every layout in the app is written against. */
export function stampSizeFields(row: {
  widthMm: Prisma.Decimal | null;
  heightMm: Prisma.Decimal | null;
}): StampSizeFields {
  return {
    widthMm: row.widthMm === null ? null : row.widthMm.toNumber(),
    heightMm: row.heightMm === null ? null : row.heightMm.toNumber(),
  };
}

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
  /** The size (#763) as the field shows it — `21.5`, not `21.5000` — because the form's own state
   * is text and a number that round-trips through the input as a different string would look to
   * the collector like an edit they did not make. */
  widthMm: string | null;
  heightMm: string | null;
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
      ...STAMP_SIZE_SELECT,
    },
  });
  if (!stamp) throw new Error("Stamp not found.");
  await assertCollectionOwner(ownerId, stamp.collectionId);
  const size = stampSizeFields(stamp);
  return {
    denomination: stamp.denomination,
    perforation: stamp.perforation,
    colorId: stamp.colorId,
    watermarkId: stamp.watermarkId,
    paperId: stamp.paperId,
    printingId: stamp.printingId,
    widthMm: size.widthMm === null ? null : formatSizeMm(size.widthMm),
    heightMm: size.heightMm === null ? null : formatSizeMm(size.heightMm),
  };
}

export interface StampAttributeData {
  id: string;
  /** Default-language name; {@link nameByLanguage} overrides it per language. */
  name: string;
  /** Per-language overrides of {@link name}, keyed by ISO 639-1 code. Only languages with a
   * stored, non-blank value appear. */
  nameByLanguage: Record<string, string>;
  /** What Colnect prints for this value (#739), or null while nothing is mapped — the fourth of the
   * Settings → Colnect translations, and what lets a catalogue page fill this attribute. */
  colnectValue: string | null;
  sortOrder: number;
}

/** Every dictionary of the collection at once — what the Settings tab and a stamp form read. */
export type StampAttributeLists = Record<StampAttributeKind, StampAttributeData[]>;

interface AttributeRow {
  id: string;
  name: string;
  colnectValue: string | null;
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
  /** What Colnect calls this row (#739). Blank is stored as null: unmapped and cleared are one
   * state, the rule every other optional text in the app follows. */
  setColnectValue(id: string, colnectValue: string | null): Promise<unknown>;
  /** The rows of one collection with their mapped values, for the uniqueness check below. */
  mapped(collectionId: string): Promise<{ id: string; colnectValue: string | null }[]>;
  upsertTranslation(id: string, language: string, name: string | null): Promise<unknown>;
  removeTranslation(id: string, language: string): Promise<unknown>;
}

const LIST_SELECT = {
  id: true,
  name: true,
  colnectValue: true,
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
    setColnectValue: (id, colnectValue) =>
      prisma.stampColor.update({ where: { id }, data: { colnectValue } }),
    mapped: (collectionId) =>
      prisma.stampColor.findMany({
        where: { collectionId },
        select: { id: true, colnectValue: true },
      }),
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
    setColnectValue: (id, colnectValue) =>
      prisma.stampWatermark.update({ where: { id }, data: { colnectValue } }),
    mapped: (collectionId) =>
      prisma.stampWatermark.findMany({
        where: { collectionId },
        select: { id: true, colnectValue: true },
      }),
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
    setColnectValue: (id, colnectValue) =>
      prisma.stampPaper.update({ where: { id }, data: { colnectValue } }),
    mapped: (collectionId) =>
      prisma.stampPaper.findMany({
        where: { collectionId },
        select: { id: true, colnectValue: true },
      }),
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
    setColnectValue: (id, colnectValue) =>
      prisma.stampPrinting.update({ where: { id }, data: { colnectValue } }),
    mapped: (collectionId) =>
      prisma.stampPrinting.findMany({
        where: { collectionId },
        select: { id: true, colnectValue: true },
      }),
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
    colnectValue: row.colnectValue,
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

/**
 * Say what Colnect prints for one dictionary row (#739) — the Settings → Colnect mapping, written
 * one select at a time exactly as the condition mapping is (#404).
 *
 * Blank clears it, so *unmapped* and *cleared* are one state. Two rows of one dictionary may not
 * claim the same Colnect word — the fill would then depend on which row the database happened to
 * hand back — and the check is made **here** as well as by the unique index, because a collision is
 * an ordinary thing for a collector to type and deserves a sentence rather than a constraint error.
 * It compares the way the fill does (trimmed, whitespace collapsed, case-insensitive), so a mapping
 * the database would accept but the lookup could not tell apart is refused too.
 */
export async function setStampAttributeColnectValue(
  ownerId: string,
  kind: StampAttributeKind,
  attributeId: string,
  colnectValue: string
): Promise<void> {
  const collectionId = await resolveAttributeCollection(kind, attributeId);
  await assertCollectionOwner(ownerId, collectionId);
  const value = colnectValue.trim();
  if (value) {
    const key = normalizeColnectAttribute(value);
    const clash = (await STORES[kind].mapped(collectionId)).find(
      (r) => r.id !== attributeId && normalizeColnectAttribute(r.colnectValue) === key
    );
    if (clash) throw new Error("Another value in this list is already mapped to that Colnect word.");
  }
  await STORES[kind].setColnectValue(attributeId, value || null);
}

/**
 * The three calls the gap-fill path makes on one dictionary row (#299/#738), narrowed out of
 * {@link STORES}.
 *
 * Since #738 a listing text can print a stamp's colour, watermark, paper and printing method, so a
 * missing translation on one of those rows is reported in the title preview like every other — and
 * filled from the offer dialog, which is `entity-translations.ts`' job. It addresses these four
 * tables through the very delegates every other attribute write uses rather than restating them,
 * so a fifth dictionary stays one entry in one table here.
 */
export function stampAttributeTranslationStore(
  kind: StampAttributeKind
): Pick<AttributeStore, "find" | "upsertTranslation" | "removeTranslation"> {
  return STORES[kind];
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
