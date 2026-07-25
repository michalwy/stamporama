import "server-only";
import { prisma } from "./db";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  syncEntityTranslations,
  translationsByLanguage,
  type TranslationValueMap,
} from "./translations";

/** The condition's translatable fields (#294), in the order the translations dialog renders them. */
export const CONDITION_TRANSLATION_FIELDS = ["name", "abbreviation"] as const;

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

async function resolveConditionCollection(conditionId: string): Promise<string> {
  const condition = await prisma.stampCondition.findUnique({
    where: { id: conditionId },
    select: { collectionId: true },
  });
  if (!condition) throw new Error("Stamp condition not found.");
  return condition.collectionId;
}

export interface StampConditionData {
  id: string;
  /** Default-language name (#294); {@link nameByLanguage} overrides it per language. */
  name: string;
  /** Default-language abbreviation; {@link abbreviationByLanguage} overrides it per language. */
  abbreviation: string;
  /** Per-language overrides of {@link name} (#294), keyed by ISO 639-1 code. Only languages with a
   * stored, non-blank value appear. */
  nameByLanguage: Record<string, string>;
  /** Per-language overrides of {@link abbreviation} (#294). Falls back independently of the name —
   * a language often translates `Mint Never Hinged` but keeps `MNH`. */
  abbreviationByLanguage: Record<string, string>;
  sortOrder: number;
}

/**
 * Default conditions seeded into every new collection, in display order.
 * See #93. Users can add, edit, reorder, and delete these afterwards.
 */
export const DEFAULT_CONDITIONS: ReadonlyArray<{
  name: string;
  abbreviation: string;
}> = [
  { name: "Mint Never Hinged", abbreviation: "MNH" },
  { name: "Mint Hinged", abbreviation: "MH" },
  { name: "Mint No Gum", abbreviation: "MNG" },
  { name: "Used", abbreviation: "U" },
  { name: "Cancelled to Order", abbreviation: "CTO" },
  { name: "First Day Cover", abbreviation: "FDC" },
];

/**
 * Seeds the default condition set for a freshly created collection. Runs inside
 * the collection-creation transaction, so it receives the transactional client.
 */
export async function seedDefaultConditions(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  await tx.stampCondition.createMany({
    data: DEFAULT_CONDITIONS.map((c, i) => ({
      collectionId,
      name: c.name,
      abbreviation: c.abbreviation,
      sortOrder: i,
    })),
  });
}

export async function getStampConditions(
  ownerId: string,
  collectionId: string
): Promise<StampConditionData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.stampCondition.findMany({
    where: { collectionId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      abbreviation: true,
      sortOrder: true,
      translations: { select: { language: true, name: true, abbreviation: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    abbreviation: c.abbreviation,
    nameByLanguage: translationsByLanguage(c.translations, (t) => t.name),
    abbreviationByLanguage: translationsByLanguage(c.translations, (t) => t.abbreviation),
    sortOrder: c.sortOrder,
  }));
}

/** Per-language `name` / `abbreviation` rows for a condition (#294). Shared rules — blank clears the
 * field, an all-blank language drops the row, unlisted languages are untouched — live in
 * {@link syncEntityTranslations}. */
async function syncConditionTranslations(
  stampConditionId: string,
  values: TranslationValueMap | undefined
): Promise<void> {
  await syncEntityTranslations(values, {
    upsert: async (language, fields) => {
      const data = { name: fields.name ?? null, abbreviation: fields.abbreviation ?? null };
      await prisma.stampConditionTranslation.upsert({
        where: { stampConditionId_language: { stampConditionId, language } },
        create: { stampConditionId, language, ...data },
        update: data,
      });
    },
    remove: async (language) => {
      await prisma.stampConditionTranslation.deleteMany({
        where: { stampConditionId, language },
      });
    },
  });
}

export async function createStampCondition(
  ownerId: string,
  collectionId: string,
  data: { name: string; abbreviation: string; translations?: TranslationValueMap }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const last = await prisma.stampCondition.findFirst({
    where: { collectionId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const sortOrder = last ? last.sortOrder + 1 : 0;
  const created = await prisma.stampCondition.create({
    data: { collectionId, name: data.name, abbreviation: data.abbreviation, sortOrder },
    select: { id: true },
  });
  await syncConditionTranslations(created.id, data.translations);
}

export async function updateStampCondition(
  ownerId: string,
  conditionId: string,
  data: { name: string; abbreviation: string; translations?: TranslationValueMap }
): Promise<void> {
  const collectionId = await resolveConditionCollection(conditionId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampCondition.update({
    where: { id: conditionId },
    data: { name: data.name, abbreviation: data.abbreviation },
  });
  await syncConditionTranslations(conditionId, data.translations);
}

/**
 * Whether a condition is referenced by any catalog price and therefore cannot
 * be deleted. The database also enforces this via an onDelete: Restrict FK;
 * this check surfaces a friendly error before we hit that constraint.
 */
export async function isConditionInUse(conditionId: string): Promise<boolean> {
  const count = await prisma.stampCatalogPrice.count({ where: { conditionId } });
  return count > 0;
}

export async function deleteStampCondition(
  ownerId: string,
  conditionId: string
): Promise<void> {
  const collectionId = await resolveConditionCollection(conditionId);
  await assertCollectionOwner(ownerId, collectionId);
  if (await isConditionInUse(conditionId)) {
    throw new ConditionInUseError();
  }
  await prisma.stampCondition.delete({ where: { id: conditionId } });
}

export class ConditionInUseError extends Error {
  constructor() {
    super("Condition is in use by catalog prices.");
    this.name = "ConditionInUseError";
  }
}

/**
 * Persists a new display order. `orderedIds` must contain exactly the collection's
 * condition ids. Rewrites `sortOrder` to match array position.
 */
export async function reorderStampConditions(
  ownerId: string,
  collectionId: string,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const existing = await prisma.stampCondition.findMany({
    where: { collectionId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((c) => c.id));
  if (
    orderedIds.length !== existingIds.size ||
    !orderedIds.every((id) => existingIds.has(id))
  ) {
    throw new Error("Reorder list does not match the collection's conditions.");
  }
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.stampCondition.update({ where: { id }, data: { sortOrder: i } })
    )
  );
}
