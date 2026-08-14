/**
 * Which photo slots a scan tile needs, and which a copy has already taken (#567).
 *
 * `front` and `back` are **singleton roles per copy** (the partial unique on `(itemId, role)`), so
 * giving a copy a tile's images can only work if none of the roles the tile carries is already
 * occupied. That one rule has two readers — the write that refuses a bad assignment
 * (`assignTileToCopy`) and the list that offers candidates for it — and they were allowed to drift:
 * the list asked the weaker question *"has this copy any free slot"*, so a front-only tile was
 * offered copies that merely lacked a back, and picking one was refused. **A list that offers what
 * the write refuses is the defect.**
 *
 * So the rule lives here, once, and both sides read it. Pure and free of Prisma on purpose: the
 * client derives the roles of the tile in hand to ask for candidates, the server intersects them
 * with what a copy holds, and a `"use client"` module importing a `server-only` one is the thing
 * that cannot happen.
 */

/** The two singleton slots a tile can fill. `main` is a stamp's slot and extras have no role. */
export type TilePhotoRole = "front" | "back";

const TILE_PHOTO_ROLES: readonly TilePhotoRole[] = ["front", "back"];

function isTilePhotoRole(value: unknown): value is TilePhotoRole {
  return value === "front" || value === "back";
}

/**
 * Which of the two slots these photo rows fill.
 *
 * One function for both sides of the comparison, because they are the same question asked twice:
 * *which roles does this tile carry* and *which roles has this copy taken* are both "which of front
 * and back is present here". Extras (`role: null`) and a stamp's `main` are not slots a tile
 * competes for, so they are ignored.
 */
export function photoRolesPresent(
  photos: readonly { role: string | null }[]
): TilePhotoRole[] {
  return TILE_PHOTO_ROLES.filter((role) => photos.some((p) => p.role === role));
}

/**
 * The same answer for a tile as the client has it — `ScanTileData` carries its two crops as
 * resolved photo ids rather than as rows, so this adapts that shape instead of making the client
 * assemble fake rows. Derived from the tile rather than assumed, so a back-only tile (the
 * unpaired-back case) asks for exactly the slot it needs and no more.
 */
export function tilePhotoRoles(tile: {
  frontPhotoId: string | null;
  backPhotoId: string | null;
}): TilePhotoRole[] {
  return photoRolesPresent([
    { role: tile.frontPhotoId ? "front" : null },
    { role: tile.backPhotoId ? "back" : null },
  ]);
}

/**
 * Where the tile and the copy collide — empty means the assignment can go ahead.
 *
 * This is the whole rule. The write refuses on a non-empty result; the list asks for copies where it
 * would be empty. Neither restates it.
 */
export function conflictingPhotoRoles(
  tileRoles: readonly TilePhotoRole[],
  taken: readonly TilePhotoRole[]
): TilePhotoRole[] {
  return tileRoles.filter((role) => taken.includes(role));
}

/** Whether a copy could take a tile carrying `tileRoles` — the in-memory twin of the query
 * fragment, and the reason both can be tested against each other. */
export function canTakeTileRoles(
  tileRoles: readonly TilePhotoRole[],
  photos: readonly { role: string | null }[]
): boolean {
  return conflictingPhotoRoles(tileRoles, photoRolesPresent(photos)).length === 0;
}

/** Serialize for a query string, and parse back. One encoding for both directions, so the list's
 * request and the read's filter cannot disagree about what was asked for. */
export function formatTilePhotoRoles(roles: readonly TilePhotoRole[]): string {
  return roles.join(",");
}

export function parseTilePhotoRoles(raw: string | null | undefined): TilePhotoRole[] {
  if (!raw) return [];
  const parsed = raw.split(",").map((s) => s.trim()).filter(isTilePhotoRole);
  // Deduplicated: `front,front` asks for one thing, and a repeat would otherwise add a redundant
  // clause to the query for no reason.
  return TILE_PHOTO_ROLES.filter((role) => parsed.includes(role));
}

/** How a copy's free slots read on screen, given what it holds. */
export function describeFreeSlots(photos: readonly { role: string | null }[]): string {
  const taken = photoRolesPresent(photos);
  if (taken.length === 0) return "no photos";
  if (taken.length === 2) return "front + back";
  return taken[0] === "front" ? "front only" : "back only";
}
