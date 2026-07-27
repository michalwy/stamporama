import "server-only";
import { prisma } from "./db";
import { normalizeLanguage } from "./languages";
import {
  TRANSLATABLE_ENTITY_FIELDS,
  type TranslatableEntity,
  type TranslationValueMap,
  syncEntityTranslations,
} from "./translations";

// Writing **one** translated field of **one** entity, outside that entity's own form (#299/#300).
//
// The six translatable entities (#293–#296, #338) are each edited through their own dialog, which stages
// every language and submits them along the entity's save. Filling a gap from an offer dialog is the
// opposite shape: one field, one language, saved on its own the moment it is typed, because a
// translation is entity data and must survive cancelling the offer dialog it was typed in.
//
// One module rather than a setter per domain module: the six paths differ only in which table they
// resolve the owning collection through and which row they upsert, and the caller dispatches over
// `TranslatableEntity` anyway. The shared blank / delete / untouched rules still come from
// `syncEntityTranslations`, so a gap filled here and one filled in the entity's dialog store the
// same thing.

/** Locating one entity: the collection that owns it (for the owner check) and the translation rows
 * it already has for the language being written — needed because the multi-field entities upsert
 * their columns together, so writing a name must carry the stored abbreviation along. */
interface EntityAccess {
  collectionId: string;
  /** The stored values of this language's row, by field key. Empty when there is no row. */
  current: Record<string, string | null>;
}

async function loadEntity(
  entityType: TranslatableEntity,
  entityId: string,
  language: string
): Promise<EntityAccess | null> {
  switch (entityType) {
    case "stamp": {
      const row = await prisma.stamp.findUnique({
        where: { id: entityId },
        select: {
          collectionId: true,
          translations: { where: { language }, select: { name: true } },
        },
      });
      return row && { collectionId: row.collectionId, current: { ...row.translations[0] } };
    }
    case "issue": {
      const row = await prisma.issue.findUnique({
        where: { id: entityId },
        select: {
          collectionId: true,
          translations: { where: { language }, select: { name: true } },
        },
      });
      return row && { collectionId: row.collectionId, current: { ...row.translations[0] } };
    }
    case "condition": {
      const row = await prisma.stampCondition.findUnique({
        where: { id: entityId },
        select: {
          collectionId: true,
          translations: { where: { language }, select: { name: true, abbreviation: true } },
        },
      });
      return row && { collectionId: row.collectionId, current: { ...row.translations[0] } };
    }
    case "certificateStatus": {
      const row = await prisma.certificateStatus.findUnique({
        where: { id: entityId },
        select: {
          collectionId: true,
          translations: { where: { language }, select: { name: true, abbreviation: true } },
        },
      });
      return row && { collectionId: row.collectionId, current: { ...row.translations[0] } };
    }
    case "area": {
      const row = await prisma.collectionArea.findUnique({
        where: { id: entityId },
        select: {
          collectionId: true,
          translations: { where: { language }, select: { titleName: true } },
        },
      });
      return row && { collectionId: row.collectionId, current: { ...row.translations[0] } };
    }
    case "subtype": {
      const row = await prisma.stampSubtype.findUnique({
        where: { id: entityId },
        select: {
          collectionId: true,
          translations: { where: { language }, select: { name: true } },
        },
      });
      return row && { collectionId: row.collectionId, current: { ...row.translations[0] } };
    }
  }
}

/** The entity's own upsert / delete pair, as {@link syncEntityTranslations} consumes them. Each
 * mirrors the one in the entity's domain module — same columns, same all-blank-deletes rule. */
function handlers(entityType: TranslatableEntity, entityId: string) {
  switch (entityType) {
    case "stamp":
      return {
        upsert: async (language: string, fields: Record<string, string | null>) => {
          const name = fields.name ?? null;
          await prisma.stampTranslation.upsert({
            where: { stampId_language: { stampId: entityId, language } },
            create: { stampId: entityId, language, name },
            update: { name },
          });
        },
        remove: async (language: string) => {
          await prisma.stampTranslation.deleteMany({ where: { stampId: entityId, language } });
        },
      };
    case "issue":
      return {
        upsert: async (language: string, fields: Record<string, string | null>) => {
          const name = fields.name ?? null;
          await prisma.issueTranslation.upsert({
            where: { issueId_language: { issueId: entityId, language } },
            create: { issueId: entityId, language, name },
            update: { name },
          });
        },
        remove: async (language: string) => {
          await prisma.issueTranslation.deleteMany({ where: { issueId: entityId, language } });
        },
      };
    case "condition":
      return {
        upsert: async (language: string, fields: Record<string, string | null>) => {
          const data = { name: fields.name ?? null, abbreviation: fields.abbreviation ?? null };
          await prisma.stampConditionTranslation.upsert({
            where: { stampConditionId_language: { stampConditionId: entityId, language } },
            create: { stampConditionId: entityId, language, ...data },
            update: data,
          });
        },
        remove: async (language: string) => {
          await prisma.stampConditionTranslation.deleteMany({
            where: { stampConditionId: entityId, language },
          });
        },
      };
    case "certificateStatus":
      return {
        upsert: async (language: string, fields: Record<string, string | null>) => {
          const data = { name: fields.name ?? null, abbreviation: fields.abbreviation ?? null };
          await prisma.certificateStatusTranslation.upsert({
            where: { certificateStatusId_language: { certificateStatusId: entityId, language } },
            create: { certificateStatusId: entityId, language, ...data },
            update: data,
          });
        },
        remove: async (language: string) => {
          await prisma.certificateStatusTranslation.deleteMany({
            where: { certificateStatusId: entityId, language },
          });
        },
      };
    case "area":
      return {
        upsert: async (language: string, fields: Record<string, string | null>) => {
          const titleName = fields.titleName ?? null;
          await prisma.collectionAreaTranslation.upsert({
            where: { collectionAreaId_language: { collectionAreaId: entityId, language } },
            create: { collectionAreaId: entityId, language, titleName },
            update: { titleName },
          });
        },
        remove: async (language: string) => {
          await prisma.collectionAreaTranslation.deleteMany({
            where: { collectionAreaId: entityId, language },
          });
        },
      };
    case "subtype":
      return {
        upsert: async (language: string, fields: Record<string, string | null>) => {
          const name = fields.name ?? null;
          await prisma.stampSubtypeTranslation.upsert({
            where: { stampSubtypeId_language: { stampSubtypeId: entityId, language } },
            create: { stampSubtypeId: entityId, language, name },
            update: { name },
          });
        },
        remove: async (language: string) => {
          await prisma.stampSubtypeTranslation.deleteMany({
            where: { stampSubtypeId: entityId, language },
          });
        },
      };
  }
}

export interface EntityTranslationWrite {
  entityType: TranslatableEntity;
  entityId: string;
  /** One of the entity's own translatable columns — see `TRANSLATABLE_ENTITY_FIELDS`. */
  entityField: string;
  /** ISO 639-1 code. The collection's default language is rejected: text in it lives in the
   * entity's own column, which this path deliberately never touches. */
  language: string;
  /** Blank clears the field — and drops the row when it leaves the language with nothing. */
  value: string;
}

/**
 * Write one translated field of one entity, owner-scoped (#299).
 *
 * `collectionId` is the collection the caller believes the entity belongs to — the entity's real
 * one is looked up and compared, so a guessed id cannot reach another collection's rows even when
 * the owner check on the caller's collection passes. Fields the entity does not have, and the
 * collection's own default language, are rejected rather than silently written.
 *
 * The entity's other fields and its other languages are left exactly as they were: a multi-field
 * entity's siblings are read back and rewritten unchanged, so filling a condition's Polish name
 * never clears its Polish abbreviation.
 */
export async function saveEntityTranslation(
  ownerId: string,
  collectionId: string,
  write: EntityTranslationWrite
): Promise<void> {
  const language = normalizeLanguage(write.language);
  if (!language) throw new Error("A language is required.");
  const fields = TRANSLATABLE_ENTITY_FIELDS[write.entityType];
  if (!fields?.includes(write.entityField)) {
    throw new Error("Unknown translatable field.");
  }
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, defaultLanguage: true },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  if (language === normalizeLanguage(collection.defaultLanguage)) {
    throw new Error("That is the collection's default language — edit the entity's own text.");
  }
  const entity = await loadEntity(write.entityType, write.entityId, language);
  if (!entity || entity.collectionId !== collectionId) {
    throw new Error("Entity not found or access denied.");
  }
  // Every field of the language, so the all-blank-deletes rule sees the whole row: the target field
  // as typed, its siblings as stored.
  const values: TranslationValueMap = {
    [language]: Object.fromEntries(
      fields.map((f) => [f, f === write.entityField ? write.value : (entity.current[f] ?? null)])
    ),
  };
  await syncEntityTranslations(values, handlers(write.entityType, write.entityId));
}
