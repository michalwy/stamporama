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
//
// ## The footer (#1457)
//
// The footer is set into the bottom line by the same rules, with `footerFrameGapMm` of white each
// side — {@link albumFooterInFrame} is its predicate. Inside the frame and below it, the plan places
// the footer from the frame's edges ({@link albumFrameInnerEdgeMm}, {@link albumFrameOuterEdgeMm}),
// read from here for the same reason: the footer and the rule it is measured from cannot disagree.

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
  | "footerPlacement"
  | "footerFrameGapMm"
>;

type AlbumRulePreset = Pick<
  AlbumRenderPreset,
  "borderStyle" | "borderWidthMm" | "borderInsetMm" | "borderGapMm"
>;

/** Whether the sheet prints a rule. Ornaments alone are not one: there is no line to set a text
 *  into, or to measure a footer from. */
export function albumHasRule(preset: Pick<AlbumRenderPreset, "borderStyle" | "borderWidthMm">): boolean {
  return preset.borderStyle !== "none" && preset.borderWidthMm > 0;
}

/** Whether the sheet has a rule the title can be set into (#1428): the preset asks for it, and there
 *  is a rule to break. Without one the title is placed below, as it always was — a page with no
 *  frame has nothing to break. Ornaments alone are not a line. */
export function albumTitleInFrame(
  preset: Pick<AlbumRenderPreset, "titlePlacement" | "borderStyle" | "borderWidthMm">
): boolean {
  return preset.titlePlacement === "in-frame" && albumHasRule(preset);
}

/** Whether the footer is set into the frame's bottom line (#1457) — {@link albumTitleInFrame}'s rule
 *  for the footer. Without a rule the footer sits on the bottom margin, whatever was chosen. */
export function albumFooterInFrame(
  preset: Pick<AlbumRenderPreset, "footerPlacement" | "borderStyle" | "borderWidthMm">
): boolean {
  return preset.footerPlacement === "in-frame" && albumHasRule(preset);
}

/** The frame's inside, inset from the sheet's edge: the inner edge of the innermost rule. A footer
 *  inside the frame is measured up from here (#1457). */
export function albumFrameInnerEdgeMm(preset: AlbumRulePreset): number {
  const inner =
    preset.borderStyle === "double"
      ? preset.borderInsetMm + preset.borderWidthMm + preset.borderGapMm
      : preset.borderInsetMm;
  return inner + preset.borderWidthMm / 2;
}

/** The frame's outside, inset from the sheet's edge: the outer edge of the outer rule. A footer
 *  below the frame is measured down from here (#1457). */
export function albumFrameOuterEdgeMm(preset: AlbumRulePreset): number {
  return preset.borderInsetMm - preset.borderWidthMm / 2;
}

/**
 * The offset that puts a footer inside the frame where the bottom margin put it before #1457 — its
 * foot on the margin — or 0 when the margin reached past the frame's inside.
 *
 * What the migration gave every template and album, and what a card stored before the value existed
 * reads as its own: the same arithmetic, so such a card reports nothing its album did not change.
 * Rounded to hundredths, as the migration rounds.
 */
export function albumFooterOffsetFromMarginMm(
  preset: AlbumRulePreset & Pick<AlbumRenderPreset, "marginBottomMm">
): number {
  const offset = preset.marginBottomMm - albumFrameInnerEdgeMm(preset);
  return Math.max(0, Math.round(offset * 100) / 100);
}

/** Where each rule's centre line runs, inset from the sheet's edge. */
function ruleInsets(preset: AlbumFramePreset): number[] {
  if (!albumHasRule(preset)) return [];
  const outer = preset.borderInsetMm;
  if (preset.borderStyle === "single") return [outer];
  // The gap is white between the two rules, edge to edge, so the centres are a weight and a gap
  // apart.
  return [outer, outer + preset.borderWidthMm + preset.borderGapMm];
}

/** The frame's centre line — where an ornament's (0, 0) is laid, and the line a title set into the
 *  frame is centred on (#1428). */
export function albumFrameCentreMm(preset: AlbumRulePreset): number {
  if (preset.borderStyle === "double" && preset.borderWidthMm > 0) {
    return preset.borderInsetMm + (preset.borderWidthMm + preset.borderGapMm) / 2;
  }
  return preset.borderInsetMm;
}

/**
 * The frame a sheet prints: its rules, and an ornament at each corner when there is one.
 *
 * `ornament` is the drawing already resolved — the album's for a live sheet, the one the card
 * stored for a printed one — or null for a frame of rules alone. `title` and `footer` are the ones
 * the sheet printed, as the plan placed them; the top rule is broken around the title only when the
 * preset sets the title into the frame (#1428), and the bottom rule around the footer likewise
 * (#1457).
 */
export function albumFrame(
  preset: AlbumFramePreset,
  ornament: AlbumOrnamentDrawing | null,
  title: AlbumRect | null = null,
  footer: AlbumRect | null = null
): AlbumFrame {
  const W = preset.pageWidthMm;
  const H = preset.pageHeightMm;
  const insets = ruleInsets(preset);
  const frame: AlbumFrame = { lineMm: preset.borderWidthMm, rects: [], paths: [], lines: [], ornaments: [] };

  // Where the top rule stops for the title, and the bottom one for the footer, if they do.
  const topGap = title && albumTitleInFrame(preset) ? gapAround(title, preset.titleFrameGapMm) : null;
  const bottomGap =
    footer && albumFooterInFrame(preset) ? gapAround(footer, preset.footerFrameGapMm) : null;

  const size = preset.frameOrnamentSizeMm;
  if (!ornament || !(size > 0)) {
    for (const r of insets) {
      if (!topGap && !bottomGap) {
        frame.rects.push({ xMm: r, yMm: r, widthMm: W - 2 * r, heightMm: H - 2 * r });
        continue;
      }
      frame.paths.push(...brokenRule(r, W, H, topGap, bottomGap));
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
      frame.lines.push(...ruleBetween(fromX, W - fromX, r, topGap));
      frame.lines.push(...ruleBetween(fromX, W - fromX, H - r, bottomGap));
    }
    if (fromY < H - fromY) {
      frame.lines.push({ x1Mm: r, y1Mm: fromY, x2Mm: r, y2Mm: H - fromY });
      frame.lines.push({ x1Mm: W - r, y1Mm: fromY, x2Mm: W - r, y2Mm: H - fromY });
    }
  }
  return frame;
}

interface FrameGap {
  fromX: number;
  toX: number;
}

/** The stretch of a rule left white for a text set into it: the text's own width and `gapMm` more
 *  each side. */
function gapAround(text: AlbumRect, gapMm: number): FrameGap {
  return { fromX: text.xMm - gapMm, toX: text.xMm + text.widthMm + gapMm };
}

/** A horizontal rule between the ornaments, in two when a text is set into it; a side the gap
 *  swallows is left out. */
function ruleBetween(fromX: number, toX: number, y: number, gap: FrameGap | null): AlbumFrameLine[] {
  if (!gap) return [{ x1Mm: fromX, y1Mm: y, x2Mm: toX, y2Mm: y }];
  const lines: AlbumFrameLine[] = [];
  if (gap.fromX > fromX) lines.push({ x1Mm: fromX, y1Mm: y, x2Mm: Math.min(gap.fromX, toX), y2Mm: y });
  if (gap.toX < toX) lines.push({ x1Mm: Math.max(gap.toX, fromX), y1Mm: y, x2Mm: toX, y2Mm: y });
  return lines;
}

/**
 * A closed rule at inset `r`, broken for a title in its top edge, a footer in its bottom one, or
 * both: one open stroke per piece, so every corner inside a piece is a join rather than two butt
 * ends. With the top broken alone, that is a single stroke from the right of the gap round to its
 * left (#1428); with both, two — down the right side, and up the left. A gap wider than the rule
 * takes the whole edge, and the stroke then starts or ends on the corner.
 */
function brokenRule(
  r: number,
  W: number,
  H: number,
  top: FrameGap | null,
  bottom: FrameGap | null
): AlbumFramePoint[][] {
  const clampX = (x: number) => Math.min(Math.max(x, r), W - r);
  // Clockwise from the top-left corner and back to it; null is where the rule stops for a gap.
  const walk: (AlbumFramePoint | null)[] = [{ xMm: r, yMm: r }];
  if (top) walk.push({ xMm: clampX(top.fromX), yMm: r }, null, { xMm: clampX(top.toX), yMm: r });
  walk.push({ xMm: W - r, yMm: r }, { xMm: W - r, yMm: H - r });
  if (bottom) {
    walk.push({ xMm: clampX(bottom.toX), yMm: H - r }, null, { xMm: clampX(bottom.fromX), yMm: H - r });
  }
  walk.push({ xMm: r, yMm: H - r }, { xMm: r, yMm: r });

  // Start just after the first gap, so the piece running through the top-left corner is one stroke:
  // the walk's closing corner and its opening one are the same point.
  const first = walk.indexOf(null);
  const ordered = [...walk.slice(first + 1), ...walk.slice(1, first)];

  const pieces: AlbumFramePoint[][] = [[]];
  for (const point of ordered) {
    const piece = pieces[pieces.length - 1];
    if (!point) {
      pieces.push([]);
      continue;
    }
    const last = piece[piece.length - 1];
    if (!last || last.xMm !== point.xMm || last.yMm !== point.yMm) piece.push(point);
  }
  return pieces.filter((piece) => piece.length > 1);
}
