import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { loadStampWantSummaries, type StampWantSummary } from "./wants";
import { getStampConditions } from "./conditions";
import { getCertificateStatuses } from "./certificate-statuses";
import {
  childIsVariant,
  isUnknownVariantStamp,
  subtypeLabel,
  VARIANT_FLAG_SELECT,
  type SubtypeLabel,
} from "./variant-classification";
import { sortPhotos, type PhotoRole, type PhotoSummary } from "./photos";
import { computeIssueRangeSuggestions, type IssueRangeSuggestion } from "./catalog-number";
import {
  recomputeIssueSortKeys,
  recomputeStampSortKeys,
} from "./catalog-sort-key-recompute";
import {
  syncEntityTranslations,
  translationsByLanguage,
  type TranslationValueMap,
} from "./translations";
import { syncStampTranslations } from "./stamps";
import { makeFormatFactorResolver } from "./format-pricing";
import {
  loadStampCopyCounts,
  NO_COPIES,
  type StampCopyCountMaps,
  type StampCopyCounts,
} from "./copy-counts";
import { allocateEntityNumber } from "./items";
import { ensureIssueChecklist, putStampOnChecklists } from "./checklists";
import { parseEntityNoSearch } from "./quick-jump";
import { checkSiblingGroup, sortOrderAssignments } from "./issue-member-order";

/** The issue's translatable fields (#295). Kept beside the domain module so the action parsing the
 * submitted `<field>:<lang>` inputs and the form rendering them cannot drift apart. */
export const ISSUE_TRANSLATION_FIELDS = ["name"] as const;

export type { IssueRangeSuggestion } from "./catalog-number";

/** Prisma select for a photo summary carried on a stamp node/issue row (#137). */
const PHOTO_SUMMARY_SELECT = {
  id: true,
  role: true,
  title: true,
  sortOrder: true,
} as const;

/** Map raw photo rows to sorted `PhotoSummary`s (front→back→main→extras by sortOrder). */
function toPhotoSummaries(
  rows: { id: string; role: string | null; title: string | null; sortOrder: number }[]
): PhotoSummary[] {
  return rows
    .map((p) => ({
      id: p.id,
      role: (p.role === "main" || p.role === "front" || p.role === "back"
        ? p.role
        : null) as PhotoRole,
      title: p.title,
      sortOrder: p.sortOrder,
    }))
    .sort(sortPhotos);
}
import {
  type IssuePriceTotal,
  type MoneyDisplay,
  type RawCatalogPrice,
  buildDescendantMap,
  buildEffectivePrimaryCatalogMap,
  pickHeadlineCatalogPrice,
  getLatestEditionYearByName,
  safeRateMap,
  applyConversion,
  baseValueOf,
  averageOf,
  getCollectionBaseCurrency,
  resolveDisplayConditionId,
} from "./pricing";

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

async function resolveIssueArea(issueId: string): Promise<{ collectionId: string; collectionAreaId: string }> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { collectionId: true, collectionAreaId: true },
  });
  if (!issue) throw new Error("Issue not found.");
  return issue;
}

/** The area an issue belongs to, or null if the issue is missing. Used to resolve the
 * catalog-number prefix context for duplicate detection when adding a stamp (#85). */
export async function getIssueAreaId(issueId: string): Promise<string | null> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { collectionAreaId: true },
  });
  return issue?.collectionAreaId ?? null;
}

export interface StampNodeData {
  stampId: string;
  parentId: string | null;
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  /** Checklists of *this issue* the stamp is on (#531) — empty means an optional extra, which is
   *  what `requiredForCompleteness = false` used to say. A stamp on a checklist of some other
   *  issue is not reported here: the tree belongs to one issue and answers for that one. */
  checklistIds: string[];
  catalogNumbers: { catalogVendorId: string; number: string }[];
  /** Colnect Marketplace item-ID (#247), or null when unset. */
  colnectId: string | null;
  mainCatalogPrice: MoneyDisplay | null;
  /** True when the displayed main price is on a non-latest edition of its catalog name. */
  mainCatalogPriceStale: boolean;
  /** True when the displayed main price was rolled up from the lowest variant child because
   *  this stamp is an unknown-variant umbrella with no own price (#238) — an estimate. */
  mainCatalogPriceUncertain: boolean;
  /** True when the displayed main price was **derived** from the single's by a format multiplier
   *  rather than recorded for the displayed format (#343) — also an estimate. */
  mainCatalogPriceDerived: boolean;
  /** Effective actsAsVariant (ADR-0010 §3): override ?? subtype flag; false if none.
   *  A base stamp is an unknown-variant umbrella iff a child has this true. */
  actsAsVariant: boolean;
  /** The stamp's subtype for display (#340), or null for a base stamp. The collection default is
   *  reported as stored and dropped by the chip, not here. */
  subtype: SubtypeLabel | null;
  /** Catalog-level photos (#137), ordered main then extras — shown under the expanded row. */
  photos: PhotoSummary[];
  /** Copies held of this stamp (#348), counted for this stamp exactly — a variant child's copies
   *  belong to the child's own badge. Zero for every stamp when the caller loaded no counts. */
  copies: StampCopyCounts;
  /** Copies held under this stamp's variant-kind descendants (#528), at any depth — the second
   *  number beside {@link copies}, broken down by disposition the same way. Zero when the caller
   *  loaded no counts. */
  variantCopies: StampCopyCounts;
  /** The open wants recorded for this stamp (#532), or null for none — the catalogue row's *this
   *  is still being looked for* marker. Null too when the caller loaded no summaries. */
  wants: StampWantSummary | null;
}

export interface IssueCatalogNumberData {
  catalogVendorId: string;
  firstNumber: string;
  lastNumber: string | null;
}

/** One vendor's per-issue override of the area-resolved catalog prefix (#377). */
export interface IssueCatalogPrefixData {
  catalogVendorId: string;
  areaPrefix: string;
}

export interface IssueData {
  id: string;
  collectionId: string;
  /** The short per-collection issue number (#432). */
  issueNo: number;
  collectionAreaId: string;
  /** Default-language name (#295); {@link nameByLanguage} overrides it per language. */
  name: string | null;
  /** Per-language overrides of {@link name} (#295), keyed by ISO 639-1 code. */
  nameByLanguage: Record<string, string>;
  year: number | null;
  isAutoCreated: boolean;
  createdAt: Date;
  members: StampNodeData[];
  catalogNumbers: IssueCatalogNumberData[];
  /** The issue's checklists (#531), in display order. An issue may carry none (nothing is a goal
   *  yet), one (the ordinary case, and what `requiredForCompleteness` used to express) or several. */
  checklists: IssueChecklistSummary[];
}

/** A checklist as a list row needs it: named, counted, and identified so an action can act on it. */
export interface IssueChecklistSummary {
  id: string;
  name: string;
  /** How many stamps it carries — the denominator of every completeness figure. */
  stampCount: number;
}

/** Prisma select producing a {@link RawCatalogPrice} — the fields the headline price picker
 *  needs (amount, currency, condition/certificate, edition year + catalog name). */
const HEADLINE_PRICE_SELECT = {
  price: true,
  currency: true,
  conditionId: true,
  certificateStatusId: true,
  // Required by `RawCatalogPrice` (ADR-0020). A headline price is the *single's*, so the picker
  // has to be able to tell a format's price apart rather than treating it as another candidate.
  formatId: true,
  catalogEdition: { select: { year: true, catalogNameId: true } },
} as const;

const MEMBER_SELECT = {
  stampId: true,
  // The collector's own position in the tree (#549). Selected rather than ordered by: this select
  // is `as const` and a readonly `orderBy` is not assignable to Prisma's input type — the same
  // reason `checklists` is ordered in the mapper. `orderIssueMembers` is what applies it.
  sortOrder: true,
  stamp: {
    select: {
      // Every checklist the stamp is on, anywhere in the collection (#531). The mapper narrows
      // them to the issue being rendered — a static select cannot name the issue it will be run
      // for, and a stamp sits on a handful of checklists at most.
      checklistEntries: { select: { checklistId: true } },
      parentId: true,
      name: true,
      issuedDay: true,
      issuedMonth: true,
      issuedYear: true,
      colnectId: true,
      catalogNumbers: { select: { catalogVendorId: true, number: true } },
      catalogPrices: { select: HEADLINE_PRICE_SELECT },
      photos: { select: PHOTO_SUMMARY_SELECT },
      // Own flags → this member's `actsAsVariant`; children flags → whether it is an
      // unknown-variant umbrella whose price rolls up from its variants (#238).
      ...VARIANT_FLAG_SELECT,
      variants: { select: VARIANT_FLAG_SELECT },
    },
  },
} as const;

/** The tree's own order (#549): the collector's manual position, with the stamp id as the tiebreak
 *  so a group whose members still share the seeded value reads the same on every request. Sorting
 *  in memory rather than in the query, because {@link MEMBER_SELECT} is `as const`; the callers
 *  that *can* order in SQL do, and this keeps the two answers identical. */
function orderIssueMembers<T extends { stampId: string; sortOrder: number }>(members: T[]): T[] {
  return [...members].sort((a, b) => a.sortOrder - b.sortOrder || a.stampId.localeCompare(b.stampId));
}

/** For a set of umbrella stamps (unknown-variant base stamps), the variant-kind descendants'
 *  prices, so the headline catalog price can roll up from the lowest variant (#238). Mirrors
 *  the copy-valuation descendant gather (ADR-0007 §7): only descendants whose effective
 *  actsAsVariant is true contribute. Returns per-stamp variant price arrays plus every currency
 *  seen (so the caller can widen its rate map). */
async function loadVariantPricesForUmbrellas(
  collectionId: string,
  umbrellaStampIds: string[]
): Promise<{ variantPricesByStamp: Map<string, RawCatalogPrice[][]>; currencies: string[] }> {
  const variantPricesByStamp = new Map<string, RawCatalogPrice[][]>();
  const currencies: string[] = [];
  if (umbrellaStampIds.length === 0) return { variantPricesByStamp, currencies };

  const descendantsByStamp = await buildDescendantMap(collectionId, new Set(umbrellaStampIds));
  const descendantIds = new Set<string>();
  for (const set of descendantsByStamp.values()) for (const id of set) descendantIds.add(id);
  if (descendantIds.size === 0) return { variantPricesByStamp, currencies };

  const stamps = await prisma.stamp.findMany({
    where: { id: { in: [...descendantIds] } },
    select: { id: true, catalogPrices: { select: HEADLINE_PRICE_SELECT }, ...VARIANT_FLAG_SELECT },
  });
  const pricesByStamp = new Map<string, RawCatalogPrice[]>();
  const isVariantByStamp = new Map<string, boolean>();
  for (const s of stamps) {
    pricesByStamp.set(s.id, s.catalogPrices);
    isVariantByStamp.set(s.id, childIsVariant(s));
    for (const p of s.catalogPrices) currencies.push(p.currency);
  }

  for (const stampId of umbrellaStampIds) {
    const variantDescendants = [
      ...(descendantsByStamp.get(stampId) ?? new Set<string>()),
    ].filter((id) => isVariantByStamp.get(id) ?? false);
    variantPricesByStamp.set(
      stampId,
      variantDescendants.map((id) => pricesByStamp.get(id) ?? [])
    );
  }
  return { variantPricesByStamp, currencies };
}

function toStampNode(
  m: {
    stampId: string;
    stamp: {
      checklistEntries: { checklistId: string }[];
      parentId: string | null;
      name: string | null;
      issuedDay: number | null;
      issuedMonth: number | null;
      issuedYear: number | null;
      colnectId: string | null;
      catalogNumbers: { catalogVendorId: string; number: string }[];
      catalogPrices: RawCatalogPrice[];
      photos: { id: string; role: string | null; title: string | null; sortOrder: number }[];
      actsAsVariantOverride: boolean | null;
      subtype: { actsAsVariant: boolean; name: string; isDefault: boolean } | null;
      variants: {
        actsAsVariantOverride: boolean | null;
        subtype: { actsAsVariant: boolean } | null;
      }[];
    };
  },
  pricing?: {
    primaryNameId: string | null;
    baseCurrency: string;
    latestYearByName: Map<string, number>;
    displayConditionId: string | null;
    /** Format the list is showing (#343); null is the single. */
    displayFormatId?: string | null;
    /** Multiplier applying to that format for this issue — one lookup per issue, because every
     *  member shares the issue's area and the issue itself. */
    formatFactor?: number | null;
    rates: Map<string, number | null>;
    /** Variant-kind descendant prices for umbrella members, keyed by stamp id (#238). */
    variantPricesByStamp: Map<string, RawCatalogPrice[][]>;
  },
  /** Copies held per stamp — its own (#348) and its variant descendants' (#528). Absent stamps
   *  read as none; an absent map means the caller loaded no counts at all. */
  copyCounts?: StampCopyCountMaps,
  /** The issue's own checklist ids (#531), used to narrow the stamp's memberships to this issue.
   *  Absent means the caller loaded no checklists, and every node reports none. */
  issueChecklistIds?: ReadonlySet<string>,
  /** Open wants per stamp (#532). Absent stamps, and an absent map, read as none. */
  wantsByStamp?: Map<string, StampWantSummary>
): StampNodeData {
  const headline = pricing
    ? pickHeadlineCatalogPrice({
        ownPrices: m.stamp.catalogPrices,
        variantPrices: pricing.variantPricesByStamp.get(m.stampId),
        isUmbrella: isUnknownVariantStamp(m.stamp),
        primaryCatalogNameId: pricing.primaryNameId,
        displayConditionId: pricing.displayConditionId,
        displayFormatId: pricing.displayFormatId ?? null,
        formatFactor: pricing.formatFactor ?? null,
        baseCurrency: pricing.baseCurrency,
        rates: pricing.rates,
      })
    : { picked: null, uncertain: false, derived: false };
  const main = headline.picked;
  const mainCatalogPriceStale =
    main && pricing
      ? (pricing.latestYearByName.get(main.catalogNameId) ?? main.editionYear) > main.editionYear
      : false;
  return {
    stampId: m.stampId,
    parentId: m.stamp.parentId,
    name: m.stamp.name,
    issuedDay: m.stamp.issuedDay,
    issuedMonth: m.stamp.issuedMonth,
    issuedYear: m.stamp.issuedYear,
    checklistIds: issueChecklistIds
      ? m.stamp.checklistEntries
          .map((e) => e.checklistId)
          .filter((id) => issueChecklistIds.has(id))
      : [],
    catalogNumbers: m.stamp.catalogNumbers,
    colnectId: m.stamp.colnectId,
    mainCatalogPrice:
      main && pricing
        ? {
            amount: main.amount.toFixed(2),
            currency: main.currency,
            convertedAmount: applyConversion(
              main.amount,
              main.currency,
              pricing.baseCurrency,
              pricing.rates
            ),
            baseCurrency: pricing.baseCurrency,
          }
        : null,
    mainCatalogPriceStale,
    mainCatalogPriceUncertain: headline.uncertain,
    mainCatalogPriceDerived: headline.derived,
    actsAsVariant: childIsVariant(m.stamp),
    subtype: subtypeLabel(m.stamp),
    photos: toPhotoSummaries(m.stamp.photos),
    copies: copyCounts?.direct.get(m.stampId) ?? NO_COPIES,
    variantCopies: copyCounts?.variant.get(m.stampId) ?? NO_COPIES,
    wants: wantsByStamp?.get(m.stampId) ?? null,
  };
}

const ISSUE_SELECT = {
  id: true,
  collectionId: true,
  issueNo: true,
  collectionAreaId: true,
  name: true,
  year: true,
  isAutoCreated: true,
  createdAt: true,
  // Per-language names (#295), so an issue edited from the inventory stamp picker seeds its
  // translation fields the same way the issues list does.
  translations: { select: { language: true, name: true } },
  members: { select: MEMBER_SELECT },
  // The issue's checklists (#531), in the order the collector set — the first one is what a
  // single-checklist badge shows and what a new stamp joins by default.
  // Ordered in the mapper rather than by the query: this select is `as const`, and a readonly
  // `orderBy` tuple is not assignable to Prisma's mutable input type. An issue carries a handful
  // of checklists, so sorting them in memory costs nothing.
  checklists: {
    select: { id: true, name: true, sortOrder: true, createdAt: true, stamps: { select: { stampId: true } } },
  },
  catalogNumbers: { select: { catalogVendorId: true, firstNumber: true, lastNumber: true } },
} as const;

/** An issue's checklists as both list selects load them — ordered in memory (see the select). */
interface ChecklistRow {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: Date;
  stamps: { stampId: string }[];
}

/** Display order: the collector's `sortOrder`, then age. The first entry is what a single-checklist
 *  badge shows and what a new stamp joins by default, so ties must not reorder between reads. */
function orderChecklists(rows: ChecklistRow[]): ChecklistRow[] {
  return [...rows].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime()
  );
}

function toIssueData(issue: {
  id: string;
  collectionId: string;
  issueNo: number;
  collectionAreaId: string;
  name: string | null;
  year: number | null;
  isAutoCreated: boolean;
  createdAt: Date;
  translations: { language: string; name: string | null }[];
  members: {
    stampId: string;
    sortOrder: number;
    stamp: {
      checklistEntries: { checklistId: string }[];
      parentId: string | null;
      name: string | null;
      issuedDay: number | null;
      issuedMonth: number | null;
      issuedYear: number | null;
      colnectId: string | null;
      catalogNumbers: { catalogVendorId: string; number: string }[];
      catalogPrices: RawCatalogPrice[];
      photos: { id: string; role: string | null; title: string | null; sortOrder: number }[];
      actsAsVariantOverride: boolean | null;
      subtype: { actsAsVariant: boolean; name: string; isDefault: boolean } | null;
      variants: {
        actsAsVariantOverride: boolean | null;
        subtype: { actsAsVariant: boolean } | null;
      }[];
    };
  }[];
  checklists: ChecklistRow[];
  catalogNumbers: { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[];
}, copyCounts?: StampCopyCountMaps): IssueData {
  const checklistIds = new Set(issue.checklists.map((c) => c.id));
  return {
    id: issue.id,
    collectionId: issue.collectionId,
    issueNo: issue.issueNo,
    collectionAreaId: issue.collectionAreaId,
    name: issue.name,
    nameByLanguage: translationsByLanguage(issue.translations, (t) => t.name),
    year: issue.year,
    isAutoCreated: issue.isAutoCreated,
    createdAt: issue.createdAt,
    members: orderIssueMembers(issue.members).map((m) =>
      toStampNode(m, undefined, copyCounts, checklistIds)
    ),
    catalogNumbers: issue.catalogNumbers,
    checklists: orderChecklists(issue.checklists).map((c) => ({
      id: c.id,
      name: c.name,
      stampCount: c.stamps.length,
    })),
  };
}

export async function listIssuesForArea(
  ownerId: string,
  collectionId: string,
  areaId: string
): Promise<IssueData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const issues = await prisma.issue.findMany({
    where: { collectionId, collectionAreaId: areaId },
    orderBy: [{ year: "asc" }, { name: "asc" }, { createdAt: "asc" }],
    select: ISSUE_SELECT,
  });
  const copyCounts = await loadStampCopyCounts(
    collectionId,
    issues.flatMap((i) => i.members.map((m) => m.stampId))
  );
  return issues.map((i) => toIssueData(i, copyCounts));
}

/** A lightweight reference to an existing issue that shares a proposed name, for the
 * create-issue duplicate warning (#178). */
export interface DuplicateIssueMatch {
  id: string;
  name: string | null;
  year: number | null;
}

/** Existing issues in `areaId` whose name equals `name` (trimmed, case-insensitive) — the
 * source for the non-blocking "duplicate name" warning shown while creating an issue (#178).
 * Scoped **per area** (a name may legitimately repeat across areas, e.g. different countries).
 * Returns `[]` for a blank name (an unnamed issue can't collide) or when nothing matches. */
export async function findDuplicateIssuesByName(
  ownerId: string,
  collectionId: string,
  areaId: string,
  name: string
): Promise<DuplicateIssueMatch[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const trimmed = name.trim();
  if (!trimmed) return [];
  return prisma.issue.findMany({
    where: {
      collectionId,
      collectionAreaId: areaId,
      name: { equals: trimmed, mode: "insensitive" },
    },
    orderBy: [{ year: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, year: true },
  });
}

export async function listAllIssues(
  ownerId: string,
  collectionId: string,
  areaIds?: string[]
): Promise<IssueData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const issues = await prisma.issue.findMany({
    where: {
      collectionId,
      ...(areaIds && areaIds.length > 0 ? { collectionAreaId: { in: areaIds } } : {}),
    },
    orderBy: [{ collectionAreaId: "asc" }, { year: "asc" }, { name: "asc" }, { createdAt: "asc" }],
    select: ISSUE_SELECT,
  });
  const copyCounts = await loadStampCopyCounts(
    collectionId,
    issues.flatMap((i) => i.members.map((m) => m.stampId))
  );
  return issues.map((i) => toIssueData(i, copyCounts));
}

/** Just the fields needed to render an issue header (title, catalog chips, counts) —
 * used by the lot intake view's grouped-by-issue mode (#121) so a lot's issue rows read
 * like the issues list without loading each issue's stamp tree. */
export interface IssueHeader {
  id: string;
  name: string | null;
  year: number | null;
  collectionAreaId: string;
  catalogNumbers: IssueCatalogNumberData[];
  memberCount: number;
  /** Distinct stamps on any of the issue's checklists (#531) — the union, because the header's
   *  badge answers "how much of this issue is a goal", not "which goal". */
  requiredCount: number;
}

/** Fetch issue headers for a set of ids, collection-scoped. Ids not found are omitted. */
export async function getIssueHeadersByIds(
  ownerId: string,
  collectionId: string,
  issueIds: string[]
): Promise<IssueHeader[]> {
  await assertCollectionOwner(ownerId, collectionId);
  if (issueIds.length === 0) return [];
  const rows = await prisma.issue.findMany({
    where: { id: { in: issueIds }, collectionId },
    select: {
      id: true,
      name: true,
      year: true,
      collectionAreaId: true,
      catalogNumbers: {
        select: { catalogVendorId: true, firstNumber: true, lastNumber: true },
      },
      members: { select: { stampId: true } },
      checklists: { select: { stamps: { select: { stampId: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    year: r.year,
    collectionAreaId: r.collectionAreaId,
    catalogNumbers: r.catalogNumbers,
    memberCount: r.members.length,
    requiredCount: new Set(r.checklists.flatMap((c) => c.stamps.map((s) => s.stampId))).size,
  }));
}

// ── Paginated queries (used by API routes) ─────────────────────────────────

export type IssueSortBy = "year" | "name" | "catalogNumber";

export interface IssueListItem {
  id: string;
  collectionId: string;
  /** The short per-collection issue number (#432) — what the quick-jump box takes after `iss`. */
  issueNo: number;
  collectionAreaId: string;
  /** Default-language name (#295); {@link nameByLanguage} overrides it per language. */
  name: string | null;
  /** Per-language overrides of {@link name} (#295), keyed by ISO 639-1 code. Only languages with a
   * stored, non-blank value appear — the edit dialog seeds its translation fields from this. */
  nameByLanguage: Record<string, string>;
  year: number | null;
  isAutoCreated: boolean;
  createdAt: string;
  catalogNumbers: IssueCatalogNumberData[];
  /** Per-vendor overrides of the area-resolved catalog prefix (#377). Sparse — only vendors this
   * issue overrides appear, and an absent vendor inherits the area's prefix. Carried on the row so
   * the edit dialog prefills its Prefix inputs without a second read. */
  catalogPrefixes: IssueCatalogPrefixData[];
  memberCount: number;
  /** Distinct stamps on any of the issue's checklists (#531) — the union. With one checklist this
   *  is that checklist's size, which is exactly what the badge showed before checklists existed. */
  requiredCount: number;
  /** The issue's checklists with their own counts and totals (#531), in display order. Empty for
   *  an issue nothing is a goal on yet; one entry is the ordinary case. The row shows the single
   *  entry as before, and collapses several into one `N checklists` badge. */
  checklists: IssueChecklistTotals[];
  /** Per-vendor suggestions where checklist stamps extend the declared catalog range
   *  (empty when every declared range still covers them). Read against the **union**: an issue
   *  publishes one range of numbers however many goals are collected inside it. */
  rangeSuggestions: IssueRangeSuggestion[];
  /** Main photos of the checklists' stamps (#137), deduped across checklists, shown on the
   * collapsed issue row as a representative gallery of the issue. */
  photos: PhotoSummary[];
}

/** One checklist on a list row: what it is called, how big it is, and what it is worth. */
export interface IssueChecklistTotals extends IssueChecklistSummary {
  /** Sum of this checklist's stamps' main catalog prices. Deliberately **per checklist**: summing
   *  the union would count a stamp shared by a basic and a specialized set once for a total that
   *  answers neither question. */
  priceTotal: IssuePriceTotal | null;
  /** True when at least one counted price is on a non-latest edition. */
  priceStale: boolean;
}

export interface PaginatedIssuesResult {
  items: IssueListItem[];
  nextCursor: string | null;
}

const ISSUE_LIST_SELECT = {
  id: true,
  collectionId: true,
  issueNo: true,
  collectionAreaId: true,
  name: true,
  year: true,
  isAutoCreated: true,
  createdAt: true,
  catalogNumbers: { select: { catalogVendorId: true, firstNumber: true, lastNumber: true } },
  // Per-vendor prefix overrides (#377) — at most one row per vendor the issue overrides, and none
  // at all for the ordinary issue that follows its area's prefix.
  catalogPrefixes: { select: { catalogVendorId: true, areaPrefix: true } },
  // Per-language names (#295), so the edit dialog can seed its translation fields from the row it
  // already has. At most one row per translation language — a handful, not a payload concern.
  translations: { select: { language: true, name: true } },
  members: {
    select: {
      stampId: true,
      stamp: {
        select: {
          // Member catalog numbers drive the declared-range coverage check.
          catalogNumbers: { select: { catalogVendorId: true, number: true } },
          catalogPrices: { select: HEADLINE_PRICE_SELECT },
          // Children's variant flags decide whether a checklist stamp is an unknown-variant
          // umbrella whose headline price rolls up from its lowest variant child (#238).
          variants: { select: VARIANT_FLAG_SELECT },
          // Only the main photo represents the stamp on the issue-level gallery (#137).
          photos: { where: { role: "main" }, select: PHOTO_SUMMARY_SELECT },
        },
      },
    },
  },
  // Which of those members each checklist claims (#531). Membership is ids only — the row's price
  // total and gallery read the member rows above, which are already loaded.
  // Ordered in the mapper rather than by the query: this select is `as const`, and a readonly
  // `orderBy` tuple is not assignable to Prisma's mutable input type. An issue carries a handful
  // of checklists, so sorting them in memory costs nothing.
  checklists: {
    select: { id: true, name: true, sortOrder: true, createdAt: true, stamps: { select: { stampId: true } } },
  },
} as const;

/**
 * Sum of one checklist's stamps' main catalog prices for one display condition
 * (certificate = none). Stamps priced only on an older edition are handled the
 * same way as the list total: if any is priced on the current edition the
 * total uses only those, otherwise it falls back to older-edition prices.
 * `convertedAmount` is left null for the caller to fill after fetching rates.
 */
function computeChecklistPriceTotal(
  requiredMembers: {
    stampId: string;
    stamp: {
      catalogPrices: RawCatalogPrice[];
      variants: {
        actsAsVariantOverride: boolean | null;
        subtype: { actsAsVariant: boolean } | null;
      }[];
    };
  }[],
  primaryNameId: string | null,
  baseCurrency: string,
  latestYearByName: Map<string, number>,
  displayConditionId: string | null,
  rates: Map<string, number | null>,
  variantPricesByStamp: Map<string, RawCatalogPrice[][]>,
  displayFormatId: string | null = null,
  formatFactor: number | null = null
): IssuePriceTotal | null {
  let sumCurrent = 0;
  let currentCount = 0;
  let estimatedCurrent = 0;
  let derivedCurrent = 0;
  let sumOlder = 0;
  let olderCount = 0;
  let estimatedOlder = 0;
  let derivedOlder = 0;
  let currency: string | null = null;
  for (const m of requiredMembers) {
    // Each required member's headline price applies the unknown-variant rollup (#238): an
    // umbrella with no own price contributes its lowest variant child's price instead. When a
    // format is on screen (#343) the same pick derives from the single where nothing explicit was
    // recorded, so a format column totals to something rather than to nothing.
    const { picked: main, uncertain, derived } = pickHeadlineCatalogPrice({
      ownPrices: m.stamp.catalogPrices,
      variantPrices: variantPricesByStamp.get(m.stampId),
      isUmbrella: isUnknownVariantStamp(m.stamp),
      primaryCatalogNameId: primaryNameId,
      displayConditionId,
      displayFormatId,
      formatFactor,
      baseCurrency,
      rates,
    });
    if (!main) continue;
    currency = main.currency;
    const isOlder = (latestYearByName.get(main.catalogNameId) ?? main.editionYear) > main.editionYear;
    if (isOlder) {
      sumOlder += main.amount;
      olderCount += 1;
      if (uncertain) estimatedOlder += 1;
      if (derived) derivedOlder += 1;
    } else {
      sumCurrent += main.amount;
      currentCount += 1;
      if (uncertain) estimatedCurrent += 1;
      if (derived) derivedCurrent += 1;
    }
  }

  const finish = (
    amount: number,
    pricedCount: number,
    usesOlderEdition: boolean,
    olderEditionExcludedCount: number,
    estimatedCount: number,
    derivedCount: number
  ): IssuePriceTotal => ({
    amount: amount.toFixed(2),
    currency: currency!,
    convertedAmount: applyConversion(amount, currency!, baseCurrency, rates),
    baseCurrency,
    pricedCount,
    requiredCount: requiredMembers.length,
    usesOlderEdition,
    olderEditionExcludedCount,
    estimatedCount,
    derivedCount,
  });

  if (currency && currentCount > 0) {
    return finish(sumCurrent, currentCount, false, olderCount, estimatedCurrent, derivedCurrent);
  }
  if (currency && olderCount > 0) {
    return finish(sumOlder, olderCount, true, 0, estimatedOlder, derivedOlder);
  }
  return null;
}

/**
 * Replace an issue's per-vendor prefix overrides (#377). `undefined` leaves them untouched (a
 * caller that did not render the fields cannot mean "clear them"); an array replaces the whole set,
 * so a vendor left out of it goes back to inheriting the area's prefix — which is what a field the
 * collector blanked out submits. Runs on the caller's transaction client.
 */
async function writeIssueCatalogPrefixes(
  tx: Prisma.TransactionClient,
  issueId: string,
  prefixes: { catalogVendorId: string; areaPrefix: string }[] | undefined
): Promise<void> {
  if (prefixes === undefined) return;
  const clean = prefixes
    .map((p) => ({ catalogVendorId: p.catalogVendorId, areaPrefix: p.areaPrefix.trim() }))
    .filter((p) => p.catalogVendorId && p.areaPrefix);
  await tx.issueCatalogPrefix.deleteMany({ where: { issueId } });
  if (clean.length > 0) {
    await tx.issueCatalogPrefix.createMany({
      data: clean.map((p) => ({ issueId, ...p })),
      skipDuplicates: true,
    });
  }
}

/** Per-language `name` rows for an issue (#295). Runs on the caller's transaction client, since
 * both create and update already wrap their writes in one. Shared blank / delete / untouched rules
 * live in {@link syncEntityTranslations}. */
async function syncIssueTranslations(
  tx: Prisma.TransactionClient,
  issueId: string,
  values: TranslationValueMap | undefined
): Promise<void> {
  await syncEntityTranslations(values, {
    upsert: async (language, fields) => {
      const name = fields.name ?? null;
      await tx.issueTranslation.upsert({
        where: { issueId_language: { issueId, language } },
        create: { issueId, language, name },
        update: { name },
      });
    },
    remove: async (language) => {
      await tx.issueTranslation.deleteMany({ where: { issueId, language } });
    },
  });
}

function toIssueListItem(
  issue: {
    id: string;
    collectionId: string;
    issueNo: number;
    collectionAreaId: string;
    name: string | null;
    year: number | null;
    isAutoCreated: boolean;
    createdAt: Date;
    translations: { language: string; name: string | null }[];
    catalogNumbers: { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[];
    catalogPrefixes: { catalogVendorId: string; areaPrefix: string }[];
    members: {
      stampId: string;
      stamp: {
        catalogNumbers: { catalogVendorId: string; number: string }[];
        catalogPrices: RawCatalogPrice[];
        variants: {
          actsAsVariantOverride: boolean | null;
          subtype: { actsAsVariant: boolean } | null;
        }[];
        photos: { id: string; role: string | null; title: string | null; sortOrder: number }[];
      };
    }[];
    checklists: ChecklistRow[];
  },
  primaryCatalogByArea: Map<string, string | null>,
  baseCurrency: string,
  latestYearByName: Map<string, number>,
  displayConditionId: string | null,
  vendorAbbrev: ReadonlyMap<string, string>,
  rates: Map<string, number | null>,
  variantPricesByStamp: Map<string, RawCatalogPrice[][]>,
  displayFormatId: string | null,
  factorFor: (areaId: string | null, issueId: string | null) => number | null
): IssueListItem {
  const memberByStamp = new Map(issue.members.map((m) => [m.stampId, m]));
  const primaryNameId = primaryCatalogByArea.get(issue.collectionAreaId) ?? null;
  // Every member of an issue shares the issue's area and the issue itself, so the multiplier is
  // one lookup for the whole row rather than one per member.
  const formatFactor = factorFor(issue.collectionAreaId, issue.id);

  // A checklist may name a stamp that is not an `IssueMember` of this issue — a cross-issue
  // checklist anchored here, or a member removed after the checklist was built. Only members can
  // be priced or photographed from this row's data, so unknown stamps are skipped rather than
  // faked; they still count towards the checklist's size, which is read from the checklist itself.
  const checklists: IssueChecklistTotals[] = orderChecklists(issue.checklists).map((c) => {
    const stamps = c.stamps
      .map((s) => memberByStamp.get(s.stampId))
      .filter((m): m is (typeof issue.members)[number] => m !== undefined);
    const priceTotal = computeChecklistPriceTotal(
      stamps,
      primaryNameId,
      baseCurrency,
      latestYearByName,
      displayConditionId,
      rates,
      variantPricesByStamp,
      displayFormatId,
      formatFactor
    );
    return {
      id: c.id,
      name: c.name,
      stampCount: c.stamps.length,
      priceTotal,
      priceStale: priceTotal?.usesOlderEdition ?? false,
    };
  });

  // The union across checklists: what any goal of this issue asks for, each stamp once.
  const requiredStampIds = new Set(
    issue.checklists.flatMap((c) => c.stamps.map((s) => s.stampId))
  );
  const requiredMembers = issue.members.filter((m) => requiredStampIds.has(m.stampId));

  // One representative main photo per checklist stamp (already filtered to role="main").
  const photos = toPhotoSummaries(requiredMembers.flatMap((m) => m.stamp.photos));

  // Declared-range coverage: only stamps on a checklist define the range — optional extras
  // (blocks, varieties) never widen it. Read against the union, because an issue publishes one
  // range of catalog numbers however many goals are collected inside it.
  const rangeSuggestions = computeIssueRangeSuggestions(
    issue.catalogNumbers,
    requiredMembers.flatMap((m) => m.stamp.catalogNumbers),
    vendorAbbrev
  );

  return {
    id: issue.id,
    collectionId: issue.collectionId,
    issueNo: issue.issueNo,
    collectionAreaId: issue.collectionAreaId,
    name: issue.name,
    nameByLanguage: translationsByLanguage(issue.translations, (t) => t.name),
    year: issue.year,
    isAutoCreated: issue.isAutoCreated,
    createdAt: issue.createdAt.toISOString(),
    catalogNumbers: issue.catalogNumbers,
    catalogPrefixes: issue.catalogPrefixes,
    memberCount: issue.members.length,
    requiredCount: requiredStampIds.size,
    checklists,
    rangeSuggestions,
    photos,
  };
}

/** Map issues to list items and attach base-currency conversions in one batched rate fetch. */
async function buildIssueListItems(
  issues: Parameters<typeof toIssueListItem>[0][],
  collectionId: string,
  primaryCatalogByArea: Map<string, string | null>,
  baseCurrency: string,
  displayConditionId: string | null,
  displayFormatId: string | null
): Promise<IssueListItem[]> {
  const [latestYearByName, vendors, factorFor] = await Promise.all([
    getLatestEditionYearByName(collectionId),
    prisma.catalogVendor.findMany({
      where: { collectionId },
      select: { id: true, abbreviation: true },
    }),
    makeFormatFactorResolver(collectionId, displayFormatId, displayConditionId),
  ]);
  const vendorAbbrev = new Map(vendors.map((v) => [v.id, v.abbreviation]));

  // Roll umbrella checklist stamps up from their variant children (#238): gather those
  // stamps across the page, load their variant prices, and build one rate map spanning
  // every currency in play (members' own prices and the variant candidates) so the
  // lowest-by-base comparison and the base-currency conversion both have their rates.
  // Read against the union of the row's checklists — a stamp priced for one checklist is priced
  // for every other one that also claims it.
  const onAnyChecklist = (i: Parameters<typeof toIssueListItem>[0]) => {
    const ids = new Set(i.checklists.flatMap((c) => c.stamps.map((s) => s.stampId)));
    return i.members.filter((m) => ids.has(m.stampId));
  };
  const umbrellaStampIds = issues.flatMap((i) =>
    onAnyChecklist(i)
      .filter((m) => isUnknownVariantStamp(m.stamp))
      .map((m) => m.stampId)
  );
  const { variantPricesByStamp, currencies: variantCurrencies } =
    await loadVariantPricesForUmbrellas(collectionId, umbrellaStampIds);
  const currencies = [
    ...issues.flatMap((i) =>
      onAnyChecklist(i).flatMap((m) => m.stamp.catalogPrices.map((p) => p.currency))
    ),
    ...variantCurrencies,
  ];
  const rates = await safeRateMap(collectionId, baseCurrency, currencies);

  return issues.map((i) =>
    toIssueListItem(
      i,
      primaryCatalogByArea,
      baseCurrency,
      latestYearByName,
      displayConditionId,
      vendorAbbrev,
      rates,
      variantPricesByStamp,
      displayFormatId,
      factorFor
    )
  );
}


export interface IssueListFilterOpts {
  areaIds?: string[];
  offset?: number;
  pageSize?: number;
  search?: string;
  /** Vendor resolved from a catalog prefix typed into the *quick search* box (#289),
   *  e.g. the "Mi" of "Mi PL 200". Narrows {@link searchCatalogNumber} to one vendor;
   *  without it the number matches across every vendor. */
  searchCatalogVendorId?: string;
  /** Bare catalog number parsed out of the quick search text (#289) — "Mi PL 200" and
   *  "PL200" both yield "200". Widens the quick search, never narrows it. */
  searchCatalogNumber?: string;
  catalogVendorId?: string;
  catalogNumber?: string;
  /** Restrict to a single year. A number matches `issue.year`; `"none"`
   *  matches issues with no year. Omitted means no year filter. */
  year?: number | "none";
  sortBy?: IssueSortBy;
  sortDir?: "asc" | "desc";
  /** Condition whose price fills the list price column / issue totals. When
   *  omitted, defaults to the collection's first condition by sortOrder. */
  displayConditionId?: string | null;
  /** Physical format whose price fills the list price column / issue totals (#343). Null or
   *  omitted is the single — the default, and the only value a collection with no formats has. */
  displayFormatId?: string | null;
}

/** Build the Prisma `where` for the issue list from the active filters.
 *  Reused by the paginated list and the year-facet aggregation; the latter
 *  omits `opts.year` so the year counts stay stable while a year is selected. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildIssueListWhere(collectionId: string, opts: IssueListFilterOpts): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [];

  if (opts.areaIds && opts.areaIds.length > 0) {
    conditions.push({ collectionAreaId: { in: opts.areaIds } });
  }

  if (opts.search) {
    const s = opts.search;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const or: any[] = [
      { name: { contains: s, mode: "insensitive" } },
      { members: { some: { stamp: { name: { contains: s, mode: "insensitive" } } } } },
      { catalogNumbers: { some: { firstNumber: { contains: s, mode: "insensitive" } } } },
      { catalogNumbers: { some: { lastNumber: { contains: s, mode: "insensitive" } } } },
      { members: { some: { stamp: { catalogNumbers: { some: { number: { contains: s, mode: "insensitive" } } } } } } },
    ];

    // The issue's own short number (#432), on exactly the copy search's rule (#268): matched *in
    // addition to* the text, never instead of it, because `200` is also a perfectly good catalog
    // number. `#200` and `200` both reach it — the first is how the number reads on screen, and it
    // is what the quick-jump box (#431) puts in this field to land on one issue.
    const issueNo = parseEntityNoSearch(s);
    if (issueNo !== null) or.push({ issueNo });

    // Prefixed catalog numbers in the quick search (#289): the raw text of "Mi PL 200"
    // never appears in a stored number, so the caller also hands us the number parsed out
    // of it (`parseCatalogSearch`, #146) plus the vendor when its abbreviation led the
    // input. Matching stays `contains`, like the rest of the quick search — that is what
    // lets "Fi BL31" reach a stored "BL31" through its digit run.
    if (opts.searchCatalogNumber) {
      const n = { contains: opts.searchCatalogNumber, mode: "insensitive" as const };
      const vendorClause = opts.searchCatalogVendorId
        ? { catalogVendorId: opts.searchCatalogVendorId }
        : {};
      or.push(
        { catalogNumbers: { some: { ...vendorClause, firstNumber: n } } },
        { catalogNumbers: { some: { ...vendorClause, lastNumber: n } } },
        { members: { some: { stamp: { catalogNumbers: { some: { ...vendorClause, number: n } } } } } }
      );
    }

    conditions.push({ OR: or });
  }

  // Catalog filter (#146): a number narrows to a vendor when one is set, else it
  // matches across every vendor. Matches the issue's own first/last range numbers
  // or any member stamp's number. A vendor without a number does not filter alone.
  if (opts.catalogNumber) {
    const vendorClause = opts.catalogVendorId ? { catalogVendorId: opts.catalogVendorId } : {};
    conditions.push({
      OR: [
        { catalogNumbers: { some: { ...vendorClause, firstNumber: opts.catalogNumber } } },
        { catalogNumbers: { some: { ...vendorClause, lastNumber: opts.catalogNumber } } },
        { members: { some: { stamp: { catalogNumbers: { some: { ...vendorClause, number: opts.catalogNumber } } } } } },
      ],
    });
  }

  if (opts.year !== undefined) {
    conditions.push({ year: opts.year === "none" ? null : opts.year });
  }

  return {
    collectionId,
    ...(conditions.length === 1 ? conditions[0] : conditions.length > 1 ? { AND: conditions } : {}),
  };
}

export interface YearFacet {
  /** null represents the "No year" bucket. */
  year: number | null;
  count: number;
}

/** Distinct years present in the issue list for the given filters (year filter
 *  itself is ignored), each with a count. Sorted descending, null ("No year")
 *  last. */
export async function listIssueYearFacets(
  ownerId: string,
  collectionId: string,
  opts: Omit<IssueListFilterOpts, "year" | "offset" | "pageSize" | "sortBy" | "sortDir" | "displayConditionId">
): Promise<YearFacet[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const where = buildIssueListWhere(collectionId, opts);
  const groups = await prisma.issue.groupBy({
    by: ["year"],
    where,
    _count: { _all: true },
  });
  return groups
    .map((g) => ({ year: g.year, count: g._count._all }))
    .sort((a, b) => {
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return b.year - a.year;
    });
}

export async function listIssuesPaginated(
  ownerId: string,
  collectionId: string,
  opts: IssueListFilterOpts
): Promise<PaginatedIssuesResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = opts.pageSize ?? 50;
  const offset = opts.offset ?? 0;
  const dir = opts.sortDir ?? "asc";
  const sortBy = opts.sortBy ?? "year";
  const [primaryCatalogByArea, baseCurrency, displayConditionId] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    getCollectionBaseCurrency(collectionId),
    resolveDisplayConditionId(collectionId, opts.displayConditionId),
  ]);
  // Null is the single (ADR-0020); there is no "first format" to resolve to.
  const displayFormatId = opts.displayFormatId ?? null;

  const where = buildIssueListWhere(collectionId, opts);

  // The primary catalog number is the implicit secondary (tiebreaker) sort key everywhere (#181),
  // served by the denormalized `primaryCatalogSortKey` column (ADR-0012) so the sort stays an
  // indexed ORDER BY + LIMIT/OFFSET. Number-less rows sort last (NULLS LAST). `year` keeps its
  // prior default null ordering.
  const tieBreak = { primaryCatalogSortKey: { sort: "asc", nulls: "last" } } as const;
  const orderBy =
    sortBy === "name"
      ? [{ name: dir }, tieBreak, { id: "asc" as const }]
      : sortBy === "catalogNumber"
        ? [
            { primaryCatalogSortKey: { sort: dir, nulls: "last" } } as const,
            { name: "asc" as const },
            { id: "asc" as const },
          ]
        : [{ year: dir }, tieBreak, { name: "asc" as const }, { id: "asc" as const }];

  const issues = await prisma.issue.findMany({
    where,
    orderBy,
    select: ISSUE_LIST_SELECT,
    take: pageSize + 1,
    skip: offset,
  });
  const hasMore = issues.length > pageSize;

  const items = await buildIssueListItems(
    hasMore ? issues.slice(0, pageSize) : issues,
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
 * One issue enriched exactly as the Issues list enriches a row — same required-stamps total, same
 * range suggestions, same representative gallery. The issue detail screen (#519) reads through
 * this rather than assembling its own header, so the page and the row it was opened from cannot
 * describe one issue differently. Returns null when the id is not this collection's.
 */
export async function getIssueListItem(
  ownerId: string,
  collectionId: string,
  issueId: string,
  opts?: { displayConditionId?: string | null; displayFormatId?: string | null }
): Promise<IssueListItem | null> {
  await assertCollectionOwner(ownerId, collectionId);
  const [primaryCatalogByArea, baseCurrency, displayConditionId, issue] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    getCollectionBaseCurrency(collectionId),
    resolveDisplayConditionId(collectionId, opts?.displayConditionId),
    prisma.issue.findFirst({ where: { id: issueId, collectionId }, select: ISSUE_LIST_SELECT }),
  ]);
  if (!issue) return null;
  const [item] = await buildIssueListItems(
    [issue],
    collectionId,
    primaryCatalogByArea,
    baseCurrency,
    displayConditionId,
    opts?.displayFormatId ?? null
  );
  return item;
}

export interface IssueSearchItem {
  id: string;
  name: string | null;
  year: number | null;
}

export async function searchIssues(
  ownerId: string,
  collectionId: string,
  query: string,
  areaIds?: string[]
): Promise<IssueSearchItem[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const issues = await prisma.issue.findMany({
    where: {
      collectionId,
      ...(areaIds && areaIds.length > 0 ? { collectionAreaId: { in: areaIds } } : {}),
      name: { contains: query, mode: "insensitive" },
    },
    select: { id: true, name: true, year: true },
    orderBy: [{ name: "asc" }, { year: "asc" }],
    take: 20,
  });
  return issues;
}

export async function listIssueMembers(
  ownerId: string,
  collectionId: string,
  issueId: string,
  /** Condition whose price fills each member's headline price. Mirrors the issue list's
   *  price column (#95); when omitted, defaults to the collection's first condition so
   *  the expanded member rows track the list's condition switcher (#238). */
  requestedDisplayConditionId?: string | null,
  /** Format whose price fills each member's headline price, tracking the list's format switcher
   *  (#343). Null is the single. */
  displayFormatId: string | null = null
): Promise<StampNodeData[]> {
  const { collectionId: issueCollection, collectionAreaId } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);
  const [members, issueChecklists] = await Promise.all([
    prisma.issueMember.findMany({
      where: { issueId },
      select: MEMBER_SELECT,
      // The manual order (#549), the tiebreak matching `orderIssueMembers` so the two readers of
      // this select can never disagree about a group whose members share a seeded value.
      orderBy: [{ sortOrder: "asc" }, { stampId: "asc" }],
    }),
    prisma.checklist.findMany({ where: { collectionId, issueId }, select: { id: true } }),
  ]);
  const issueChecklistIds = new Set(issueChecklists.map((c) => c.id));

  const [primaryCatalogByArea, baseCurrency, latestYearByName, displayConditionId] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    getCollectionBaseCurrency(collectionId),
    getLatestEditionYearByName(collectionId),
    resolveDisplayConditionId(collectionId, requestedDisplayConditionId),
  ]);
  const primaryNameId = primaryCatalogByArea.get(collectionAreaId) ?? null;
  const factorFor = await makeFormatFactorResolver(collectionId, displayFormatId, displayConditionId);
  const formatFactor = factorFor(collectionAreaId, issueId);

  // Umbrella members (unknown-variant base stamps) roll their headline price up from the
  // lowest variant child, so load those descendant prices and build one rate map covering
  // every currency in play — members' own prices and the variant candidates (#238).
  const umbrellaStampIds = members
    .filter((m) => isUnknownVariantStamp(m.stamp))
    .map((m) => m.stampId);
  const { variantPricesByStamp, currencies: variantCurrencies } =
    await loadVariantPricesForUmbrellas(collectionId, umbrellaStampIds);
  const currencies = [
    ...members.flatMap((m) => m.stamp.catalogPrices.map((p) => p.currency)),
    ...variantCurrencies,
  ];
  const [rates, copyCounts, wantsByStamp] = await Promise.all([
    safeRateMap(collectionId, baseCurrency, currencies),
    loadStampCopyCounts(collectionId, members.map((m) => m.stampId)),
    loadStampWantSummaries(collectionId, members.map((m) => m.stampId)),
  ]);

  return members.map((m) =>
    toStampNode(m, {
      primaryNameId,
      baseCurrency,
      latestYearByName,
      displayConditionId,
      displayFormatId,
      formatFactor,
      rates,
      variantPricesByStamp,
    }, copyCounts, issueChecklistIds, wantsByStamp)
  );
}

/** Axes shared by every issue price/average cell so the dialog can lay them out as a matrix. */
interface IssueCellAxes {
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

/** One catalog's required-stamps total at a (condition × certificate) intersection. */
export interface IssueCatalogCell extends IssueCellAxes {
  /** Sum in the catalog's currency, 2 decimals. */
  sumCatalog: string;
  catalogCurrency: string;
  /** Sum converted to the collection base currency, or null when same currency / no rate. */
  convertedSum: string | null;
  baseCurrency: string;
  pricedCount: number;
  requiredCount: number;
  /** True when this catalog prices every required member for this intersection. */
  complete: boolean;
}

export interface IssueCatalogGroup {
  catalogNameId: string;
  catalogName: string;
  vendorAbbreviation: string;
  catalogNameCurrency: string;
  /** Every (condition × certificate) intersection this catalog prices at least one member for. */
  cells: IssueCatalogCell[];
}

/** A catalog excluded from an intersection's average because it does not price every required member. */
export interface IssueIncompleteCatalog {
  catalogNameId: string;
  catalogName: string;
  vendorAbbreviation: string;
  pricedCount: number;
  requiredCount: number;
}

/** Cross-catalog average at a (condition × certificate) intersection. */
export interface IssueAverageCell extends IssueCellAxes {
  /** Mean of the complete catalogs' base-currency totals, 2 decimals; null when none can be averaged. */
  averageBase: string | null;
  baseCurrency: string;
  completeCatalogCount: number;
  /** Catalogs that priced some but not all required members (excluded from the average). */
  incompleteCatalogs: IssueIncompleteCatalog[];
}

export interface ChecklistPriceDetails {
  baseCurrency: string;
  /** The checklist this breaks down (#531) — the dialog names it, since an issue may have several
   *  and the row opens one entry per checklist. */
  checklistName: string;
  requiredCount: number;
  /** Per (condition × certificate) average of the complete catalogs' totals, always in the base currency. */
  averageCells: IssueAverageCell[];
  /** Per-catalog breakdown using only each catalog's newest (current) edition. */
  catalogsLatest: IssueCatalogGroup[];
  /** Per-catalog breakdown using each member's newest priced edition (older-edition fallback). */
  catalogsAll: IssueCatalogGroup[];
}

/**
 * One checklist's totals broken down per catalog and averaged across
 * catalogs, shaped for the price-details dialog. The subject is a **checklist** rather than an
 * issue (#531): with several goals in one publication, "the total for this set" had no single
 * answer, and a checklist is what restores one. Two per-catalog breakdowns are
 * returned: `catalogsLatest` sums each stamp's price on the catalog's newest
 * (current) edition only; `catalogsAll` sums each stamp's newest priced edition
 * (older-edition fallback) — the dialog's latest/all toggle chooses between them.
 * Averages are always computed from the latest-edition totals (toggle-independent):
 * per (condition × certificate), the mean of the base-currency totals of catalogs
 * that price *all* the checklist's stamps in that variant; incomplete catalogs are always
 * reported so the gap is visible. Totals are broken down per certificate status
 * (plus "None"), mirroring the stamp matrix. See price-details dialog.
 */
export async function getChecklistPriceDetails(
  ownerId: string,
  collectionId: string,
  checklistId: string
): Promise<ChecklistPriceDetails> {
  await assertCollectionOwner(ownerId, collectionId);
  const checklist = await prisma.checklist.findFirst({
    where: { id: checklistId, collectionId },
    select: { name: true },
  });
  if (!checklist) throw new Error("Checklist not found.");

  const [members, conditions, certificateStatuses, baseCurrency, latestYearByName] =
    await Promise.all([
      prisma.checklistStamp.findMany({
        where: { checklistId },
        select: {
          stamp: {
            select: {
              catalogPrices: {
                select: {
                  price: true,
                  currency: true,
                  conditionId: true,
                  certificateStatusId: true,
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
              },
            },
          },
        },
      }),
      getStampConditions(ownerId, collectionId),
      getCertificateStatuses(ownerId, collectionId),
      getCollectionBaseCurrency(collectionId),
      getLatestEditionYearByName(collectionId),
    ]);

  const requiredCount = members.length;

  // Axis metadata for cells: condition + certificate (with "None" = null → key "").
  const condMeta = new Map(
    conditions.map((c) => [c.id, { name: c.name, abbreviation: c.abbreviation, sort: c.sortOrder }])
  );
  const certMeta = new Map<string, { name: string | null; abbreviation: string | null; sort: number }>();
  certMeta.set("", { name: null, abbreviation: null, sort: -1 });
  for (const cs of certificateStatuses) {
    certMeta.set(cs.id, { name: cs.name, abbreviation: cs.abbreviation, sort: cs.sortOrder });
  }
  const axesFor = (comboKey: string): IssueCellAxes => {
    const [conditionId, certKey] = comboKey.split("~");
    const cm = condMeta.get(conditionId);
    const cert = certMeta.get(certKey) ?? { name: null, abbreviation: null, sort: -1 };
    return {
      conditionId,
      conditionName: cm?.name ?? "",
      conditionAbbreviation: cm?.abbreviation ?? "",
      conditionSortOrder: cm?.sort ?? 0,
      certificateStatusId: certKey === "" ? null : certKey,
      certificateStatusName: cert.name,
      certificateStatusAbbreviation: cert.abbreviation,
      certificateSortOrder: cert.sort,
    };
  };

  // Catalog metadata (name/currency/vendor) discovered from the priced members.
  const catalogMeta = new Map<
    string,
    { catalogName: string; vendorAbbreviation: string; catalogNameCurrency: string }
  >();
  type Acc = { sum: number; priced: number };
  // catalogNameId → `${conditionId}~${certKey}` → { sum, priced }, for each edition-selection variant.
  const latestSums = new Map<string, Map<string, Acc>>();
  const allSums = new Map<string, Map<string, Acc>>();
  const addTo = (
    target: Map<string, Map<string, Acc>>,
    catId: string,
    comboKey: string,
    amount: number
  ) => {
    let byCombo = target.get(catId);
    if (!byCombo) {
      byCombo = new Map();
      target.set(catId, byCombo);
    }
    const acc = byCombo.get(comboKey) ?? { sum: 0, priced: 0 };
    acc.sum += amount;
    acc.priced += 1;
    byCombo.set(comboKey, acc);
  };

  for (const m of members) {
    // Per (catalog, condition, certificate): the member's newest priced edition
    // (for "all") and, separately, its price on the catalog's current edition ("latest").
    const bestAll = new Map<string, { year: number; amount: number }>();
    const latestHit = new Map<string, number>();
    for (const p of m.stamp.catalogPrices) {
      const catId = p.catalogEdition.catalogNameId;
      if (!catalogMeta.has(catId)) {
        catalogMeta.set(catId, {
          catalogName: p.catalogEdition.catalogName.name,
          vendorAbbreviation: p.catalogEdition.catalogName.vendor.abbreviation,
          catalogNameCurrency: p.catalogEdition.catalogName.currency,
        });
      }
      const certKey = p.certificateStatusId ?? "";
      const key = `${catId}~${p.conditionId}~${certKey}`;
      const cur = bestAll.get(key);
      if (!cur || p.catalogEdition.year > cur.year) {
        bestAll.set(key, { year: p.catalogEdition.year, amount: Number(p.price) });
      }
      if (p.catalogEdition.year === latestYearByName.get(catId)) {
        latestHit.set(key, Number(p.price));
      }
    }
    const toCombo = (key: string) => {
      const first = key.indexOf("~");
      return { catId: key.slice(0, first), comboKey: key.slice(first + 1) };
    };
    for (const [key, best] of bestAll) {
      const { catId, comboKey } = toCombo(key);
      addTo(allSums, catId, comboKey, best.amount);
    }
    for (const [key, amount] of latestHit) {
      const { catId, comboKey } = toCombo(key);
      addTo(latestSums, catId, comboKey, amount);
    }
  }

  const rates = await safeRateMap(
    collectionId,
    baseCurrency,
    [...catalogMeta.values()].map((c) => c.catalogNameCurrency)
  );

  const comboSort = (a: IssueCellAxes, b: IssueCellAxes) =>
    a.conditionSortOrder - b.conditionSortOrder || a.certificateSortOrder - b.certificateSortOrder;

  // Per-catalog breakdown: one cell per priced (condition × certificate) intersection.
  const buildCatalogs = (sums: Map<string, Map<string, Acc>>): IssueCatalogGroup[] =>
    [...sums.entries()]
      .map(([catId, byCombo]) => {
        const meta = catalogMeta.get(catId)!;
        const cells: IssueCatalogCell[] = [...byCombo.entries()]
          .map(([comboKey, acc]) => ({
            ...axesFor(comboKey),
            sumCatalog: acc.sum.toFixed(2),
            catalogCurrency: meta.catalogNameCurrency,
            convertedSum: applyConversion(acc.sum, meta.catalogNameCurrency, baseCurrency, rates),
            baseCurrency,
            pricedCount: acc.priced,
            requiredCount,
            complete: acc.priced === requiredCount,
          }))
          .sort(comboSort);
        return {
          catalogNameId: catId,
          catalogName: meta.catalogName,
          vendorAbbreviation: meta.vendorAbbreviation,
          catalogNameCurrency: meta.catalogNameCurrency,
          cells,
        };
      })
      .sort((a, b) => a.catalogName.localeCompare(b.catalogName));

  const catalogsLatest = buildCatalogs(latestSums);
  const catalogsAll = buildCatalogs(allSums);

  // Per (condition × certificate) average over the latest-edition complete catalogs.
  const comboKeys = new Set<string>();
  for (const byCombo of latestSums.values()) for (const k of byCombo.keys()) comboKeys.add(k);
  const averageCells: IssueAverageCell[] = [...comboKeys]
    .map((comboKey) => {
      const completeValues: number[] = [];
      const incompleteCatalogs: IssueIncompleteCatalog[] = [];
      for (const [catId, byCombo] of latestSums) {
        const acc = byCombo.get(comboKey);
        if (!acc) continue;
        const meta = catalogMeta.get(catId)!;
        if (acc.priced === requiredCount) {
          const bv = baseValueOf(acc.sum, meta.catalogNameCurrency, baseCurrency, rates);
          if (bv != null) completeValues.push(bv);
        } else {
          incompleteCatalogs.push({
            catalogNameId: catId,
            catalogName: meta.catalogName,
            vendorAbbreviation: meta.vendorAbbreviation,
            pricedCount: acc.priced,
            requiredCount,
          });
        }
      }
      const avg = averageOf(completeValues);
      return {
        ...axesFor(comboKey),
        averageBase: avg == null ? null : avg.toFixed(2),
        baseCurrency,
        completeCatalogCount: completeValues.length,
        incompleteCatalogs: incompleteCatalogs.sort((a, b) =>
          a.catalogName.localeCompare(b.catalogName)
        ),
      };
    })
    .sort(comboSort);

  return {
    baseCurrency,
    checklistName: checklist.name,
    requiredCount,
    averageCells,
    catalogsLatest,
    catalogsAll,
  };
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface AutoCreateVendorRange {
  catalogVendorId: string;
  /** Pre-generated catalog numbers, one per stamp position (length === count). */
  numbers: string[];
}

export interface AutoCreateStampsInput {
  /** Number of stamps to create; every vendor's numbering spans this many positions. */
  count: number;
  /** Each selected vendor with its generated catalog number for each position. */
  vendors: AutoCreateVendorRange[];
}

/** Validate a range auto-create request before any writes. Shared by issue creation
 *  (#70) and post-creation bulk add (#219). */
function assertAutoCreateInput(input: AutoCreateStampsInput): void {
  const { count, vendors } = input;
  if (count < 1) throw new Error("Range must include at least one stamp.");
  if (count > 50) throw new Error("Range cannot exceed 50 stamps.");
  if (vendors.length === 0) throw new Error("At least one catalog vendor must be selected.");
  if (vendors.some((v) => v.numbers.length !== count)) {
    throw new Error("Each vendor must supply one catalog number per stamp.");
  }
}

/** Create `input.count` stamps as root nodes of `issueId` in `areaId`, tagging each with
 *  the area (primary), putting it on the issue's checklist, and writing every vendor's
 *  generated catalog number. Shared by issue creation (#70) and add-range (#219); runs
 *  inside an existing transaction. Caller must have validated `input`.
 *
 *  A generated range **is** the issue's set — that is what auto-creating from a catalog range
 *  means — so it lands on the issue's first checklist, creating one named after the issue when
 *  there is none. This is the flag's old `requiredForCompleteness: true` in checklist terms. */
async function createRangeStamps(
  tx: Prisma.TransactionClient,
  params: {
    collectionId: string;
    areaId: string;
    issueId: string;
    issuedYear: number | null;
    input: AutoCreateStampsInput;
  }
): Promise<string[]> {
  const { collectionId, areaId, issueId, issuedYear, input } = params;
  const { count, vendors } = input;
  const stampIds: string[] = [];

  for (let n = 0; n < count; n++) {
    const stamp = await tx.stamp.create({
      data: { collectionId, issuedYear },
      select: { id: true },
    });
    stampIds.push(stamp.id);
  }

  await tx.stampCollectionArea.createMany({
    data: stampIds.map((stampId) => ({
      stampId,
      collectionAreaId: areaId,
      isPrimary: true,
    })),
  });

  const rangeBase = await nextIssueSortOrder(tx, issueId);
  await tx.issueMember.createMany({
    // The range is numbered in the order it was generated, which is the order the numbers were
    // typed — a bulk add is one insertion, not `count` of them (#549).
    data: stampIds.map((stampId, i) => ({ issueId, stampId, sortOrder: rangeBase + i })),
  });

  const checklistId = await ensureIssueChecklist(tx, collectionId, issueId);
  await tx.checklistStamp.createMany({
    data: stampIds.map((stampId) => ({ checklistId, stampId })),
    skipDuplicates: true,
  });

  const catalogNumberRows: { stampId: string; catalogVendorId: string; number: string }[] = [];
  for (let i = 0; i < stampIds.length; i++) {
    for (const v of vendors) {
      catalogNumberRows.push({
        stampId: stampIds[i],
        catalogVendorId: v.catalogVendorId,
        number: v.numbers[i],
      });
    }
  }
  if (catalogNumberRows.length > 0) {
    await tx.stampCatalogNumber.createMany({ data: catalogNumberRows });
  }
  return stampIds;
}

export async function createIssue(
  ownerId: string,
  collectionId: string,
  areaId: string,
  data: {
    name?: string | null;
    year?: number | null;
    catalogNumbers?: { catalogVendorId: string; firstNumber: string; lastNumber?: string | null }[];
    /** Per-vendor overrides of the area-resolved catalog prefix (#377). Blank values are dropped —
     * a blank field means "inherit the area's prefix", which is the absence of a row. */
    catalogPrefixes?: { catalogVendorId: string; areaPrefix: string }[];
    /** Per-language `name` overrides (#295), keyed by ISO 639-1 code then field key. A blank / null
     * value removes that language's row; languages absent from the record are left untouched. */
    translations?: TranslationValueMap;
    autoCreateStamps?: AutoCreateStampsInput;
  }
): Promise<{ id: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  const area = await prisma.collectionArea.findUnique({
    where: { id: areaId },
    select: { collectionId: true, assignable: true },
  });
  if (!area || area.collectionId !== collectionId) {
    throw new Error("Collection area not found.");
  }
  if (!area.assignable) {
    throw new Error(
      "This is a grouping-only area and can't hold issues. Pick a specific area."
    );
  }

  if (data.autoCreateStamps) assertAutoCreateInput(data.autoCreateStamps);

  const created = await prisma.$transaction(async (tx) => {
    const issue = await tx.issue.create({
      data: {
        collectionId,
        // #432, inside the creating transaction so a rolled-back issue also retires the number.
        issueNo: await allocateEntityNumber(tx, collectionId, "issue"),
        collectionAreaId: areaId,
        name: data.name ?? null,
        year: data.year ?? null,
      },
      select: { id: true },
    });
    await syncIssueTranslations(tx, issue.id, data.translations);
    if (data.catalogNumbers && data.catalogNumbers.length > 0) {
      await tx.issueCatalogNumber.createMany({
        data: data.catalogNumbers.map((cn) => ({
          issueId: issue.id,
          catalogVendorId: cn.catalogVendorId,
          firstNumber: cn.firstNumber,
          lastNumber: cn.lastNumber ?? null,
        })),
        skipDuplicates: true,
      });
    }
    await writeIssueCatalogPrefixes(tx, issue.id, data.catalogPrefixes);

    let stampIds: string[] = [];
    if (data.autoCreateStamps) {
      stampIds = await createRangeStamps(tx, {
        collectionId,
        areaId,
        issueId: issue.id,
        issuedYear: data.year ?? null,
        input: data.autoCreateStamps,
      });
    }

    return { id: issue.id, stampIds };
  });
  // Populate the denormalized catalog sort key for the issue and any auto-created stamps (#181).
  await recomputeIssueSortKeys(collectionId, [created.id]);
  await recomputeStampSortKeys(collectionId, created.stampIds);
  return { id: created.id };
}

/**
 * Add a catalog-number range of stamps to an existing issue (#219) — the post-creation
 * equivalent of {@link createIssue}'s `autoCreateStamps` (#70). New stamps are appended as
 * additional root nodes in the issue's own area, alongside anything already there. The
 * generated numbers and per-vendor spans are prepared by the caller (same generation as
 * creation); duplicate-catalog enforcement (#85) also happens in the action layer.
 */
export async function addStampRangeToIssue(
  ownerId: string,
  collectionId: string,
  issueId: string,
  input: AutoCreateStampsInput
): Promise<void> {
  const { collectionId: issueCollection, collectionAreaId } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);
  assertAutoCreateInput(input);

  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { year: true },
  });

  const stampIds = await prisma.$transaction((tx) =>
    createRangeStamps(tx, {
      collectionId,
      areaId: collectionAreaId,
      issueId,
      issuedYear: issue?.year ?? null,
      input,
    })
  );
  await recomputeStampSortKeys(collectionId, stampIds);
}

export async function updateIssue(
  ownerId: string,
  collectionId: string,
  issueId: string,
  data: {
    name?: string | null;
    year?: number | null;
    catalogNumbers?: { catalogVendorId: string; firstNumber: string; lastNumber?: string | null }[];
    /** Per-vendor prefix overrides (#377); see {@link createIssue}. Passing an array replaces the
     * issue's whole set, so a vendor left out of it goes back to inheriting the area's prefix. */
    catalogPrefixes?: { catalogVendorId: string; areaPrefix: string }[];
    /** Per-language `name` overrides (#295); see {@link createIssue}. */
    translations?: TranslationValueMap;
  }
): Promise<void> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.$transaction(async (tx) => {
    await tx.issue.update({
      where: { id: issueId },
      data: { name: data.name ?? null, year: data.year ?? null },
    });
    await syncIssueTranslations(tx, issueId, data.translations);
    if (data.catalogNumbers !== undefined) {
      await tx.issueCatalogNumber.deleteMany({ where: { issueId } });
      if (data.catalogNumbers.length > 0) {
        await tx.issueCatalogNumber.createMany({
          data: data.catalogNumbers.map((cn) => ({
            issueId,
            catalogVendorId: cn.catalogVendorId,
            firstNumber: cn.firstNumber,
            lastNumber: cn.lastNumber ?? null,
          })),
          skipDuplicates: true,
        });
      }
    }
    await writeIssueCatalogPrefixes(tx, issueId, data.catalogPrefixes);
  });
  if (data.catalogNumbers !== undefined) {
    await recomputeIssueSortKeys(collectionId, [issueId]);
  }
}

/**
 * Declared-range coverage suggestions for one issue: for each vendor whose member
 * stamps extend the issue's First–Last range, a proposal to widen it. Empty when
 * every declared range still covers its members. See {@link computeIssueRangeSuggestions}.
 */
export async function getIssueRangeSuggestions(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<IssueRangeSuggestion[]> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  const [issue, vendors] = await Promise.all([
    prisma.issue.findUnique({
      where: { id: issueId },
      select: {
        catalogNumbers: { select: { catalogVendorId: true, firstNumber: true, lastNumber: true } },
        members: {
          select: {
            requiredForCompleteness: true,
            stamp: { select: { catalogNumbers: { select: { catalogVendorId: true, number: true } } } },
          },
        },
      },
    }),
    prisma.catalogVendor.findMany({ where: { collectionId }, select: { id: true, abbreviation: true } }),
  ]);
  if (!issue) return [];
  const vendorAbbrev = new Map(vendors.map((v) => [v.id, v.abbreviation]));
  return computeIssueRangeSuggestions(
    issue.catalogNumbers,
    issue.members
      .filter((m) => m.requiredForCompleteness)
      .flatMap((m) => m.stamp.catalogNumbers),
    vendorAbbrev
  );
}

/** Upsert a single vendor's declared First–Last range on an issue (used to apply a
 *  coverage suggestion without touching the issue's other vendor ranges). */
export async function setIssueCatalogRange(
  ownerId: string,
  collectionId: string,
  issueId: string,
  catalogVendorId: string,
  firstNumber: string,
  lastNumber: string | null
): Promise<void> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);
  const first = firstNumber.trim();
  if (!first) throw new Error("First catalog number is required.");
  const last = lastNumber?.trim() || null;
  // Guard the vendor belongs to this collection before writing.
  const vendor = await prisma.catalogVendor.findFirst({
    where: { id: catalogVendorId, collectionId },
    select: { id: true },
  });
  if (!vendor) throw new Error("Catalog vendor not found.");
  await prisma.issueCatalogNumber.upsert({
    where: { issueId_catalogVendorId: { issueId, catalogVendorId } },
    create: { issueId, catalogVendorId, firstNumber: first, lastNumber: last },
    update: { firstNumber: first, lastNumber: last },
  });
  // The vendor's First may be the primary catalog number driving this issue's sort key (#181).
  await recomputeIssueSortKeys(collectionId, [issueId]);
}

export async function deleteIssue(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<void> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  await prisma.$transaction(async (tx) => {
    const members = await tx.issueMember.findMany({
      where: { issueId },
      select: { stampId: true },
    });

    if (members.length > 0) {
      const stampIds = members.map((m) => m.stampId);
      const shared = await tx.issueMember.groupBy({
        by: ["stampId"],
        where: { stampId: { in: stampIds }, issueId: { not: issueId } },
      });
      const sharedIds = new Set(shared.map((s) => s.stampId));
      const exclusiveIds = stampIds.filter((id) => !sharedIds.has(id));

      if (exclusiveIds.length > 0) {
        await deleteStampsDepthFirst(tx, exclusiveIds);
      }
    }

    await tx.issue.delete({ where: { id: issueId } });
  });
}

async function deleteStampsDepthFirst(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  stampIds: string[]
): Promise<void> {
  const idSet = new Set(stampIds);
  const stamps = await tx.stamp.findMany({
    where: { id: { in: stampIds } },
    select: { id: true, parentId: true },
  });

  const childMap = new Map<string | null, string[]>();
  for (const s of stamps) {
    const parentKey = s.parentId && idSet.has(s.parentId) ? s.parentId : null;
    const list = childMap.get(parentKey) ?? [];
    list.push(s.id);
    childMap.set(parentKey, list);
  }

  const order: string[] = [];
  function visit(id: string) {
    for (const child of childMap.get(id) ?? []) visit(child);
    order.push(id);
  }
  for (const root of childMap.get(null) ?? []) visit(root);
  for (const id of stampIds) {
    if (!order.includes(id)) order.push(id);
  }

  for (const id of order) {
    await tx.stamp.delete({ where: { id } });
  }
}

export interface IssueDeletionPreview {
  totalMembers: number;
  exclusiveCount: number;
  sharedCount: number;
}

export async function previewIssueDeletion(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<IssueDeletionPreview> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  const members = await prisma.issueMember.findMany({
    where: { issueId },
    select: { stampId: true },
  });

  if (members.length === 0) {
    return { totalMembers: 0, exclusiveCount: 0, sharedCount: 0 };
  }

  const stampIds = members.map((m) => m.stampId);
  const shared = await prisma.issueMember.groupBy({
    by: ["stampId"],
    where: { stampId: { in: stampIds }, issueId: { not: issueId } },
  });
  const sharedCount = shared.length;

  return {
    totalMembers: members.length,
    exclusiveCount: members.length - sharedCount,
    sharedCount,
  };
}

export interface AddStampData {
  name?: string | null;
  issuedDay?: number | null;
  issuedMonth?: number | null;
  issuedYear?: number | null;
  parentStampId?: string | null;
  // Child-only subtype classification (ADR-0010). For a child, `subtypeId` defaults
  // to the collection's default subtype when omitted; `actsAsVariantOverride` is the
  // tri-state per-stamp override (null = inherit from the subtype). Ignored for
  // top-level stamps, which stay unclassified.
  subtypeId?: string | null;
  actsAsVariantOverride?: boolean | null;
  /** Which of the issue's checklists the new stamp joins (#531). The sentinel
   *  {@link DEFAULT_CHECKLIST} stands for "the issue's first checklist, created from the issue's
   *  name if it has none" — what ticking *Required for completeness* meant before checklists
   *  existed, and what an issue being started from scratch needs. Empty = an optional extra. */
  checklistIds: string[];
  /** Colnect item-ID (#247), or null/omitted when unset. */
  colnectId?: string | null;
  /** Per-language `name` overrides (#296), keyed by ISO 639-1 code then field key. See
   * {@link syncStampTranslations}. */
  translations?: TranslationValueMap;
  catalogNumbers: { catalogVendorId: string; number: string }[];
  catalogPrices?: {
    catalogEditionId: string;
    conditionId: string;
    certificateStatusId: string | null;
    price: string;
    currency: string;
  }[];
}

export async function addStampToIssue(
  ownerId: string,
  collectionId: string,
  issueId: string,
  data: AddStampData
): Promise<{ stampId: string }> {
  const { collectionId: issueCollection, collectionAreaId } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  if (data.parentStampId) {
    const parentMember = await prisma.issueMember.findUnique({
      where: { issueId_stampId: { issueId, stampId: data.parentStampId } },
    });
    if (!parentMember) {
      throw new Error("Parent stamp is not a member of this issue.");
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Children carry a subtype (chosen or the collection default) and an optional
    // per-stamp actsAsVariant override; top-level stamps stay unclassified.
    let subtypeId: string | null = null;
    let actsAsVariantOverride: boolean | null = null;
    if (data.parentStampId) {
      subtypeId = data.subtypeId ?? null;
      if (subtypeId) {
        const sub = await tx.stampSubtype.findFirst({
          where: { id: subtypeId, collectionId },
          select: { id: true },
        });
        if (!sub) throw new Error("Subtype not found in this collection.");
      } else {
        const def = await tx.stampSubtype.findFirst({
          where: { collectionId, isDefault: true },
          select: { id: true },
        });
        subtypeId = def?.id ?? null;
      }
      actsAsVariantOverride = data.actsAsVariantOverride ?? null;
    }

    const stamp = await tx.stamp.create({
      data: {
        collectionId,
        name: data.name ?? null,
        issuedDay: data.issuedDay ?? null,
        issuedMonth: data.issuedMonth ?? null,
        issuedYear: data.issuedYear ?? null,
        parentId: data.parentStampId ?? null,
        subtypeId,
        actsAsVariantOverride,
        colnectId: data.colnectId || null,
      },
      select: { id: true },
    });

    await syncStampTranslations(tx, stamp.id, data.translations);

    await tx.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId, isPrimary: true },
    });

    await tx.issueMember.create({
      data: { issueId, stampId: stamp.id, sortOrder: await nextIssueSortOrder(tx, issueId) },
    });

    await putStampOnChecklists(tx, collectionId, issueId, stamp.id, data.checklistIds);

    if (data.catalogNumbers.length > 0) {
      await tx.stampCatalogNumber.createMany({
        data: data.catalogNumbers.map((cn) => ({
          stampId: stamp.id,
          catalogVendorId: cn.catalogVendorId,
          number: cn.number,
        })),
        skipDuplicates: true,
      });
    }

    if (data.catalogPrices && data.catalogPrices.length > 0) {
      await tx.stampCatalogPrice.createMany({
        data: data.catalogPrices.map((cp) => ({
          stampId: stamp.id,
          catalogEditionId: cp.catalogEditionId,
          conditionId: cp.conditionId,
          certificateStatusId: cp.certificateStatusId,
          price: cp.price,
          currency: cp.currency,
        })),
        skipDuplicates: true,
      });
    }

    return { stampId: stamp.id };
  });

  await recomputeStampSortKeys(collectionId, [result.stampId]);
  return result;
}

/**
 * Where a stamp joining this issue goes: past everything already in it (#549).
 *
 * One number for the whole issue rather than one per sibling group, because it only has to be past
 * the group the newcomer lands in and the issue-wide maximum is past every group at once. That is
 * also what makes it right for a stamp whose parent is picked *after* the position is taken.
 */
async function nextIssueSortOrder(
  tx: Prisma.TransactionClient,
  issueId: string
): Promise<number> {
  const highest = await tx.issueMember.aggregate({
    where: { issueId },
    _max: { sortOrder: true },
  });
  return (highest._max.sortOrder ?? -1) + 1;
}

/**
 * Put one **sibling group** of an issue's stamp tree in the order given (#549) — the issue's root
 * stamps, or one parent's variants. The request names the whole group, and
 * {@link checkSiblingGroup} is what refuses anything else: a partial group would move a stamp past
 * a sibling the collector could not see.
 */
export async function reorderIssueMembers(
  ownerId: string,
  collectionId: string,
  issueId: string,
  orderedStampIds: string[]
): Promise<void> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  const members = await prisma.issueMember.findMany({
    where: { issueId },
    select: { stampId: true, stamp: { select: { parentId: true } } },
  });
  const check = checkSiblingGroup(
    members.map((m) => ({ stampId: m.stampId, parentId: m.stamp.parentId })),
    orderedStampIds
  );
  if (!check.ok) throw new Error(check.reason);

  await prisma.$transaction(
    sortOrderAssignments(orderedStampIds).map(({ stampId, sortOrder }) =>
      prisma.issueMember.update({
        where: { issueId_stampId: { issueId, stampId } },
        data: { sortOrder },
      })
    )
  );
}

export async function removeStampFromIssue(
  ownerId: string,
  collectionId: string,
  issueId: string,
  stampId: string
): Promise<void> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.issueMember.delete({
    where: { issueId_stampId: { issueId, stampId } },
  });
}

export async function moveStampNode(
  ownerId: string,
  collectionId: string,
  issueId: string,
  stampId: string,
  targetIssueId: string
): Promise<void> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  const { collectionId: targetCollection } = await resolveIssueArea(targetIssueId);
  if (targetCollection !== collectionId) throw new Error("Target issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  // Collect the stamp and all its descendants that are members of this issue
  const allMembers = await prisma.issueMember.findMany({
    where: { issueId },
    // `requiredForCompleteness` was selected here until #549's tests reached this path: the column
    // went away with #531's checklists, the value was never read, and Prisma rejects the query.
    select: { stampId: true, stamp: { select: { parentId: true } } },
  });

  const memberSet = new Map(allMembers.map((m) => [m.stampId, m]));

  function collectSubtree(rootId: string): string[] {
    const ids: string[] = [rootId];
    for (const [sid, member] of memberSet) {
      if (member.stamp.parentId === rootId) {
        ids.push(...collectSubtree(sid));
      }
    }
    return ids;
  }

  const stampIds = collectSubtree(stampId);

  await prisma.$transaction(async (tx) => {
    // The subtree lands at the end of the target issue, keeping its own internal order (#549) —
    // arriving stamps are the newest members there, whatever position they held where they came
    // from, and a position is a statement about one issue's tree.
    const base = await nextIssueSortOrder(tx, targetIssueId);
    for (const [i, sid] of stampIds.entries()) {
      await tx.issueMember.update({
        where: { issueId_stampId: { issueId, stampId: sid } },
        data: { issueId: targetIssueId, sortOrder: base + i },
      });
    }
  });
}

/** A catalog identity that both the source and target issue's stamps already carry —
 *  merging would place two stamps with the same number under one issue (#218, #85). */
export interface IssueMergeConflict {
  catalogVendorId: string;
  vendorAbbreviation: string;
  number: string;
  /** Display label, e.g. "Mi 200". */
  label: string;
}

export interface IssueMergePreview {
  sourceName: string | null;
  targetName: string | null;
  /** Stamp nodes that will be reassigned from source to target. */
  stampCount: number;
  /** Catalog-number collisions between the two issues' stamps (advisory, non-blocking). */
  conflicts: IssueMergeConflict[];
}

/** Catalog identities (vendor + number) shared by the source and target issues' member
 *  stamps. Both issues are expected to share an area, so a plain vendor+number match is
 *  the effective identity (prefix is area-derived). */
async function computeMergeConflicts(
  collectionId: string,
  sourceIssueId: string,
  targetIssueId: string
): Promise<IssueMergeConflict[]> {
  const [sourceNumbers, targetNumbers] = await Promise.all([
    prisma.stampCatalogNumber.findMany({
      where: { stamp: { issueMemberships: { some: { issueId: sourceIssueId } } } },
      select: { catalogVendorId: true, number: true },
    }),
    prisma.stampCatalogNumber.findMany({
      where: { stamp: { issueMemberships: { some: { issueId: targetIssueId } } } },
      select: { catalogVendorId: true, number: true },
    }),
  ]);

  const targetKeys = new Set(targetNumbers.map((n) => `${n.catalogVendorId} ${n.number}`));
  const conflictKeys = new Map<string, { catalogVendorId: string; number: string }>();
  for (const n of sourceNumbers) {
    const key = `${n.catalogVendorId} ${n.number}`;
    if (targetKeys.has(key)) {
      conflictKeys.set(key, { catalogVendorId: n.catalogVendorId, number: n.number });
    }
  }
  if (conflictKeys.size === 0) return [];

  const vendorIds = [...new Set([...conflictKeys.values()].map((c) => c.catalogVendorId))];
  const vendors = await prisma.catalogVendor.findMany({
    where: { id: { in: vendorIds }, collectionId },
    select: { id: true, abbreviation: true },
  });
  const abbrevById = new Map(vendors.map((v) => [v.id, v.abbreviation]));

  return [...conflictKeys.values()]
    .map((c) => {
      const abbreviation = abbrevById.get(c.catalogVendorId) ?? "";
      return {
        catalogVendorId: c.catalogVendorId,
        vendorAbbreviation: abbreviation,
        number: c.number,
        label: `${abbreviation} ${c.number}`.trim(),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Summarize what merging `sourceIssueId` into `targetIssueId` would do (#218): how many
 * stamp nodes move and which catalog numbers collide between the two issues. Read-only —
 * drives the confirmation dialog before the irreversible merge.
 */
export async function previewIssueMerge(
  ownerId: string,
  collectionId: string,
  sourceIssueId: string,
  targetIssueId: string
): Promise<IssueMergePreview> {
  if (sourceIssueId === targetIssueId) throw new Error("Cannot merge an issue into itself.");
  const { collectionId: sourceCollection } = await resolveIssueArea(sourceIssueId);
  if (sourceCollection !== collectionId) throw new Error("Issue not found.");
  const { collectionId: targetCollection } = await resolveIssueArea(targetIssueId);
  if (targetCollection !== collectionId) throw new Error("Target issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  const [source, target, stampCount, conflicts] = await Promise.all([
    prisma.issue.findUnique({ where: { id: sourceIssueId }, select: { name: true } }),
    prisma.issue.findUnique({ where: { id: targetIssueId }, select: { name: true } }),
    prisma.issueMember.count({ where: { issueId: sourceIssueId } }),
    computeMergeConflicts(collectionId, sourceIssueId, targetIssueId),
  ]);

  return {
    sourceName: source?.name ?? null,
    targetName: target?.name ?? null,
    stampCount,
    conflicts,
  };
}

/**
 * Merge `sourceIssueId` into `targetIssueId` (#218): reassign every stamp node under the
 * source to the target and delete the now-empty source issue. Stamp tree structure is
 * preserved (each stamp keeps its `parentId`), so the source's root nodes become root
 * nodes of the target. Stamps already shared with the target keep their existing target
 * membership; their duplicate source membership is dropped when the source issue is
 * deleted (its `IssueMember` / `IssueCatalogNumber` rows cascade). Inventory items are
 * unaffected — they reference the stamp, which now belongs to the target. Irreversible.
 */
export async function mergeIssues(
  ownerId: string,
  collectionId: string,
  sourceIssueId: string,
  targetIssueId: string
): Promise<void> {
  if (sourceIssueId === targetIssueId) throw new Error("Cannot merge an issue into itself.");
  const { collectionId: sourceCollection } = await resolveIssueArea(sourceIssueId);
  if (sourceCollection !== collectionId) throw new Error("Issue not found.");
  const { collectionId: targetCollection } = await resolveIssueArea(targetIssueId);
  if (targetCollection !== collectionId) throw new Error("Target issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  const [sourceMembers, targetMembers] = await Promise.all([
    prisma.issueMember.findMany({
      where: { issueId: sourceIssueId },
      select: { stampId: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { stampId: "asc" }],
    }),
    prisma.issueMember.findMany({ where: { issueId: targetIssueId }, select: { stampId: true } }),
  ]);
  const targetStampIds = new Set(targetMembers.map((m) => m.stampId));
  // Stamps not already in the target move over; stamps already shared with the target
  // keep that membership and their source row is cascade-deleted with the source issue.
  const stampIdsToMove = sourceMembers
    .map((m) => m.stampId)
    .filter((stampId) => !targetStampIds.has(stampId));

  await prisma.$transaction(async (tx) => {
    if (stampIdsToMove.length > 0) {
      // The source's stamps append after the target's, keeping the order they had among
      // themselves (#549) — the same rule moving a single node follows, applied to a whole issue.
      const base = await nextIssueSortOrder(tx, targetIssueId);
      for (const [i, stampId] of stampIdsToMove.entries()) {
        await tx.issueMember.update({
          where: { issueId_stampId: { issueId: sourceIssueId, stampId } },
          data: { issueId: targetIssueId, sortOrder: base + i },
        });
      }
    }
    await tx.issue.delete({ where: { id: sourceIssueId } });
  });
}

export interface IssueReferencedVendor {
  catalogVendorId: string;
  name: string;
  abbreviation: string;
}

/**
 * Distinct catalog vendors referenced by an issue — its own catalog numbers plus
 * every member stamp's catalog numbers. Used to warn, before moving the issue to a
 * different area, which vendors the target area does not surface (#156). Vendors are
 * collection-scoped, so the numbers stay valid after a move; this only drives the UI
 * warning about display coverage.
 */
export async function listIssueReferencedVendors(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<IssueReferencedVendor[]> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  const [issueNumbers, memberNumbers] = await Promise.all([
    prisma.issueCatalogNumber.findMany({
      where: { issueId },
      select: { catalogVendorId: true },
    }),
    prisma.stampCatalogNumber.findMany({
      where: { stamp: { issueMemberships: { some: { issueId } } } },
      select: { catalogVendorId: true },
    }),
  ]);

  const vendorIds = new Set<string>([
    ...issueNumbers.map((n) => n.catalogVendorId),
    ...memberNumbers.map((n) => n.catalogVendorId),
  ]);
  if (vendorIds.size === 0) return [];

  const vendors = await prisma.catalogVendor.findMany({
    where: { id: { in: [...vendorIds] }, collectionId },
    select: { id: true, name: true, abbreviation: true },
    orderBy: { name: "asc" },
  });
  return vendors.map((v) => ({
    catalogVendorId: v.id,
    name: v.name,
    abbreviation: v.abbreviation,
  }));
}

/**
 * Move an issue (with its stamp tree) to a different collecting area (#156).
 *
 * The issue's `collectionAreaId` is updated and each member stamp's area tag
 * (`StampCollectionArea`) is re-pointed from the old area to the target: the target
 * link is upserted (carrying `isPrimary` from the old link) and the old-area link is
 * removed only when the stamp is not a member of another issue that stays in the old
 * area — so stamps shared across issues keep resolving in both places. Catalog numbers
 * are untouched (vendors are collection-scoped); the UI warns separately about vendors
 * the target area does not surface. No-ops when the issue is already in the target area.
 */
export async function moveIssueToArea(
  ownerId: string,
  collectionId: string,
  issueId: string,
  targetAreaId: string
): Promise<void> {
  const { collectionId: issueCollection, collectionAreaId: currentAreaId } =
    await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  if (targetAreaId === currentAreaId) return;

  const targetArea = await prisma.collectionArea.findUnique({
    where: { id: targetAreaId },
    select: { collectionId: true, assignable: true },
  });
  if (!targetArea || targetArea.collectionId !== collectionId) {
    throw new Error("Target area not found.");
  }
  if (!targetArea.assignable) {
    throw new Error(
      "This is a grouping-only area and can't hold issues. Pick a specific area."
    );
  }

  const members = await prisma.issueMember.findMany({
    where: { issueId },
    select: {
      stampId: true,
      stamp: {
        select: {
          stampAreaLinks: {
            where: { collectionAreaId: currentAreaId },
            select: { isPrimary: true },
          },
        },
      },
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.issue.update({
      where: { id: issueId },
      data: { collectionAreaId: targetAreaId },
    });

    for (const m of members) {
      const oldLink = m.stamp.stampAreaLinks[0];
      const isPrimary = oldLink?.isPrimary ?? false;

      await tx.stampCollectionArea.upsert({
        where: {
          stampId_collectionAreaId: {
            stampId: m.stampId,
            collectionAreaId: targetAreaId,
          },
        },
        create: { stampId: m.stampId, collectionAreaId: targetAreaId, isPrimary },
        update: isPrimary ? { isPrimary: true } : {},
      });

      // Keep the old-area link if another issue that stays in the old area still
      // contains this stamp; otherwise the stamp fully follows the issue.
      const stillInOldArea = await tx.issueMember.count({
        where: {
          stampId: m.stampId,
          issueId: { not: issueId },
          issue: { collectionAreaId: currentAreaId },
        },
      });
      if (stillInOldArea === 0) {
        await tx.stampCollectionArea.deleteMany({
          where: { stampId: m.stampId, collectionAreaId: currentAreaId },
        });
      }
    }
  });
  // The issue and its re-tagged stamps changed area → their effective primary vendor, and thus
  // the sort key, may differ (#181).
  await recomputeIssueSortKeys(collectionId, [issueId]);
  await recomputeStampSortKeys(
    collectionId,
    members.map((m) => m.stampId)
  );
}
