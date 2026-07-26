import type { LocationData } from "@/lib/locations";

/** Re-export so the UI keeps importing the path builder from here; the derivation itself lives in
 * `@/lib/location-path` so server-side reads (the printable packing list, #330) share it. */
export { buildLocationPath } from "@/lib/location-path";

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
