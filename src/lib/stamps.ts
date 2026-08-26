import "server-only";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "./db";
import {
  catalogKeyMatches,
  catalogMatchKey,
  catalogNumberRuns,
  formatCatalogNumber,
} from "./catalog-number";
import {
  type MoneyDisplay,
  type RawCatalogPrice,
  buildEffectiveAreaCatalogMap,
  buildEffectivePrimaryCatalogMap,
  pickFormatCatalogPrice,
  getLatestEditionYearByName,
  safeRateMap,
  applyConversion,
  baseValueOf,
  averageOf,
  getCollectionBaseCurrency,
  resolveDisplayConditionId,
} from "./pricing";
import {
  isUnknownVariantStamp,
  subtypeLabel,
  VARIANT_FLAG_SELECT,
  type SubtypeLabel,
} from "./variant-classification";
import { buildAreaPrefixNodes, effectivePrefixFor } from "./area-prefix";
import { loadIssuePrefixMap } from "./issue-prefix";
import { deletePhotoBytesForStamp, sortPhotos, type PhotoSummary } from "./photos";
import { recomputeStampSortKeys } from "./catalog-sort-key-recompute";
import { makeFormatFactorLookup, makeFormatFactorResolver } from "./format-pricing";
import { loadStampWantSummaries, type StampWantSummary } from "./wants";
import {
  loadStampCopyCounts,
  NO_COPIES,
  type StampCopyCountMaps,
  type StampCopyCounts,
} from "./copy-counts";
import { putStampOnChecklists } from "./checklists";
import {
  syncEntityTranslations,
  translationsByLanguage,
  type TranslationValueMap,
} from "./translations";
import type { Prisma } from "@/generated/prisma/client";

/** The stamp's translatable fields (#296). Kept beside the domain module so the action parsing the
 * submitted `<field>:<lang>` inputs and the form rendering them cannot drift apart. */
export const STAMP_TRANSLATION_FIELDS = ["name"] as const;

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

async function resolveStampCollection(stampId: string): Promise<string> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: stampId },
    select: { collectionId: true },
  });
  if (!stamp) throw new Error("Stamp not found.");
  return stamp.collectionId;
}

/**
 * Per-language `name` rows for a stamp (#296). Runs on the caller's transaction client — both the
 * edit path here and `addStampToIssue` already wrap their writes in one. Shared blank / delete /
 * untouched rules live in {@link syncEntityTranslations}.
 */
export async function syncStampTranslations(
  tx: Prisma.TransactionClient,
  stampId: string,
  values: TranslationValueMap | undefined
): Promise<void> {
  await syncEntityTranslations(values, {
    upsert: async (language, fields) => {
      const name = fields.name ?? null;
      await tx.stampTranslation.upsert({
        where: { stampId_language: { stampId, language } },
        create: { stampId, language, name },
        update: { name },
      });
    },
    remove: async (language) => {
      await tx.stampTranslation.deleteMany({ where: { stampId, language } });
    },
  });
}

/** A stamp's stored per-language names (#296), for seeding the edit dialog's translation fields.
 * Owner-scoped through {@link resolveStampCollection} + {@link assertCollectionOwner}. */
export async function getStampTranslations(
  ownerId: string,
  stampId: string
): Promise<Record<string, string>> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.stampTranslation.findMany({
    where: { stampId },
    select: { language: true, name: true },
  });
  return translationsByLanguage(rows, (t) => t.name);
}

export interface StampCatalogNumberData {
  catalogVendorId: string;
  number: string;
}

export interface StampVariantData {
  id: string;
  collectionId: string;
  parentId: string | null;
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  createdAt: Date;
  catalogNumbers: StampCatalogNumberData[];
}

export interface StampData extends StampVariantData {
  variants: StampVariantData[];
}

const VARIANT_SELECT = {
  id: true,
  collectionId: true,
  parentId: true,
  name: true,
  issuedDay: true,
  issuedMonth: true,
  issuedYear: true,
  createdAt: true,
  catalogNumbers: {
    select: { catalogVendorId: true, number: true },
  },
} as const;

const STAMP_SELECT = {
  ...VARIANT_SELECT,
  variants: { select: VARIANT_SELECT },
} as const;

export async function createStamp(
  ownerId: string,
  collectionId: string,
  data: { name?: string; issuedDay?: number; issuedMonth?: number; issuedYear?: number }
): Promise<StampData> {
  await assertCollectionOwner(ownerId, collectionId);
  const stamp = await prisma.stamp.create({
    data: {
      collectionId,
      name: data.name ?? null,
      issuedDay: data.issuedDay ?? null,
      issuedMonth: data.issuedMonth ?? null,
      issuedYear: data.issuedYear ?? null,
    },
    select: { ...STAMP_SELECT, variants: { select: STAMP_SELECT } },
  });
  return stamp;
}

export async function createVariant(
  ownerId: string,
  parentId: string,
  data: { name?: string; issuedDay?: number; issuedMonth?: number; issuedYear?: number }
): Promise<StampData> {
  const collectionId = await resolveStampCollection(parentId);
  await assertCollectionOwner(ownerId, collectionId);
  const stamp = await prisma.stamp.create({
    data: {
      collectionId,
      parentId,
      name: data.name ?? null,
      issuedDay: data.issuedDay ?? null,
      issuedMonth: data.issuedMonth ?? null,
      issuedYear: data.issuedYear ?? null,
    },
    select: { ...STAMP_SELECT, variants: { select: STAMP_SELECT } },
  });
  return stamp;
}

export async function updateStamp(
  ownerId: string,
  stampId: string,
  data: { name?: string | null; issuedDay?: number | null; issuedMonth?: number | null; issuedYear?: number | null }
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stamp.update({ where: { id: stampId }, data });
}

async function deleteStampTreeTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  stampId: string,
  deletedIds: string[]
): Promise<void> {
  const children = await tx.stamp.findMany({
    where: { parentId: stampId },
    select: { id: true },
  });
  for (const child of children) {
    await deleteStampTreeTx(tx, child.id, deletedIds);
  }
  await tx.stamp.delete({ where: { id: stampId } });
  deletedIds.push(stampId);
}

export async function deleteStamp(
  ownerId: string,
  stampId: string,
  mode: "cascade" | "reparent" = "cascade"
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);

  // Ids of every stamp actually removed, so their photo bytes are cleaned up post-commit
  // (Prisma cascade drops the `Photo` rows, but not the stored files — #137). Reparent removes
  // only the target; cascade removes the whole subtree.
  const deletedIds: string[] = [];

  if (mode === "reparent") {
    await prisma.$transaction(async (tx) => {
      const stamp = await tx.stamp.findUniqueOrThrow({
        where: { id: stampId },
        select: { parentId: true },
      });
      await tx.stamp.updateMany({
        where: { parentId: stampId },
        data: { parentId: stamp.parentId },
      });
      await tx.stamp.delete({ where: { id: stampId } });
      deletedIds.push(stampId);
    });
  } else {
    await prisma.$transaction(async (tx) => {
      await deleteStampTreeTx(tx, stampId, deletedIds);
    });
  }

  await Promise.all(deletedIds.map((id) => deletePhotoBytesForStamp(id)));
}

export async function getStampChildCount(
  ownerId: string,
  stampId: string
): Promise<number> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.stamp.count({ where: { parentId: stampId } });
}

export interface StampSubtypeAssignment {
  parentId: string | null;
  subtypeId: string | null;
  actsAsVariantOverride: boolean | null;
}

/** The subtype classification of a single stamp, for prefilling the edit form. */
export async function getStampSubtypeAssignment(
  ownerId: string,
  stampId: string
): Promise<StampSubtypeAssignment> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.stamp.findUniqueOrThrow({
    where: { id: stampId },
    select: { parentId: true, subtypeId: true, actsAsVariantOverride: true },
  });
}

export async function getStamp(
  ownerId: string,
  stampId: string
): Promise<StampData> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  const stamp = await prisma.stamp.findUniqueOrThrow({
    where: { id: stampId },
    select: { ...STAMP_SELECT, variants: { select: STAMP_SELECT } },
  });
  return stamp;
}

export async function listStamps(
  ownerId: string,
  collectionId: string,
  filters?: { collectionAreaId?: string }
): Promise<StampData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.stamp.findMany({
    where: {
      collectionId,
      parentId: null,
      ...(filters?.collectionAreaId
        ? { stampAreaLinks: { some: { collectionAreaId: filters.collectionAreaId } } }
        : {}),
    },
    select: { ...STAMP_SELECT, variants: { select: STAMP_SELECT } },
    orderBy: { createdAt: "asc" },
  });
}

// ── Paginated queries (used by API routes) ─────────────────────────────────

export interface StampIssueMembership {
  issueId: string;
  issueName: string | null;
  issueYear: number | null;
  /** **Every** checklist of this membership's issue (#531), each flagged with whether this stamp
   *  is on it. All of them rather than only the ones it is on, because the stamp form's picker has
   *  to offer the boxes it is *not* ticked for. None ticked = an optional extra of the issue,
   *  which is what `requiredForCompleteness = false` used to say. */
  checklists: { id: string; name: string; on: boolean }[];
}

export interface StampListItem {
  id: string;
  collectionId: string;
  parentId: string | null;
  subtypeId: string | null;
  /** The stamp's subtype for display (#340), or null for a base stamp. */
  subtype: SubtypeLabel | null;
  actsAsVariantOverride: boolean | null;
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  createdAt: string;
  catalogNumbers: StampCatalogNumberData[];
  /** Colnect Marketplace item-ID (#247), or null when unset. */
  colnectId: string | null;
  areaId: string | null;
  issues: StampIssueMembership[];
  mainCatalogPrice: MoneyDisplay | null;
  /** True when the displayed main price is on a non-latest edition of its catalog name. */
  mainCatalogPriceStale: boolean;
  /** True when the displayed main price was **derived** from the single's by a format multiplier
   *  rather than recorded for the displayed format (#343) — an estimate, not a catalog figure. */
  mainCatalogPriceDerived: boolean;
  /** Catalog-level photos (#137), ordered front, back, then extras by sortOrder. Metadata only —
   * the collection-scoped serving route addresses variant bytes by photo id. */
  photos: PhotoSummary[];
  /** Copies held of this stamp (#348), counted for this stamp exactly — a variant's copies are
   *  its own, never rolled into its parent's badge. */
  copies: StampCopyCounts;
  /** Copies held under this stamp's variant-kind descendants (#528), at any depth — reported
   *  beside {@link copies}, never added to it. Broken down by disposition the same way, so the
   *  badge can say what those copies are held for and not only how many there are. */
  variantCopies: StampCopyCounts;
  /** The open wants recorded for this stamp (#532), or null for none — the catalogue row's *this
   *  is still being looked for* marker. */
  wants: StampWantSummary | null;
}

export interface PaginatedStampsResult {
  items: StampListItem[];
  nextCursor: string | null;
}

const STAMP_LIST_SELECT = {
  id: true,
  collectionId: true,
  parentId: true,
  subtypeId: true,
  // Name + default-ness for the row's subtype chip (#340).
  subtype: { select: { name: true, isDefault: true } },
  actsAsVariantOverride: true,
  name: true,
  issuedDay: true,
  issuedMonth: true,
  issuedYear: true,
  createdAt: true,
  colnectId: true,
  catalogNumbers: { select: { catalogVendorId: true, number: true } },
  catalogPrices: {
    select: {
      price: true,
      currency: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      catalogEdition: { select: { year: true, catalogNameId: true } },
    },
  },
  stampAreaLinks: {
    select: { collectionAreaId: true, isPrimary: true },
  },
  issueMemberships: {
    select: {
      issueId: true,
      // The issue's own checklists, so the row can say which sets claim this stamp (#531). Paired
      // with `checklistEntries` below, which says which of them it is actually on.
      issue: {
        select: { name: true, year: true, checklists: { select: { id: true, name: true } } },
      },
    },
  },
  checklistEntries: { select: { checklistId: true } },
  photos: { select: { id: true, role: true, title: true, sortOrder: true } },
} as const;

function toStampListItem(
  stamp: {
    id: string;
    collectionId: string;
    parentId: string | null;
    subtypeId: string | null;
    subtype: { name: string; isDefault: boolean } | null;
    actsAsVariantOverride: boolean | null;
    name: string | null;
    issuedDay: number | null;
    issuedMonth: number | null;
    issuedYear: number | null;
    createdAt: Date;
    colnectId: string | null;
    catalogNumbers: { catalogVendorId: string; number: string }[];
    catalogPrices: RawCatalogPrice[];
    stampAreaLinks: { collectionAreaId: string; isPrimary: boolean }[];
    issueMemberships: {
      issueId: string;
      issue: {
        name: string | null;
        year: number | null;
        checklists: { id: string; name: string }[];
      };
    }[];
    checklistEntries: { checklistId: string }[];
    photos: { id: string; role: string | null; title: string | null; sortOrder: number }[];
  },
  primaryCatalogByArea: Map<string, string | null>,
  baseCurrency: string,
  latestYearByName: Map<string, number>,
  displayConditionId: string | null,
  displayFormatId: string | null,
  factorFor: (areaId: string | null, issueId: string | null) => number | null,
  copyCounts: StampCopyCountMaps,
  wantsByStamp: Map<string, StampWantSummary>
): StampListItem {
  const primaryLink = stamp.stampAreaLinks.find((l) => l.isPrimary);
  const areaId = primaryLink?.collectionAreaId ?? stamp.stampAreaLinks[0]?.collectionAreaId ?? null;
  const primaryNameId = areaId ? (primaryCatalogByArea.get(areaId) ?? null) : null;
  const onChecklist = new Set(stamp.checklistEntries.map((e) => e.checklistId));
  // A format's price is explicit or derived (#343): the recorded row for the format wins, else the
  // single's price × the multiplier resolved for this stamp's area and issue.
  const { picked: main, derived: mainCatalogPriceDerived } = pickFormatCatalogPrice(
    stamp.catalogPrices,
    primaryNameId,
    displayConditionId,
    null,
    displayFormatId,
    factorFor(areaId, stamp.issueMemberships[0]?.issueId ?? null)
  );
  const mainCatalogPriceStale = main
    ? (latestYearByName.get(main.catalogNameId) ?? main.editionYear) > main.editionYear
    : false;
  return {
    id: stamp.id,
    collectionId: stamp.collectionId,
    parentId: stamp.parentId,
    subtypeId: stamp.subtypeId,
    subtype: subtypeLabel(stamp),
    actsAsVariantOverride: stamp.actsAsVariantOverride,
    name: stamp.name,
    issuedDay: stamp.issuedDay,
    issuedMonth: stamp.issuedMonth,
    issuedYear: stamp.issuedYear,
    createdAt: stamp.createdAt.toISOString(),
    colnectId: stamp.colnectId,
    catalogNumbers: stamp.catalogNumbers,
    areaId,
    issues: stamp.issueMemberships
      .map((m) => ({
        issueId: m.issueId,
        issueName: m.issue.name,
        issueYear: m.issue.year,
        // Each membership answers for its own issue: a stamp on two issues is on each one's
        // checklists separately, exactly as the old per-membership boolean was.
        checklists: m.issue.checklists.map((c) => ({ ...c, on: onChecklist.has(c.id) })),
      }))
      // Sorted so `issues[0]` is a **rule** and not whatever Postgres handed back. Several readers
      // already call it *the first membership* and act on it — the stamp edit dialog picks the
      // checklists it edits from it (#531), the Variants card writes its tree against it (#630) —
      // and a stamp on two issues would otherwise have those two disagree between page loads. The
      // earliest issue reads as first, a year-less one last, and the id settles a tie. Sorted here
      // rather than in the select because `STAMP_LIST_SELECT` is `as const` and Prisma's `orderBy`
      // will not take a readonly array.
      .sort(
        (a, b) =>
          (a.issueYear ?? Infinity) - (b.issueYear ?? Infinity) ||
          a.issueId.localeCompare(b.issueId)
      ),
    // convertedAmount filled by buildStampListItems after rates are fetched
    mainCatalogPrice: main
      ? { amount: main.amount.toFixed(2), currency: main.currency, convertedAmount: null, baseCurrency }
      : null,
    mainCatalogPriceStale,
    mainCatalogPriceDerived,
    photos: stamp.photos
      .map((p) => ({
        id: p.id,
        // Stamps use the single `main` slot (#137); keep any known slot role, else it's an extra.
        role: (p.role === "main" || p.role === "front" || p.role === "back"
          ? p.role
          : null) as "front" | "back" | "main" | null,
        title: p.title,
        sortOrder: p.sortOrder,
      }))
      .sort(sortPhotos),
    copies: copyCounts.direct.get(stamp.id) ?? NO_COPIES,
    variantCopies: copyCounts.variant.get(stamp.id) ?? NO_COPIES,
    wants: wantsByStamp.get(stamp.id) ?? null,
  };
}

/** Map stamps to list items and attach base-currency conversions in one batched rate fetch. */
async function buildStampListItems(
  stamps: Parameters<typeof toStampListItem>[0][],
  collectionId: string,
  primaryCatalogByArea: Map<string, string | null>,
  baseCurrency: string,
  displayConditionId: string | null,
  displayFormatId: string | null
): Promise<StampListItem[]> {
  const [latestYearByName, factorFor, copyCounts, wantsByStamp] = await Promise.all([
    getLatestEditionYearByName(collectionId),
    makeFormatFactorResolver(collectionId, displayFormatId, displayConditionId),
    // Only the page's stamps (#348) — this funnel is reached with the rows already sliced.
    loadStampCopyCounts(collectionId, stamps.map((s) => s.id)),
    loadStampWantSummaries(collectionId, stamps.map((s) => s.id)),
  ]);
  const items = stamps.map((s) =>
    toStampListItem(
      s,
      primaryCatalogByArea,
      baseCurrency,
      latestYearByName,
      displayConditionId,
      displayFormatId,
      factorFor,
      copyCounts,
      wantsByStamp
    )
  );
  const currencies = items
    .map((i) => i.mainCatalogPrice?.currency)
    .filter((c): c is string => !!c);
  const rates = await safeRateMap(collectionId, baseCurrency, currencies);
  for (const it of items) {
    const mp = it.mainCatalogPrice;
    if (mp) {
      mp.convertedAmount = applyConversion(Number(mp.amount), mp.currency, baseCurrency, rates);
    }
  }
  return items;
}

export type StampSortBy = "issueDate" | "catalogNumber" | "name" | "issueName";

export interface StampListFilterOpts {
  areaIds?: string[];
  offset?: number;
  pageSize?: number;
  search?: string;
  catalogVendorId?: string;
  catalogNumber?: string;
  issueId?: string;
  /** Restrict to a single year. A number matches `stamp.issuedYear`; `"none"`
   *  matches stamps with no issued year. Omitted means no year filter. */
  year?: number | "none";
  sortBy?: StampSortBy;
  sortDir?: "asc" | "desc";
  /** Condition whose price fills the list price column. When omitted, defaults
   *  to the collection's first condition by sortOrder. */
  displayConditionId?: string | null;
  /** Physical format whose price fills the list price column (#343). Null / omitted is the
   *  single — the default, and the only value a collection with no formats can have. */
  displayFormatId?: string | null;
}


/** Build the Prisma `where` for the stamp list from the active filters.
 *  Reused by the paginated list and the year-facet aggregation; the latter
 *  omits `opts.year` so the year counts stay stable while a year is selected. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildStampListWhere(collectionId: string, opts: StampListFilterOpts): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [];

  if (opts.areaIds && opts.areaIds.length > 0) {
    conditions.push({ stampAreaLinks: { some: { collectionAreaId: { in: opts.areaIds } } } });
  }

  if (opts.issueId) {
    conditions.push({ issueMemberships: { some: { issueId: opts.issueId } } });
  }

  if (opts.search) {
    const s = opts.search;
    conditions.push({
      OR: [
        { name: { contains: s, mode: "insensitive" } },
        { issueMemberships: { some: { issue: { name: { contains: s, mode: "insensitive" } } } } },
        { catalogNumbers: { some: { number: { contains: s, mode: "insensitive" } } } },
      ],
    });
  }

  // Catalog filter (#146): a number narrows to a vendor when one is set, else it
  // matches that number across every vendor. A vendor without a number does not
  // filter on its own.
  if (opts.catalogNumber) {
    conditions.push({
      catalogNumbers: {
        some: {
          number: opts.catalogNumber,
          ...(opts.catalogVendorId ? { catalogVendorId: opts.catalogVendorId } : {}),
        },
      },
    });
  }

  if (opts.year !== undefined) {
    conditions.push({ issuedYear: opts.year === "none" ? null : opts.year });
  }

  return {
    collectionId,
    ...(conditions.length === 1 ? conditions[0] : conditions.length > 1 ? { AND: conditions } : {}),
  };
}

export interface StampYearFacet {
  /** null represents the "No year" bucket. */
  year: number | null;
  count: number;
}

/** Distinct issued years present in the stamp list for the given filters (year
 *  filter itself is ignored), each with a count. Sorted ascending, null
 *  ("No year") last (#703). */
export async function listStampYearFacets(
  ownerId: string,
  collectionId: string,
  opts: Omit<StampListFilterOpts, "year" | "offset" | "pageSize" | "sortBy" | "sortDir" | "displayConditionId">
): Promise<StampYearFacet[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const where = buildStampListWhere(collectionId, opts);
  const groups = await prisma.stamp.groupBy({
    by: ["issuedYear"],
    where,
    _count: { _all: true },
  });
  return groups
    .map((g) => ({ year: g.issuedYear, count: g._count._all }))
    .sort((a, b) => {
      // Oldest first (#703): the facet is a timeline of the collection, and a collector scanning it
      // for a period reads it the way the album is arranged. "No year" stays last either way — it is
      // not a point on that line.
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return a.year - b.year;
    });
}

export async function listStampsPaginated(
  ownerId: string,
  collectionId: string,
  opts: StampListFilterOpts
): Promise<PaginatedStampsResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = opts.pageSize ?? 50;
  const offset = opts.offset ?? 0;
  const dir = opts.sortDir ?? "asc";
  const sortBy = opts.sortBy ?? "issueDate";
  const [primaryCatalogByArea, baseCurrency, displayConditionId] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    getCollectionBaseCurrency(collectionId),
    resolveDisplayConditionId(collectionId, opts.displayConditionId),
  ]);
  // Null is the single (ADR-0020) — no resolution step, unlike the condition, because there is no
  // "first format" row to fall back to.
  const displayFormatId = opts.displayFormatId ?? null;

  const where = buildStampListWhere(collectionId, opts);

  // The primary catalog number is the implicit secondary (tiebreaker) sort key everywhere (#181),
  // served by the denormalized `primaryCatalogSortKey` column (ADR-0014). Number-less rows sort
  // last (NULLS LAST); the date components keep their prior default null ordering.
  const tieBreak = { primaryCatalogSortKey: { sort: "asc", nulls: "last" } } as const;

  // The `issueName` sort orders by the stamp's issue, which lives across the to-many
  // `issueMemberships` relation Prisma can't `orderBy`; resolve it in memory. The stored sort key
  // still supplies the tiebreaker, so no catalog-number re-parsing is needed.
  if (sortBy === "issueName") {
    const rows = await prisma.stamp.findMany({
      where,
      select: {
        id: true,
        name: true,
        primaryCatalogSortKey: true,
        issueMemberships: { select: { issue: { select: { name: true } } }, take: 1 },
      },
    });
    const s = dir === "desc" ? -1 : 1;
    const issueNameOf = (r: (typeof rows)[number]) => r.issueMemberships[0]?.issue.name ?? "";
    rows.sort((a, b) => {
      const primary = s * issueNameOf(a).localeCompare(issueNameOf(b));
      if (primary !== 0) return primary;
      // Tiebreaker: primary catalog number ascending, nulls last.
      const ka = a.primaryCatalogSortKey;
      const kb = b.primaryCatalogSortKey;
      if (ka !== kb) {
        if (ka === null) return 1;
        if (kb === null) return -1;
        return ka - kb;
      }
      const n = (a.name ?? "").localeCompare(b.name ?? "");
      if (n !== 0) return n;
      return a.id.localeCompare(b.id);
    });
    const pageRows = rows.slice(offset, offset + pageSize + 1);
    const hasMore = pageRows.length > pageSize;
    const finalIds = (hasMore ? pageRows.slice(0, pageSize) : pageRows).map((r) => r.id);
    const stamps = await prisma.stamp.findMany({
      where: { id: { in: finalIds } },
      select: STAMP_LIST_SELECT,
    });
    const idOrder = new Map(finalIds.map((id, i) => [id, i]));
    stamps.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
    const items = await buildStampListItems(
      stamps,
      collectionId,
      primaryCatalogByArea,
      baseCurrency,
      displayConditionId,
      displayFormatId
    );
    return { items, nextCursor: hasMore ? String(offset + pageSize) : null };
  }

  const orderBy =
    sortBy === "name"
      ? [{ name: dir }, tieBreak, { id: "asc" as const }]
      : sortBy === "catalogNumber"
        ? [
            { primaryCatalogSortKey: { sort: dir, nulls: "last" } } as const,
            { name: "asc" as const },
            { id: "asc" as const },
          ]
        : [
            { issuedYear: dir },
            { issuedMonth: dir },
            { issuedDay: dir },
            tieBreak,
            { id: "asc" as const },
          ];

  const stamps = await prisma.stamp.findMany({
    where,
    orderBy,
    select: STAMP_LIST_SELECT,
    take: pageSize + 1,
    skip: offset,
  });
  const hasMore = stamps.length > pageSize;
  const items = await buildStampListItems(
    hasMore ? stamps.slice(0, pageSize) : stamps,
    collectionId,
    primaryCatalogByArea,
    baseCurrency,
    displayConditionId,
    displayFormatId
  );
  const nextCursor = hasMore ? String(offset + pageSize) : null;
  return { items, nextCursor };
}

/**
 * One stamp enriched exactly as the flat Stamps list enriches a row — same headline price, same
 * copy counts, same photos. The stamp detail screen (#518) reads through this rather than through
 * {@link getStamp} so the page and the row it was opened from cannot describe one stamp
 * differently. The `getItemListItem` precedent (#241).
 */
export async function getStampListItem(
  ownerId: string,
  stampId: string,
  opts?: { displayConditionId?: string | null; displayFormatId?: string | null }
): Promise<StampListItem> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  const [primaryCatalogByArea, baseCurrency, displayConditionId, stamp] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    getCollectionBaseCurrency(collectionId),
    resolveDisplayConditionId(collectionId, opts?.displayConditionId),
    prisma.stamp.findUniqueOrThrow({ where: { id: stampId }, select: STAMP_LIST_SELECT }),
  ]);
  const [item] = await buildStampListItems(
    [stamp],
    collectionId,
    primaryCatalogByArea,
    baseCurrency,
    displayConditionId,
    opts?.displayFormatId ?? null
  );
  return item;
}

/** Where in the tree this stamp sits among the variants beside it (#630) — `1` of `5`, one-based,
 *  read in the very order the card lists a parent's children in. */
export interface StampSiblingPosition {
  index: number;
  total: number;
}

/** A stamp's place in the variant tree (#54): the base it hangs under, and the variants under it. */
export interface StampRelatives {
  parent: StampListItem | null;
  children: StampListItem[];
  /** This stamp's place among its siblings, or null when it hangs under no base stamp. */
  position: StampSiblingPosition | null;
  /**
   * The issue the Variants card writes against (#630): the stamp's **first** issue membership,
   * null when it belongs to none. Sibling order and issue membership are both per-issue facts
   * (`IssueMember.sortOrder`, #549), so a card that manages a tree has to settle on one issue —
   * the same first-membership rule the stamp edit dialog already edits checklists by. The card
   * *names* it rather than assuming it, so a stamp on two issues says which one is being changed.
   */
  treeIssueId: string | null;
  /**
   * Whether {@link children} are one **complete** sibling group of {@link treeIssueId} — the only
   * shape `reorderIssueMembers` accepts (#549). False when a variant belongs to some other issue
   * (or to none), where a drag here would send the server a partial group.
   */
  childrenOrderable: boolean;
}

/**
 * The parent and the direct children of a stamp, each enriched as a list row so the variant card
 * on the stamp detail screen (#518) reads like the issue tree it mirrors. One level in each
 * direction: the card manages *this* stamp's own level, and a whole subtree drawn on a detail page
 * is the issue screen's job (#519).
 *
 * Order is the tree's own, not the catalogue's: `IssueMember.sortOrder` within {@link
 * StampRelatives.treeIssueId} where the stamp is a member, then the denormalized catalog sort key
 * (ADR-0014) — the variant price grid's rule exactly (#618), so the two surfaces list one tree the
 * same way round and a drag here shows up there.
 */
export async function getStampRelatives(
  ownerId: string,
  stampId: string,
  opts?: { displayConditionId?: string | null; displayFormatId?: string | null }
): Promise<StampRelatives> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  const self = await prisma.stamp.findUniqueOrThrow({
    where: { id: stampId },
    select: {
      parentId: true,
      // The first membership, on `toStampListItem`'s own rule — earliest issue, id to settle a
      // tie — so the issue this card writes against is the one the header's Issues card leads with.
      issueMemberships: {
        select: { issueId: true, issue: { select: { year: true } } },
      },
    },
  });
  const treeIssueId =
    [...self.issueMemberships].sort(
      (a, b) =>
        (a.issue.year ?? Infinity) - (b.issue.year ?? Infinity) ||
        a.issueId.localeCompare(b.issueId)
    )[0]?.issueId ?? null;

  const [primaryCatalogByArea, baseCurrency, displayConditionId, rows, memberOrder] =
    await Promise.all([
      buildEffectivePrimaryCatalogMap(collectionId),
      getCollectionBaseCurrency(collectionId),
      resolveDisplayConditionId(collectionId, opts?.displayConditionId),
      prisma.stamp.findMany({
        where: {
          collectionId,
          OR: [
            { parentId: stampId },
            ...(self.parentId ? [{ id: self.parentId }, { parentId: self.parentId }] : []),
          ],
        },
        orderBy: [{ primaryCatalogSortKey: { sort: "asc", nulls: "last" } }, { name: "asc" }],
        select: STAMP_LIST_SELECT,
      }),
      // Only the tree issue's positions are read: they are the order this card draws and the order
      // a drag from it writes back.
      treeIssueId
        ? prisma.issueMember.findMany({
            where: { issueId: treeIssueId },
            select: { stampId: true, sortOrder: true },
          })
        : Promise.resolve([]),
    ]);

  const items = await buildStampListItems(
    rows,
    collectionId,
    primaryCatalogByArea,
    baseCurrency,
    displayConditionId,
    opts?.displayFormatId ?? null
  );
  const sortOrderByStamp = new Map(memberOrder.map((m) => [m.stampId, m.sortOrder]));
  /** The catalogue order the query returned, used as the tiebreak — and as the whole answer for a
   *  group the tree issue does not order. A stable sort keeps it under equal keys. */
  const catalogRank = new Map(items.map((i, rank) => [i.id, rank]));
  const inTreeOrder = (group: StampListItem[]): StampListItem[] =>
    [...group].sort((a, b) => {
      const sa = sortOrderByStamp.get(a.id);
      const sb = sortOrderByStamp.get(b.id);
      if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
      // A member always precedes a non-member: the manual order is the one the collector set.
      if ((sa === undefined) !== (sb === undefined)) return sa === undefined ? 1 : -1;
      return (catalogRank.get(a.id) ?? 0) - (catalogRank.get(b.id) ?? 0);
    });

  const children = inTreeOrder(items.filter((i) => i.parentId === stampId));
  const siblings = self.parentId
    ? inTreeOrder(items.filter((i) => i.parentId === self.parentId))
    : [];
  const selfIndex = siblings.findIndex((i) => i.id === stampId);

  return {
    parent: items.find((i) => i.id === self.parentId) ?? null,
    children,
    // The stamp is one of its parent's children, so it is in `siblings` by construction; the
    // guard is for a tree that changed under the read, not for an ordinary miss.
    position:
      self.parentId && selfIndex >= 0
        ? { index: selfIndex + 1, total: siblings.length }
        : null,
    treeIssueId,
    childrenOrderable:
      !!treeIssueId && children.length > 1 && children.every((c) => sortOrderByStamp.has(c.id)),
  };
}

// ── Stamp picker search (inventory item dialog, #104) ──────────────────────

/** One suggestion row for the inventory stamp/variant picker, carrying enough
 * identity to disambiguate a stamp: catalog labels, name, year, area, and the
 * issue it belongs to. A base stamp with variants is selectable as the
 * "unknown variant" (ADR-0007 §2); `isVariant` marks an identified variant. */
export interface StampSearchItem {
  stampId: string;
  parentId: string | null;
  isVariant: boolean;
  /** True for a base stamp that has variants — selecting it means the specific
   * variant is unknown (ADR-0007 §2). */
  hasVariants: boolean;
  name: string | null;
  issuedYear: number | null;
  areaId: string | null;
  areaName: string | null;
  issueId: string | null;
  issueName: string | null;
  issueYear: number | null;
  /** Formatted catalog labels, e.g. ["Mi·PL 200"]. */
  catalogNumbers: string[];
  /** The stamp's subtype for display (#340), or null for a base stamp. */
  subtype: SubtypeLabel | null;
}

const PICKER_LIMIT = 20;

/**
 * The substrings to recall stamps by from a picker query, matched against the stored catalog
 * `number` — which has to contain **all** of them.
 *
 * Digits are the sharpest handle and the common case, taken one **run** at a time: `"Mi PL 200"` →
 * `["200"]`, `"Mi PL BL30 B4"` → `["30", "4"]`. Per run rather than all the digits at once because a
 * number carrying two of them concatenates to something no stored value contains (`"304"` against a
 * filed `"BL30 B4"`), so the stamp was never recalled however it was typed (#435).
 *
 * A run keeps the letters written straight after it ({@link catalogNumberRuns}), which is what makes
 * a **variant** reachable: `"Fi PL 7cII"` → `["7cII"]` rather than `["7"]`. The candidate net is
 * capped, and a low bare digit run is shared by thousands of numbers in a real collection — so a net
 * woven on `"7"` alone comes back full of other stamps and the one asked for is never in it.
 * Matched case-insensitively, so a stamp filed as `7cii` answers to the `7cII` a collector types.
 *
 * A query with **no digits at all** would otherwise never reach the catalog branch, which loses
 * digit-free numbering — Michel's Roman local issues, e.g. `Mi·RU-BW IIIA`. For those the handle is
 * the query's last whitespace-separated token (`"Mi RU-BW IIIA"` → `"IIIA"`, `"IIIA"` → `"IIIA"`),
 * matched case-insensitively so a stamp filed as `IIIa` is still recalled. An ordinary word query
 * ("eagle") simply lands on this branch and matches no number — recall may over-match freely, since
 * the precision pass below is what decides.
 *
 * The whitespace split is what the vendor/prefix are shed by, so — unlike the numeric case — a
 * *fully concatenated* digit-free query ("MiRU-BWIIIA") is not recalled: there is no digit run to
 * cut on, and stripping a vendor abbreviation here would need the collection's vendors before the
 * query is built. Typing the parts apart, or the bare number, finds the stamp.
 */
function catalogRecallToken(text: string): { values: string[]; insensitive: boolean } | null {
  const runs = catalogNumberRuns(text);
  if (runs.length > 0) return { values: runs, insensitive: true };
  const last = text.trim().split(/\s+/).at(-1) ?? "";
  return last ? { values: [last], insensitive: true } : null;
}

/**
 * Search a collection's stamps for the inventory picker autocomplete (#104).
 *
 * The database query is a broad *recall* net — name / issue-name substring, a
 * catalog-number `contains` (see {@link catalogRecallToken}), and a copy `locationRef`
 * substring (#303) — and the JS pass is *precision*: a candidate survives only if the
 * query matches its name/issue text, one of its copies' location refs, or, via
 * {@link catalogKeyMatches}, its normalized catalog keys (vendor abbreviation + effective
 * area prefix + number). That normalization is what lets `Mi PL200`, `MiPL200`, and `200`
 * all resolve to the same stamp. Returns ≤20 rows, catalog matches first, then by newest
 * issue year.
 */
export async function searchStampsForPicker(
  ownerId: string,
  collectionId: string,
  query: string
): Promise<StampSearchItem[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const text = query.trim();
  if (!text) return [];
  const catalogToken = catalogRecallToken(text);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const or: any[] = [
    { name: { contains: text, mode: "insensitive" } },
    { issueMemberships: { some: { issue: { name: { contains: text, mode: "insensitive" } } } } },
  ];
  if (catalogToken) {
    or.push({
      catalogNumbers: {
        // Every run has to be inside the *same* stored number, so they are ANDed on one `some`.
        some: {
          AND: catalogToken.values.map((value) => ({
            number: catalogToken.insensitive
              ? { contains: value, mode: "insensitive" }
              : { contains: value },
          })),
        },
      },
    });
  }
  // A stamp is also reachable by where one of its copies is filed (#303), so the shelf
  // reference on a piece in hand finds the stamp it belongs to.
  const locationRefWhere = { locationRef: { contains: text, mode: "insensitive" as const } };
  or.push({ items: { some: locationRefWhere } });

  const [candidates, vendors, areaRows, issuePrefixes] = await Promise.all([
    prisma.stamp.findMany({
      where: { collectionId, OR: or },
      select: {
        id: true,
        parentId: true,
        name: true,
        issuedYear: true,
        catalogNumbers: { select: { catalogVendorId: true, number: true } },
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
        issueMemberships: {
          select: { issueId: true, issue: { select: { name: true, year: true } } },
          take: 1,
        },
        variants: { select: VARIANT_FLAG_SELECT },
        // The candidate's own subtype, for the result row's chip (#340) — `variants` above carries
        // the children's, which answers a different question (is this an umbrella?).
        subtype: { select: { name: true, isDefault: true } },
        // Pre-filtered to the matching copies only, so its presence *is* the location hit.
        items: { where: locationRefWhere, select: { id: true }, take: 1 },
      },
      // Cap recall generously; precision + ranking narrow to PICKER_LIMIT below.
      take: 200,
    }),
    prisma.catalogVendor.findMany({
      where: { collectionId },
      select: { id: true, abbreviation: true },
    }),
    prisma.collectionArea.findMany({
      where: { collectionId },
      select: {
        id: true,
        name: true,
        parentId: true,
        catalogPrefix: true,
        collectionAreaVendors: { select: { catalogVendorId: true, areaPrefix: true } },
      },
    }),
    // Per-issue prefix overrides (#377) — part of the picker's *match key*, not only its labels, so
    // a stamp under a sub-catalog is found by the number the collector actually reads on it.
    loadIssuePrefixMap(collectionId),
  ]);

  const vendorAbbr = new Map(vendors.map((v) => [v.id, v.abbreviation]));
  const areaNames = new Map(areaRows.map((a) => [a.id, a.name]));
  const areaNodes = buildAreaPrefixNodes(areaRows);

  interface Scored {
    item: StampSearchItem;
    exactCatalog: boolean;
  }
  const scored: Scored[] = [];

  for (const s of candidates) {
    const primaryLink = s.stampAreaLinks.find((l) => l.isPrimary) ?? s.stampAreaLinks[0];
    const areaId = primaryLink?.collectionAreaId ?? null;

    const membershipIssueId = s.issueMemberships[0]?.issueId ?? null;
    const labels: string[] = [];
    const keys: string[] = [];
    for (const cn of s.catalogNumbers) {
      const abbr = vendorAbbr.get(cn.catalogVendorId) ?? "";
      const prefix = effectivePrefixFor(
        areaId,
        cn.catalogVendorId,
        areaNodes,
        membershipIssueId,
        issuePrefixes
      );
      labels.push(formatCatalogNumber(abbr, prefix, cn.number));
      keys.push(catalogMatchKey(abbr, prefix, cn.number));
    }

    const membership = s.issueMemberships[0];
    const lower = text.toLowerCase();
    const nameHit = !!s.name && s.name.toLowerCase().includes(lower);
    const issueName = membership?.issue.name ?? null;
    const issueHit = !!issueName && issueName.toLowerCase().includes(lower);
    const catalogHit = catalogKeyMatches(text, keys);
    const locationHit = s.items.length > 0;

    if (!nameHit && !issueHit && !catalogHit && !locationHit) continue;

    scored.push({
      // Catalog-number matches are the most specific intent, so rank them first.
      exactCatalog: catalogHit,
      item: {
        stampId: s.id,
        parentId: s.parentId,
        isVariant: s.parentId !== null,
        hasVariants: isUnknownVariantStamp(s),
        name: s.name,
        issuedYear: s.issuedYear,
        areaId,
        areaName: areaId ? (areaNames.get(areaId) ?? null) : null,
        issueId: membership?.issueId ?? null,
        issueName,
        issueYear: membership?.issue.year ?? null,
        catalogNumbers: labels,
        subtype: subtypeLabel(s),
      },
    });
  }

  scored.sort((a, b) => {
    if (a.exactCatalog !== b.exactCatalog) return a.exactCatalog ? -1 : 1;
    return (b.item.issueYear ?? 0) - (a.item.issueYear ?? 0);
  });

  return scored.slice(0, PICKER_LIMIT).map((x) => x.item);
}

// ── Mutations ──────────────────────────────────────────────────────────────

export interface CatalogPriceInput {
  catalogEditionId: string;
  conditionId: string;
  certificateStatusId: string | null;
  /** Physical format; null or absent = single, so a caller that predates formats stays valid.
   *  An explicit row here always wins over a value derived from a multiplier. */
  formatId?: string | null;
  price: string;
  currency: string;
}

export async function updateStampWithCatalog(
  ownerId: string,
  stampId: string,
  data: {
    name?: string | null;
    issuedDay?: number | null;
    issuedMonth?: number | null;
    issuedYear?: number | null;
    catalogNumbers: { catalogVendorId: string; number: string }[];
    catalogPrices?: CatalogPriceInput[];
    // Colnect item-ID (#247). `undefined` leaves the stored value untouched (callers whose
    // form doesn't render the field); a string sets it; `null`/"" clears it.
    colnectId?: string | null;
    /** Per-language `name` overrides (#296), keyed by ISO 639-1 code then field key. Omitted
     * (undefined) by callers whose form doesn't render them, leaving every row untouched. */
    translations?: TranslationValueMap;
    /** Which checklists of {@link checklistIssueId} the stamp should be on afterwards (#531).
     *  `undefined` leaves every membership untouched — callers whose form does not render the
     *  field. Requires `checklistIssueId`: a checklist edit is always about one issue's goals. */
    checklistIds?: string[];
    /** The issue whose checklists {@link checklistIds} names. */
    checklistIssueId?: string | null;
    // Child-only subtype classification (ADR-0010). `undefined` leaves the current
    // value untouched; for a child, `subtypeId: null` falls back to the collection
    // default. Top-level stamps are always forced back to null on both fields.
    subtypeId?: string | null;
    actsAsVariantOverride?: boolean | null;
  }
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.$transaction(async (tx) => {
    const managesSubtype =
      data.subtypeId !== undefined || data.actsAsVariantOverride !== undefined;
    const subtypeData: { subtypeId?: string | null; actsAsVariantOverride?: boolean | null } = {};
    if (managesSubtype) {
      const current = await tx.stamp.findUniqueOrThrow({
        where: { id: stampId },
        select: { parentId: true },
      });
      if (current.parentId === null) {
        // Top-level stamps are never classified.
        subtypeData.subtypeId = null;
        subtypeData.actsAsVariantOverride = null;
      } else {
        if (data.subtypeId !== undefined) {
          let sid = data.subtypeId;
          if (sid) {
            const sub = await tx.stampSubtype.findFirst({
              where: { id: sid, collectionId },
              select: { id: true },
            });
            if (!sub) throw new Error("Subtype not found in this collection.");
          } else {
            const def = await tx.stampSubtype.findFirst({
              where: { collectionId, isDefault: true },
              select: { id: true },
            });
            sid = def?.id ?? null;
          }
          subtypeData.subtypeId = sid;
        }
        if (data.actsAsVariantOverride !== undefined) {
          subtypeData.actsAsVariantOverride = data.actsAsVariantOverride;
        }
      }
    }
    await tx.stamp.update({
      where: { id: stampId },
      data: {
        name: data.name ?? null,
        issuedDay: data.issuedDay ?? null,
        issuedMonth: data.issuedMonth ?? null,
        issuedYear: data.issuedYear ?? null,
        // Omit when undefined so callers that don't manage the field leave it untouched;
        // a blank string clears it to null.
        ...(data.colnectId !== undefined ? { colnectId: data.colnectId || null } : {}),
        ...subtypeData,
      },
    });
    await syncStampTranslations(tx, stampId, data.translations);
    if (data.checklistIds !== undefined && data.checklistIssueId) {
      await putStampOnChecklists(
        tx,
        collectionId,
        data.checklistIssueId,
        stampId,
        data.checklistIds
      );
    }
    await tx.stampCatalogNumber.deleteMany({ where: { stampId } });
    if (data.catalogNumbers.length > 0) {
      await tx.stampCatalogNumber.createMany({
        data: data.catalogNumbers.map((cn) => ({
          stampId,
          catalogVendorId: cn.catalogVendorId,
          number: cn.number,
        })),
        skipDuplicates: true,
      });
    }
    if (data.catalogPrices !== undefined) {
      await tx.stampCatalogPrice.deleteMany({ where: { stampId } });
      if (data.catalogPrices.length > 0) {
        await tx.stampCatalogPrice.createMany({
          data: data.catalogPrices.map((cp) => ({
            stampId,
            catalogEditionId: cp.catalogEditionId,
            conditionId: cp.conditionId,
            certificateStatusId: cp.certificateStatusId,
            formatId: cp.formatId ?? null,
            price: cp.price,
            currency: cp.currency,
          })),
          skipDuplicates: true,
        });
      }
    }
  });
  // Catalog numbers may have changed → refresh the denormalized sort key (#181).
  await recomputeStampSortKeys(collectionId, [stampId]);
}

/** One already-recorded catalog price shown for reference in the quick editor, so the user
 * can price a new (condition × certificate × edition) consistently with what's on file. */
export interface QuickCatalogPriceReference {
  catalogLabel: string;
  editionYear: number;
  conditionAbbreviation: string;
  certificateStatusName: string | null;
  /** Abbreviation of the format this price is for (#343), or null for the single. */
  formatAbbreviation: string | null;
  price: string;
  currency: string;
  /** True for the exact target the field writes to (primary catalog's latest edition ×
   * this condition × this certificate, at the **single**) — the value the amount field prefills
   * from. Never a format row: the quick editor does not write those. */
  isTarget: boolean;
}

/** One catalog the quick-price editor can write to: the latest edition of a catalog active
 * on the stamp's primary area (plus the effective primary catalog), the currency the value
 * lands in, and the amount already recorded there for this condition × certificate so the
 * field can prefill. `isPrimary` marks the stamp's effective primary catalog (#170). */
export interface QuickCatalogTarget {
  catalogNameId: string;
  catalogLabel: string;
  vendorAbbreviation: string;
  editionYear: number;
  currency: string;
  amount: string | null;
  isPrimary: boolean;
  /** An **explicit** price already recorded on this edition for the format the caller is showing,
   * when that format is not the single. It is what the copy on screen is actually worth, and it is
   * also the one case where nothing this dialog writes changes that figure: an explicit format row
   * outranks the derivation (`pickFormatCatalogPrice`), and only the stamp's Prices tab can edit it.
   * Null when there is none — the format's value then derives from the single being typed here. */
  formatAmount: string | null;
}

/** Context for the quick catalog-price editor: every catalog the value can land in (one row
 * per vendor active on the stamp's area, primary flagged), and read-only context (area + any
 * other recorded prices) so the user can price confidently without leaving the dialog
 * (#147, #170). */
export interface QuickCatalogPriceContext {
  /** Catalogs the editor exposes an input for, primary first. Empty when the stamp's area
   * has no catalog with an edition yet. */
  catalogs: QuickCatalogTarget[];
  /** Area whose effective primary catalog the value resolves through, for orientation. */
  areaName: string | null;
  /** Every recorded price for this stamp across editions/conditions/certificates, newest
   * edition first, for reference. Empty when nothing is on file yet. */
  otherPrices: QuickCatalogPriceReference[];
  /**
   * The format the caller is *showing*, when it is not the single — read-only orientation, never a
   * write target (#343).
   *
   * The quick editor always writes the single's row, because that is what a catalogue quotes: a
   * multiple's value is the single's price times this multiplier, which is exactly how a copy in
   * that format is valued when it has no explicit row of its own. So the dialog can say what the
   * figure being typed means for the copy on screen without pretending to price it.
   *
   * `factor` is null when no factor row applies — nothing derives there, and a copy in that format
   * stays unpriced until either a factor or an explicit price exists.
   */
  displayFormat: { formatId: string; abbreviation: string; factor: number | null } | null;
}

/** Resolve the catalogs the quick-price editor can write to for a stamp: every catalog **effective**
 * on the stamp's primary area (#675 — its own books, or the nearest ancestor's where it attaches
 * none), unioned with the area's effective primary catalog, keeping only
 * catalogs that have at least one edition (a price needs an edition to land on). Latest edition
 * per catalog, primary first, then by vendor/catalog name. Throws if the stamp isn't linked to
 * an area. Returns the internal target shape (with `editionId` for price matching); the public
 * `QuickCatalogTarget` drops `editionId` and adds the recorded `amount`. */
async function resolveAreaCatalogTargets(
  collectionId: string,
  stampId: string
): Promise<
  Array<{
    catalogNameId: string;
    catalogLabel: string;
    vendorAbbreviation: string;
    editionId: string;
    editionYear: number;
    currency: string;
    isPrimary: boolean;
  }>
> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: stampId },
    select: { stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } } },
  });
  const link = stamp?.stampAreaLinks.find((l) => l.isPrimary) ?? stamp?.stampAreaLinks[0];
  const areaId = link?.collectionAreaId ?? null;
  if (!areaId) {
    throw new Error("This stamp isn't linked to an area, so it has no catalog.");
  }
  const [primaryByArea, booksByArea] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    buildEffectiveAreaCatalogMap(collectionId),
  ]);
  const primaryCatalogNameId = primaryByArea.get(areaId) ?? null;
  const candidateIds = new Set<string>(booksByArea.get(areaId) ?? []);
  if (primaryCatalogNameId) candidateIds.add(primaryCatalogNameId);
  if (candidateIds.size === 0) return [];

  const catalogs = await prisma.catalogName.findMany({
    where: { id: { in: [...candidateIds] } },
    select: {
      id: true,
      name: true,
      currency: true,
      vendor: { select: { abbreviation: true } },
      catalogEditions: { select: { id: true, year: true }, orderBy: { year: "desc" }, take: 1 },
    },
  });

  return catalogs
    .flatMap((c) => {
      const edition = c.catalogEditions[0];
      if (!edition) return [];
      return [
        {
          catalogNameId: c.id,
          catalogLabel: c.name,
          vendorAbbreviation: c.vendor.abbreviation,
          editionId: edition.id,
          editionYear: edition.year,
          currency: c.currency,
          isPrimary: c.id === primaryCatalogNameId,
        },
      ];
    })
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return (
        a.vendorAbbreviation.localeCompare(b.vendorAbbreviation) ||
        a.catalogLabel.localeCompare(b.catalogLabel)
      );
    });
}

export async function getQuickCatalogPriceContext(
  ownerId: string,
  stampId: string,
  conditionId: string,
  certificateStatusId: string | null,
  /**
   * The format the caller is *showing* (#343) — a list's format switcher, or a copy's own format.
   * It never moves the row being read: the quick editor prices the **single**, and this only
   * decides what the dialog can say the typed figure works out at for the copy on screen. Null when
   * the caller is showing singles, which is most of them.
   */
  displayFormatId: string | null = null
): Promise<QuickCatalogPriceContext> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  const certId = certificateStatusId ?? null;
  const targets = await resolveAreaCatalogTargets(collectionId, stampId);

  const prices = await prisma.stampCatalogPrice.findMany({
    where: { stampId },
    select: {
      catalogEditionId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      price: true,
      currency: true,
      condition: { select: { abbreviation: true } },
      certificateStatus: { select: { name: true } },
      format: { select: { abbreviation: true } },
      catalogEdition: {
        select: { year: true, catalogName: { select: { name: true } } },
      },
    },
    orderBy: { catalogEdition: { year: "desc" } },
  });

  // The row every input reads from and writes to: the **single**, always. Not the format the caller
  // happens to be showing — a catalogue quotes singles, and a multiple's value is that figure times
  // the format's factor, so writing the shown format's row here would file a single's quotation as
  // the multiple's own price and stop the factor from ever applying. A price that genuinely deviates
  // from the derivation is an explicit row, entered on the stamp's Prices tab, which is the only
  // place with the grid to see what it is deviating from.
  const amountFor = (editionId: string, formatId: string | null) => {
    const existing = prices.find(
      (p) =>
        p.catalogEditionId === editionId &&
        p.conditionId === conditionId &&
        p.certificateStatusId === certId &&
        p.formatId === formatId
    );
    return existing ? existing.price.toFixed(2) : null;
  };
  const targetEditionIds = new Set(targets.map((t) => t.editionId));

  const areaName = await resolvePrimaryAreaName(stampId);

  return {
    catalogs: targets.map((t) => ({
      catalogNameId: t.catalogNameId,
      catalogLabel: t.catalogLabel,
      vendorAbbreviation: t.vendorAbbreviation,
      editionYear: t.editionYear,
      currency: t.currency,
      amount: amountFor(t.editionId, null),
      isPrimary: t.isPrimary,
      formatAmount: displayFormatId ? amountFor(t.editionId, displayFormatId) : null,
    })),
    areaName,
    otherPrices: prices.map((p) => ({
      catalogLabel: p.catalogEdition.catalogName.name,
      editionYear: p.catalogEdition.year,
      conditionAbbreviation: p.condition.abbreviation,
      certificateStatusName: p.certificateStatus?.name ?? null,
      formatAbbreviation: p.format?.abbreviation ?? null,
      price: p.price.toFixed(2),
      currency: p.currency,
      // A recorded price is a "target" (the value an input prefills from) when it sits on one
      // of the editable editions for this condition × certificate, at the single.
      isTarget:
        targetEditionIds.has(p.catalogEditionId) &&
        p.conditionId === conditionId &&
        p.certificateStatusId === certId &&
        p.formatId === null,
    })),
    displayFormat: await resolveDisplayFormat(collectionId, stampId, conditionId, displayFormatId),
  };
}

/** The shown format's name and the multiplier that derives its value from the single's, for the
 * read-only line the quick editor draws (#343). Null for the single, and for a format id that is
 * not this collection's — the dialog then simply says nothing about formats. */
async function resolveDisplayFormat(
  collectionId: string,
  stampId: string,
  conditionId: string,
  displayFormatId: string | null
): Promise<QuickCatalogPriceContext["displayFormat"]> {
  if (!displayFormatId) return null;
  const format = await prisma.stampFormat.findFirst({
    where: { id: displayFormatId, collectionId },
    select: { id: true, abbreviation: true },
  });
  if (!format) return null;
  const [stamp, lookup] = await Promise.all([
    prisma.stamp.findUnique({
      where: { id: stampId },
      select: {
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
        issueMemberships: { select: { issueId: true }, take: 1 },
      },
    }),
    makeFormatFactorLookup(collectionId),
  ]);
  // The **primary** area link, the one `areaPathIds` resolves a factor against everywhere else.
  const link = stamp?.stampAreaLinks.find((l) => l.isPrimary) ?? stamp?.stampAreaLinks[0];
  return {
    formatId: format.id,
    abbreviation: format.abbreviation,
    factor: lookup(
      format.id,
      link?.collectionAreaId ?? null,
      stamp?.issueMemberships[0]?.issueId ?? null,
      conditionId
    ),
  };
}

/** Name of the stamp's primary (or first) area, for read-only orientation in the quick
 * catalog-price editor. Null when the stamp isn't linked to any area. */
async function resolvePrimaryAreaName(stampId: string): Promise<string | null> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: stampId },
    select: {
      stampAreaLinks: {
        select: { isPrimary: true, collectionArea: { select: { name: true } } },
      },
    },
  });
  const link =
    stamp?.stampAreaLinks.find((l) => l.isPrimary) ?? stamp?.stampAreaLinks[0];
  return link?.collectionArea.name ?? null;
}

/** One catalog value to set from the quick-price editor: a raw amount for a specific catalog
 * (by `catalogNameId`), which resolves to that catalog's latest edition and currency. */
export interface QuickCatalogPriceEntry {
  catalogNameId: string;
  amount: number;
}

/**
 * Quickly set (or overwrite) catalog values for a stamp at `conditionId × certificateStatusId`
 * from the quick-add dialog: each entry lands on the latest edition of its catalog, in that
 * catalog's currency (#170). Catalogs must belong to the collection; each is written on the
 * latest edition (ADR-0006). Used by the lot intake / offer-set screens to price a copy inline
 * without opening the full stamp editor (#121, #164).
 *
 * **Always the single**, and there is deliberately no parameter for a format. A quick price is a
 * figure read straight off a paper catalogue, and a catalogue quotes singles: a multiple's value is
 * that figure times the resolved `StampFormatFactor` (`pickFormatCatalogPrice`). Writing the
 * displayed format's row instead would file a single's quotation as the multiple's own price *and*
 * suppress the factor for good, from a dialog whose collector never asked for either. A multiple
 * whose real price deviates from the derivation gets an explicit row on the stamp's Prices tab —
 * the one screen that shows what it is deviating from.
 */
export async function quickSetCatalogPrices(
  ownerId: string,
  stampId: string,
  conditionId: string,
  certificateStatusId: string | null,
  entries: QuickCatalogPriceEntry[]
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  if (entries.length === 0) {
    throw new Error("Enter at least one catalog value.");
  }
  const cond = await prisma.stampCondition.findFirst({
    where: { id: conditionId, collectionId },
    select: { id: true },
  });
  if (!cond) throw new Error("Condition not found in this collection.");
  if (certificateStatusId) {
    const cert = await prisma.certificateStatus.findFirst({
      where: { id: certificateStatusId, collectionId },
      select: { id: true },
    });
    if (!cert) throw new Error("Certificate status not found in this collection.");
  }

  for (const entry of entries) {
    if (!Number.isFinite(entry.amount) || entry.amount < 0) {
      throw new Error("Enter a valid non-negative amount.");
    }
    const catalog = await prisma.catalogName.findFirst({
      where: { id: entry.catalogNameId, vendor: { collectionId } },
      select: {
        currency: true,
        catalogEditions: { select: { id: true }, orderBy: { year: "desc" }, take: 1 },
      },
    });
    if (!catalog) throw new Error("Catalog not found in this collection.");
    const edition = catalog.catalogEditions[0];
    if (!edition) throw new Error("That catalog has no editions yet.");
    const priceStr = entry.amount.toFixed(2);
    // The (stamp, edition, condition, cert, format) uniqueness uses NULLS NOT DISTINCT, which
    // Prisma can't target in `upsert`; find-then-write instead.
    const existing = await prisma.stampCatalogPrice.findFirst({
      where: {
        stampId,
        catalogEditionId: edition.id,
        conditionId,
        certificateStatusId: certificateStatusId ?? null,
        formatId: null,
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.stampCatalogPrice.update({
        where: { id: existing.id },
        data: { price: priceStr, currency: catalog.currency },
      });
    } else {
      await prisma.stampCatalogPrice.create({
        data: {
          stampId,
          catalogEditionId: edition.id,
          conditionId,
          certificateStatusId: certificateStatusId ?? null,
          formatId: null,
          price: priceStr,
          currency: catalog.currency,
        },
      });
    }
  }
}

export async function upsertStampCatalogNumber(
  ownerId: string,
  stampId: string,
  catalogVendorId: string,
  number: string
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampCatalogNumber.upsert({
    where: { stampId_catalogVendorId: { stampId, catalogVendorId } },
    create: { stampId, catalogVendorId, number },
    update: { number },
  });
  await recomputeStampSortKeys(collectionId, [stampId]);
}

export async function deleteStampCatalogNumber(
  ownerId: string,
  stampId: string,
  catalogVendorId: string
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampCatalogNumber.delete({
    where: { stampId_catalogVendorId: { stampId, catalogVendorId } },
  });
  await recomputeStampSortKeys(collectionId, [stampId]);
}

export interface StampCatalogPriceData {
  catalogEditionId: string;
  price: Decimal;
  currency: string;
}

export interface StampCatalogPriceDisplay {
  catalogEditionId: string;
  conditionId: string;
  /** Physical format this price is for; null = single. */
  formatId: string | null;
  conditionName: string;
  conditionAbbreviation: string;
  certificateStatusId: string | null;
  certificateStatusName: string | null;
  certificateStatusAbbreviation: string | null;
  price: string;
  currency: string;
  /** Price converted to the collection base currency, or null when same currency / no rate. */
  convertedAmount: string | null;
  baseCurrency: string;
  editionYear: number;
  catalogNameId: string;
  catalogName: string;
  vendorAbbreviation: string;
  catalogNameCurrency: string;
}

export async function getStampCatalogPrices(
  ownerId: string,
  stampId: string
): Promise<StampCatalogPriceDisplay[]> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  const prices = await prisma.stampCatalogPrice.findMany({
    where: { stampId },
    select: {
      catalogEditionId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      price: true,
      currency: true,
      condition: { select: { name: true, abbreviation: true } },
      certificateStatus: { select: { name: true, abbreviation: true } },
      catalogEdition: {
        select: {
          year: true,
          catalogNameId: true,
          catalogName: {
            select: {
              name: true,
              currency: true,
              vendor: { select: { abbreviation: true } },
            },
          },
        },
      },
    },
    orderBy: { catalogEdition: { year: "desc" } },
  });

  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  const rates = await safeRateMap(
    collectionId,
    baseCurrency,
    prices.map((p) => p.currency)
  );

  return prices.map((p) => ({
    catalogEditionId: p.catalogEditionId,
    conditionId: p.conditionId,
    conditionName: p.condition.name,
    conditionAbbreviation: p.condition.abbreviation,
    certificateStatusId: p.certificateStatusId,
    certificateStatusName: p.certificateStatus?.name ?? null,
    certificateStatusAbbreviation: p.certificateStatus?.abbreviation ?? null,
    formatId: p.formatId,
    price: Number(p.price).toFixed(2),
    currency: p.currency,
    convertedAmount: applyConversion(Number(p.price), p.currency, baseCurrency, rates),
    baseCurrency,
    editionYear: p.catalogEdition.year,
    catalogNameId: p.catalogEdition.catalogNameId,
    catalogName: p.catalogEdition.catalogName.name,
    vendorAbbreviation: p.catalogEdition.catalogName.vendor.abbreviation,
    catalogNameCurrency: p.catalogEdition.catalogName.currency,
  }));
}

/** Axes shared by every price/average cell so the dialog can lay them out as a matrix. */
interface StampCellAxes {
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  conditionSortOrder: number;
  certificateStatusId: string | null;
  certificateStatusName: string | null;
  certificateStatusAbbreviation: string | null;
  /** Certificate sort order; -1 for "None" so it always leads. */
  certificateSortOrder: number;
}

/** One averaged price across catalogs, for a (condition × certificate) intersection. */
export interface StampAverageCell extends StampCellAxes {
  /** Mean of the per-catalog prices in the collection base currency, 2 decimals; null when none convertible. */
  averageBase: string | null;
  baseCurrency: string;
  /** Catalogs that contributed to the average. */
  catalogCount: number;
  /** Catalogs that priced this intersection but whose currency could not be converted (excluded). */
  excludedNoRateCount: number;
}

/** One recorded price at a (condition × certificate) intersection of a single edition. */
export interface StampPriceCell extends StampCellAxes {
  price: string;
  currency: string;
  convertedAmount: string | null;
  baseCurrency: string;
}

/** One catalog edition — the collapsible unit in the dialog's catalog breakdown. */
export interface StampEditionGroup {
  catalogEditionId: string;
  editionYear: number;
  /** True for the newest edition (by year) of its catalog that has any price. */
  isNewest: boolean;
  catalogNameId: string;
  catalogName: string;
  vendorAbbreviation: string;
  catalogNameCurrency: string;
  cells: StampPriceCell[];
}

export interface StampPriceDetails {
  baseCurrency: string;
  /** Averages across catalogs, always in the collection base currency. */
  averageCells: StampAverageCell[];
  /** One entry per catalog edition, ordered by catalog name then newest year first. */
  editions: StampEditionGroup[];
}

/**
 * A stamp's recorded prices, shaped for the price-details dialog: the cross-catalog
 * average per (condition × certificate) plus the full per-edition breakdown. Averages
 * take, per catalog, the newest edition that prices a given combination, convert it to
 * the collection base currency, and mean those values; they are independent of the
 * dialog's latest/all toggle. Cells carry condition/certificate sort orders so the
 * dialog can render them as a conditions-as-rows × certificates-as-columns matrix.
 * See price-details dialog.
 */
export async function getStampPriceDetails(
  ownerId: string,
  stampId: string
): Promise<StampPriceDetails> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  const prices = await prisma.stampCatalogPrice.findMany({
    where: { stampId },
    select: {
      catalogEditionId: true,
      conditionId: true,
      certificateStatusId: true,
      price: true,
      currency: true,
      condition: { select: { name: true, abbreviation: true, sortOrder: true } },
      certificateStatus: { select: { name: true, abbreviation: true, sortOrder: true } },
      catalogEdition: {
        select: {
          year: true,
          catalogNameId: true,
          catalogName: {
            select: {
              name: true,
              currency: true,
              vendor: { select: { abbreviation: true } },
            },
          },
        },
      },
    },
    orderBy: { catalogEdition: { year: "desc" } },
  });

  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  const rates = await safeRateMap(
    collectionId,
    baseCurrency,
    prices.map((p) => p.currency)
  );

  const axesOf = (p: (typeof prices)[number]): StampCellAxes => ({
    conditionId: p.conditionId,
    conditionName: p.condition.name,
    conditionAbbreviation: p.condition.abbreviation,
    conditionSortOrder: p.condition.sortOrder,
    certificateStatusId: p.certificateStatusId,
    certificateStatusName: p.certificateStatus?.name ?? null,
    certificateStatusAbbreviation: p.certificateStatus?.abbreviation ?? null,
    certificateSortOrder: p.certificateStatus?.sortOrder ?? -1,
  });

  // ── Averages: per catalog, the newest edition pricing each (condition × cert). ──
  const bestPerCatalogCombo = new Map<string, (typeof prices)[number]>();
  for (const p of prices) {
    const key = `${p.catalogEdition.catalogNameId}~${p.conditionId}~${p.certificateStatusId ?? ""}`;
    const cur = bestPerCatalogCombo.get(key);
    if (!cur || p.catalogEdition.year > cur.catalogEdition.year) bestPerCatalogCombo.set(key, p);
  }
  const comboGroups = new Map<
    string,
    { sample: (typeof prices)[number]; values: number[]; excluded: number }
  >();
  for (const p of bestPerCatalogCombo.values()) {
    const key = `${p.conditionId}~${p.certificateStatusId ?? ""}`;
    let g = comboGroups.get(key);
    if (!g) {
      g = { sample: p, values: [], excluded: 0 };
      comboGroups.set(key, g);
    }
    const bv = baseValueOf(Number(p.price), p.currency, baseCurrency, rates);
    if (bv == null) g.excluded += 1;
    else g.values.push(bv);
  }
  const averageCells: StampAverageCell[] = [...comboGroups.values()].map((g) => {
    const avg = averageOf(g.values);
    return {
      ...axesOf(g.sample),
      averageBase: avg == null ? null : avg.toFixed(2),
      baseCurrency,
      catalogCount: g.values.length,
      excludedNoRateCount: g.excluded,
    };
  });

  // ── Per-edition breakdown (each edition is a collapsible section). ──
  const edMap = new Map<string, StampEditionGroup>();
  for (const p of prices) {
    let ed = edMap.get(p.catalogEditionId);
    if (!ed) {
      ed = {
        catalogEditionId: p.catalogEditionId,
        editionYear: p.catalogEdition.year,
        isNewest: false,
        catalogNameId: p.catalogEdition.catalogNameId,
        catalogName: p.catalogEdition.catalogName.name,
        vendorAbbreviation: p.catalogEdition.catalogName.vendor.abbreviation,
        catalogNameCurrency: p.catalogEdition.catalogName.currency,
        cells: [],
      };
      edMap.set(p.catalogEditionId, ed);
    }
    ed.cells.push({
      ...axesOf(p),
      price: Number(p.price).toFixed(2),
      currency: p.currency,
      convertedAmount: applyConversion(Number(p.price), p.currency, baseCurrency, rates),
      baseCurrency,
    });
  }
  const newestByCatalog = new Map<string, number>();
  for (const ed of edMap.values()) {
    const cur = newestByCatalog.get(ed.catalogNameId);
    if (cur === undefined || ed.editionYear > cur) newestByCatalog.set(ed.catalogNameId, ed.editionYear);
  }
  const editions = [...edMap.values()]
    .map((ed) => ({ ...ed, isNewest: ed.editionYear === newestByCatalog.get(ed.catalogNameId) }))
    .sort((a, b) => a.catalogName.localeCompare(b.catalogName) || b.editionYear - a.editionYear);

  return { baseCurrency, averageCells, editions };
}

export interface StaleCatalogPrice {
  stampId: string;
  catalogEditionId: string;
  price: Decimal;
  currency: string;
  editionYear: number;
  catalogNameId: string;
  latestEditionId: string;
  latestEditionYear: number;
}

export async function findStaleCatalogPrices(
  ownerId: string,
  collectionId: string
): Promise<StaleCatalogPrice[]> {
  await assertCollectionOwner(ownerId, collectionId);

  const prices = await prisma.stampCatalogPrice.findMany({
    where: { stamp: { collectionId } },
    select: {
      stampId: true,
      catalogEditionId: true,
      price: true,
      currency: true,
      catalogEdition: {
        select: {
          year: true,
          catalogNameId: true,
          catalogName: {
            select: {
              catalogEditions: {
                select: { id: true, year: true },
                orderBy: { year: "desc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  const stale: StaleCatalogPrice[] = [];
  for (const p of prices) {
    const latest = p.catalogEdition.catalogName.catalogEditions[0];
    if (latest && latest.year > p.catalogEdition.year) {
      stale.push({
        stampId: p.stampId,
        catalogEditionId: p.catalogEditionId,
        price: p.price,
        currency: p.currency,
        editionYear: p.catalogEdition.year,
        catalogNameId: p.catalogEdition.catalogNameId,
        latestEditionId: latest.id,
        latestEditionYear: latest.year,
      });
    }
  }
  return stale;
}
