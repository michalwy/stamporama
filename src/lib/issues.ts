import "server-only";
import { prisma } from "./db";
import { getStampConditions } from "./conditions";
import {
  type IssuePriceTotal,
  type MoneyDisplay,
  type RawCatalogPrice,
  buildEffectivePrimaryCatalogMap,
  pickMainCatalogPrice,
  getLatestEditionYearByName,
  safeRateMap,
  applyConversion,
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
      stamp: { catalogPrices: RawCatalogPrice[] };
    }[];
  },
  primaryCatalogByArea: Map<string, string | null>,
  baseCurrency: string,
  latestYearByName: Map<string, number>,
  displayConditionId: string | null
): IssueListItem {
  const requiredMembers = issue.members.filter((m) => m.requiredForCompleteness);
  const primaryNameId = primaryCatalogByArea.get(issue.collectionAreaId) ?? null;

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
  sortBy?: IssueSortBy;
  sortDir?: "asc" | "desc";
  /** Condition whose price fills the list price column / issue totals. When
   *  omitted, defaults to the collection's first condition by sortOrder. */
  displayConditionId?: string | null;
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

  if (opts.catalogVendorId && opts.catalogNumber) {
    conditions.push({
      OR: [
        { catalogNumbers: { some: { catalogVendorId: opts.catalogVendorId, firstNumber: opts.catalogNumber } } },
        { catalogNumbers: { some: { catalogVendorId: opts.catalogVendorId, lastNumber: opts.catalogNumber } } },
        { members: { some: { stamp: { catalogNumbers: { some: { catalogVendorId: opts.catalogVendorId, number: opts.catalogNumber } } } } } },
      ],
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    collectionId,
    ...(conditions.length === 1 ? conditions[0] : conditions.length > 1 ? { AND: conditions } : {}),
  };

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

export interface IssueConditionTotal {
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  total: IssuePriceTotal | null;
}

/**
 * The issue's required-stamps total computed for every condition (certificate =
 * none), so the issue row's popover can show its value across conditions without
 * changing the list's selected condition. See #95.
 */
export async function getIssuePriceTotalsByCondition(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<IssueConditionTotal[]> {
  const { collectionId: issueCollection, collectionAreaId } = await resolveIssueArea(issueId);
  if (issueCollection !== collectionId) throw new Error("Issue not found.");
  await assertCollectionOwner(ownerId, collectionId);

  const [members, conditions, primaryCatalogByArea, baseCurrency, latestYearByName] =
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
                  catalogEdition: { select: { year: true, catalogNameId: true } },
                },
              },
            },
          },
        },
      }),
      getStampConditions(ownerId, collectionId),
      buildEffectivePrimaryCatalogMap(collectionId),
      getCollectionBaseCurrency(collectionId),
      getLatestEditionYearByName(collectionId),
    ]);

  const primaryNameId = primaryCatalogByArea.get(collectionAreaId) ?? null;

  const totals = conditions.map((c) => ({
    conditionId: c.id,
    conditionName: c.name,
    conditionAbbreviation: c.abbreviation,
    total: computeRequiredPriceTotal(members, primaryNameId, baseCurrency, latestYearByName, c.id),
  }));

  const currencies = totals
    .map((t) => t.total?.currency)
    .filter((c): c is string => !!c);
  const rates = await safeRateMap(collectionId, baseCurrency, currencies);
  for (const t of totals) {
    if (t.total) {
      t.total.convertedAmount = applyConversion(
        Number(t.total.amount),
        t.total.currency,
        baseCurrency,
        rates
      );
    }
  }
  return totals;
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface AutoCreateVendorRange {
  catalogVendorId: string;
  rangeFrom: number;
}

export interface AutoCreateStampsInput {
  /** Number of stamps to create; every vendor's numbering spans this many positions. */
  count: number;
  /** Each selected vendor with the first catalog number of its own range. */
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
            number: String(v.rangeFrom + i),
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
    const stamp = await tx.stamp.create({
      data: {
        collectionId,
        name: data.name ?? null,
        issuedDay: data.issuedDay ?? null,
        issuedMonth: data.issuedMonth ?? null,
        issuedYear: data.issuedYear ?? null,
        parentId: data.parentStampId ?? null,
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
