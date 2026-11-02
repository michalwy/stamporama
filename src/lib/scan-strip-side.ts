// Which side the Card scans tiles show (#2350): fronts, or backs — for the whole section with one
// switch, and for one card with its own.
//
// Pure — no DOM, no React, no Prisma. The section reads it in render, the stored view state parses
// into it, and the unit tests call it.
//
// **The section switch sets every card.** It clears the cards' own choices, so after it every card
// shows the side it names; a card switched on its own afterwards differs from it until the section
// switch is used again. A card switched back to what the section shows is no longer an exception,
// so its choice is dropped rather than kept as a copy of the section's.
//
// **A tile with no back keeps its front**, marked *no back*: the grid keeps its shape, and the
// missing back is what the collector reads off it. The back is shown as its picture was cut — turned
// as the card's back was scanned (#1555) — which is how the tile's own dialog shows it too.

import type { TileSide } from "./scan-tile-view";

/** The side the section shows, and the cards that show the other, keyed by batch number. */
export interface StripSides {
  side: TileSide;
  cardSides: Record<string, TileSide>;
}

export function isTileSide(value: unknown): value is TileSide {
  return value === "front" || value === "back";
}

/** The side one card's tiles show. */
export function cardSide(sides: StripSides, batchNo: number): TileSide {
  return sides.cardSides[String(batchNo)] ?? sides.side;
}

/** The section switch: every card shows `side`, and no card is an exception any more. */
export function withSectionSide(side: TileSide): StripSides {
  return { side, cardSides: {} };
}

/** One card's switch: only that card's tiles turn. */
export function withCardSide(sides: StripSides, batchNo: number, side: TileSide): StripSides {
  const cardSides = { ...sides.cardSides };
  if (side === sides.side) delete cardSides[String(batchNo)];
  else cardSides[String(batchNo)] = side;
  return { side: sides.side, cardSides };
}

/** What a tile needs for this: its own pictures, and the copy's a consumed tile handed them to. */
export interface StripTilePictures {
  frontPhotoId: string | null;
  backPhotoId: string | null;
  item: { frontPhotoId: string | null; backPhotoId: string | null } | null;
}

/** The picture a tile's square shows on `side`. */
export interface StripPicture {
  photoId: string | null;
  /** The side the picture is — the front of a tile asked for its back and having none. */
  shown: TileSide;
  /** Asked for the back and showing the front, because there is no back. */
  noBack: boolean;
}

export function stripPicture(tile: StripTilePictures, side: TileSide): StripPicture {
  // The picture follows the photo row to whoever owns it now — a consumed tile's are its copy's.
  const front = tile.frontPhotoId ?? tile.item?.frontPhotoId ?? null;
  if (side === "front") return { photoId: front, shown: "front", noBack: false };
  const back = tile.backPhotoId ?? tile.item?.backPhotoId ?? null;
  if (back) return { photoId: back, shown: "back", noBack: false };
  return { photoId: front, shown: "front", noBack: true };
}
