import "server-only";
import { prisma } from "./db";
import { groupIssuePrefixRows, type IssuePrefixMap, type IssuePrefixRow } from "./area-vendor";

// Per-issue overrides of the area-resolved catalog prefix (#377), loaded once per read.
//
// The prefix in front of a bare catalog number is normally resolved per (area, vendor) with tree
// inheritance (#66). An issue may override it for its own stamps — a special or commemorative
// sub-catalog that does not follow the area's numbering — and that override is the *whole* catalog
// identity, so it applies to the displayed label, to duplicate detection (#85) and to the Colnect
// strict full-key match (#155) alike.
//
// Every consumer loads the collection's whole override map in one query rather than resolving per
// row: the table is sparse by construction (only issues that set one have a row at all), and the
// alternative is a lookup per catalog number on screens that render hundreds.

/** One stored override, as the client surfaces receive it. Shaped in `area-vendor.ts` so the
 * client's own fetch can name it without reaching into a `server-only` module. */
export type IssueCatalogPrefixRow = IssuePrefixRow;

/**
 * Every per-issue prefix override in a collection, flat and owner-checked — what the client's
 * `useIssueCatalogPrefixes` fetches. Unpaginated on purpose: the table only holds rows for issues
 * that override something, so this is a handful even in a large collection, and every list screen
 * needs the whole map before it can render a single catalog chip.
 */
export async function getIssueCatalogPrefixes(
  ownerId: string,
  collectionId: string
): Promise<IssueCatalogPrefixRow[]> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  return prisma.issueCatalogPrefix.findMany({
    where: { issue: { collectionId } },
    select: { issueId: true, catalogVendorId: true, areaPrefix: true },
    orderBy: [{ issueId: "asc" }, { catalogVendorId: "asc" }],
  });
}

/** Every per-issue prefix override in a collection, as `issueId → (vendorId → prefix)`. */
export async function loadIssuePrefixMap(collectionId: string): Promise<IssuePrefixMap> {
  const rows = await prisma.issueCatalogPrefix.findMany({
    where: { issue: { collectionId } },
    select: { issueId: true, catalogVendorId: true, areaPrefix: true },
  });
  return groupIssuePrefixRows(rows);
}

/** The overrides of a single issue, as the `vendorId → prefix` map the resolvers take. Used where
 * only one issue is in play (the duplicate check's context issue), so the collection-wide load
 * would read rows nothing asks about. */
export async function loadIssuePrefixes(issueId: string): Promise<Map<string, string>> {
  const rows = await prisma.issueCatalogPrefix.findMany({
    where: { issueId },
    select: { catalogVendorId: true, areaPrefix: true },
  });
  return new Map(rows.map((r) => [r.catalogVendorId, r.areaPrefix]));
}

