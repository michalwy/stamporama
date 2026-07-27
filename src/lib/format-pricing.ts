import "server-only";
import { prisma } from "./db";
import { getFormatFactorRows } from "./format-factors";
import { formatFactorKey, resolveFormatFactor } from "./format-factor";
import { getStampFormats, type StampFormatData } from "./stamp-formats";

// Resolving, for one stamp, the multiplier that applies to each (format, condition) pair.
//
// Resolution happens here rather than in the browser because it needs the stamp's *area ancestry*
// and its issue — facts the price grid has no reason to hold. What the grid gets back is a flat
// lookup it can multiply the single's price by as the collector types, so a derived value updates
// live instead of after a save.

// `formatFactorKey` lives in the pure `format-factor` module — the price grid is a client
// component and cannot import anything from here.
export { formatFactorKey };

export interface StampFormatPricing {
  formats: StampFormatData[];
  /** `formatId~conditionId` → multiplier. A missing entry means nothing derives there. */
  factors: Record<string, number>;
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
 * The stamp's area and every ancestor of it, nearest first — what an area-anchored factor is
 * matched against. Built from the **primary** area link, the same one the inventory list and the
 * catalog-sort key use, so a factor applies where the collector already sees the stamp filed.
 * Falls back to any link when none is marked primary.
 */
async function areaPathIds(collectionId: string, stampId: string): Promise<string[]> {
  const links = await prisma.stampCollectionArea.findMany({
    where: { stampId },
    select: { collectionAreaId: true, isPrimary: true },
  });
  if (links.length === 0) return [];
  const start = (links.find((l) => l.isPrimary) ?? links[0]).collectionAreaId;

  const areas = await prisma.collectionArea.findMany({
    where: { collectionId },
    select: { id: true, parentId: true },
  });
  const parentOf = new Map(areas.map((a) => [a.id, a.parentId]));

  const path: string[] = [];
  let current: string | null | undefined = start;
  // The tree is user-built and nothing at the database level forbids a cycle, so the walk is
  // bounded rather than trusting termination.
  for (let depth = 0; current && depth < 50; depth++) {
    if (path.includes(current)) break;
    path.push(current);
    current = parentOf.get(current) ?? null;
  }
  return path;
}

/**
 * Formats and the factor applying to each (format, condition) pair for one stamp. Returned whole
 * — a collection holds a handful of factor rows and a handful of formats, so resolving every
 * combination up front costs less than asking per cell.
 */
export async function getStampFormatPricing(
  ownerId: string,
  stampId: string
): Promise<StampFormatPricing> {
  const collectionId = await resolveStampCollection(stampId);
  const [formats, rows, areaPath, stamp] = await Promise.all([
    getStampFormats(ownerId, collectionId),
    getFormatFactorRows(collectionId),
    areaPathIds(collectionId, stampId),
    prisma.stamp.findUnique({
      where: { id: stampId },
      select: { issueMemberships: { select: { issueId: true }, take: 1 } },
    }),
  ]);
  // A stamp belongs to at most one issue in practice; an issue anchor matches that one.
  const issueId = stamp?.issueMemberships[0]?.issueId ?? null;

  const conditions = await prisma.stampCondition.findMany({
    where: { collectionId },
    select: { id: true },
  });

  const factors: Record<string, number> = {};
  for (const format of formats) {
    for (const condition of conditions) {
      const resolved = resolveFormatFactor(rows, {
        formatId: format.id,
        areaPath,
        issueId,
        conditionId: condition.id,
      });
      if (resolved) factors[formatFactorKey(format.id, condition.id)] = resolved.factor;
    }
  }
  return { formats, factors };
}

/**
 * Resolve the format multiplier for **many stamps at once** — what a list page needs (#343).
 *
 * `getStampFormatPricing` answers "every factor for one stamp"; a list asks the opposite question,
 * "one factor for every stamp on the page", and answering it per stamp would be a query per row.
 * The collection's factor rows and its area tree are both small and both loaded once here; the
 * returned function is pure and resolves in memory, memoising each area's ancestor path because a
 * page of an issue's members shares one area.
 *
 * Returns a function that is always null for the single (`formatId === null`) — nothing derives
 * there, the single's price *is* the recorded one.
 */
export async function makeFormatFactorResolver(
  collectionId: string,
  formatId: string | null,
  conditionId: string | null
): Promise<(areaId: string | null, issueId: string | null) => number | null> {
  if (!formatId) return () => null;
  const lookup = await makeFormatFactorLookup(collectionId);
  return (areaId, issueId) => lookup(formatId, areaId, issueId, conditionId);
}

/**
 * The same in-memory resolution, but with the format and condition supplied **per call** — what a
 * mixed set of copies needs (#343), where every row carries its own format and its own condition.
 * {@link makeFormatFactorResolver} is this bound to one (format, condition) pair.
 */
export async function makeFormatFactorLookup(
  collectionId: string
): Promise<
  (
    formatId: string | null,
    areaId: string | null,
    issueId: string | null,
    conditionId: string | null
  ) => number | null
> {
  const [rows, areas] = await Promise.all([
    getFormatFactorRows(collectionId),
    prisma.collectionArea.findMany({ where: { collectionId }, select: { id: true, parentId: true } }),
  ]);
  if (rows.length === 0) return () => null;

  const parentOf = new Map(areas.map((a) => [a.id, a.parentId]));
  const pathCache = new Map<string, string[]>();
  const pathFor = (areaId: string): string[] => {
    const cached = pathCache.get(areaId);
    if (cached) return cached;
    const path: string[] = [];
    let current: string | null | undefined = areaId;
    // Bounded rather than trusting termination: the tree is user-built and nothing at the database
    // level forbids a cycle (same guard as `areaPathIds`).
    for (let depth = 0; current && depth < 50; depth++) {
      if (path.includes(current)) break;
      path.push(current);
      current = parentOf.get(current) ?? null;
    }
    pathCache.set(areaId, path);
    return path;
  };

  return (formatId, areaId, issueId, conditionId) =>
    formatId
      ? (resolveFormatFactor(rows, {
          formatId,
          areaPath: areaId ? pathFor(areaId) : [],
          issueId,
          conditionId,
        })?.factor ?? null)
      : null;
}

/**
 * Formats alone, for an add-stamp dialog: with no stamp there is no area and no issue, so no
 * factor can be resolved. The grid still offers the format tabs — an explicit price may be typed
 * straight away, and the derived values appear once the stamp exists somewhere.
 */
export async function getCollectionFormatsForPricing(
  ownerId: string,
  collectionId: string
): Promise<StampFormatPricing> {
  return { formats: await getStampFormats(ownerId, collectionId), factors: {} };
}
