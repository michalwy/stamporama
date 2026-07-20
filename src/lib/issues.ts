import "server-only";
import { prisma } from "./db";
import { getStampConditions } from "./conditions";
import { getCertificateStatuses } from "./certificate-statuses";
import { childIsVariant, VARIANT_FLAG_SELECT } from "./variant-classification";
import { sortPhotos, type PhotoRole, type PhotoSummary } from "./photos";

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
  buildEffectivePrimaryCatalogMap,
  pickMainCatalogPrice,
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

export interface StampNodeData {
  stampId: string;
  parentId: string | null;
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  requiredForCompleteness: boolean;
  catalogNumbers: { catalogVendorId: string; number: string }[];
  mainCatalogPrice: MoneyDisplay | null;
  /** True when the displayed main price is on a non-latest edition of its catalog name. */
  mainCatalogPriceStale: boolean;
  /** Effective actsAsVariant (ADR-0010 §3): override ?? subtype flag; false if none.
   *  A base stamp is an unknown-variant umbrella iff a child has this true. */
  actsAsVariant: boolean;
  /** Catalog-level photos (#137), ordered main then extras — shown under the expanded row. */
  photos: PhotoSummary[];
}

export interface IssueCatalogNumberData {
  catalogVendorId: string;
  firstNumber: string;
  lastNumber: string | null;
}

export interface IssueData {
  id: string;
  collectionId: string;
  collectionAreaId: string;
  name: string | null;
  year: number | null;
  isAutoCreated: boolean;
  createdAt: Date;
  members: StampNodeData[];
  catalogNumbers: IssueCatalogNumberData[];
  completeness: { required: number; owned: number };
}

const MEMBER_SELECT = {
  stampId: true,
  requiredForCompleteness: true,
  stamp: {
    select: {
      parentId: true,
      name: true,
      issuedDay: true,
      issuedMonth: true,
      issuedYear: true,
      catalogNumbers: { select: { catalogVendorId: true, number: true } },
      catalogPrices: {
        select: {
          price: true,
          currency: true,
          conditionId: true,
          certificateStatusId: true,
          catalogEdition: { select: { year: true, catalogNameId: true } },
        },
      },
      photos: { select: PHOTO_SUMMARY_SELECT },
      ...VARIANT_FLAG_SELECT,
    },
  },
} as const;

function toStampNode(
  m: {
    stampId: string;
    requiredForCompleteness: boolean;
    stamp: {
      parentId: string | null;
      name: string | null;
      issuedDay: number | null;
      issuedMonth: number | null;
      issuedYear: number | null;
      catalogNumbers: { catalogVendorId: string; number: string }[];
      catalogPrices: RawCatalogPrice[];
      photos: { id: string; role: string | null; title: string | null; sortOrder: number }[];
      actsAsVariantOverride: boolean | null;
      subtype: { actsAsVariant: boolean } | null;
    };
  },
  pricing?: {
    primaryNameId: string | null;
    baseCurrency: string;
    latestYearByName: Map<string, number>;
    displayConditionId: string | null;
  }
): StampNodeData {
  const main = pricing
    ? pickMainCatalogPrice(m.stamp.catalogPrices, pricing.primaryNameId, pricing.displayConditionId)
    : null;
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
    requiredForCompleteness: m.requiredForCompleteness,
    catalogNumbers: m.stamp.catalogNumbers,
    // convertedAmount filled by the caller after rates are fetched
    mainCatalogPrice:
      main && pricing
        ? { amount: main.amount.toFixed(2), currency: main.currency, convertedAmount: null, baseCurrency: pricing.baseCurrency }
        : null,
    mainCatalogPriceStale,
    actsAsVariant: childIsVariant(m.stamp),
    photos: toPhotoSummaries(m.stamp.photos),
  };
}

const ISSUE_SELECT = {
  id: true,
  collectionId: true,
  collectionAreaId: true,
  name: true,
  year: true,
  isAutoCreated: true,
  createdAt: true,
  members: { select: MEMBER_SELECT },
  catalogNumbers: { select: { catalogVendorId: true, firstNumber: true, lastNumber: true } },
} as const;

function toIssueData(issue: {
  id: string;
  collectionId: string;
  collectionAreaId: string;
  name: string | null;
  year: number | null;
  isAutoCreated: boolean;
  createdAt: Date;
  members: {
    stampId: string;
    requiredForCompleteness: boolean;
    stamp: {
      parentId: string | null;
      name: string | null;
      issuedDay: number | null;
      issuedMonth: number | null;
      issuedYear: number | null;
      catalogNumbers: { catalogVendorId: string; number: string }[];
      catalogPrices: RawCatalogPrice[];
      photos: { id: string; role: string | null; title: string | null; sortOrder: number }[];
      actsAsVariantOverride: boolean | null;
      subtype: { actsAsVariant: boolean } | null;
    };
  }[];
  catalogNumbers: { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[];
}): IssueData {
  const required = issue.members.filter((m) => m.requiredForCompleteness).length;
  return {
    id: issue.id,
    collectionId: issue.collectionId,
    collectionAreaId: issue.collectionAreaId,
    name: issue.name,
    year: issue.year,
    isAutoCreated: issue.isAutoCreated,
    createdAt: issue.createdAt,
    members: issue.members.map((m) => toStampNode(m)),
    catalogNumbers: issue.catalogNumbers,
    completeness: { required, owned: 0 },
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
  return issues.map(toIssueData);
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
  return issues.map(toIssueData);
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
      members: { select: { requiredForCompleteness: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    year: r.year,
    collectionAreaId: r.collectionAreaId,
    catalogNumbers: r.catalogNumbers,
    memberCount: r.members.length,
    requiredCount: r.members.filter((m) => m.requiredForCompleteness).length,
  }));
}

// ── Paginated queries (used by API routes) ─────────────────────────────────

export type IssueSortBy = "year" | "name" | "catalogNumber";

export interface IssueListItem {
  id: string;
  collectionId: string;
  collectionAreaId: string;
  name: string | null;
  year: number | null;
  isAutoCreated: boolean;
  createdAt: string;
  catalogNumbers: IssueCatalogNumberData[];
  memberCount: number;
  requiredCount: number;
  requiredPriceTotal: IssuePriceTotal | null;
  /** True when at least one required member's counted price is on a non-latest edition. */
  requiredPriceStale: boolean;
  /** Main photos of the required-for-completeness stamps (#137), shown on the collapsed issue
   * row as a representative gallery of the issue. */
  photos: PhotoSummary[];
}

export interface PaginatedIssuesResult {
  items: IssueListItem[];
  nextCursor: string | null;
}

const ISSUE_LIST_SELECT = {
  id: true,
  collectionId: true,
  collectionAreaId: true,
  name: true,
  year: true,
  isAutoCreated: true,
  createdAt: true,
  catalogNumbers: { select: { catalogVendorId: true, firstNumber: true, lastNumber: true } },
  members: {
    select: {
      requiredForCompleteness: true,
      stamp: {
        select: {
          catalogPrices: {
            select: {
              price: true,
              currency: true,
              conditionId: true,
              certificateStatusId: true,
              catalogEdition: { select: { year: true, catalogNameId: true } },
            },
          },
          // Only the main photo represents the stamp on the issue-level gallery (#137).
          photos: { where: { role: "main" }, select: PHOTO_SUMMARY_SELECT },
        },
      },
    },
  },
} as const;

/**
 * Sum of required members' main catalog prices for one display condition
 * (certificate = none). Members priced only on an older edition are handled the
 * same way as the list total: if any member is priced on the current edition the
 * total uses only those, otherwise it falls back to older-edition prices.
 * `convertedAmount` is left null for the caller to fill after fetching rates.
 */
function computeRequiredPriceTotal(
  requiredMembers: { stamp: { catalogPrices: RawCatalogPrice[] } }[],
  primaryNameId: string | null,
  baseCurrency: string,
  latestYearByName: Map<string, number>,
  displayConditionId: string | null
): IssuePriceTotal | null {
  let sumCurrent = 0;
  let currentCount = 0;
  let sumOlder = 0;
  let olderCount = 0;
  let currency: string | null = null;
  for (const m of requiredMembers) {
    const main = pickMainCatalogPrice(m.stamp.catalogPrices, primaryNameId, displayConditionId);
    if (!main) continue;
    currency = main.currency;
    const isOlder = (latestYearByName.get(main.catalogNameId) ?? main.editionYear) > main.editionYear;
    if (isOlder) {
      sumOlder += main.amount;
      olderCount += 1;
    } else {
      sumCurrent += main.amount;
      currentCount += 1;
    }
  }

  if (currency && currentCount > 0) {
    return {
      amount: sumCurrent.toFixed(2),
      currency,
      convertedAmount: null,
      baseCurrency,
      pricedCount: currentCount,
      requiredCount: requiredMembers.length,
      usesOlderEdition: false,
      olderEditionExcludedCount: olderCount,
    };
  }
  if (currency && olderCount > 0) {
    return {
      amount: sumOlder.toFixed(2),
      currency,
      convertedAmount: null,
      baseCurrency,
      pricedCount: olderCount,
      requiredCount: requiredMembers.length,
      usesOlderEdition: true,
      olderEditionExcludedCount: 0,
    };
  }
  return null;
}

function toIssueListItem(
  issue: {
    id: string;
    collectionId: string;
    collectionAreaId: string;
    name: string | null;
    year: number | null;
    isAutoCreated: boolean;
    createdAt: Date;
    catalogNumbers: { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[];
    members: {
      requiredForCompleteness: boolean;
      stamp: {
        catalogPrices: RawCatalogPrice[];
        photos: { id: string; role: string | null; title: string | null; sortOrder: number }[];
      };
    }[];
  },
  primaryCatalogByArea: Map<string, string | null>,
  baseCurrency: string,
  latestYearByName: Map<string, number>,
  displayConditionId: string | null
): IssueListItem {
  const requiredMembers = issue.members.filter((m) => m.requiredForCompleteness);
  const primaryNameId = primaryCatalogByArea.get(issue.collectionAreaId) ?? null;
  // One representative main photo per required stamp (already filtered to role="main").
  const photos = toPhotoSummaries(requiredMembers.flatMap((m) => m.stamp.photos));

  // convertedAmount filled after rates are fetched (see buildIssueListItems).
  const requiredPriceTotal = computeRequiredPriceTotal(
    requiredMembers,
    primaryNameId,
    baseCurrency,
    latestYearByName,
    displayConditionId
  );

  return {
    id: issue.id,
    collectionId: issue.collectionId,
    collectionAreaId: issue.collectionAreaId,
    name: issue.name,
    year: issue.year,
    isAutoCreated: issue.isAutoCreated,
    createdAt: issue.createdAt.toISOString(),
    catalogNumbers: issue.catalogNumbers,
    memberCount: issue.members.length,
    requiredCount: requiredMembers.length,
    requiredPriceTotal,
    requiredPriceStale: requiredPriceTotal?.usesOlderEdition ?? false,
    photos,
  };
}

/** Map issues to list items and attach base-currency conversions in one batched rate fetch. */
async function buildIssueListItems(
  issues: Parameters<typeof toIssueListItem>[0][],
  collectionId: string,
  primaryCatalogByArea: Map<string, string | null>,
  baseCurrency: string,
  displayConditionId: string | null
): Promise<IssueListItem[]> {
  const latestYearByName = await getLatestEditionYearByName(collectionId);
  const items = issues.map((i) =>
    toIssueListItem(i, primaryCatalogByArea, baseCurrency, latestYearByName, displayConditionId)
  );
  const currencies = items
    .map((i) => i.requiredPriceTotal?.currency)
    .filter((c): c is string => !!c);
  const rates = await safeRateMap(collectionId, baseCurrency, currencies);
  for (const it of items) {
    const t = it.requiredPriceTotal;
    if (t) {
      t.convertedAmount = applyConversion(Number(t.amount), t.currency, baseCurrency, rates);
    }
  }
  return items;
}

function parseNumericCatalog(val: string | null | undefined): number {
  if (!val) return Number.MAX_SAFE_INTEGER;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

export interface IssueListFilterOpts {
  areaIds?: string[];
  offset?: number;
  pageSize?: number;
  search?: string;
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
    conditions.push({
      OR: [
        { name: { contains: s, mode: "insensitive" } },
        { members: { some: { stamp: { name: { contains: s, mode: "insensitive" } } } } },
        { catalogNumbers: { some: { firstNumber: { contains: s, mode: "insensitive" } } } },
        { catalogNumbers: { some: { lastNumber: { contains: s, mode: "insensitive" } } } },
        { members: { some: { stamp: { catalogNumbers: { some: { number: { contains: s, mode: "insensitive" } } } } } } },
      ],
    });
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
  const [primaryCatalogByArea, baseCurrency, displayConditionId] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    getCollectionBaseCurrency(collectionId),
    resolveDisplayConditionId(collectionId, opts.displayConditionId),
  ]);

  const where = buildIssueListWhere(collectionId, opts);

  if (opts.sortBy === "catalogNumber") {
    const allIds = await prisma.issue.findMany({
      where,
      select: {
        id: true,
        catalogNumbers: { select: { firstNumber: true } },
      },
    });
    allIds.sort((a, b) => {
      const aNum = parseNumericCatalog(a.catalogNumbers[0]?.firstNumber);
      const bNum = parseNumericCatalog(b.catalogNumbers[0]?.firstNumber);
      const cmp = aNum - bNum;
      return dir === "desc" ? -cmp : cmp;
    });
    const pageIds = allIds.slice(offset, offset + pageSize + 1).map((r) => r.id);
    const hasMore = pageIds.length > pageSize;
    const finalIds = hasMore ? pageIds.slice(0, pageSize) : pageIds;

    const issues = await prisma.issue.findMany({
      where: { id: { in: finalIds } },
      select: ISSUE_LIST_SELECT,
    });
    const idOrder = new Map(finalIds.map((id, i) => [id, i]));
    issues.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

    const items = await buildIssueListItems(issues, collectionId, primaryCatalogByArea, baseCurrency, displayConditionId);
    const nextCursor = hasMore ? String(offset + pageSize) : null;
    return { items, nextCursor };
  }

  const orderBy =
    opts.sortBy === "name"
      ? [{ name: dir }, { id: "asc" as const }]
      : opts.sortBy === "year"
        ? [{ year: dir }, { name: "asc" as const }, { id: "asc" as const }]
        : [{ year: dir }, { name: "asc" as const }, { createdAt: "asc" as const }];

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
    displayConditionId
  );
  const nextCursor = hasMore ? String(offset + pageSize) : null;

  return { items, nextCursor };
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
  issueId: string
): Promise<StampNodeData[]> {
  const { collectionId: issueCollection, collectionAreaId } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);
  const members = await prisma.issueMember.findMany({
    where: { issueId },
    select: MEMBER_SELECT,
  });

  const [primaryCatalogByArea, baseCurrency, latestYearByName, displayConditionId] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    getCollectionBaseCurrency(collectionId),
    getLatestEditionYearByName(collectionId),
    resolveDisplayConditionId(collectionId, undefined),
  ]);
  const primaryNameId = primaryCatalogByArea.get(collectionAreaId) ?? null;

  const nodes = members.map((m) =>
    toStampNode(m, { primaryNameId, baseCurrency, latestYearByName, displayConditionId })
  );
  const currencies = nodes
    .map((n) => n.mainCatalogPrice?.currency)
    .filter((c): c is string => !!c);
  const rates = await safeRateMap(collectionId, baseCurrency, currencies);
  for (const n of nodes) {
    const mp = n.mainCatalogPrice;
    if (mp) mp.convertedAmount = applyConversion(Number(mp.amount), mp.currency, baseCurrency, rates);
  }
  return nodes;
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

export interface IssuePriceDetails {
  baseCurrency: string;
  requiredCount: number;
  /** Per (condition × certificate) average of the complete catalogs' totals, always in the base currency. */
  averageCells: IssueAverageCell[];
  /** Per-catalog breakdown using only each catalog's newest (current) edition. */
  catalogsLatest: IssueCatalogGroup[];
  /** Per-catalog breakdown using each member's newest priced edition (older-edition fallback). */
  catalogsAll: IssueCatalogGroup[];
}

/**
 * An issue's required-stamps totals broken down per catalog and averaged across
 * catalogs, shaped for the price-details dialog. Two per-catalog breakdowns are
 * returned: `catalogsLatest` sums each member's price on the catalog's newest
 * (current) edition only; `catalogsAll` sums each member's newest priced edition
 * (older-edition fallback) — the dialog's latest/all toggle chooses between them.
 * Averages are always computed from the latest-edition totals (toggle-independent):
 * per (condition × certificate), the mean of the base-currency totals of catalogs
 * that price *all* required members in that variant; incomplete catalogs are always
 * reported so the gap is visible. Totals are broken down per certificate status
 * (plus "None"), mirroring the stamp matrix. See price-details dialog.
 */
export async function getIssuePriceDetails(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<IssuePriceDetails> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  const [members, conditions, certificateStatuses, baseCurrency, latestYearByName] =
    await Promise.all([
      prisma.issueMember.findMany({
        where: { issueId, requiredForCompleteness: true },
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

  return { baseCurrency, requiredCount, averageCells, catalogsLatest, catalogsAll };
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

export async function createIssue(
  ownerId: string,
  collectionId: string,
  areaId: string,
  data: {
    name?: string | null;
    year?: number | null;
    catalogNumbers?: { catalogVendorId: string; firstNumber: string; lastNumber?: string | null }[];
    autoCreateStamps?: AutoCreateStampsInput;
  }
): Promise<{ id: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  const area = await prisma.collectionArea.findUnique({
    where: { id: areaId },
    select: { collectionId: true },
  });
  if (!area || area.collectionId !== collectionId) {
    throw new Error("Collection area not found.");
  }

  if (data.autoCreateStamps) {
    const { count, vendors } = data.autoCreateStamps;
    if (count < 1) throw new Error("Range must include at least one stamp.");
    if (count > 50) throw new Error("Range cannot exceed 50 stamps.");
    if (vendors.length === 0) throw new Error("At least one catalog vendor must be selected.");
    if (vendors.some((v) => v.numbers.length !== count)) {
      throw new Error("Each vendor must supply one catalog number per stamp.");
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const issue = await tx.issue.create({
      data: {
        collectionId,
        collectionAreaId: areaId,
        name: data.name ?? null,
        year: data.year ?? null,
      },
      select: { id: true },
    });
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

    if (data.autoCreateStamps) {
      const { count, vendors } = data.autoCreateStamps;
      const stampIds: string[] = [];

      for (let n = 0; n < count; n++) {
        const stamp = await tx.stamp.create({
          data: {
            collectionId,
            issuedYear: data.year ?? null,
          },
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

      await tx.issueMember.createMany({
        data: stampIds.map((stampId) => ({
          issueId: issue.id,
          stampId,
          requiredForCompleteness: true,
        })),
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
    }

    return issue;
  });
  return { id: created.id };
}

export async function updateIssue(
  ownerId: string,
  collectionId: string,
  issueId: string,
  data: {
    name?: string | null;
    year?: number | null;
    catalogNumbers?: { catalogVendorId: string; firstNumber: string; lastNumber?: string | null }[];
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
  });
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
  requiredForCompleteness: boolean;
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
      },
      select: { id: true },
    });

    await tx.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId, isPrimary: true },
    });

    await tx.issueMember.create({
      data: {
        issueId,
        stampId: stamp.id,
        requiredForCompleteness: data.requiredForCompleteness,
      },
    });

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

  return result;
}

export async function toggleIssueMemberRequired(
  ownerId: string,
  collectionId: string,
  issueId: string,
  stampId: string,
  required: boolean
): Promise<void> {
  const { collectionId: issueCollection } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.issueMember.update({
    where: { issueId_stampId: { issueId, stampId } },
    data: { requiredForCompleteness: required },
  });
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
    select: { stampId: true, requiredForCompleteness: true, stamp: { select: { parentId: true } } },
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

  await prisma.$transaction(
    stampIds.map((sid) =>
      prisma.issueMember.update({
        where: { issueId_stampId: { issueId, stampId: sid } },
        data: { issueId: targetIssueId },
      })
    )
  );
}
