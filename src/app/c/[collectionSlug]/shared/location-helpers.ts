import type { LocationData } from "@/lib/locations";

/** Ids of every descendant of `locationId` (children, grandchildren, …). */
export function getLocationDescendantIds(
  locations: LocationData[],
  locationId: string
): Set<string> {
  const result = new Set<string>();
  const queue = [locationId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const l of locations) {
      if (l.parentId === id) {
        result.add(l.id);
        queue.push(l.id);
      }
    }
  }
  return result;
}

/** Breadcrumb path (`Szafa 1 › Klaser A`) from the root location to `locationId`,
 * or null when unknown (mirrors {@link buildAreaPath}). */
export function buildLocationPath(
  locations: LocationData[],
  locationId: string | null
): string | null {
  if (!locationId) return null;
  const byId = new Map(locations.map((l) => [l.id, l]));
  const path: string[] = [];
  let current = byId.get(locationId);
  let depth = 0;
  while (current && depth < 50) {
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return path.length > 0 ? path.join(" › ") : null;
}

interface LocationTreeRow {
  location: LocationData;
  depth: number;
}

/** Depth-annotated, parent-before-children flattening for the management list. */
export function flattenLocationTree(locations: LocationData[]): LocationTreeRow[] {
  function collect(parentId: string | null, depth: number): LocationTreeRow[] {
    const rows: LocationTreeRow[] = [];
    const children = locations
      .filter((l) => l.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    for (const child of children) {
      rows.push({ location: child, depth });
      rows.push(...collect(child.id, depth + 1));
    }
    return rows;
  }
  return collect(null, 0);
}
