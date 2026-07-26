import type { CollectionAreaData } from "@/lib/areas";

// The per-area catalog-vendor resolution now lives in `@/lib/area-vendor` so the server-side
// lot-intake reads (#172) can share it; re-exported here for existing importers.
export { effectiveVendorsForArea, effectivePrimaryVendorId } from "@/lib/area-vendor";

/** Re-export so the UI keeps importing the path builder from here; the derivation itself lives in
 * `@/lib/area-path` so server-side reads (the printable packing list, #330) share it. */
export { buildAreaPath } from "@/lib/area-path";

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
