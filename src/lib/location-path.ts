import type { LocationData } from "./locations";

// Pure storage-location path resolution. Lives here (rather than beside the UI helpers) so the
// server reads that render locations without React — the printable packing list (#330) — share the
// one derivation the copy rows already use. No React / Prisma, so it runs on both sides.

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
