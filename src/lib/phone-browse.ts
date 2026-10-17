import "server-only";
import { prisma } from "./db";
import {
  getIssueListItem,
  listIssueMembers,
  listIssuesPaginated,
  listIssueYearFacets,
  type IssueListItem,
  type StampNodeData,
  type YearFacet,
} from "./issues";
import { makeCatalogLabeller } from "./collection-search";
import { readIncludeSpecialised } from "./specialised-checklists-preference";
import { phoneAreaAncestors, phoneAreaChildren, type PhoneBrowseAreaRow, type PhoneBrowseAreaSource } from "./phone-browse-view";

// Browsing on the phone (#2005, ADR-0072 §5): area → year → issue → stamp. **The desk's reads,
// nothing of its own**: the years are the Issues list's year facet, an area's issues are the Issues
// list's own page under its area and year filters, and an issue's stamps are the issue screen's
// member read — copies counted and wants summarised exactly as the desk's tree shows them.

/** An area's issues listed for one year, at most this many; past that the screen says the rest are at the desk. */
export const PHONE_BROWSE_ISSUE_LIMIT = 200;

/** The collection's area tree as browsing reads it, in the desk's order (`readCollectionAreas`'). */
async function readAreaTree(collectionId: string): Promise<PhoneBrowseAreaSource[]> {
  return prisma.collectionArea.findMany({
    where: { collectionId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, parentId: true },
  });
}

/** Each area's **own** issues, counted — the rows' roll-up is `phoneAreaChildren`'s. */
async function readOwnIssueCounts(collectionId: string): Promise<Map<string, number>> {
  const groups = await prisma.issue.groupBy({
    by: ["collectionAreaId"],
    where: { collectionId },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.collectionAreaId, g._count._all]));
}

export interface PhoneBrowseLevel {
  /** The area this level is, or null for the collection's top level. */
  area: PhoneBrowseAreaSource | null;
  /** The area's ancestors, outermost first. */
  ancestors: PhoneBrowseAreaSource[];
  /** Its sub-areas, each with the issues under it. */
  children: PhoneBrowseAreaRow[];
  /** The years of the area's **own** issues, oldest first, *No year* last — empty at the top level,
   *  where no issue is filed. */
  years: YearFacet[];
}

/**
 * One level of the area tree: the top level for `areaId === null`, else that area. Null when the
 * area is not this collection's.
 */
export async function getPhoneBrowseLevel(
  ownerId: string,
  collectionId: string,
  areaId: string | null
): Promise<PhoneBrowseLevel | null> {
  const [areas, ownCounts] = await Promise.all([
    readAreaTree(collectionId),
    readOwnIssueCounts(collectionId),
  ]);
  const area = areaId === null ? null : (areas.find((a) => a.id === areaId) ?? null);
  if (areaId !== null && !area) return null;
  const years =
    area && (ownCounts.get(area.id) ?? 0) > 0
      ? await listIssueYearFacets(ownerId, collectionId, { areaIds: [area.id] })
      : [];
  return {
    area,
    ancestors: area ? phoneAreaAncestors(areas, area.id) : [],
    children: phoneAreaChildren(areas, ownCounts, areaId),
    years,
  };
}

export interface PhoneBrowseIssues {
  area: PhoneBrowseAreaSource;
  issues: IssueListItem[];
  /** True when there were more than {@link PHONE_BROWSE_ISSUE_LIMIT}. */
  more: boolean;
}

/**
 * One area's issues of one year (`null` — those with none), the Issues list's own page under its
 * area and year filters and in its default order. Null when the area is not this collection's.
 */
export async function getPhoneBrowseIssues(
  ownerId: string,
  collectionId: string,
  areaId: string,
  year: number | null
): Promise<PhoneBrowseIssues | null> {
  const area = await prisma.collectionArea.findFirst({
    where: { id: areaId, collectionId },
    select: { id: true, name: true, parentId: true },
  });
  if (!area) return null;
  const page = await listIssuesPaginated(ownerId, collectionId, {
    areaIds: [areaId],
    year: year ?? "none",
    pageSize: PHONE_BROWSE_ISSUE_LIMIT,
    includeSpecialised: await readIncludeSpecialised(collectionId),
  });
  return { area, issues: page.items, more: page.nextCursor !== null };
}

export interface PhoneBrowseStamp extends StampNodeData {
  /** Every catalogue number, primary vendor's first, as the desk labels them. */
  catalogLabels: string[];
}

export interface PhoneBrowseIssue {
  issue: IssueListItem;
  areaName: string;
  stamps: PhoneBrowseStamp[];
}

/** One issue's stamps, as the issue screen reads them. Null when the issue is not this collection's. */
export async function getPhoneBrowseIssue(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<PhoneBrowseIssue | null> {
  const includeSpecialised = await readIncludeSpecialised(collectionId);
  const issue = await getIssueListItem(ownerId, collectionId, issueId, { includeSpecialised });
  if (!issue) return null;
  const [members, vendors, area] = await Promise.all([
    listIssueMembers(ownerId, collectionId, issueId, null, null, includeSpecialised),
    prisma.catalogVendor.findMany({
      where: { collectionId },
      select: { id: true, abbreviation: true },
    }),
    prisma.collectionArea.findUnique({
      where: { id: issue.collectionAreaId },
      select: { name: true },
    }),
  ]);
  const labeller = await makeCatalogLabeller(collectionId, vendors);
  return {
    issue,
    areaName: area?.name ?? "",
    stamps: members.map((m) => ({
      ...m,
      catalogLabels: labeller
        .labelFor(issue.collectionAreaId, issue.id, m.catalogNumbers)
        .map((cn) => cn.label),
    })),
  };
}
