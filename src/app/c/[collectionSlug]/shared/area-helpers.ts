import type { CollectionAreaData } from "@/lib/areas";

// The per-area catalog-vendor resolution now lives in `@/lib/area-vendor` so the server-side
// lot-intake reads (#172) can share it; re-exported here for existing importers.
export { effectiveVendorsForArea, effectivePrimaryVendorId } from "@/lib/area-vendor";

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
