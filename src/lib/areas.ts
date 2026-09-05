import "server-only";
import { prisma } from "./db";
import { recomputeSortKeysForAreas } from "./catalog-sort-key-recompute";
import {
  syncEntityTranslations,
  translationsByLanguage,
  type TranslationValueMap,
} from "./translations";

/** The area's translatable fields (#293). Kept beside the domain module so the action parsing the
 * submitted `<field>:<lang>` inputs and the form rendering them cannot drift apart. */
export const AREA_TRANSLATION_FIELDS = ["titleName"] as const;

/** The area plus every area nested under it, within a collection. Used to scope a catalog
 * sort-key recompute to a subtree when an area's effective primary catalog shifts (#181), and to
 * resolve the bulk-lot builder's one selected area into the set its pool reads over (#759) — where
 * the *root* is kept as well, because the lot is named after it. */
export async function areaSubtreeIds(collectionId: string, rootId: string): Promise<string[]> {
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

/** One catalog **vendor** effective on an area — what a stamp's number is labelled and identified
 * with. Since #675 a vendor may be recorded on an area with no book of its behind it (numbering and
 * pricing are separate declarations), so the book fields are nullable: recording Michel numbers in an
 * area you own no Michel volume for is an ordinary situation. */
/** A blank area prefix means "inherit", not "an empty prefix" — the issue dialog's own idiom
 * (#377). The area level is two-state: null passes the question to the parent. */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A vendor row's prefix, normalised to the column's three states (#675): null stays null (declared,
 * inherits), and anything else is trimmed — to `''` when it comes out blank, which is the stated
 * *no prefix*. Whitespace is never a prefix. */
function normalizeVendorPrefix(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.trim();
}

/** What one area says about a (vendor) prefix at its own level: its row where that row states
 * something, else its own area prefix, else nothing. The same precedence the tree walk applies at
 * each step ({@link resolveAreaVendorPrefix}). */
function resolveOwnPrefix(
  rowPrefix: string | null | undefined,
  catalogPrefix: string | null
): string | null {
  if (rowPrefix != null) return rowPrefix || null;
  if (catalogPrefix !== null) return catalogPrefix || null;
  return null;
}

/**
 * Which vendor leads numbering after this write (#675).
 *
 * The caller states it, because the dialog does. When it says nothing at all, the vendor follows the
 * primary catalog name's — which is what the column meant before the split, and keeps every other
 * write path (the demo seeder, tests, any area created without touching the dialog) leading its
 * numbering correctly instead of silently losing its sort keys.
 */
async function resolvePrimaryVendorId(data: {
  primaryCatalogNameId?: string | null;
  primaryCatalogVendorId?: string | null;
}): Promise<string | null> {
  if (data.primaryCatalogVendorId !== undefined) return data.primaryCatalogVendorId;
  if (!data.primaryCatalogNameId) return null;
  const name = await prisma.catalogName.findUnique({
    where: { id: data.primaryCatalogNameId },
    select: { vendorId: true },
  });
  return name?.vendorId ?? null;
}

export interface AreaCatalogEntry {
  catalogVendorId: string;
  vendorName: string;
  vendorAbbreviation: string;
  /** The resolved prefix for this (area, vendor) pair — see {@link resolveAreaVendorPrefix}. */
  prefix: string | null;
  /** The area's price book for this vendor, where it attaches one; null for a vendor recorded
   * without a book. An area attaching several of a vendor's books reports one of them here. */
  catalogNameId: string | null;
  catalogName: string | null;
}

/** One `CollectionAreaVendor` row exactly as the area declares it (#675) — the numbering vendors
 * this area's stamps carry numbers for. Distinct from {@link AreaCatalogEntry}, which is the
 * *resolved* answer for an area after the tree walk. */
export interface AreaVendorEntry {
  catalogVendorId: string;
  vendorName: string;
  vendorAbbreviation: string;
  /** The per-vendor exception to the area's own `catalogPrefix`, in three states: `''` is the
   * stated *no prefix for this vendor here*, which stops both the area's own prefix and any
   * ancestor's; null declares the vendor and lets the prefix inherit; anything else is that prefix.
   * The absence of a row entirely means the area does not record this vendor's numbers. */
  areaPrefix: string | null;
}

export interface CollectionAreaData {
  id: string;
  name: string;
  parentId: string | null;
  description: string | null;
  primaryCatalogNameId: string | null;
  /** The vendor that leads numbering here (#675) — the catalog sort key, the leading label and the
   * primary chip. Null when this area declares none and the question passes to its parent. */
  primaryCatalogVendorId: string | null;
  /** The area's own prefix for every vendor (#675); null when it says nothing at this level. */
  catalogPrefix: string | null;
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
  /** The **books** this area attaches, one entry per book. The area's price sources, and — until a
   * vendor row says otherwise — where its numbering vendors are read from. */
  catalogEntries: AreaCatalogEntry[];
  /** The `CollectionAreaVendor` rows this area declares (#675), verbatim. */
  vendorEntries: AreaVendorEntry[];
}

export async function getCollectionAreas(
  ownerId: string,
  collectionId: string
): Promise<CollectionAreaData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return readCollectionAreas(collectionId);
}

/**
 * {@link getCollectionAreas} without the ownership check, for server reads that have **already**
 * resolved the collection for the owner and only need the area tree to format catalog numbers
 * (`buildAreaVendorMaps`) — the auction lot's derived name (#353) is one. Split out rather than
 * threading an `ownerId` through modules that have no other use for one; the caller owns the check.
 */
export async function readCollectionAreas(
  collectionId: string
): Promise<CollectionAreaData[]> {
  const areas = await prisma.collectionArea.findMany({
    where: { collectionId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      parentId: true,
      description: true,
      primaryCatalogNameId: true,
      primaryCatalogVendorId: true,
      catalogPrefix: true,
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
        orderBy: [{ catalogVendor: { name: "asc" } }],
        select: {
          catalogVendorId: true,
          areaPrefix: true,
          catalogVendor: { select: { name: true, abbreviation: true } },
        },
      },
    },
  });
  return areas.map((a) => ({
    id: a.id,
    name: a.name,
    parentId: a.parentId,
    description: a.description,
    primaryCatalogNameId: a.primaryCatalogNameId,
    primaryCatalogVendorId: a.primaryCatalogVendorId,
    catalogPrefix: a.catalogPrefix,
    titleName: a.titleName,
    titleNameByLanguage: translationsByLanguage(a.translations, (t) => t.titleName),
    assignable: a.assignable,
    sortOrder: a.sortOrder,
    stampCount: a._count.stampAreaLinks,
    childCount: a._count.children,
    catalogEntries: (() => {
      // What *this* area says about the prefix, at the level it says it: its own vendor row where
      // that row states one, else its own `catalogPrefix` (#675). The tree walk that turns this into
      // an answer for a descendant is `resolveAreaVendorPrefix`.
      const vendorPrefixMap = new Map(
        a.collectionAreaVendors.map((v) => [v.catalogVendorId, v.areaPrefix])
      );
      return a.collectionAreaCatalogs.map((c) => ({
        catalogNameId: c.catalogNameId,
        catalogVendorId: c.catalogName.vendorId,
        vendorName: c.catalogName.vendor.name,
        catalogName: c.catalogName.name,
        vendorAbbreviation: c.catalogName.vendor.abbreviation,
        prefix: resolveOwnPrefix(vendorPrefixMap.get(c.catalogName.vendorId), a.catalogPrefix),
      }));
    })(),
    vendorEntries: a.collectionAreaVendors.map((v) => ({
      catalogVendorId: v.catalogVendorId,
      vendorName: v.catalogVendor.name,
      vendorAbbreviation: v.catalogVendor.abbreviation,
      areaPrefix: v.areaPrefix,
    })),
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
    /** The vendor that leads numbering here (#675). Omitted, it follows `primaryCatalogNameId`'s
     * vendor — see {@link resolvePrimaryVendorId}. */
    primaryCatalogVendorId?: string | null;
    /** The area's prefix for every vendor (#675); blank means "inherit" and stores null. */
    catalogPrefix?: string | null;
    titleName?: string | null;
    /** Per-language `titleName` overrides (#293), keyed by ISO 639-1 code then field key. A blank
     * / null value removes that language's row. Languages absent from the record are left
     * untouched. */
    translations?: TranslationValueMap;
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
      primaryCatalogVendorId: await resolvePrimaryVendorId(data),
      catalogPrefix: blankToNull(data.catalogPrefix),
      titleName: data.titleName ?? null,
      assignable: data.assignable ?? true,
      // Append to the end of the sibling group (#78).
      sortOrder: await nextSiblingSortOrder(collectionId, data.parentId ?? null),
    },
    select: { id: true },
  });
  await syncAreaTranslations(created.id, data.translations);
  return { id: created.id };
}

/**
 * Write an area's per-language `titleName` rows (#293). Blank / null deletes the row (so "cleared"
 * and "never set" are one state — fall back to the default `titleName`); languages missing from
 * `values` are left alone. The rules are shared with the other translatable entities (#294–#296) in
 * {@link syncEntityTranslations}; this supplies the area's own Prisma delegate.
 */
async function syncAreaTranslations(
  areaId: string,
  values: TranslationValueMap | undefined
): Promise<void> {
  await syncEntityTranslations(values, {
    upsert: async (language, fields) => {
      const titleName = fields.titleName ?? null;
      await prisma.collectionAreaTranslation.upsert({
        where: { collectionAreaId_language: { collectionAreaId: areaId, language } },
        create: { collectionAreaId: areaId, language, titleName },
        update: { titleName },
      });
    },
    remove: async (language) => {
      await prisma.collectionAreaTranslation.deleteMany({
        where: { collectionAreaId: areaId, language },
      });
    },
  });
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
    /** The vendor that leads numbering here (#675); see {@link createCollectionArea}. */
    primaryCatalogVendorId?: string | null;
    /** The area's prefix for every vendor (#675); blank means "inherit" and stores null. */
    catalogPrefix?: string | null;
    titleName?: string | null;
    /** Per-language `titleName` overrides (#293); see {@link createCollectionArea}. */
    translations?: TranslationValueMap;
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
      primaryCatalogVendorId: true,
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
  const nextPrimaryVendorId = await resolvePrimaryVendorId(data);

  await prisma.collectionArea.update({
    where: { id: areaId },
    data: {
      name: data.name,
      parentId: nextParentId,
      description: data.description ?? null,
      primaryCatalogNameId: data.primaryCatalogNameId ?? null,
      primaryCatalogVendorId: nextPrimaryVendorId,
      catalogPrefix: blankToNull(data.catalogPrefix),
      titleName: data.titleName ?? null,
      ...(data.assignable !== undefined ? { assignable: data.assignable } : {}),
      ...(parentChanged
        ? { sortOrder: await nextSiblingSortOrder(collectionId, nextParentId) }
        : {}),
    },
  });

  await syncAreaTranslations(areaId, data.translations);

  // Changing the area's own leading **vendor**, or its parent, shifts the effective leading vendor
  // — and thus the catalog sort key (#181) — for this area and every descendant that inherits it.
  // Recompute the whole subtree; rare, so a bulk pass is fine.
  //
  // The gate is the vendor and not the primary *book* (#675): the sort key is built from the primary
  // vendor's catalog number, so swapping which Michel volume prices the area moves nothing about how
  // its stamps sort, and a subtree recompute on that edit is work with no effect.
  const primaryVendorChanged = nextPrimaryVendorId !== existing.primaryCatalogVendorId;
  if (primaryVendorChanged || parentChanged) {
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

/**
 * The **price books** attached to an area (`CollectionAreaCatalog`). Replaces the list wholesale;
 * an empty list detaches every book, which is the area saying "inherit my parent's" (#675 —
 * `buildEffectiveAreaCatalogMap`).
 *
 * Split from {@link syncAreaVendors} by #675. One call used to write both tables, deriving the
 * vendor rows from the books with "non-null prefix wins, else last wins": two Michel volumes with
 * two prefix boxes stored one value and silently threw the other away, and a vendor could not exist
 * without a book at all.
 */
export async function syncAreaCatalogBooks(
  ownerId: string,
  areaId: string,
  catalogNameIds: readonly string[]
): Promise<void> {
  const collectionId = await resolveAreaCollection(areaId);
  await assertCollectionOwner(ownerId, collectionId);

  const ids = [...new Set(catalogNameIds)];
  if (ids.length > 0) {
    const valid = await prisma.catalogName.findMany({
      where: { id: { in: ids }, vendor: { collectionId } },
      select: { id: true },
    });
    if (valid.length !== ids.length) {
      throw new Error("Catalog name not found in this collection.");
    }
  }

  await prisma.$transaction([
    prisma.collectionAreaCatalog.deleteMany({ where: { collectionAreaId: areaId } }),
    prisma.collectionAreaCatalog.createMany({
      data: ids.map((catalogNameId) => ({ collectionAreaId: areaId, catalogNameId })),
    }),
  ]);
}

/** One numbering vendor as the area declares it (#675). */
export interface AreaVendorInput {
  catalogVendorId: string;
  /** The per-vendor exception to the area's `catalogPrefix`, in the column's three states (#675):
   * omit it (or pass null) for the ordinary tick, where the prefix inherits; pass `''` for the
   * stated *no prefix for this vendor here*, which stops the walk; pass text for that prefix. */
  areaPrefix?: string | null;
}

/**
 * The **numbering vendors** an area's stamps carry numbers for (`CollectionAreaVendor`). Replaces
 * the list wholesale, and is written explicitly rather than derived from the attached books (#675),
 * so a vendor may be recorded with no book of its behind it — recording Michel numbers in an area
 * you own no Michel volume for is an ordinary situation, and attaching a book used to be the only
 * way to obtain a vendor.
 */
export async function syncAreaVendors(
  ownerId: string,
  areaId: string,
  vendors: readonly AreaVendorInput[]
): Promise<void> {
  const collectionId = await resolveAreaCollection(areaId);
  await assertCollectionOwner(ownerId, collectionId);

  // Last mention of a vendor wins, so a caller repeating one cannot violate the primary key. The
  // lossy part of the old collapse was merging *different* prefixes of one vendor's several books;
  // there is one row per vendor on this list by construction.
  const byVendor = new Map<string, string | null>();
  for (const v of vendors) byVendor.set(v.catalogVendorId, normalizeVendorPrefix(v.areaPrefix));

  if (byVendor.size > 0) {
    const valid = await prisma.catalogVendor.findMany({
      where: { id: { in: [...byVendor.keys()] }, collectionId },
      select: { id: true },
    });
    if (valid.length !== byVendor.size) {
      throw new Error("Catalog vendor not found in this collection.");
    }
  }

  await prisma.$transaction([
    prisma.collectionAreaVendor.deleteMany({ where: { collectionAreaId: areaId } }),
    prisma.collectionAreaVendor.createMany({
      data: [...byVendor].map(([catalogVendorId, areaPrefix]) => ({
        collectionAreaId: areaId,
        catalogVendorId,
        areaPrefix,
      })),
    }),
  ]);
}
