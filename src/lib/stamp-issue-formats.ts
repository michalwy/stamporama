import "server-only";
import { prisma, type DbTransaction } from "./db";
import {
  syncEntityTranslations,
  translationsByLanguage,
  type TranslationValueMap,
} from "./translations";
import { isTagColor, type TagColor } from "./tag-colors";
import { DEFAULT_ISSUE_FORMATS, type StampIssueFormatLabel } from "./stamp-issue-format-defaults";
import { isColnectOrdinaryStamp, normalizeColnectAttribute } from "./colnect-attributes";

// The issue-format dictionary (#2439) — the form a stamp was issued in: souvenir sheet, miniature
// sheet, tête-bêche, booklet pane. Same shape and lifecycle as `stamp-formats.ts` (seeded on
// collection creation, then fully the collector's), with a condition's chip colour (#728).
//
// It belongs to the **stamp**, never the copy — a copy's format is how the collector's piece was cut
// or kept and is untouched by this. There is no "Stamp" row: a null `issueFormatId` **is** an
// ordinary stamp. Not inherited down the variant tree (ADR-0010), and nothing in valuation, holdings
// or copy formats reads it. What does read it is a series: `countsTowardsSeries` (#2470).

export interface StampIssueFormatData {
  id: string;
  /** Default-language name; {@link nameByLanguage} overrides it per language. */
  name: string;
  /** Default-language abbreviation. */
  abbreviation: string;
  /** Per-language overrides of {@link name}, keyed by ISO 639-1 code. */
  nameByLanguage: Record<string, string>;
  /** Per-language overrides of {@link abbreviation}. Independent of {@link nameByLanguage}. */
  abbreviationByLanguage: Record<string, string>;
  sortOrder: number;
  /** Chip colour, or null for the neutral chip. */
  color: TagColor | null;
  /** What Colnect prints in a stamp's "Format" for this value (#2443), or null while nothing is
   *  mapped — set on Settings → Colnect → Attributes beside the four attribute dictionaries. */
  colnectValue: string | null;
  /** Whether entries in it count towards the series (#2470, ADR-0080). */
  countsTowardsSeries: boolean;
  /** How many stamps carry this issue format — what the settings row says, and why a delete is
   *  refused while it is above nought. */
  stampCount: number;
}

/** The select that reads a stamp's issue format for display, beside the attribute fragments. */
export const STAMP_ISSUE_FORMAT_DISPLAY_SELECT = {
  issueFormat: { select: { id: true, name: true, abbreviation: true, color: true } },
} as const;

/** The shape {@link STAMP_ISSUE_FORMAT_DISPLAY_SELECT} returns. */
export interface StampIssueFormatDisplayRow {
  issueFormat: { id: string; name: string; abbreviation: string; color: string | null } | null;
}

/** A selected stamp's issue format as the screens want it; null is an ordinary stamp. */
export function stampIssueFormatLabel(row: StampIssueFormatDisplayRow): StampIssueFormatLabel | null {
  if (!row.issueFormat) return null;
  return {
    id: row.issueFormat.id,
    name: row.issueFormat.name,
    abbreviation: row.issueFormat.abbreviation,
    color: isTagColor(row.issueFormat.color) ? row.issueFormat.color : null,
  };
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function resolveIssueFormatCollection(issueFormatId: string): Promise<string> {
  const row = await prisma.stampIssueFormat.findUnique({
    where: { id: issueFormatId },
    select: { collectionId: true },
  });
  if (!row) throw new Error("Issue format not found.");
  return row.collectionId;
}

/** An issue format a stamp of this collection can carry: this collection's. Null — an ordinary
 *  stamp — always can. */
export async function assertIssueFormatInCollection(
  collectionId: string,
  issueFormatId: string | null | undefined
): Promise<void> {
  if (!issueFormatId) return;
  const row = await prisma.stampIssueFormat.findFirst({
    where: { id: issueFormatId, collectionId },
    select: { id: true },
  });
  if (!row) throw new Error("Issue format not found in this collection.");
}

/** Seeds the starting issue formats into a freshly created collection, inside its creation
 *  transaction. */
export async function seedDefaultIssueFormats(
  collectionId: string,
  tx: DbTransaction
): Promise<void> {
  await tx.stampIssueFormat.createMany({
    data: DEFAULT_ISSUE_FORMATS.map((f, i) => ({
      collectionId,
      name: f.name,
      abbreviation: f.abbreviation,
      color: f.color,
      sortOrder: i,
      countsTowardsSeries: f.countsTowardsSeries ?? true,
    })),
  });
}

export async function getStampIssueFormats(
  ownerId: string,
  collectionId: string
): Promise<StampIssueFormatData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.stampIssueFormat.findMany({
    where: { collectionId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      abbreviation: true,
      sortOrder: true,
      color: true,
      colnectValue: true,
      countsTowardsSeries: true,
      translations: { select: { language: true, name: true, abbreviation: true } },
      _count: { select: { stamps: true } },
    },
  });
  return rows.map((f) => ({
    id: f.id,
    name: f.name,
    abbreviation: f.abbreviation,
    nameByLanguage: translationsByLanguage(f.translations, (t) => t.name),
    abbreviationByLanguage: translationsByLanguage(f.translations, (t) => t.abbreviation),
    sortOrder: f.sortOrder,
    color: isTagColor(f.color) ? f.color : null,
    colnectValue: f.colnectValue,
    countsTowardsSeries: f.countsTowardsSeries,
    stampCount: f._count.stamps,
  }));
}

/** Per-language rows — the shared rules (blank clears a field, an all-blank language drops the row,
 *  an unlisted language is untouched) live in {@link syncEntityTranslations}. */
async function syncIssueFormatTranslations(
  stampIssueFormatId: string,
  values: TranslationValueMap | undefined
): Promise<void> {
  await syncEntityTranslations(values, {
    upsert: async (language, fields) => {
      const data = { name: fields.name ?? null, abbreviation: fields.abbreviation ?? null };
      await prisma.stampIssueFormatTranslation.upsert({
        where: { stampIssueFormatId_language: { stampIssueFormatId, language } },
        create: { stampIssueFormatId, language, ...data },
        update: data,
      });
    },
    remove: async (language) => {
      await prisma.stampIssueFormatTranslation.deleteMany({
        where: { stampIssueFormatId, language },
      });
    },
  });
}

export interface StampIssueFormatInput {
  name: string;
  abbreviation: string;
  color: TagColor | null;
  countsTowardsSeries: boolean;
  translations?: TranslationValueMap;
}

/** Adds an issue format at the end of the collector's order; returns its id (the agent API answers
 *  with it, #2445 — the Settings panel ignores it). */
export async function createStampIssueFormat(
  ownerId: string,
  collectionId: string,
  data: StampIssueFormatInput
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  const last = await prisma.stampIssueFormat.findFirst({
    where: { collectionId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const created = await prisma.stampIssueFormat.create({
    data: {
      collectionId,
      name: data.name,
      abbreviation: data.abbreviation,
      color: data.color,
      countsTowardsSeries: data.countsTowardsSeries,
      sortOrder: last ? last.sortOrder + 1 : 0,
    },
    select: { id: true },
  });
  await syncIssueFormatTranslations(created.id, data.translations);
  return created.id;
}

export async function updateStampIssueFormat(
  ownerId: string,
  issueFormatId: string,
  data: StampIssueFormatInput
): Promise<void> {
  const collectionId = await resolveIssueFormatCollection(issueFormatId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampIssueFormat.update({
    where: { id: issueFormatId },
    data: {
      name: data.name,
      abbreviation: data.abbreviation,
      color: data.color,
      countsTowardsSeries: data.countsTowardsSeries,
    },
  });
  await syncIssueFormatTranslations(issueFormatId, data.translations);
}

export class IssueFormatInUseError extends Error {
  constructor(readonly stampCount: number) {
    super(`Issue format is used by ${stampCount} stamp${stampCount === 1 ? "" : "s"}.`);
    this.name = "IssueFormatInUseError";
  }
}

/** Deletes an unused issue format. One a stamp carries is refused with how many do — the FK is
 *  `onDelete: Restrict`; this surfaces it as a sentence first. */
export async function deleteStampIssueFormat(ownerId: string, issueFormatId: string): Promise<void> {
  const collectionId = await resolveIssueFormatCollection(issueFormatId);
  await assertCollectionOwner(ownerId, collectionId);
  const stampCount = await prisma.stamp.count({ where: { issueFormatId } });
  if (stampCount > 0) throw new IssueFormatInUseError(stampCount);
  await prisma.stampIssueFormat.delete({ where: { id: issueFormatId } });
}

/** Persists a new display order; `orderedIds` must be exactly the collection's issue formats. */
export async function reorderStampIssueFormats(
  ownerId: string,
  collectionId: string,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const existing = await prisma.stampIssueFormat.findMany({
    where: { collectionId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((f) => f.id));
  if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) {
    throw new Error("Reorder list does not match the collection's issue formats.");
  }
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.stampIssueFormat.update({ where: { id }, data: { sortOrder: i } })
    )
  );
}

/** A Colnect word the issue-format mapping refuses, in words the collector can act on. */
export class IssueFormatColnectValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueFormatColnectValueError";
  }
}

/**
 * Say what Colnect prints in "Format" for one issue format (#2443) — `setStampAttributeColnectValue`
 * for the fifth mapped dictionary, on its rules: blank clears it, and two issue formats may not
 * claim one Colnect word, compared the way the fill compares (trimmed, whitespace collapsed,
 * case-insensitive), so a collision is a sentence rather than a constraint error.
 *
 * Colnect's **"Stamp"** is refused: it is an ordinary stamp, which is no issue format, and the fill
 * never maps it — a row claiming it would be a mapping that silently does nothing.
 */
export async function setStampIssueFormatColnectValue(
  ownerId: string,
  issueFormatId: string,
  colnectValue: string
): Promise<void> {
  const collectionId = await resolveIssueFormatCollection(issueFormatId);
  await assertCollectionOwner(ownerId, collectionId);
  const value = colnectValue.trim();
  if (value) {
    if (isColnectOrdinaryStamp(value)) {
      throw new IssueFormatColnectValueError(
        "Colnect's “Stamp” is an ordinary stamp, which is no issue format — leave it unmapped."
      );
    }
    const key = normalizeColnectAttribute(value);
    const siblings = await prisma.stampIssueFormat.findMany({
      where: { collectionId },
      select: { id: true, colnectValue: true },
    });
    const clash = siblings.find(
      (r) => r.id !== issueFormatId && normalizeColnectAttribute(r.colnectValue) === key
    );
    if (clash) {
      throw new IssueFormatColnectValueError(
        "Another issue format is already mapped to that Colnect word."
      );
    }
  }
  await prisma.stampIssueFormat.update({
    where: { id: issueFormatId },
    data: { colnectValue: value || null },
  });
}
