// The page frame, as geometry (#766, #1427): the rules and the four corner ornaments, placed.
//
// **Pure**, and the only place a frame is worked out. The PDF (#768) and the canvas (#769) both draw
// what this returns and neither computes a millimetre of it — the rule `album-layout.ts` states for
// the plan, applied to the paint around it. Before #1427 the two drew the double rule separately and
// disagreed: the PDF left 1.2 mm between the pair and the preview 1 mm. A preview that disagrees with
// the PDF is a confident wrong answer (#795), and a gap that became a template value is exactly where
// it would have kept happening.
//
// ## Paint, not layout
//
// Nothing here reads or moves the plan. The frame sits in the margin, and choosing or resizing one
// never changes which series lands on which sheet — so it re-plans nothing, and the only thing it can
// do to a printed card is make it look different, which the divergence report says (#778).
//
// ## Where the ornament sits, and where the rules stop
//
// Decided with the collector on 2026-09-28, against his AlbumEasy `Classic` frame, whose double line
// runs into forked tips at the end of the ornament's arms:
//
// - the ornament's point (0, 0) is laid on the corner of the frame's **centre line** — the rule itself
//   for a single rule, the middle of the pair for a double one, the inset for a frame of ornaments
//   alone;
// - it is scaled so the longer side of its frame (`viewBox`) is the ornament size;
// - it is drawn as uploaded at the top-left and **mirrored** at the other three, so it always faces
//   into the page;
// - the rules run **between** the ornaments and stop at the far edges of their frames.
//
// So the drawing carries its own alignment. A frame starting at `0 0` sits wholly inside the corner;
// one starting at negative numbers reaches out past the rule, the way `Classic`'s rosette does.
//
// ## The title in the frame line (#1428)
//
// When the album's title is set into the frame, the top rule — both rules of a double one — stops
// `titleFrameGapMm` short of the title on each side. The title is placed by the plan
// (`album-layout.ts`, which reads {@link albumTitleInFrame} and {@link albumFrameCentreMm} from here
// so the two cannot disagree about whether there is a line to sit in); the frame only leaves room
// around the rectangle it is handed. That rectangle is the one the sheet printed — a stored card's
// own — so a card reprinted later breaks its rule exactly where it did.

import type { AlbumRect } from "./album-layout";
import type { AlbumOrnamentDrawing } from "./album-ornament-svg";
import type { AlbumRenderPreset } from "./album-template-rules";

/** An affine map from an ornament's own coordinates to the sheet's millimetres, top-left origin:
 *  `x' = a·x + c·y + e`, `y' = b·x + d·y + f`, SVG's order. */
export type AlbumFrameMatrix = [number, number, number, number, number, number];

export type AlbumFrameCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface AlbumFrameLine {
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
}

export interface AlbumFramePoint {
  xMm: number;
  yMm: number;
}

export interface AlbumFrame {
  /** The weight every rule is drawn at. */
  lineMm: number;
  /** Closed rules — a frame without corner ornaments, drawn as rectangles so their corners join. */
  rects: AlbumRect[];
  /** Open rules that turn corners — a frame without ornaments whose top rule is broken around the
   *  title (#1428). Drawn as one stroke each with mitred joins, so the corners join as a rectangle's
   *  do, and butt ends at the gap. */
  paths: AlbumFramePoint[][];
  /** Open rules, between the ornaments. Drawn with butt ends: they stop where the drawing starts. */
  lines: AlbumFrameLine[];
  ornaments: { corner: AlbumFrameCorner; matrix: AlbumFrameMatrix }[];
}

/** The preset values a frame is made of, and nothing else — so a caller holding a stored card's
 *  preset and one holding a live album's pass the same thing. */
export type AlbumFramePreset = Pick<
  AlbumRenderPreset,
  | "pageWidthMm"
  | "pageHeightMm"
  | "borderStyle"
  | "borderWidthMm"
  | "borderInsetMm"
  | "borderGapMm"
  | "frameOrnamentSizeMm"
  | "titlePlacement"
  | "titleFrameGapMm"
>;

/** Whether the sheet has a rule the title can be set into (#1428): the preset asks for it, and there
 *  is a rule to break. Without one the title is placed below, as it always was — a page with no
 *  frame has nothing to break. Ornaments alone are not a line. */
export function albumTitleInFrame(
  preset: Pick<AlbumRenderPreset, "titlePlacement" | "borderStyle" | "borderWidthMm">
): boolean {
  return preset.titlePlacement === "in-frame" && preset.borderStyle !== "none" && preset.borderWidthMm > 0;
}

/** Where each rule's centre line runs, inset from the sheet's edge. */
function ruleInsets(preset: AlbumFramePreset): number[] {
  if (preset.borderStyle === "none" || preset.borderWidthMm <= 0) return [];
  const outer = preset.borderInsetMm;
  if (preset.borderStyle === "single") return [outer];
  // The gap is white between the two rules, edge to edge, so the centres are a weight and a gap
  // apart.
  return [outer, outer + preset.borderWidthMm + preset.borderGapMm];
}

/** The frame's centre line — where an ornament's (0, 0) is laid, and the line a title set into the
 *  frame is centred on (#1428). */
export function albumFrameCentreMm(
  preset: Pick<AlbumRenderPreset, "borderStyle" | "borderWidthMm" | "borderInsetMm" | "borderGapMm">
): number {
  if (preset.borderStyle === "double" && preset.borderWidthMm > 0) {
    return preset.borderInsetMm + (preset.borderWidthMm + preset.borderGapMm) / 2;
  }
  return preset.borderInsetMm;
}

/**
 * The frame a sheet prints: its rules, and an ornament at each corner when there is one.
 *
 * `ornament` is the drawing already resolved — the album's for a live sheet, the one the card
 * stored for a printed one — or null for a frame of rules alone. `title` is the title the sheet
 * printed, as the plan placed it; the top rule is broken around it only when the preset sets the
 * title into the frame (#1428).
 */
export function albumFrame(
  preset: AlbumFramePreset,
  ornament: AlbumOrnamentDrawing | null,
  title: AlbumRect | null = null
): AlbumFrame {
  const W = preset.pageWidthMm;
  const H = preset.pageHeightMm;
  const insets = ruleInsets(preset);
  const frame: AlbumFrame = { lineMm: preset.borderWidthMm, rects: [], paths: [], lines: [], ornaments: [] };

  // Where the top rule stops for the title, if it does.
  const gap =
    title && albumTitleInFrame(preset)
      ? {
          fromX: title.xMm - preset.titleFrameGapMm,
          toX: title.xMm + title.widthMm + preset.titleFrameGapMm,
        }
      : null;

  const size = preset.frameOrnamentSizeMm;
  if (!ornament || !(size > 0)) {
    for (const r of insets) {
      if (!gap) {
        frame.rects.push({ xMm: r, yMm: r, widthMm: W - 2 * r, heightMm: H - 2 * r });
        continue;
      }
      // One stroke round the sheet from the right of the gap to its left, so every corner is a
      // join. A gap wider than the rule takes the whole top edge and the stroke starts at a corner.
      const right = Math.min(Math.max(gap.toX, r), W - r);
      const left = Math.max(Math.min(gap.fromX, W - r), r);
      const points: AlbumFramePoint[] = [];
      if (right < W - r) points.push({ xMm: right, yMm: r });
      points.push({ xMm: W - r, yMm: r }, { xMm: W - r, yMm: H - r }, { xMm: r, yMm: H - r }, { xMm: r, yMm: r });
      if (left > r) points.push({ xMm: left, yMm: r });
      frame.paths.push(points);
    }
    return frame;
  }

  const vb = ornament.viewBox;
  const s = size / Math.max(vb.width, vb.height);
  const c = albumFrameCentreMm(preset);
  frame.ornaments = [
    { corner: "top-left", matrix: [s, 0, 0, s, c, c] },
    { corner: "top-right", matrix: [-s, 0, 0, s, W - c, c] },
    { corner: "bottom-left", matrix: [s, 0, 0, -s, c, H - c] },
    { corner: "bottom-right", matrix: [-s, 0, 0, -s, W - c, H - c] },
  ];

  // How far in from the sheet's edge each ornament reaches along the top and the left.
  const reachX = c + s * (vb.x + vb.width);
  const reachY = c + s * (vb.y + vb.height);
  for (const r of insets) {
    // A drawing that reaches less far than the rule itself stops nothing short of the rule's corner.
    const fromX = Math.max(reachX, r);
    const fromY = Math.max(reachY, r);
    if (fromX < W - fromX) {
      if (!gap) {
        frame.lines.push({ x1Mm: fromX, y1Mm: r, x2Mm: W - fromX, y2Mm: r });
      } else {
        // The top rule in two, each side of the title; a side the gap swallows is left out.
        if (gap.fromX > fromX) frame.lines.push({ x1Mm: fromX, y1Mm: r, x2Mm: Math.min(gap.fromX, W - fromX), y2Mm: r });
        if (gap.toX < W - fromX) frame.lines.push({ x1Mm: Math.max(gap.toX, fromX), y1Mm: r, x2Mm: W - fromX, y2Mm: r });
      }
      frame.lines.push({ x1Mm: fromX, y1Mm: H - r, x2Mm: W - fromX, y2Mm: H - r });
    }
    if (fromY < H - fromY) {
      frame.lines.push({ x1Mm: r, y1Mm: fromY, x2Mm: r, y2Mm: H - fromY });
      frame.lines.push({ x1Mm: W - r, y1Mm: fromY, x2Mm: W - r, y2Mm: H - fromY });
    }
  }
  return frame;
}
