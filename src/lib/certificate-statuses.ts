import "server-only";
import { prisma } from "./db";
import {
  syncEntityTranslations,
  translationsByLanguage,
  type TranslationValueMap,
} from "./translations";

/** The certificate status's translatable fields (#294), in dialog render order. */
export const CERTIFICATE_STATUS_TRANSLATION_FIELDS = ["name", "abbreviation"] as const;

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

async function resolveStatusCollection(statusId: string): Promise<string> {
  const status = await prisma.certificateStatus.findUnique({
    where: { id: statusId },
    select: { collectionId: true },
  });
  if (!status) throw new Error("Certificate status not found.");
  return status.collectionId;
}

export interface CertificateStatusData {
  id: string;
  /** Default-language name (#294); {@link nameByLanguage} overrides it per language. */
  name: string;
  /** Default-language abbreviation; {@link abbreviationByLanguage} overrides it per language. */
  abbreviation: string;
  /** Per-language overrides of {@link name} (#294), keyed by ISO 639-1 code. Only languages with a
   * stored, non-blank value appear. */
  nameByLanguage: Record<string, string>;
  /** Per-language overrides of {@link abbreviation} (#294); falls back independently of the name. */
  abbreviationByLanguage: Record<string, string>;
  sortOrder: number;
}

// Certificate status is optional: a stamp with no status selected is treated as
// "none", so collections start with an empty list rather than a seeded "None"
// row. See #94. Users add their own statuses (e.g. Certificate, Guarantee).

export async function getCertificateStatuses(
  ownerId: string,
  collectionId: string
): Promise<CertificateStatusData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.certificateStatus.findMany({
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
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    abbreviation: s.abbreviation,
    nameByLanguage: translationsByLanguage(s.translations, (t) => t.name),
    abbreviationByLanguage: translationsByLanguage(s.translations, (t) => t.abbreviation),
    sortOrder: s.sortOrder,
  }));
}

/** Per-language `name` / `abbreviation` rows for a certificate status (#294); see
 * {@link syncEntityTranslations} for the shared blank / delete / untouched rules. */
async function syncCertificateStatusTranslations(
  certificateStatusId: string,
  values: TranslationValueMap | undefined
): Promise<void> {
  await syncEntityTranslations(values, {
    upsert: async (language, fields) => {
      const data = { name: fields.name ?? null, abbreviation: fields.abbreviation ?? null };
      await prisma.certificateStatusTranslation.upsert({
        where: { certificateStatusId_language: { certificateStatusId, language } },
        create: { certificateStatusId, language, ...data },
        update: data,
      });
    },
    remove: async (language) => {
      await prisma.certificateStatusTranslation.deleteMany({
        where: { certificateStatusId, language },
      });
    },
  });
}

export async function createCertificateStatus(
  ownerId: string,
  collectionId: string,
  data: { name: string; abbreviation: string; translations?: TranslationValueMap }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const last = await prisma.certificateStatus.findFirst({
    where: { collectionId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const sortOrder = last ? last.sortOrder + 1 : 0;
  const created = await prisma.certificateStatus.create({
    data: { collectionId, name: data.name, abbreviation: data.abbreviation, sortOrder },
    select: { id: true },
  });
  await syncCertificateStatusTranslations(created.id, data.translations);
}

export async function updateCertificateStatus(
  ownerId: string,
  statusId: string,
  data: { name: string; abbreviation: string; translations?: TranslationValueMap }
): Promise<void> {
  const collectionId = await resolveStatusCollection(statusId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.certificateStatus.update({
    where: { id: statusId },
    data: { name: data.name, abbreviation: data.abbreviation },
  });
  await syncCertificateStatusTranslations(statusId, data.translations);
}

/**
 * Whether a certificate status is referenced by any catalog price and therefore
 * cannot be deleted. The database also enforces this via an onDelete: Restrict
 * FK; this check surfaces a friendly error before we hit that constraint.
 */
export async function isCertificateStatusInUse(statusId: string): Promise<boolean> {
  const count = await prisma.stampCatalogPrice.count({
    where: { certificateStatusId: statusId },
  });
  return count > 0;
}

export async function deleteCertificateStatus(
  ownerId: string,
  statusId: string
): Promise<void> {
  const collectionId = await resolveStatusCollection(statusId);
  await assertCollectionOwner(ownerId, collectionId);
  if (await isCertificateStatusInUse(statusId)) {
    throw new CertificateStatusInUseError();
  }
  await prisma.certificateStatus.delete({ where: { id: statusId } });
}

export class CertificateStatusInUseError extends Error {
  constructor() {
    super("Certificate status is in use by catalog prices.");
    this.name = "CertificateStatusInUseError";
  }
}

/**
 * Persists a new display order. `orderedIds` must contain exactly the
 * collection's certificate-status ids. Rewrites `sortOrder` to match array
 * position.
 */
export async function reorderCertificateStatuses(
  ownerId: string,
  collectionId: string,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const existing = await prisma.certificateStatus.findMany({
    where: { collectionId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((s) => s.id));
  if (
    orderedIds.length !== existingIds.size ||
    !orderedIds.every((id) => existingIds.has(id))
  ) {
    throw new Error("Reorder list does not match the collection's certificate statuses.");
  }
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.certificateStatus.update({ where: { id }, data: { sortOrder: i } })
    )
  );
}
