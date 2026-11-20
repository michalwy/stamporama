// A scan seen before it is uploaded (#2599) — the pure half of the thumbnails in the *Fronts and
// backs* pairs list.
//
// Pure — no DOM, no React, no Prisma. The dialog is a client component and the unit tests read it.
//
// The list exists so the collector can check the pairs before anything goes up, and a file name says
// nothing about what is on the scan. So every front and back shows a small picture of itself, made in
// the browser from the chosen file. Two things are decided here: how small that picture is drawn, and
// how far a back is turned so it stands the way it will sit on the card.

import { turnoverBackTurn, type BackTurnover } from "./back-turnover";
import type { QuarterTurn } from "./tile-turn";

/** Longest edge of the picture made from a scan, in pixels. Large enough for the enlarged hover view
 * (20rem, twice that on a dense screen), small enough that forty of them never hold forty full-size
 * scans decoded in memory. */
export const SCAN_PREVIEW_EDGE = 640;

/** The size a scan of `width` × `height` is drawn at so its longest edge is at most `maxEdge`. Never
 * enlarged: a scan smaller than that keeps its own size. */
export function scanPreviewSize(
  width: number,
  height: number,
  maxEdge: number = SCAN_PREVIEW_EDGE
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * How far a scan's picture is turned in the pairs list: a front not at all, a back as the cut will
 * turn it (#1555) — so the back appears as it will sit beside its front on the card, and choosing
 * another way the backs were scanned turns them at once.
 */
export function scanPreviewTurn(side: "front" | "back", turnover: BackTurnover): QuarterTurn {
  return side === "back" ? turnoverBackTurn(turnover) : 0;
}
