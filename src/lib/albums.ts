import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { areaSubtreeIds } from "./areas";
import { compareCatalogSortKeys } from "./catalog-sort-key";
import { orderedChecklistStampIds } from "./checklists";
import { normalizeLanguage } from "./languages";
import {
  asAlbumBorderStyle,
  asAlbumBoxBorderStyle,
  asAlbumLabelPosition,
  DEFAULT_ALBUM_PRESET,
  type AlbumRenderPreset,
} from "./album-template-rules";

// Albums (#767) — the Prisma side. The design is #755; ADR-0045 states the model.
//
// **Seeded, never referenced** (#308, #766). Creating an album copies a template's values onto it
// and the link ends there, so an album carries no `albumTemplateId` and editing a template changes
// nothing that has already been planned. That rule matters more here than anywhere else it is
// applied: the thing already planned may be in a binder with stamps glued to it.
//
// The geometry itself is not in this file and must not arrive here. `album-layout.ts` is the plan,
// `album-plan.ts` is what feeds it from these rows, and this module only moves data.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** Resolve an album to its collection, so every write can be authorized from the id alone. */
async function resolveAlbumCollection(albumId: string): Promise<string> {
  const row = await prisma.album.findUnique({
    where: { id: albumId },
    select: { collectionId: true },
  });
  if (!row) throw new Error("Album not found.");
  return row.collectionId;
}

async function resolveEntryAlbum(entryId: string): Promise<{ albumId: string; collectionId: string }> {
  const row = await prisma.albumEntry.findUnique({
    where: { id: entryId },
    select: { albumId: true, album: { select: { collectionId: true } } },
  });
  if (!row) throw new Error("Album entry not found.");
  return { albumId: row.albumId, collectionId: row.album.collectionId };
}

/** Raised on `@@unique([collectionId, name])`. Its own error rather than a generic failed save
 *  (`AlbumTemplateNameTakenError`'s rule): an album is printed by name, and a footer naming one of
 *  two identically-titled binders is a card nobody can file. */
export class AlbumNameTakenError extends Error {
  constructor(name: string) {
    super(`An album called "${name}" already exists.`);
    this.name = "AlbumNameTakenError";
  }
}

/** The preset columns, listed once. The same list as `album-templates.ts`'s, and it has to stay the
 *  same list — `AlbumRenderPreset` is what makes that checkable. */
const PRESET_SELECT = {
  pageWidthMm: true,
  pageHeightMm: true,
  marginTopMm: true,
  marginRightMm: true,
  marginBottomMm: true,
  marginLeftMm: true,
  blocksPerBand: true,
  blockGapMm: true,
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
  printTitle: true,
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
} satisfies Prisma.AlbumSelect;

const ALBUM_SELECT = {
  id: true,
  collectionId: true,
  collectionAreaId: true,
  name: true,
  language: true,
  ...PRESET_SELECT,
} satisfies Prisma.AlbumSelect;

type AlbumRow = Prisma.AlbumGetPayload<{ select: typeof ALBUM_SELECT }>;

/** An album as every surface reads one: its identity and the preset it prints under. */
export interface AlbumData extends AlbumRenderPreset {
  id: string;
  collectionId: string;
  collectionAreaId: string;
  name: string;
  language: string;
}

/** The three choice columns come back as `string`; everything else is already its own type. */
function toAlbumData(row: AlbumRow): AlbumData {
  return {
    ...row,
    borderStyle: asAlbumBorderStyle(row.borderStyle),
    boxBorderStyle: asAlbumBoxBorderStyle(row.boxBorderStyle),
    labelPosition: asAlbumLabelPosition(row.labelPosition),
  };
}

/** An album on the list screen: what it is, what it is about, and how much of it there is. */
export interface AlbumSummary {
  id: string;
  name: string;
  language: string;
  collectionAreaId: string;
  areaName: string;
  entryCount: number;
}

export async function getAlbums(ownerId: string, collectionId: string): Promise<AlbumSummary[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.album.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      language: true,
      collectionAreaId: true,
      collectionArea: { select: { name: true } },
      _count: { select: { entries: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    language: row.language,
    collectionAreaId: row.collectionAreaId,
    areaName: row.collectionArea.name,
    entryCount: row._count.entries,
  }));
}

export async function getAlbum(ownerId: string, albumId: string): Promise<AlbumData | null> {
  const collectionId = await resolveAlbumCollection(albumId);
  await assertCollectionOwner(ownerId, collectionId);
  const row = await prisma.album.findUnique({ where: { id: albumId }, select: ALBUM_SELECT });
  return row ? toAlbumData(row) : null;
}

/** What creating an album needs beyond its preset. */
export interface AlbumInput {
  name: string;
  collectionAreaId: string;
  language: string;
}

function rethrowNameClash(err: unknown, name: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new AlbumNameTakenError(name);
  }
  throw err;
}

/**
 * Create an album on an area, seeded from a template.
 *
 * `templateId` **copies** that template's values (#308's rule) and is then forgotten; null seeds
 * `DEFAULT_ALBUM_PRESET`, which is the geometry of the collector's own AlbumEasy sources rather than
 * a page size somebody made up (#766).
 *
 * The album's entries are gathered immediately, because an album with no entries is indistinguishable
 * from one whose area holds nothing, and the difference matters on the very first screen.
 */
export async function createAlbum(
  ownerId: string,
  collectionId: string,
  input: AlbumInput,
  templateId: string | null
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);

  const area = await prisma.collectionArea.findFirst({
    where: { id: input.collectionAreaId, collectionId },
    select: { id: true },
  });
  if (!area) throw new Error("Area not found in this collection.");

  let preset: AlbumRenderPreset = DEFAULT_ALBUM_PRESET;
  if (templateId) {
    const template = await prisma.albumTemplate.findFirst({
      where: { id: templateId, collectionId },
      select: PRESET_SELECT,
    });
    if (!template) throw new Error("Album template not found in this collection.");
    preset = {
      ...template,
      borderStyle: asAlbumBorderStyle(template.borderStyle),
      boxBorderStyle: asAlbumBoxBorderStyle(template.boxBorderStyle),
      labelPosition: asAlbumLabelPosition(template.labelPosition),
    };
  }

  let albumId: string;
  try {
    const created = await prisma.album.create({
      data: {
        collectionId,
        collectionAreaId: input.collectionAreaId,
        name: input.name,
        language: normalizeLanguage(input.language) ?? input.language,
        ...preset,
      },
      select: { id: true },
    });
    albumId = created.id;
  } catch (err) {
    rethrowNameClash(err, input.name);
  }

  await gatherAlbumEntries(ownerId, albumId);
  return albumId;
}

/** Rename an album or change the language it is printed in.
 *
 *  A language change re-plans every live page — headings are longer in some languages and longer
 *  headings wrap (#755) — and leaves printed pages in the language they were printed in, where #778
 *  reports the divergence like any other. No rule of its own. */
export async function updateAlbum(
  ownerId: string,
  albumId: string,
  input: Pick<AlbumInput, "name" | "language">
): Promise<void> {
  const collectionId = await resolveAlbumCollection(albumId);
  await assertCollectionOwner(ownerId, collectionId);
  try {
    await prisma.album.update({
      where: { id: albumId },
      data: {
        name: input.name,
        language: normalizeLanguage(input.language) ?? input.language,
      },
    });
  } catch (err) {
    rethrowNameClash(err, input.name);
  }
}

/** Re-seed an album's render values from a template. A copy, again: nothing links back afterwards,
 *  and the album is free to be edited away from the template it came from. */
export async function reseedAlbumFromTemplate(
  ownerId: string,
  albumId: string,
  templateId: string
): Promise<void> {
  const collectionId = await resolveAlbumCollection(albumId);
  await assertCollectionOwner(ownerId, collectionId);
  const template = await prisma.albumTemplate.findFirst({
    where: { id: templateId, collectionId },
    select: PRESET_SELECT,
  });
  if (!template) throw new Error("Album template not found in this collection.");
  await prisma.album.update({ where: { id: albumId }, data: template });
}

export async function deleteAlbum(ownerId: string, albumId: string): Promise<void> {
  const collectionId = await resolveAlbumCollection(albumId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.album.delete({ where: { id: albumId } });
}

// ── Entries ──────────────────────────────────────────────────────────────────

/** One entry as the album screen reads it. */
export interface AlbumEntryData {
  id: string;
  checklistId: string;
  checklistName: string;
  issueId: string | null;
  issueName: string | null;
  /** The chapter this entry falls in — `Issue.year`, or null for a checklist that spans issues. */
  year: number | null;
  sortOrder: number;
  /** The stamps of the entry, in the order this album prints them: the checklist's own order (#764)
   *  unless the album overrides it. */
  stampIds: string[];
  /** True when the order above is the album's own rather than the checklist's — what the page editor
   *  (#769) says out loud about a block. */
  ordersItsOwn: boolean;
}

const ENTRY_SELECT = {
  id: true,
  checklistId: true,
  sortOrder: true,
  stampOrder: { select: { stampId: true, sortOrder: true } },
  checklist: {
    select: {
      name: true,
      issueId: true,
      issue: { select: { name: true, year: true, primaryCatalogSortKey: true } },
      stamps: { select: { stampId: true, sortOrder: true } },
    },
  },
} satisfies Prisma.AlbumEntrySelect;

type EntryRow = Prisma.AlbumEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

/**
 * The order this album prints an entry's stamps in.
 *
 * The checklist's own order is the base (#764) and the album may override it. An override is
 * **total or absent**, so this is not a merge: rows present means the album has an opinion about the
 * whole block, rows absent means it is following the collection.
 *
 * A stamp that joined the checklist *after* an override was written has no row, and is appended
 * rather than dropped — a page that quietly omits a stamp is the one failure a want list must not
 * have.
 */
function orderedEntryStampIds(row: EntryRow): { stampIds: string[]; ordersItsOwn: boolean } {
  const base = orderedChecklistStampIds(row.checklist.stamps);
  if (row.stampOrder.length === 0) return { stampIds: base, ordersItsOwn: false };

  const rank = new Map(row.stampOrder.map((o) => [o.stampId, o.sortOrder]));
  const known = base.filter((id) => rank.has(id));
  known.sort((a, b) => rank.get(a)! - rank.get(b)! || a.localeCompare(b));
  const appended = base.filter((id) => !rank.has(id));
  return { stampIds: [...known, ...appended], ordersItsOwn: true };
}

function toEntryData(row: EntryRow): AlbumEntryData {
  const { stampIds, ordersItsOwn } = orderedEntryStampIds(row);
  return {
    id: row.id,
    checklistId: row.checklistId,
    checklistName: row.checklist.name,
    issueId: row.checklist.issueId,
    issueName: row.checklist.issue?.name ?? null,
    year: row.checklist.issue?.year ?? null,
    sortOrder: row.sortOrder,
    stampIds,
    ordersItsOwn,
  };
}

/** An album's entries in the order it prints them. */
export async function getAlbumEntries(
  ownerId: string,
  albumId: string
): Promise<AlbumEntryData[]> {
  const collectionId = await resolveAlbumCollection(albumId);
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.albumEntry.findMany({
    where: { albumId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: ENTRY_SELECT,
  });
  return rows.map(toEntryData);
}

/**
 * Gather the checklists of the album's area subtree that are not in it yet, appending them in
 * catalog order.
 *
 * **Additive.** Nothing is removed: an entry the collector added by hand, or one whose issue has
 * since moved out of the area, is a decision about a card and not a stale row. The one thing that
 * removes an entry is deleting the checklist, which the database cascades.
 *
 * A checklist with **no issue** (`issueId` null — one that spans issues) has no area and cannot be
 * gathered at all. That is the only exception in the whole model, and the screen states it rather
 * than leaving it to be discovered.
 *
 * Returns how many entries were added, so a refresh can say so.
 */
export async function gatherAlbumEntries(ownerId: string, albumId: string): Promise<number> {
  const album = await prisma.album.findUnique({
    where: { id: albumId },
    select: { collectionId: true, collectionAreaId: true },
  });
  if (!album) throw new Error("Album not found.");
  await assertCollectionOwner(ownerId, album.collectionId);

  const areaIds = await areaSubtreeIds(album.collectionId, album.collectionAreaId);
  const candidates = await prisma.checklist.findMany({
    where: {
      collectionId: album.collectionId,
      issue: { collectionAreaId: { in: areaIds } },
    },
    select: {
      id: true,
      sortOrder: true,
      issue: { select: { year: true, primaryCatalogSortKey: true } },
    },
  });

  const existing = new Set(
    (
      await prisma.albumEntry.findMany({ where: { albumId }, select: { checklistId: true } })
    ).map((e) => e.checklistId)
  );
  const missing = candidates.filter((c) => !existing.has(c.id));
  if (missing.length === 0) return 0;

  // Catalog order — the order the album reads in before the collector has said otherwise: by year,
  // then by the issue's catalog sort key (#181), then by the checklist's own order within its issue.
  // A yearless issue sorts last rather than first: an unknown year is not year zero.
  missing.sort(
    (a, b) =>
      (a.issue?.year ?? Number.MAX_SAFE_INTEGER) - (b.issue?.year ?? Number.MAX_SAFE_INTEGER) ||
      compareCatalogSortKeys(
        a.issue?.primaryCatalogSortKey ?? null,
        b.issue?.primaryCatalogSortKey ?? null
      ) ||
      a.sortOrder - b.sortOrder ||
      a.id.localeCompare(b.id)
  );

  const last = await prisma.albumEntry.findFirst({
    where: { albumId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  let next = last ? last.sortOrder + 1 : 0;
  await prisma.albumEntry.createMany({
    data: missing.map((c) => ({ albumId, checklistId: c.id, sortOrder: next++ })),
    skipDuplicates: true,
  });
  return missing.length;
}

/** Add one checklist by hand — the only way a checklist that spans issues can get into an album. */
export async function addAlbumEntry(
  ownerId: string,
  albumId: string,
  checklistId: string
): Promise<void> {
  const collectionId = await resolveAlbumCollection(albumId);
  await assertCollectionOwner(ownerId, collectionId);
  const checklist = await prisma.checklist.findFirst({
    where: { id: checklistId, collectionId },
    select: { id: true },
  });
  if (!checklist) throw new Error("Checklist not found in this collection.");
  const last = await prisma.albumEntry.findFirst({
    where: { albumId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  await prisma.albumEntry.createMany({
    data: [{ albumId, checklistId, sortOrder: last ? last.sortOrder + 1 : 0 }],
    skipDuplicates: true,
  });
}

/** Take an entry out of the album. The checklist itself is untouched — this says *not in this
 *  binder*, not *not a goal*. */
export async function removeAlbumEntry(ownerId: string, entryId: string): Promise<void> {
  const { collectionId } = await resolveEntryAlbum(entryId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.albumEntry.delete({ where: { id: entryId } });
}

/** Persist a new entry order. `orderedIds` must be exactly the album's entries; `sortOrder` is
 *  rewritten to match array position, as `reorderHawidStrips` and `reorderChecklistStamps` do. */
export async function reorderAlbumEntries(
  ownerId: string,
  albumId: string,
  orderedIds: string[]
): Promise<void> {
  const collectionId = await resolveAlbumCollection(albumId);
  await assertCollectionOwner(ownerId, collectionId);
  const existing = await prisma.albumEntry.findMany({ where: { albumId }, select: { id: true } });
  const existingIds = new Set(existing.map((e) => e.id));
  if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(id))) {
    throw new Error("Reorder list does not match the album's entries.");
  }
  await prisma.$transaction(
    orderedIds.map((id, i) => prisma.albumEntry.update({ where: { id }, data: { sortOrder: i } }))
  );
}

/**
 * Give one entry an order of its own, overriding the checklist's (#764).
 *
 * Written **whole**: `orderedStampIds` must be exactly the checklist's stamps, because a partial
 * override cannot define an order and the presence of rows is what says the album has an opinion.
 */
export async function setAlbumEntryStampOrder(
  ownerId: string,
  entryId: string,
  orderedStampIds: string[]
): Promise<void> {
  const { collectionId } = await resolveEntryAlbum(entryId);
  await assertCollectionOwner(ownerId, collectionId);
  const entry = await prisma.albumEntry.findUnique({
    where: { id: entryId },
    select: { checklist: { select: { stamps: { select: { stampId: true } } } } },
  });
  if (!entry) throw new Error("Album entry not found.");
  const members = new Set(entry.checklist.stamps.map((s) => s.stampId));
  if (
    orderedStampIds.length !== members.size ||
    !orderedStampIds.every((id) => members.has(id))
  ) {
    throw new Error("Reorder list does not match the checklist's stamps.");
  }
  await prisma.$transaction([
    prisma.albumEntryStampOrder.deleteMany({ where: { albumEntryId: entryId } }),
    prisma.albumEntryStampOrder.createMany({
      data: orderedStampIds.map((stampId, i) => ({
        albumEntryId: entryId,
        stampId,
        sortOrder: i,
      })),
    }),
  ]);
}

/** Drop an entry's override, returning it to the checklist's own order. Deleting the rows *is* the
 *  reset: an album with no rows is one that has never disagreed. */
export async function clearAlbumEntryStampOrder(
  ownerId: string,
  entryId: string
): Promise<void> {
  const { collectionId } = await resolveEntryAlbum(entryId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.albumEntryStampOrder.deleteMany({ where: { albumEntryId: entryId } });
}
