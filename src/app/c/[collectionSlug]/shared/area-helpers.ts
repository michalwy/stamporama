import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";

export function getDescendantIds(
  areas: CollectionAreaData[],
  areaId: string
): Set<string> {
  const result = new Set<string>();
  const queue = [areaId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const a of areas) {
      if (a.parentId === id) {
        result.add(a.id);
        queue.push(a.id);
      }
    }
  }
  return result;
}

/** Breadcrumb path (`A › B › C`) from the root area to `areaId`, or null. */
export function buildAreaPath(
  areas: CollectionAreaData[],
  areaId: string | null
): string | null {
  if (!areaId) return null;
  const byId = new Map(areas.map((a) => [a.id, a]));
  const path: string[] = [];
  let current = byId.get(areaId);
  let depth = 0;
  while (current && depth < 50) {
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return path.length > 0 ? path.join(" › ") : null;
}

export function effectiveVendorsForArea(
  areas: CollectionAreaData[],
  areaId: string
): AreaCatalogEntry[] {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const result = new Map<string, AreaCatalogEntry>();
  const ancestors: CollectionAreaData[] = [];
  let current = byId.get(areaId);
  let depth = 0;
  while (current && depth < 50) {
    ancestors.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  for (const a of ancestors.reverse()) {
    for (const e of a.catalogEntries) {
      result.set(e.catalogVendorId, e);
    }
  }
  return Array.from(result.values());
}

export function effectivePrimaryVendorId(
  areas: CollectionAreaData[],
  areaId: string
): string | null {
  const byId = new Map(areas.map((a) => [a.id, a]));
  let current = byId.get(areaId);
  let depth = 0;
  while (current && depth < 50) {
    if (current.primaryCatalogNameId) {
      const entry = effectiveVendorsForArea(areas, areaId).find(
        (e) => e.catalogNameId === current!.primaryCatalogNameId
      );
      return entry?.catalogVendorId ?? null;
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return null;
}

export interface AreaTreeItem {
  area: CollectionAreaData;
  depth: number;
  /** True when this node is the last among its siblings. */
  isLast: boolean;
  /**
   * Per ancestor level (index 0 = top level), whether that ancestor has a
   * following sibling — i.e. whether a vertical guide rail should continue
   * through this node's row at that level.
   */
  ancestorHasNextSibling: boolean[];
}

export function flattenAreaTree(areas: CollectionAreaData[]): AreaTreeItem[] {
  function collect(
    parentId: string | null,
    depth: number,
    ancestorHasNextSibling: boolean[]
  ): AreaTreeItem[] {
    const nodes: AreaTreeItem[] = [];
    const siblings = areas.filter((x) => x.parentId === parentId);
    siblings.forEach((a, i) => {
      const isLast = i === siblings.length - 1;
      nodes.push({ area: a, depth, isLast, ancestorHasNextSibling });
      nodes.push(
        ...collect(a.id, depth + 1, [...ancestorHasNextSibling, !isLast])
      );
    });
    return nodes;
  }
  return collect(null, 0, []);
}
