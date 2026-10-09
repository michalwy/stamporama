// Covering symbols on offer photos (#1665; ADR-0066) — the pure half: what a cover is, how one sent
// from the browser is cleaned, whether an offer needs covers at all, and what the walk and the ready
// gate count. No Prisma, so the unit suite, the server and the editor share one reading.
//
// A cover is kept with the **copy's photo** and applied only when an offer that needs covers renders
// that photo. Geometry is in fractions of the photo (0–1): a saved photo's bytes never change
// (#1006), so a fraction drawn today is true of every derivative for as long as the photo exists.

import type { CoverFingerprintRow } from "./offer-photo-fingerprint";

export const PHOTO_COVER_SHAPES = ["rect", "ellipse"] as const;
export type PhotoCoverShape = (typeof PHOTO_COVER_SHAPES)[number];

export const PHOTO_COVER_STYLES = ["pixelate", "blur", "bar"] as const;
export type PhotoCoverStyle = (typeof PHOTO_COVER_STYLES)[number];

/** What a newly drawn cover starts as when the platform says nothing usable. */
export const DEFAULT_PHOTO_COVER_STYLE: PhotoCoverStyle = "pixelate";

export const PHOTO_COVER_STYLE_LABELS: Record<PhotoCoverStyle, string> = {
  pixelate: "Pixelate",
  blur: "Blur",
  bar: "Solid bar",
};

/** The colour a bar is drawn in when nothing else says — what every bar was before #1702. */
export const DEFAULT_PHOTO_COVER_COLOR = "#000000";

/** The short palette a bar's colour is picked from (#1702); any other colour can be picked freely.
 *  Cream is the paper most stamps are printed on, so a bar in it reads as blank paper. */
export const PHOTO_COVER_PALETTE: readonly { color: string; label: string }[] = [
  { color: "#000000", label: "Black" },
  { color: "#ffffff", label: "White" },
  { color: "#808080", label: "Grey" },
  { color: "#f3ead3", label: "Stamp-paper cream" },
];

export const PHOTO_COVER_SHAPE_LABELS: Record<PhotoCoverShape, string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
};

/** The smallest side a cover may have, as a share of the photo. A click without a drag would
 *  otherwise store a cover nobody can see, let alone grab. */
export const MIN_COVER_SIZE = 0.005;

/** How many covers one photo may carry — a sanity bound on a request, not a product rule. */
export const MAX_COVERS_PER_PHOTO = 50;

export interface PhotoCover {
  shape: PhotoCoverShape;
  style: PhotoCoverStyle;
  /** A bar's fill, lowercase `#rrggbb` (#1702). Present on a bar once cleaned, absent on any other
   *  style; the editor may keep one on a pixelation so switching back to a bar restores it. */
  color?: string;
  /** Left edge, top edge, width and height, each a fraction of the photo's own size. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export class PhotoCoverValidationError extends Error {}

export function isPhotoCoverShape(value: unknown): value is PhotoCoverShape {
  return typeof value === "string" && (PHOTO_COVER_SHAPES as readonly string[]).includes(value);
}

export function isPhotoCoverStyle(value: unknown): value is PhotoCoverStyle {
  return typeof value === "string" && (PHOTO_COVER_STYLES as readonly string[]).includes(value);
}

/** A platform's stored default style, read forgivingly: anything unknown is the built-in default. */
export function normalizePhotoCoverStyle(value: string | null | undefined): PhotoCoverStyle {
  return isPhotoCoverStyle(value) ? value : DEFAULT_PHOTO_COVER_STYLE;
}

/** A colour as stored: lowercase `#rrggbb`, from that or the 3-digit shorthand; null for anything
 *  else. */
export function normalizeCoverColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

/** A platform's stored first-bar colour, read forgivingly: anything unusable is black. */
export function normalizePlatformCoverColor(value: string | null | undefined): string {
  return normalizeCoverColor(value) ?? DEFAULT_PHOTO_COVER_COLOR;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * The covers as they will be stored, from whatever the browser sent: shape and style must be known,
 * the box is clipped to the photo, a bar carries its colour and nothing else carries one (#1702), and
 * a cover left smaller than {@link MIN_COVER_SIZE} on either side
 * after clipping is refused rather than silently dropped — the collector drew it, so losing it
 * without a word would leave a symbol showing they believe is hidden.
 *
 * @throws {PhotoCoverValidationError} on anything that is not a list of usable covers.
 */
export function cleanPhotoCovers(input: unknown): PhotoCover[] {
  if (!Array.isArray(input)) throw new PhotoCoverValidationError("Covers must be a list.");
  if (input.length > MAX_COVERS_PER_PHOTO) {
    throw new PhotoCoverValidationError(`A photo can carry at most ${MAX_COVERS_PER_PHOTO} covers.`);
  }
  return input.map((raw, index) => {
    const cover = raw as Partial<Record<keyof PhotoCover, unknown>> | null;
    if (!cover || typeof cover !== "object") {
      throw new PhotoCoverValidationError(`Cover ${index + 1} is not a cover.`);
    }
    if (!isPhotoCoverShape(cover.shape)) {
      throw new PhotoCoverValidationError(`Cover ${index + 1} has an unknown shape.`);
    }
    if (!isPhotoCoverStyle(cover.style)) {
      throw new PhotoCoverValidationError(`Cover ${index + 1} has an unknown style.`);
    }
    const numbers = [cover.x, cover.y, cover.width, cover.height];
    if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new PhotoCoverValidationError(`Cover ${index + 1} has no usable position.`);
    }
    let color: string | undefined;
    if (cover.style === "bar") {
      // A bar sent without a colour — from a page opened before bars had one — is the black it
      // would have been drawn in then. One sent with a colour that is not one is refused.
      if (cover.color == null) color = DEFAULT_PHOTO_COVER_COLOR;
      else {
        const normalized = normalizeCoverColor(cover.color);
        if (!normalized) throw new PhotoCoverValidationError(`Cover ${index + 1} has an unusable colour.`);
        color = normalized;
      }
    }
    const [x, y, width, height] = numbers as number[];
    const left = clamp01(x);
    const top = clamp01(y);
    const right = clamp01(x + width);
    const bottom = clamp01(y + height);
    if (right - left < MIN_COVER_SIZE || bottom - top < MIN_COVER_SIZE) {
      throw new PhotoCoverValidationError(`Cover ${index + 1} is too small or outside the photo.`);
    }
    return {
      shape: cover.shape,
      style: cover.style,
      ...(color ? { color } : {}),
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  });
}

/** A stored cover row as the code reads it, or null when it names a shape or style this code does
 *  not know (the table's CHECKs make that unreachable). A bar without a usable colour is black. */
export function storedPhotoCover(row: {
  shape: string;
  style: string;
  color: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}): PhotoCover | null {
  if (!isPhotoCoverShape(row.shape) || !isPhotoCoverStyle(row.style)) return null;
  const { shape, style, x, y, width, height } = row;
  return style === "bar"
    ? { shape, style, color: normalizeCoverColor(row.color) ?? DEFAULT_PHOTO_COVER_COLOR, x, y, width, height }
    : { shape, style, x, y, width, height };
}

/**
 * Whether an offer's photos need covers: its own override when it has one, else its platform's flag,
 * read live (#1665). Null on the offer means *follow the platform*.
 */
export function offerNeedsCovers(offerOverride: boolean | null, platformCoverSymbols: boolean): boolean {
  return offerOverride ?? platformCoverSymbols;
}

/**
 * The covers part of an offer's photo fingerprint (#311): one row per source photo that carries
 * covers, sorted, each with its covers in their stored order. Empty — and therefore absent from the
 * hash — when the offer needs no covers or none of its photos has any, so neither the upgrade nor a
 * photo merely marked *nothing to cover* declares an image out of date that has not changed a pixel.
 * A bar's colour is named only when it is not black (#1702), so every bar drawn before bars had a
 * colour hashes as it did.
 */
export function coverFingerprintRows(
  needsCovers: boolean,
  coversByPhotoId: ReadonlyMap<string, readonly PhotoCover[]>
): (readonly [string, readonly CoverFingerprintRow[]])[] {
  if (!needsCovers) return [];
  return [...coversByPhotoId]
    .filter(([, covers]) => covers.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(
      ([photoId, covers]) =>
        [
          photoId,
          covers.map((c) =>
            c.style === "bar" && c.color && c.color !== DEFAULT_PHOTO_COVER_COLOR
              ? ([c.shape, c.style, c.x, c.y, c.width, c.height, c.color] as const)
              : ([c.shape, c.style, c.x, c.y, c.width, c.height] as const)
          ),
        ] as const
    );
}

/** One photo the walk can show: a copy's own photo, used by at least one image of the offer. */
export interface CoverWalkCandidate {
  photoId: string;
  itemId: string;
  checked: boolean;
}

/**
 * The copy photos an offer's images are actually rendered from, once each, in plan order — what the
 * walk goes through and what the ready gate counts (#1665). Built from the plan's tiles so a side the
 * offer does not photograph is never asked about, and a copy's extra attached on its own is. An
 * image uploaded straight to the offer is not a copy's photo and is left out.
 */
export function coverWalkPhotos(
  images: readonly {
    tiles: readonly { photoId: string; itemId: string | null; pairedPhotoId?: string | null }[];
  }[],
  checkedPhotoIds: ReadonlySet<string>,
  copyPhotoIds: ReadonlySet<string>
): CoverWalkCandidate[] {
  const seen = new Set<string>();
  const out: CoverWalkCandidate[] = [];
  const add = (photoId: string, itemId: string | null) => {
    if (!itemId || seen.has(photoId) || !copyPhotoIds.has(photoId)) return;
    seen.add(photoId);
    out.push({ photoId, itemId, checked: checkedPhotoIds.has(photoId) });
  };
  for (const image of images) {
    for (const tile of image.tiles) {
      add(tile.photoId, tile.itemId);
      if (tile.pairedPhotoId) add(tile.pairedPhotoId, tile.itemId);
    }
  }
  return out;
}

// ── Carrying covers to the next photo (#1703) ────────────────────────────────
//
// Listing a series, every stamp carries the same design, so the symbols sit in the same places on
// each. The walk proposes the covers last used on a side to the next unchecked photo of that side.
// A cover is already a share of the photo's width and height, so it lands on the same part of a
// stamp photographed at another size or resolution with no conversion.

/** The covers each side would pass on: what was last saved on a front, and on a back, in the walk. */
export interface CarriedCovers {
  front: readonly PhotoCover[];
  back: readonly PhotoCover[];
}

export const NO_CARRIED_COVERS: CarriedCovers = { front: [], back: [] };

/**
 * After a photo is saved: its covers become what its side passes on. A photo saved with none —
 * *nothing to cover* — passes nothing, so the next photo of that side starts empty. An extra (no
 * side) neither passes covers on nor changes what the sides pass.
 */
export function carryAfterSave(
  carried: CarriedCovers,
  side: "front" | "back" | null | undefined,
  covers: readonly PhotoCover[]
): CarriedCovers {
  if (side !== "front" && side !== "back") return carried;
  return { ...carried, [side]: covers.map((c) => ({ ...c })) };
}

/**
 * The covers proposed for a photo the walk arrives at, or null when none are: only to a photo not
 * yet checked — one already checked keeps what the collector decided — and only from its own side,
 * a back's from the previous back. An extra is never proposed anything.
 */
export function proposedCovers(
  carried: CarriedCovers,
  target: { side?: "front" | "back" | null; checked: boolean }
): PhotoCover[] | null {
  if (target.checked) return null;
  if (target.side !== "front" && target.side !== "back") return null;
  const covers = carried[target.side];
  return covers.length > 0 ? covers.map((c) => ({ ...c })) : null;
}
