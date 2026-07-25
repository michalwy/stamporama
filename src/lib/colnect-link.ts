// Pure Colnect URL helpers (no Prisma, no server imports) so the UI can link out to a
// stamp's Colnect page and `test:unit` can cover the formatting.
//
// A stamp's Colnect Marketplace item-ID is stored on `Stamp.colnectId` (#247) — a plain
// external identifier, not a catalog number. Colnect's canonical stamp URL carries a
// slug after the ID (`/en/stamps/stamp/1133075-X-Poland`), but the ID alone resolves:
// Colnect redirects `/en/stamps/stamp/<ID>` to the full slug. We only store the ID, so
// the ID-only form is what we link to.

const COLNECT_STAMP_BASE = "https://colnect.com/en/stamps/stamp/";

/**
 * The Colnect page URL for a stored item-ID (#290), or null when the ID is missing or
 * blank — callers use the null to skip the link entirely.
 */
export function colnectStampUrl(colnectId: string | null | undefined): string | null {
  const id = colnectId?.trim();
  if (!id) return null;
  return `${COLNECT_STAMP_BASE}${encodeURIComponent(id)}`;
}
