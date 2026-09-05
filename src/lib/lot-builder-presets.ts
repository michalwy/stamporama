import "server-only";
import { prisma } from "./db";
import {
  LOT_RECIPE_KEYS,
  type LotRecipe,
} from "./lot-builder-criteria";
import type { DuplicatePolicy, SeriesPreference } from "./lot-builder-rules";

// Saved bulk-lot builder criteria (#773) — the database half.
//
// A preset is a **recipe**: how a lot of this kind is picked, with nothing about which lot. The
// vocabulary is `LotRecipe` in `lot-builder-criteria.ts` and the table's columns are that type
// spelled out; the reasoning for what is *not* in it — the platform, the area, the subtree scope,
// the seed, the pins, the rejections — lives there and in the schema, not repeated here.
//
// Read **live** and never copied onto anything: what a preset produces is a query string, and the
// offer that query string commits records its own copies. So there is no in-use check and no
// snapshot — an edited preset simply builds the next lot differently, which is what editing it
// means.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function resolvePresetCollection(presetId: string): Promise<string> {
  const preset = await prisma.lotBuilderPreset.findUnique({
    where: { id: presetId },
    select: { collectionId: true },
  });
  if (!preset) throw new Error("Lot preset not found.");
  return preset.collectionId;
}

export interface LotBuilderPresetData {
  id: string;
  name: string;
  recipe: LotRecipe;
}

/** The columns, as Prisma hands them back. `Decimal` on the money axes, so they come out as objects
 *  and have to be turned into the plain numbers the criteria are made of. */
const SELECT = {
  id: true,
  name: true,
  yearFrom: true,
  yearTo: true,
  conditionIds: true,
  formatIds: true,
  maxCatalogValue: true,
  countMin: true,
  countMax: true,
  valueMin: true,
  valueMax: true,
  series: true,
  duplicates: true,
  maxPerStamp: true,
  nameTemplate: true,
  descriptionTemplate: true,
} as const;

type PresetRow = {
  id: string;
  name: string;
  yearFrom: number | null;
  yearTo: number | null;
  conditionIds: string[];
  formatIds: string[];
  maxCatalogValue: { toString(): string } | null;
  countMin: number | null;
  countMax: number | null;
  valueMin: { toString(): string } | null;
  valueMax: { toString(): string } | null;
  series: string;
  duplicates: string;
  maxPerStamp: number | null;
  nameTemplate: string | null;
  descriptionTemplate: string | null;
};

/** A stored `Decimal` as the criteria carry it: a plain finite number, or null. */
function decimal(value: { toString(): string } | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A stored preference as the rules read it. Anything outside the vocabulary reads as **neutral** —
 * the same fallback `parseLotBuilderRequest` applies to a stale link, and for the same reason: a
 * word the pick cannot act on is one the collector has not chosen.
 */
function series(raw: string): SeriesPreference {
  return raw === "preferComplete" || raw === "preferSingles" ? raw : "neutral";
}

function duplicates(raw: string): DuplicatePolicy {
  return raw === "preferDuplicates" ? raw : "neutral";
}

function toData(row: PresetRow): LotBuilderPresetData {
  return {
    id: row.id,
    name: row.name,
    recipe: {
      yearFrom: row.yearFrom,
      yearTo: row.yearTo,
      conditionIds: row.conditionIds,
      formatIds: row.formatIds,
      maxCatalogValue: decimal(row.maxCatalogValue),
      countMin: row.countMin,
      countMax: row.countMax,
      valueMin: decimal(row.valueMin),
      valueMax: decimal(row.valueMax),
      series: series(row.series),
      maxPerStamp: row.maxPerStamp,
      duplicates: duplicates(row.duplicates),
      nameTemplate: row.nameTemplate,
      descriptionTemplate: row.descriptionTemplate,
    },
  };
}

/** The recipe as columns. Written whole on every save, which is what makes an update mean *this is
 *  the preset now* rather than *merge this into whatever it used to say*. */
function toColumns(recipe: LotRecipe) {
  return {
    yearFrom: recipe.yearFrom,
    yearTo: recipe.yearTo,
    conditionIds: recipe.conditionIds,
    formatIds: recipe.formatIds,
    maxCatalogValue: recipe.maxCatalogValue,
    countMin: recipe.countMin,
    countMax: recipe.countMax,
    valueMin: recipe.valueMin,
    valueMax: recipe.valueMax,
    series: recipe.series,
    duplicates: recipe.duplicates,
    maxPerStamp: recipe.maxPerStamp,
    nameTemplate: recipe.nameTemplate,
    descriptionTemplate: recipe.descriptionTemplate,
  } satisfies Record<(typeof LOT_RECIPE_KEYS)[number], unknown>;
}

/** The collection's lot presets, ordered by name — the order the select draws them in. */
export async function getLotBuilderPresets(
  ownerId: string,
  collectionId: string
): Promise<LotBuilderPresetData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.lotBuilderPreset.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: SELECT,
  });
  return rows.map(toData);
}

export async function createLotBuilderPreset(
  ownerId: string,
  collectionId: string,
  name: string,
  recipe: LotRecipe
): Promise<LotBuilderPresetData> {
  await assertCollectionOwner(ownerId, collectionId);
  const row = await prisma.lotBuilderPreset.create({
    data: { collectionId, name, ...toColumns(recipe) },
    select: SELECT,
  });
  return toData(row);
}

/** Overwrite a preset with what is on screen. The name travels with it, so *Update* doubles as a
 *  rename and there is no second dialog for one text field. */
export async function updateLotBuilderPreset(
  ownerId: string,
  presetId: string,
  name: string,
  recipe: LotRecipe
): Promise<LotBuilderPresetData> {
  const collectionId = await resolvePresetCollection(presetId);
  await assertCollectionOwner(ownerId, collectionId);
  const row = await prisma.lotBuilderPreset.update({
    where: { id: presetId },
    data: { name, ...toColumns(recipe) },
    select: SELECT,
  });
  return toData(row);
}

export async function deleteLotBuilderPreset(ownerId: string, presetId: string): Promise<void> {
  const collectionId = await resolvePresetCollection(presetId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.lotBuilderPreset.delete({ where: { id: presetId } });
}
