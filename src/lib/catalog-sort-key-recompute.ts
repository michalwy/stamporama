import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { buildPrimaryVendorByAreaMap } from "./pricing";
import { computeCatalogSortKey } from "./catalog-sort-key";

// Maintenance of the denormalized `primaryCatalogSortKey` column on `issue` / `stamp` (#181;
// ADR-0014). Callers invoke these after a mutation that can change a row's catalog numbers or its
// area, and after an area's effective primary catalog changes. Recompute runs post-commit with the
// plain client (not inside the caller's transaction): the window where a key is briefly stale is a
// single-user, sub-second gap that the very next read closes, and it keeps callers free of
// transaction-client threading.

const CHUNK = 5000;

/** Write the computed keys in bulk with a single `UPDATE ... FROM (VALUES ...)` per chunk. */
async function applyKeys(
  table: "issue" | "stamp",
  pairs: { id: string; key: string | null }[]
): Promise<void> {
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    const values = Prisma.join(
      chunk.map((p) => Prisma.sql`(${p.id}, ${p.key}::text)`)
    );
    // The table name is a compile-time literal, never user input.
    const tbl = Prisma.raw(`"${table}"`);
    await prisma.$executeRaw`
      UPDATE ${tbl} AS t
      SET "primaryCatalogSortKey" = v.key
      FROM (VALUES ${values}) AS v(id, key)
      WHERE t.id = v.id
    `;
  }
}

/** Recompute the sort key for the given issues (or every issue in the collection when `issueIds`
 * is omitted). */
export async function recomputeIssueSortKeys(
  collectionId: string,
  issueIds?: string[]
): Promise<void> {
  if (issueIds && issueIds.length === 0) return;
  const primaryVendorByArea = await buildPrimaryVendorByAreaMap(collectionId);
  const issues = await prisma.issue.findMany({
    where: { collectionId, ...(issueIds ? { id: { in: issueIds } } : {}) },
    select: {
      id: true,
      collectionAreaId: true,
      catalogNumbers: { select: { catalogVendorId: true, firstNumber: true } },
    },
  });
  const pairs = issues.map((i) => ({
    id: i.id,
    key: computeCatalogSortKey(
      i.catalogNumbers.map((c) => ({ catalogVendorId: c.catalogVendorId, value: c.firstNumber })),
      primaryVendorByArea.get(i.collectionAreaId) ?? null
    ),
  }));
  await applyKeys("issue", pairs);
}

/** Recompute the sort key for the given stamps (or every stamp in the collection when `stampIds`
 * is omitted). A stamp's area comes from its primary area link (falling back to any link). */
export async function recomputeStampSortKeys(
  collectionId: string,
  stampIds?: string[]
): Promise<void> {
  if (stampIds && stampIds.length === 0) return;
  const primaryVendorByArea = await buildPrimaryVendorByAreaMap(collectionId);
  const stamps = await prisma.stamp.findMany({
    where: { collectionId, ...(stampIds ? { id: { in: stampIds } } : {}) },
    select: {
      id: true,
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      catalogNumbers: { select: { catalogVendorId: true, number: true } },
    },
  });
  const pairs = stamps.map((s) => {
    const link = s.stampAreaLinks.find((l) => l.isPrimary) ?? s.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    return {
      id: s.id,
      key: computeCatalogSortKey(
        s.catalogNumbers.map((c) => ({ catalogVendorId: c.catalogVendorId, value: c.number })),
        areaId ? (primaryVendorByArea.get(areaId) ?? null) : null
      ),
    };
  });
  await applyKeys("stamp", pairs);
}

/** Recompute every issue and stamp whose area is one of `areaIds` — used after an area's effective
 * primary catalog changes (set/clear primary catalog, or reparent, which shifts inheritance for the
 * subtree). Pass the whole affected subtree's area ids. */
export async function recomputeSortKeysForAreas(
  collectionId: string,
  areaIds: string[]
): Promise<void> {
  if (areaIds.length === 0) return;
  const [issues, stamps] = await Promise.all([
    prisma.issue.findMany({
      where: { collectionId, collectionAreaId: { in: areaIds } },
      select: { id: true },
    }),
    prisma.stamp.findMany({
      where: { collectionId, stampAreaLinks: { some: { collectionAreaId: { in: areaIds } } } },
      select: { id: true },
    }),
  ]);
  await recomputeIssueSortKeys(
    collectionId,
    issues.map((i) => i.id)
  );
  await recomputeStampSortKeys(
    collectionId,
    stamps.map((s) => s.id)
  );
}
