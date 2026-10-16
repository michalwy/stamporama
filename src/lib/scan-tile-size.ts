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

/**
 * What sits on a tile's frame at each size (#1971): the band above the picture, the condition mark
 * in it, the tick box and the state badge in its corners, and the number and handled tick under the
 * picture.
 *
 * **They scale with the tile.** #1922 made the squares larger and left these at the sizes that fit
 * the old 5.5 rem square, so at *Medium* and *Large* the marks were small print in big corners and
 * the box was hard to hit. *Small* is now the floor: its mark is set at a list row's condition chip
 * (`ROW_CHIP`, 0.75 rem), the smallest size a condition is read at anywhere else, and the larger
 * tiles step up from there without the marks outgrowing the band.
 *
 * **Nothing here covers more of the stamp.** Every mark sits on the frame — the band above the
 * picture and the label row below it — so the band grows with its marks rather than the marks
 * reaching over the scan (#628).
 */
export interface ScanTileChrome {
  /** The band above the picture, in rem — it clears the corner marks with their inset. */
  bandRem: number;
  /** The side of the tick box and of the state badge, in rem. */
  boxRem: number;
  /** How far the corner marks sit in from the frame, in rem. */
  insetRem: number;
  /** The mark chips' type size, in rem — never below a list row's condition chip. */
  markFontRem: number;
  /** The mark chips' padding. */
  markPadding: string;
  /** The tile number and the label row under the picture, in rem. */
  labelFontRem: number;
  /** The glyphs on the frame — the handled tick, the badge's glyph, the tick in the box. */
  icon: "sm" | "md";
}

export const SCAN_TILE_CHROME: Record<ScanTileSize, ScanTileChrome> = {
  small: {
    bandRem: 1.6,
    boxRem: 1.25,
    insetRem: 0.15,
    markFontRem: 0.75,
    markPadding: "0 0.3rem",
    labelFontRem: 0.75,
    icon: "sm",
  },
  medium: {
    bandRem: 1.9,
    boxRem: 1.5,
    insetRem: 0.2,
    markFontRem: 0.8125,
    markPadding: "0.05rem 0.35rem",
    labelFontRem: 0.8125,
    icon: "sm",
  },
  large: {
    bandRem: 2.2,
    boxRem: 1.75,
    insetRem: 0.225,
    markFontRem: 0.875,
    markPadding: "0.1rem 0.45rem",
    labelFontRem: 0.875,
    icon: "md",
  },
};
