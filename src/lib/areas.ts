import "server-only";
import { prisma } from "./db";
import { recomputeSortKeysForAreas } from "./catalog-sort-key-recompute";
import { normalizeLanguage } from "./languages";

/** The area plus every area nested under it, within a collection. Used to scope a catalog
 * sort-key recompute to a subtree when an area's effective primary catalog shifts (#181). */
async function areaSubtreeIds(collectionId: string, rootId: string): Promise<string[]> {
  const areas = await prisma.collectionArea.findMany({
    where: { collectionId },
    select: { id: true, parentId: true },
  });
  const childrenByParent = new Map<string | null, string[]>();
  for (const a of areas) {
    const list = childrenByParent.get(a.parentId) ?? [];
    list.push(a.id);
    childrenByParent.set(a.parentId, list);
  }
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    out.push(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return out;
}

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

async function resolveAreaCollection(areaId: string): Promise<string> {
  const area = await prisma.collectionArea.findUnique({
    where: { id: areaId },
    select: { collectionId: true },
  });
  if (!area) throw new Error("Collection area not found.");
  return area.collectionId;
}

async function assertEffectivePrimaryCatalog(
  primaryCatalogNameId: string | null | undefined,
  parentId: string | null | undefined
): Promise<void> {
  if (primaryCatalogNameId) return;
  let currentId = parentId ?? null;
  let depth = 0;
  while (currentId && depth < 50) {
    const ancestor = await prisma.collectionArea.findUnique({
      where: { id: currentId },
      select: { primaryCatalogNameId: true, parentId: true },
    });
    if (!ancestor) break;
    if (ancestor.primaryCatalogNameId) return;
    currentId = ancestor.parentId;
    depth++;
  }
  throw new Error(
    "A primary catalog is required. Set one on this area or on a parent area."
  );
}

export interface AreaCatalogEntry {
  catalogNameId: string;
  catalogVendorId: string;
  vendorName: string;
  catalogName: string;
  vendorAbbreviation: string;
  prefix: string | null;
}

export interface CollectionAreaData {
  id: string;
  name: string;
  parentId: string | null;
  description: string | null;
  primaryCatalogNameId: string | null;
  /** Optional name used for this area in auto-generated listing titles (#210); null when blank.
   * This is the **default-language** value; {@link titleNameByLanguage} overrides it per language. */
  titleName: string | null;
  /** Per-language overrides of {@link titleName} (#293), keyed by ISO 639-1 code. Only languages
   * with a stored, non-blank value appear. */
  titleNameByLanguage: Record<string, string>;
  /** Grouping-only areas (#263) organize children but can't receive Issues/stamps directly. */
  assignable: boolean;
  /** Custom sibling display order (#78); lower sorts first, ties break by name. */
  sortOrder: number;
  stampCount: number;
  childCount: number;
  catalogEntries: AreaCatalogEntry[];
}

export async function getCollectionAreas(
  ownerId: string,
  collectionId: string
): Promise<CollectionAreaData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const areas = await prisma.collectionArea.findMany({
    where: { collectionId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      parentId: true,
      description: true,
      primaryCatalogNameId: true,
      titleName: true,
      assignable: true,
      sortOrder: true,
      translations: { select: { language: true, titleName: true } },
      _count: { select: { stampAreaLinks: true, children: true } },
      collectionAreaCatalogs: {
        orderBy: [
          { catalogName: { vendor: { name: "asc" } } },
          { catalogName: { name: "asc" } },
        ],
        select: {
          catalogNameId: true,
          catalogName: {
            select: {
              name: true,
              vendorId: true,
              vendor: { select: { name: true, abbreviation: true } },
            },
          },
        },
      },
      collectionAreaVendors: {
        select: { catalogVendorId: true, areaPrefix: true },
      },
    },
  });
  return areas.map((a) => ({
    id: a.id,
    name: a.name,
    parentId: a.parentId,
    description: a.description,
    primaryCatalogNameId: a.primaryCatalogNameId,
    titleName: a.titleName,
    titleNameByLanguage: Object.fromEntries(
      a.translations
        .filter((t): t is { language: string; titleName: string } => !!t.titleName?.trim())
        .map((t) => [t.language, t.titleName])
    ),
    assignable: a.assignable,
    sortOrder: a.sortOrder,
    stampCount: a._count.stampAreaLinks,
    childCount: a._count.children,
    catalogEntries: (() => {
      const vendorPrefixMap = new Map(
        a.collectionAreaVendors.map((v) => [v.catalogVendorId, v.areaPrefix])
      );
      return a.collectionAreaCatalogs.map((c) => ({
        catalogNameId: c.catalogNameId,
        catalogVendorId: c.catalogName.vendorId,
        vendorName: c.catalogName.vendor.name,
        catalogName: c.catalogName.name,
        vendorAbbreviation: c.catalogName.vendor.abbreviation,
        prefix: vendorPrefixMap.get(c.catalogName.vendorId) ?? null,
      }));
    })(),
  }));
}

export async function createCollectionArea(
  ownerId: string,
  collectionId: string,
  data: {
    name: string;
    parentId?: string | null;
    description?: string | null;
    primaryCatalogNameId?: string | null;
    titleName?: string | null;
    /** Per-language `titleName` overrides (#293), keyed by ISO 639-1 code. A blank / null value
     * removes that language's row. Languages absent from the record are left untouched. */
    titleNameByLanguage?: Record<string, string | null>;
    assignable?: boolean;
  }
): Promise<{ id: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  if (data.parentId) {
    const parent = await prisma.collectionArea.findUnique({
      where: { id: data.parentId },
      select: { collectionId: true },
    });
    if (!parent || parent.collectionId !== collectionId) {
      throw new Error("Parent area not found.");
    }
  }
  // Grouping-only areas hold no material of their own, so they're exempt from the
  // primary-catalog requirement (#263) — a bare "Europe" node needs none. They may still
  // set one to pass down; assignable areas must have an effective primary as before (#69).
  const isAssignable = data.assignable ?? true;
  if (isAssignable) {
    await assertEffectivePrimaryCatalog(data.primaryCatalogNameId, data.parentId);
  }
  const created = await prisma.collectionArea.create({
    data: {
      collectionId,
      name: data.name,
      parentId: data.parentId ?? null,
      description: data.description ?? null,
      primaryCatalogNameId: data.primaryCatalogNameId ?? null,
      titleName: data.titleName ?? null,
      assignable: data.assignable ?? true,
      // Append to the end of the sibling group (#78).
      sortOrder: await nextSiblingSortOrder(collectionId, data.parentId ?? null),
    },
    select: { id: true },
  });
  await syncAreaTranslations(created.id, data.titleNameByLanguage);
  return { id: created.id };
}

/**
 * Write an area's per-language `titleName` rows (#293). A non-blank value upserts the row, a blank
 * or null one deletes it (so "cleared" and "never set" are one state — fall back to the default
 * `titleName`). Languages missing from `values` are left as they are, so a form that only renders
 * the languages currently in use never drops translations for a language that was removed from the
 * platform list and might come back.
 */
async function syncAreaTranslations(
  areaId: string,
  values: Record<string, string | null> | undefined
): Promise<void> {
  if (!values) return;
  for (const [rawLanguage, rawValue] of Object.entries(values)) {
    const language = normalizeLanguage(rawLanguage);
    if (!language) continue;
    const titleName = (rawValue ?? "").trim();
    if (titleName) {
      await prisma.collectionAreaTranslation.upsert({
        where: { collectionAreaId_language: { collectionAreaId: areaId, language } },
        create: { collectionAreaId: areaId, language, titleName },
        update: { titleName },
      });
    } else {
      await prisma.collectionAreaTranslation.deleteMany({
        where: { collectionAreaId: areaId, language },
      });
    }
  }
}

/** Next sortOrder for a new area appended to its sibling group (#78): max sibling + 1, else 0. */
async function nextSiblingSortOrder(
  collectionId: string,
  parentId: string | null
): Promise<number> {
  const last = await prisma.collectionArea.aggregate({
    where: { collectionId, parentId },
    _max: { sortOrder: true },
  });
  return last._max.sortOrder === null ? 0 : last._max.sortOrder + 1;
}

export async function updateCollectionArea(
  ownerId: string,
  areaId: string,
  data: {
    name: string;
    parentId?: string | null;
    description?: string | null;
    primaryCatalogNameId?: string | null;
    titleName?: string | null;
    /** Per-language `titleName` overrides (#293); see {@link createCollectionArea}. */
    titleNameByLanguage?: Record<string, string | null>;
    assignable?: boolean;
  }
): Promise<void> {
  const collectionId = await resolveAreaCollection(areaId);
  await assertCollectionOwner(ownerId, collectionId);

  const existing = await prisma.collectionArea.findUniqueOrThrow({
    where: { id: areaId },
    select: {
      parentId: true,
      assignable: true,
      primaryCatalogNameId: true,
      _count: { select: { issues: true, stampAreaLinks: true } },
    },
  });

  // Making an area grouping-only while Issues/stamps are directly assigned to it would
  // strand them (grouping-only areas can't hold material). Block it — move them first (#263).
  if (data.assignable === false) {
    const { issues, stampAreaLinks } = existing._count;
    if (issues > 0 || stampAreaLinks > 0) {
      throw new Error(
        "Cannot mark an area grouping-only while it has issues or stamps assigned to it. Move them first."
      );
    }
  }

  if (data.parentId) {
    const parent = await prisma.collectionArea.findUnique({
      where: { id: data.parentId },
      select: { collectionId: true },
    });
    if (!parent || parent.collectionId !== collectionId) {
      throw new Error("Parent area not found.");
    }
    let currentId: string | null = data.parentId;
    let depth = 0;
    while (currentId !== null && depth < 50) {
      if (currentId === areaId) {
        throw new Error("Cannot set an area as its own ancestor.");
      }
      const current: { parentId: string | null } | null =
        await prisma.collectionArea.findUnique({
          where: { id: currentId },
          select: { parentId: true },
        });
      currentId = current?.parentId ?? null;
      depth++;
    }
  }

  // Grouping-only areas are exempt from the primary-catalog requirement (#263); assignable
  // areas must still have an effective primary (#69). Use the post-update assignable value.
  const effectiveAssignable = data.assignable ?? existing.assignable;
  if (effectiveAssignable) {
    await assertEffectivePrimaryCatalog(data.primaryCatalogNameId, data.parentId);
  }

  // Moving to a different parent puts the area into a new sibling group, so append it to
  // the end there (#78). Staying under the same parent keeps its existing position.
  const nextParentId = data.parentId ?? null;
  const parentChanged = nextParentId !== existing.parentId;

  await prisma.collectionArea.update({
    where: { id: areaId },
    data: {
      name: data.name,
      parentId: nextParentId,
      description: data.description ?? null,
      primaryCatalogNameId: data.primaryCatalogNameId ?? null,
      titleName: data.titleName ?? null,
      ...(data.assignable !== undefined ? { assignable: data.assignable } : {}),
      ...(parentChanged
        ? { sortOrder: await nextSiblingSortOrder(collectionId, nextParentId) }
        : {}),
    },
  });

  await syncAreaTranslations(areaId, data.titleNameByLanguage);

  // Changing an area's own primary catalog or its parent shifts the *effective* primary catalog
  // (and thus the catalog sort key, #181) for this area and every descendant that inherits it.
  // Recompute the whole subtree — rare, so a bulk pass is fine.
  const primaryChanged = (data.primaryCatalogNameId ?? null) !== existing.primaryCatalogNameId;
  if (primaryChanged || parentChanged) {
    const subtree = await areaSubtreeIds(collectionId, areaId);
    await recomputeSortKeysForAreas(collectionId, subtree);
  }
}

export async function deleteCollectionArea(
  ownerId: string,
  areaId: string
): Promise<void> {
  const collectionId = await resolveAreaCollection(areaId);
  await assertCollectionOwner(ownerId, collectionId);

  const counts = await prisma.collectionArea.findUniqueOrThrow({
    where: { id: areaId },
    select: { _count: { select: { children: true, stampAreaLinks: true } } },
  });

  if (counts._count.children > 0) {
    throw new Error(
      "Cannot delete an area that has child areas. Move or delete them first."
    );
  }
  if (counts._count.stampAreaLinks > 0) {
    throw new Error(
      "Cannot delete an area that has assigned stamps. Unassign them first."
    );
  }

  await prisma.collectionArea.delete({ where: { id: areaId } });
}

/**
 * Persist a custom sibling order (#78). `orderedIds` is the full set of areas that share
 * `parentId`, in the desired top-to-bottom order; each is assigned `sortOrder = index`.
 * Reordering is sibling-scoped only — every id must belong to the collection and sit under
 * `parentId`, and the set must be complete, so a partial or cross-level list is rejected.
 */
export async function reorderCollectionAreas(
  ownerId: string,
  collectionId: string,
  parentId: string | null,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);

  const siblings = await prisma.collectionArea.findMany({
    where: { collectionId, parentId },
    select: { id: true },
  });
  const siblingIds = new Set(siblings.map((s) => s.id));

  if (
    orderedIds.length !== siblingIds.size ||
    new Set(orderedIds).size !== orderedIds.length ||
    orderedIds.some((id) => !siblingIds.has(id))
  ) {
    throw new Error("Reorder list must be the exact set of sibling areas.");
  }

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.collectionArea.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );
}

export async function syncAreaCatalogEntries(
  ownerId: string,
  areaId: string,
  entries: { catalogNameId: string; prefix: string | null }[]
): Promise<void> {
  const collectionId = await resolveAreaCollection(areaId);
  await assertCollectionOwner(ownerId, collectionId);

  const vendorPrefixes: Map<string, string | null> = new Map();

  if (entries.length > 0) {
    const ids = entries.map((e) => e.catalogNameId);
    const valid = await prisma.catalogName.findMany({
      where: { id: { in: ids }, vendor: { collectionId } },
      select: { id: true, vendorId: true },
    });
    const validIds = new Set(valid.map((v) => v.id));
    const invalid = ids.find((id) => !validIds.has(id));
    if (invalid) {
      throw new Error("Catalog name not found in this collection.");
    }

    // Derive vendor-level prefixes: non-null prefix wins; last entry for a vendor wins otherwise
    const vendorIdMap = new Map(valid.map((v) => [v.id, v.vendorId]));
    for (const e of entries) {
      const vendorId = vendorIdMap.get(e.catalogNameId)!;
      if (!vendorPrefixes.has(vendorId) || e.prefix !== null) {
        vendorPrefixes.set(vendorId, e.prefix);
      }
    }
  }

  await prisma.$transaction([
    prisma.collectionAreaCatalog.deleteMany({ where: { collectionAreaId: areaId } }),
    prisma.collectionAreaVendor.deleteMany({ where: { collectionAreaId: areaId } }),
    prisma.collectionAreaCatalog.createMany({
      data: entries.map((e) => ({
        collectionAreaId: areaId,
        catalogNameId: e.catalogNameId,
      })),
    }),
    prisma.collectionAreaVendor.createMany({
      data: Array.from(vendorPrefixes.entries()).map(([catalogVendorId, areaPrefix]) => ({
        collectionAreaId: areaId,
        catalogVendorId,
        areaPrefix,
      })),
    }),
  ]);
}
