// A page without stamps (#1429): the vocabulary, the bounds and the few rules of a free page — a
// title page, a section divider, a map or a page of notes, carrying pictures, headings and texts the
// collector places himself inside the album's frame.
//
// **Pure.** No Prisma, no React, no PDF library. The editor's fields, the server actions that store
// what they typed, the layout that places a free page and the unit tests all read this one list —
// `album-corrections.ts`'s shape, for a page rather than a block.
//
// ## The one place on this track where the collector places things himself
//
// Every other thing on an album page is placed by the layout and corrected by a **delta**, because a
// live page has no row and a position stored against it would move with the next stamp bought
// (ADR-0045 §3). A free page is different in kind: it is a row of its own, anchored to an entry like
// a note, and what is on it is placed at **millimetres from the sheet's top-left corner** — exactly,
// by dragging or by typing (#769's rule that every correction is reachable both ways). Nothing about a
// re-flow can move an element, because nothing about a re-flow moves the page it is on.
//
// ## Only the width is stored
//
// A text wraps to its width and is as tall as its lines; a picture keeps its own proportions and is as
// tall as its width makes it. A stored height would be a second figure that could disagree with the
// first, and the one that lost would be the one on paper.
//
// ## An invention, and it says so
//
// Like the free text block (#769), a free page has nothing in `~/Documents/AlbumEasy` to be measured
// against in the way the packing rules were: the collector asked for it on 2026-09-28 with a
// screenshot of his own title page — a coat of arms, *Wolne Miasto Gdańsk*, *Freie Stadt Danzig*,
// *1920 – 1939* inside the album's frame — and it is built as asked.

import type { AlbumRect, AlbumTextRole } from "./album-layout";

/** What an element on a free page is: a picture from the collection's library, or a run of text. */
export const ALBUM_FREE_ELEMENT_KINDS = ["picture", "text"] as const;
export type AlbumFreeElementKind = (typeof ALBUM_FREE_ELEMENT_KINDS)[number];

export function asAlbumFreeElementKind(raw: string): AlbumFreeElementKind | null {
  return (ALBUM_FREE_ELEMENT_KINDS as readonly string[]).includes(raw)
    ? (raw as AlbumFreeElementKind)
    : null;
}

/** How a text sits inside its own width. Centred is what every other text on an album page is, and
 *  what a new one starts as. */
export const ALBUM_FREE_TEXT_ALIGNS = [
  { key: "left", label: "Left" },
  { key: "center", label: "Centred" },
  { key: "right", label: "Right" },
] as const;
export type AlbumFreeTextAlign = (typeof ALBUM_FREE_TEXT_ALIGNS)[number]["key"];

export function asAlbumFreeTextAlign(raw: string): AlbumFreeTextAlign {
  return raw === "left" || raw === "right" ? raw : "center";
}

/**
 * The two kinds of text an editor offers, and what each starts as.
 *
 * One element kind underneath: a heading is a text set in a bigger face. The two buttons exist because
 * the collector thinks of *Wolne Miasto Gdańsk* and of a paragraph about it as different things, and a
 * new element should start looking like the thing he asked for. Both set in the template's own faces
 * (#766) — the chapter's face for a heading, the checklist heading's for a text — so a free page
 * matches the album's type with nothing to configure.
 */
export const ALBUM_FREE_TEXT_STARTS = {
  heading: { role: "chapter", label: "Add a heading" },
  text: { role: "heading", label: "Add a text" },
} as const satisfies Record<string, { role: AlbumTextRole; label: string }>;

/** Sanity rails for a position: an element may overhang the sheet — that is visible and fixable —
 *  but a figure a thousand millimetres off the paper is a typo, not a layout. */
export const ALBUM_FREE_POSITION_MIN_MM = -500;
export const ALBUM_FREE_POSITION_MAX_MM = 1000;
/** An element narrower than a millimetre cannot be picked up again; one wider than a metre is not on
 *  any page this app prints. */
export const ALBUM_FREE_WIDTH_MIN_MM = 1;
export const ALBUM_FREE_WIDTH_MAX_MM = 1000;
/** The template's own type bounds (`album-template-rules.ts`) stop at 96 pt, which is a heading; a
 *  title page's single word may want more. */
export const ALBUM_FREE_SIZE_MIN_PT = 4;
export const ALBUM_FREE_SIZE_MAX_PT = 200;

/**
 * The resolution below which a raster picture is flagged before printing (#1429).
 *
 * 300 dpi at the size it is placed — the figure the issue names, and the one a print shop would. It
 * is a flag rather than a refusal: the collector may have nothing sharper, and a slightly soft coat of
 * arms is still a coat of arms. Shown in the editor, never printed, for the reason the inherited-size
 * flag is (ADR-0047 §9).
 */
export const ALBUM_PICTURE_MIN_DPI = 300;

/** How many dots per inch a raster `widthPx` wide prints at when it is placed `widthMm` wide. */
export function albumPictureDpi(widthPx: number, widthMm: number): number {
  if (!(widthMm > 0)) return Infinity;
  return widthPx / (widthMm / 25.4);
}

/** Whether a picture placed at `widthMm` would print below {@link ALBUM_PICTURE_MIN_DPI}. A vector
 *  picture has no pixels and is never flagged. */
export function albumPictureTooCoarse(
  widthPx: number | null,
  widthMm: number
): boolean {
  if (widthPx === null) return false;
  return albumPictureDpi(widthPx, widthMm) < ALBUM_PICTURE_MIN_DPI;
}

/**
 * How tall a picture is for its width: its own proportions, height over width.
 *
 * A vector drawing's are its `viewBox`'s; a raster's are its pixels'. A picture whose proportions
 * cannot be read is drawn square rather than refused, so the page still opens and the element can
 * still be picked up and removed.
 */
export function albumPictureAspect(size: { width: number; height: number } | null): number {
  if (!size || !(size.width > 0) || !(size.height > 0)) return 1;
  return size.height / size.width;
}

/** Millimetres to a tenth, like every figure on this track. */
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Where an element `widthMm` × `heightMm` sits to be centred in `area` — **one action** in the editor
 * (#1429), horizontally or vertically.
 *
 * Centred in the sheet's **content area**, the rectangle between the margins and whatever running
 * head, chapter heading or footer the page prints — the same rectangle every other text on an album
 * page is centred in. On a template whose margins are equal that is the sheet's own centre.
 */
export function albumCentredXMm(area: AlbumRect, widthMm: number): number {
  return tenth(area.xMm + (area.widthMm - widthMm) / 2);
}

export function albumCentredYMm(area: AlbumRect, heightMm: number): number {
  return tenth(area.yMm + (area.heightMm - heightMm) / 2);
}

/**
 * One millimetre field of a free page's element, as the editor submits it.
 *
 * Either decimal separator, one decimal place — `parseAlbumCorrectionMm`'s reading — but **blank is
 * not zero**: a position is not a delta, and a cleared field is a mistake to report rather than a
 * correction taken back.
 */
export function parseAlbumFreeMm(
  raw: string,
  label: string,
  min: number,
  max: number
): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = raw.trim().replace(",", ".");
  if (!/^-?\d+(\.\d)?$/.test(trimmed)) {
    return {
      ok: false,
      message: `${label} must be a number of millimetres with at most one decimal place.`,
    };
  }
  const value = Number(trimmed);
  if (value < min || value > max) {
    return { ok: false, message: `${label} must be between ${min} and ${max} mm.` };
  }
  return { ok: true, value };
}

/** A type size in points, as typed. Whole or one decimal place, either separator. */
export function parseAlbumFreeSizePt(
  raw: string
): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d)?$/.test(trimmed)) {
    return { ok: false, message: "The size must be a number of points with at most one decimal place." };
  }
  const value = Number(trimmed);
  if (value < ALBUM_FREE_SIZE_MIN_PT || value > ALBUM_FREE_SIZE_MAX_PT) {
    return {
      ok: false,
      message: `The size must be between ${ALBUM_FREE_SIZE_MIN_PT} and ${ALBUM_FREE_SIZE_MAX_PT} pt.`,
    };
  }
  return { ok: true, value };
}
