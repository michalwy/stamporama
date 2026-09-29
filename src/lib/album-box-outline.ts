// A box's printed outline, as geometry (#1466).
//
// **Pure**, and the only place the outline is placed. The PDF (#768) and the canvas (#769) — the page
// editor and the Page template preview — both stroke what this returns, so the two cannot put the
// line in different places.
//
// ## The outline belongs to the box
//
// Decided with the collector on 2026-09-29: the line lies **inside** the box. Its outer edge is the
// box's size and its whole weight is taken from the inside, so a hawid cut to the box covers the line
// and none of it shows around the mount. Before #1466 the line was centred on the box's edge, half of
// it outside. Rejected: the line outside the box (the boxes would take more room, and the plan would
// move), and leaving it centred.
//
// A stroke is centred on its path, so the path is the box inset by half the weight. A weight heavier
// than the box can hold is capped at half the box's shorter side — the box is then solid ink, and
// still no larger than itself.
//
// ## Paint, not layout
//
// Box sizes, the plan and the hawid strips do not read this, and no template value changed — so a
// printed card does not report it as a divergence (#778).

import type { AlbumRect } from "./album-layout";
import type { AlbumRenderPreset } from "./album-template-rules";

export interface AlbumBoxOutline {
  /** The path the stroke is centred on: the box inset by half of {@link weightMm}. */
  rect: AlbumRect;
  weightMm: number;
}

/** Where a box's outline is stroked, or `null` when the template draws none. */
export function albumBoxOutline(
  preset: Pick<AlbumRenderPreset, "boxBorderStyle" | "boxBorderWidthMm">,
  box: AlbumRect
): AlbumBoxOutline | null {
  if (preset.boxBorderStyle === "none" || preset.boxBorderWidthMm <= 0) return null;
  const weightMm = Math.min(preset.boxBorderWidthMm, box.widthMm / 2, box.heightMm / 2);
  if (weightMm <= 0) return null;
  const inset = weightMm / 2;
  return {
    rect: {
      xMm: box.xMm + inset,
      yMm: box.yMm + inset,
      widthMm: box.widthMm - weightMm,
      heightMm: box.heightMm - weightMm,
    },
    weightMm,
  };
}
