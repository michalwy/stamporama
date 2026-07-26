import type { CollectionAreaData } from "./areas";

// Pure collection-area path resolution. Lives here (rather than beside the UI helpers) so the
// server reads that render areas without React — the printable packing list (#330) — share the one
// derivation the copy rows already use. No React / Prisma, so it runs on both sides.

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
