// Pure storage-location path resolution. Lives here (rather than beside the UI helpers) so the
// server reads that render locations without React — the printable packing list (#330), the Copies
// list's filing groups (#421) — share the one derivation the copy rows already use. No React /
// Prisma, so it runs on both sides.

/** The three fields a path is built from. Stated structurally rather than as `LocationData` so a
 * server read can pass the columns it selected without inventing item counts (#421). */
export interface LocationPathNode {
  id: string;
  name: string;
  parentId: string | null;
}

/** Breadcrumb path (`Szafa 1 › Klaser A`) from the root location to `locationId`,
 * or null when unknown (mirrors {@link buildAreaPath}). */
export function buildLocationPath(
  locations: readonly LocationPathNode[],
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
