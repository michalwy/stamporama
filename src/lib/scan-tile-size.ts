// How large the tiles on a card's strip are drawn (#1922).
//
// Pure — no DOM, no React, no Prisma — so the parse of a stored value is a unit test rather than a
// browser session.
//
// **Medium is the default, about twice the old square.** At 5.5 rem a tile was a picture to hover,
// never one to read: a face value and the difference between two close designs were only legible in
// the enlarged view, so identifying a card meant hovering every square of it. Small stays for a
// card of sixty pieces seen whole; Large is for small print. Each is a column *minimum* — the strip
// still wraps across the window and stretches its columns to fill the row, so nothing ever scrolls
// sideways at any size.
//
// Large stops below the thumb derivative's long edge (`THUMB_MAX_EDGE`, 320 px): past it the
// square would only be enlarging the same pixels, and the hover already shows the full image.

export type ScanTileSize = "small" | "medium" | "large";

export const SCAN_TILE_SIZES: readonly ScanTileSize[] = ["small", "medium", "large"];

export const DEFAULT_SCAN_TILE_SIZE: ScanTileSize = "medium";

/** Each size's column width, in rem. */
export const SCAN_TILE_WIDTH_REM: Record<ScanTileSize, number> = {
  small: 5.5,
  medium: 11,
  large: 16,
};

export const SCAN_TILE_SIZE_LABEL: Record<ScanTileSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

/** A stored value back to a size — anything this browser cannot read as one is the default. */
export function parseScanTileSize(raw: string | null | undefined): ScanTileSize {
  return SCAN_TILE_SIZES.includes(raw as ScanTileSize) ? (raw as ScanTileSize) : DEFAULT_SCAN_TILE_SIZE;
}
