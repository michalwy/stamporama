import "server-only";
import { prisma, type DbTransaction } from "./db";
import {
  syncEntityTranslations,
  translationsByLanguage,
  type TranslationValueMap,
} from "./translations";
import { COVER_FORMATS, isCoverKind, sortPriceFormats, type CoverKind } from "./cover-kind";

// The physical-format dictionary — pairs, blocks, strips. Same shape and lifecycle as
// `conditions.ts`: seeded on collection creation, then fully the collector's to edit.
//
// There is no "single" row and none is seeded. A null `formatId` **means single**, exactly as a
// null `certificateStatusId` means "no certificate" (ADR-0006 §2), so the list here holds only
// the multiples.
//
// Four more rows are **not** the collector's (#2356): the prices on cover — EF, MeF, MiF — and on
// piece, told apart by `coverKind` (`cover-kind.ts`). Every price path reads them as formats, which
// is the point; nothing a copy, a want, a trade or a lot is described by may name one. So
// {@link getStampFormats} leaves them out unless asked, a format accepted for anything but a price
// is checked with {@link COPY_FORMAT_WHERE}, and the dictionary's editors cannot touch them.

/** The `where` a format must match to describe a copy — or a want, a trade line, an auction line, a
 *  lot: any of the four cover-price rows is refused (#2356). */
export const COPY_FORMAT_WHERE = { coverKind: null } as const;

/** A format a copy can be in: this collection's, and not one of the cover prices (#2356). */
export async function assertCopyFormatInCollection(collectionId: string, formatId: string): Promise<void> {
  const format = await prisma.stampFormat.findFirst({
    where: { id: formatId, collectionId, ...COPY_FORMAT_WHERE },
    select: { id: true },
  });
  if (!format) throw new Error("Format not found in this collection.");
}

/** The format's translatable fields (#344), in the order the form shows them. Two columns, like a
 * condition's — and they fall back independently, because a language commonly translates the name
 * and leaves the abbreviation alone. */
export const FORMAT_TRANSLATION_FIELDS = ["name", "abbreviation"] as const;

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

/** The collection of a format the collector may edit — never one of the cover-price rows (#2356),
 *  which are what the catalogues print and the same in every collection. */
async function resolveFormatCollection(formatId: string): Promise<string> {
  const format = await prisma.stampFormat.findUnique({
    where: { id: formatId },
    select: { collectionId: true, coverKind: true },
  });
  if (!format) throw new Error("Stamp format not found.");
  if (format.coverKind) throw new Error("The prices on cover and on piece cannot be edited here.");
  return format.collectionId;
}

export interface StampFormatData {
  id: string;
  /** Default-language name (#344); {@link nameByLanguage} overrides it per language. */
  name: string;
  /** Default-language abbreviation (#344). */
  abbreviation: string;
  /** Per-language overrides of {@link name} (#344), keyed by ISO 639-1 code. Only languages with a
   * stored, non-blank value appear. */
  nameByLanguage: Record<string, string>;
  /** Per-language overrides of {@link abbreviation} (#344). Independent of {@link nameByLanguage}. */
  abbreviationByLanguage: Record<string, string>;
  sortOrder: number;
  /** Set on the four reserved cover-price rows (#2356); null on a format a copy can be in. */
  coverKind: CoverKind | null;
}

/**
 * Default formats seeded into every new collection, in display order. Kept in sync with the
 * backfill in `20260727090000_stamp_format_multiples`. Users can add, edit, reorder and delete
 * these afterwards — the vocabulary a collector needs depends entirely on what they collect.
 */
export const DEFAULT_FORMATS: ReadonlyArray<{
  name: string;
  abbreviation: string;
}> = [
  { name: "Horizontal pair", abbreviation: "HPair" },
  { name: "Vertical pair", abbreviation: "VPair" },
  { name: "Strip of 3", abbreviation: "Str3" },
  { name: "Block of 4", abbreviation: "Blk4" },
  { name: "Corner block of 4", abbreviation: "CB4" },
  { name: "Margin copy", abbreviation: "Marg" },
];

/**
 * Seeds the default format set for a freshly created collection. Runs inside the
 * collection-creation transaction, so it receives the transactional client.
 */
export async function seedDefaultFormats(
  collectionId: string,
  tx: DbTransaction
): Promise<void> {
  await tx.stampFormat.createMany({
    data: DEFAULT_FORMATS.map((f, i) => ({
      collectionId,
      name: f.name,
      abbreviation: f.abbreviation,
      sortOrder: i,
    })),
  });
  // The cover prices (#2356), which every collection has — kept in sync with the backfill in
  // `20261102140000_stamp_format_cover_prices` and `20261102140100_stamp_format_cover_abbreviations`.
  await tx.stampFormat.createMany({
    data: COVER_FORMATS.map((f, i) => ({
      collectionId,
      name: f.name,
      abbreviation: f.abbreviation,
      sortOrder: i,
      coverKind: f.coverKind,
    })),
  });
}

/**
 * The collection's formats. A copy's only, unless `withCoverPrices` — then the four cover-price rows
 * follow them (#2356): what a **price** surface asks for (the price grids, the lists' price switcher,
 * the multipliers, the agent API's price tools), and nothing else.
 */
export async function getStampFormats(
  ownerId: string,
  collectionId: string,
  options: { withCoverPrices?: boolean } = {}
): Promise<StampFormatData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.stampFormat.findMany({
    where: { collectionId, ...(options.withCoverPrices ? {} : COPY_FORMAT_WHERE) },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      abbreviation: true,
      sortOrder: true,
      coverKind: true,
      translations: { select: { language: true, name: true, abbreviation: true } },
    },
  });
  const formats = rows.map((f) => ({
    id: f.id,
    name: f.name,
    abbreviation: f.abbreviation,
    nameByLanguage: translationsByLanguage(f.translations, (t) => t.name),
    abbreviationByLanguage: translationsByLanguage(f.translations, (t) => t.abbreviation),
    sortOrder: f.sortOrder,
    coverKind: isCoverKind(f.coverKind) ? f.coverKind : null,
  }));
  return sortPriceFormats(formats);
}

/** Per-language rows for a format (#344). Shared rules — blank clears the field, an all-blank
 * language drops the row, unlisted languages are untouched — live in
 * {@link syncEntityTranslations}. The two columns are upserted together, which is what makes each
 * fall back on its own. */
async function syncFormatTranslations(
  stampFormatId: string,
  values: TranslationValueMap | undefined
): Promise<void> {
  await syncEntityTranslations(values, {
    upsert: async (language, fields) => {
      const data = { name: fields.name ?? null, abbreviation: fields.abbreviation ?? null };
      await prisma.stampFormatTranslation.upsert({
        where: { stampFormatId_language: { stampFormatId, language } },
        create: { stampFormatId, language, ...data },
        update: data,
      });
    },
    remove: async (language) => {
      await prisma.stampFormatTranslation.deleteMany({ where: { stampFormatId, language } });
    },
  });
}

export async function createStampFormat(
  ownerId: string,
  collectionId: string,
  data: { name: string; abbreviation: string; translations?: TranslationValueMap }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const last = await prisma.stampFormat.findFirst({
    where: { collectionId, ...COPY_FORMAT_WHERE },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const created = await prisma.stampFormat.create({
    data: {
      collectionId,
      name: data.name,
      abbreviation: data.abbreviation,
      sortOrder: last ? last.sortOrder + 1 : 0,
    },
    select: { id: true },
  });
  await syncFormatTranslations(created.id, data.translations);
}

export async function updateStampFormat(
  ownerId: string,
  formatId: string,
  data: { name: string; abbreviation: string; translations?: TranslationValueMap }
): Promise<void> {
  const collectionId = await resolveFormatCollection(formatId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampFormat.update({
    where: { id: formatId },
    data: { name: data.name, abbreviation: data.abbreviation },
  });
  await syncFormatTranslations(formatId, data.translations);
}

/**
 * Whether a format is referenced by a catalog price or a recorded copy, and therefore cannot be
 * deleted. All three FKs are `onDelete: Restrict`; this check surfaces a friendly error before the
 * constraint fires. Factor rows are deliberately **not** counted — they cascade, because a factor
 * is a rule *about* the format with no meaning once it is gone, unlike a price or a copy.
 *
 * The third is a **component** of a multi-stamp copy (ADR-0044 §5) — "a block of four, on this
 * cover" — which is a use of the format exactly as a copy's own is, and reached through a different
 * column only because a carrier says two things about format at once.
 */
export async function isFormatInUse(formatId: string): Promise<boolean> {
  const [prices, items, components] = await Promise.all([
    prisma.stampCatalogPrice.count({ where: { formatId } }),
    prisma.item.count({ where: { formatId } }),
    prisma.itemStamp.count({ where: { formatId } }),
  ]);
  return prices > 0 || items > 0 || components > 0;
}

export class FormatInUseError extends Error {
  constructor() {
    super("Format is in use by catalog prices or copies.");
    this.name = "FormatInUseError";
  }
}

export async function deleteStampFormat(
  ownerId: string,
  formatId: string
): Promise<void> {
  const collectionId = await resolveFormatCollection(formatId);
  await assertCollectionOwner(ownerId, collectionId);
  if (await isFormatInUse(formatId)) {
    throw new FormatInUseError();
  }
  await prisma.stampFormat.delete({ where: { id: formatId } });
}

/**
 * Persists a new display order. `orderedIds` must contain exactly the collection's format ids.
 * Rewrites `sortOrder` to match array position.
 */
export async function reorderStampFormats(
  ownerId: string,
  collectionId: string,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const existing = await prisma.stampFormat.findMany({
    where: { collectionId, ...COPY_FORMAT_WHERE },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((f) => f.id));
  if (
    orderedIds.length !== existingIds.size ||
    !orderedIds.every((id) => existingIds.has(id))
  ) {
    throw new Error("Reorder list does not match the collection's formats.");
  }
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.stampFormat.update({ where: { id }, data: { sortOrder: i } })
    )
  );
}
