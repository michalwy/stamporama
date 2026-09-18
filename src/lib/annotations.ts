// Marking up a detail and keeping it as a photo (#674, #1300) — the shapes, how they are styled, the
// rectangle a snapshot takes, and the drawing that is burnt into it. Pure: no DOM, no React, no
// `sharp`, no Prisma.
//
// ## One drawing, two surfaces
//
// A mark is drawn twice — live, over the picture in the viewer, and once more into the snapshot the
// server writes. Both go through {@link markPrimitives}: the same shapes in the same frame (the
// picture's own pixels: a tile's box on the card, a photo's upload), turned into the same strokes and
// the same type. The viewer renders those primitives as React SVG; the server renders them as an SVG
// string ({@link snapshotOverlaySvg}). A snapshot therefore shows what was on screen rather than an
// approximation of it redone somewhere else (#1300's rule).
//
// ## Sizes are the screen's
//
// A stroke's thickness, a tick's length and a font size are stated in **screen** pixels — what the
// collector chose them by, and what they look like while drawing. Placing a mark is a matter of the
// picture's pixels; styling it is a matter of the screen's. The snapshot keeps both: its request
// carries the zoom it was taken at (`viewScale`), so every screen pixel becomes the number of output
// pixels that one screen pixel covered. A 2 px line on a snapshot of a whole card rendered at twice
// the screen's resolution is a 4 px line — the same line.
//
// ## Nothing here is stored as a mark
//
// Marks are ephemeral to the snapshot (#674's scope): the result is a new photo with the drawing in
// its pixels, and the original picture is not touched. There is no annotation table and no editable
// overlay to come back to. That is also what keeps this independent of the comparison view
// (ADR-0049 §4) — a layer of shapes over *a* picture, which that view can mount later without either
// viewer growing drawing code of its own.

import type { Box } from "./scan-boxes";
import {
  MAX_SCAN_DPI,
  MIN_SCAN_DPI,
  formatMillimetres,
  scanPixelsToMm,
  type ScanPoint,
} from "./scan-measure";
import { toSheetPoint, type Viewport, type ViewportSize } from "./scan-viewport";

/**
 * A mark the collector drew on the picture.
 *
 * - **ellipse** and **line** point at something and say nothing numeric (#674).
 * - **rulerMark** is a line with graduations and its length in millimetres (#1300). It carries the
 *   scale it was drawn at, so a later correction of the scale field does not silently re-measure a
 *   mark already on the picture. Its label is the length alone (#1342): the scale is said by the
 *   viewer while measuring, and on the picture it was clutter.
 * - **text** is a note, its top-left corner where it was placed (#1300).
 *
 * Every mark carries the **style it was drawn in** (#1342): changing the settings styles the next mark,
 * and a red line stays red after switching to yellow. Only a mark selected on purpose is restyled.
 */
export type Annotation =
  | { kind: "ellipse" | "line"; a: ScanPoint; b: ScanPoint; style: AnnotationStyle }
  | { kind: "rulerMark"; a: ScanPoint; b: ScanPoint; dpi: number; style: AnnotationStyle }
  | { kind: "text"; at: ScanPoint; text: string; style: AnnotationStyle };

export type AnnotationKind = Annotation["kind"];
/** The marks drawn by dragging from one end to the other. */
export type DragAnnotationKind = "ellipse" | "line" | "rulerMark";

/**
 * Everything a snapshot draws: the annotations, plus the measurement standing on the viewer when it
 * is taken — a distance (the ruler, the perforation run) or a box (the size tool), with the figure
 * the viewer showed for it.
 *
 * The figure travels as **text**, already formatted by the viewer — and so already carrying the
 * scale it was taken at (`formatMillimetresAt` / `formatGaugeAt`). A gauge depends on a tooth count
 * the server never sees, and a photo carrying a number without its dpi is exactly what the measuring
 * stack refuses to produce. The live viewer draws the same marks with an empty label, since its
 * figure is set in the page beside the line.
 */
export type SnapshotMark =
  | Annotation
  | { kind: "distance" | "box"; a: ScanPoint; b: ScanPoint; label: string; style: AnnotationStyle };

// ── Style (#1300) ────────────────────────────────────────────────────────────────────────────────

/**
 * The colours a mark can be. A short set of strong ones rather than a picker: a mark has to stand out
 * on a stamp, which is paper in one place and ink in the next, and a few well-chosen colours do that
 * reliably where an arbitrary one often does not.
 *
 * Every mark is drawn over a **halo** — a wider stroke in a contrasting colour underneath — so even
 * the colour nearest the stamp's own stays readable: dark under the light colours, light under black.
 *
 * Not semantic tokens, and deliberately: these colours are drawn *on a picture*, in pixels a snapshot
 * keeps, and must be the same in either theme — the watermark chips' exception (#625), for the same
 * reason.
 */
export const ANNOTATION_COLOURS = [
  { id: "white", label: "White", colour: "#ffffff", halo: "rgba(0,0,0,0.65)" },
  { id: "black", label: "Black", colour: "#111111", halo: "rgba(255,255,255,0.8)" },
  { id: "red", label: "Red", colour: "#ff3b30", halo: "rgba(0,0,0,0.65)" },
  { id: "yellow", label: "Yellow", colour: "#ffd60a", halo: "rgba(0,0,0,0.65)" },
  { id: "green", label: "Green", colour: "#30d158", halo: "rgba(0,0,0,0.65)" },
  { id: "blue", label: "Blue", colour: "#0a84ff", halo: "rgba(255,255,255,0.8)" },
] as const;

export type AnnotationColour = (typeof ANNOTATION_COLOURS)[number]["id"];

/** How thick a mark's line is, in screen pixels — a few steps, for every mark but text. */
export const ANNOTATION_THICKNESSES = [1, 2, 3, 5] as const;
/** How large a text mark is set, in screen pixels — a few steps. The ruler mark's figure uses it too,
 * so everything written on the picture is one size. */
export const ANNOTATION_FONT_SIZES = [12, 16, 24, 32] as const;

export interface AnnotationStyle {
  colour: AnnotationColour;
  thickness: number;
  fontSize: number;
}

/** Which of the three settings show on a mark of a kind — a note has no line, a ring no type. What
 * the settings bar offers for a selected mark (#1342). */
export function styleFieldsOf(kind: SnapshotMark["kind"]): { thickness: boolean; fontSize: boolean } {
  if (kind === "text") return { thickness: false, fontSize: true };
  if (kind === "ellipse" || kind === "line") return { thickness: true, fontSize: false };
  return { thickness: true, fontSize: true };
}

/** What marks look like until the collector says otherwise — #674's white hairline on a dark halo. */
export const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = { colour: "white", thickness: 1, fontSize: 16 };

/**
 * A style as it arrives in a snapshot request: every field one of the steps, or null. The server
 * draws only what the viewer could have drawn.
 */
export function parseAnnotationStyle(raw: unknown): AnnotationStyle | null {
  if (!isRecord(raw)) return null;
  const { colour, thickness, fontSize } = raw;
  if (!ANNOTATION_COLOURS.some((c) => c.id === colour)) return null;
  if (!(ANNOTATION_THICKNESSES as readonly unknown[]).includes(thickness)) return null;
  if (!(ANNOTATION_FONT_SIZES as readonly unknown[]).includes(fontSize)) return null;
  return { colour: colour as AnnotationColour, thickness: thickness as number, fontSize: fontSize as number };
}

/**
 * The style remembered from the last sitting (#1300), read forgivingly: whatever field is missing or no
 * longer one of the steps falls back to the default on its own, so a stale entry costs one setting
 * rather than all three.
 */
export function readStoredAnnotationStyle(raw: string | null): AnnotationStyle {
  let stored: unknown = null;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  const record = isRecord(stored) ? stored : {};
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  return {
    colour: pick(record.colour, ANNOTATION_COLOURS.map((c) => c.id), DEFAULT_ANNOTATION_STYLE.colour),
    thickness: pick(record.thickness, ANNOTATION_THICKNESSES, DEFAULT_ANNOTATION_STYLE.thickness),
    fontSize: pick(record.fontSize, ANNOTATION_FONT_SIZES, DEFAULT_ANNOTATION_STYLE.fontSize),
  };
}

function paletteOf(style: AnnotationStyle) {
  return ANNOTATION_COLOURS.find((c) => c.id === style.colour) ?? ANNOTATION_COLOURS[0];
}

// ── Limits ──────────────────────────────────────────────────────────────────────────────────────

/** What a snapshot is called when the collector does not say. */
export const DEFAULT_SNAPSHOT_TITLE = "Detail";
export const MAX_SNAPSHOT_TITLE = 120;
export const MAX_SNAPSHOT_LABEL = 120;
/** A note is a few words pointing at something, not a paragraph. */
export const MAX_TEXT_MARK = 120;
/** Far above anything drawn by hand; it bounds what one request can make the server render. */
export const MAX_SNAPSHOT_MARKS = 100;
/** A snapshot is at least this large on its longest edge. A detail zoomed deep into is a few dozen
 * source pixels across, and kept at that size it is a thumbnail of itself: enlarging it adds no
 * detail, but it keeps the marks and the figure legible at the size the photo is looked at. */
export const MIN_SNAPSHOT_EDGE = 800;
/** Below this on either edge a region is a slip of the hand rather than a detail. */
export const MIN_SNAPSHOT_REGION = 4;
/** The zooms a viewer can be at, with room on both sides — `scan-viewport.ts` clamps well inside. */
const MIN_VIEW_SCALE = 1e-4;
const MAX_VIEW_SCALE = 1e3;
/** How many steps of undo a sitting keeps. */
export const MAX_MARK_HISTORY = 100;

// ── Drawing marks ───────────────────────────────────────────────────────────────────────────────

/**
 * A mark from the two ends of a drag, in the style it is drawn in, or null when the drag drew
 * nothing: a ring needs a width **and** a height, and a line needs a length. A click that never
 * became a drag is not a mark. A ruler mark also needs a stated scale — without one it has no figure,
 * and it is not drawn.
 */
export function annotationFromDrag(
  kind: DragAnnotationKind,
  a: ScanPoint,
  b: ScanPoint,
  style: AnnotationStyle,
  dpi: number | null = null
): Annotation | null {
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (kind === "ellipse") return w > 0 && h > 0 ? { kind, a, b, style } : null;
  if (Math.hypot(w, h) <= 0) return null;
  if (kind === "rulerMark") return dpi === null ? null : { kind, a, b, dpi, style };
  return { kind, a, b, style };
}

/**
 * The marks with the one at `index` in a new style (#1342) — a mark selected and restyled on purpose.
 * The same array when nothing changes, so {@link changeMarks} records no step for it.
 */
export function restyleMark(marks: Annotation[], index: number, style: AnnotationStyle): Annotation[] {
  const mark = marks[index];
  if (!mark || sameStyle(mark.style, style)) return marks;
  return marks.map((m, i) => (i === index ? { ...m, style } : m));
}

export function sameStyle(a: AnnotationStyle, b: AnnotationStyle): boolean {
  return a.colour === b.colour && a.thickness === b.thickness && a.fontSize === b.fontSize;
}

/**
 * The marks on the picture with the way back through every change to them (#1300): a mark drawn, a
 * note typed, edited or removed, and **Clear** — each one step of **Undo**.
 */
export interface MarksHistory {
  marks: Annotation[];
  past: Annotation[][];
}

export const NO_MARKS: MarksHistory = { marks: [], past: [] };

/** The marks after a change, with what they were before it kept for Undo. No change, no step. */
export function changeMarks(history: MarksHistory, next: Annotation[]): MarksHistory {
  if (next === history.marks) return history;
  if (next.length === 0 && history.marks.length === 0) return history;
  return { marks: next, past: [...history.past, history.marks].slice(-MAX_MARK_HISTORY) };
}

export function undoMarks(history: MarksHistory): MarksHistory {
  if (history.past.length === 0) return history;
  return { marks: history.past[history.past.length - 1], past: history.past.slice(0, -1) };
}

/**
 * The rectangle a note covers on the picture, in picture pixels — what a click with the text tool
 * hits to open a note for editing. An estimate from the number of characters, generous by a little,
 * since there are no font metrics here; the note is set from its top-left corner, in its own size.
 */
export function textMarkBox(
  mark: { at: ScanPoint; text: string; style: AnnotationStyle },
  viewScale: number
): Box {
  const scale = viewScale > 0 ? viewScale : 1;
  const fontSize = mark.style.fontSize;
  return {
    x: mark.at.x,
    y: mark.at.y,
    w: (Math.max(mark.text.length, 1) * fontSize * TEXT_WIDTH_EM + fontSize * 0.5) / scale,
    h: (fontSize * TEXT_LINE_EM) / scale,
  };
}

/** The topmost note under a picture point, or null — the last drawn wins, as it is drawn on top. */
export function textMarkAt(marks: readonly Annotation[], point: ScanPoint, viewScale: number): number | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    if (mark.kind !== "text") continue;
    if (insideBox(point, textMarkBox(mark, viewScale))) return i;
  }
  return null;
}

/** How near a click has to land to a mark's line to take it, in screen pixels beyond the stroke. */
const HIT_SLOP = 5;

/**
 * The topmost mark under a picture point, or null (#1342) — what a click selects. A ring and a line are
 * taken near their stroke, not anywhere inside, so a click inside a ring can still reach a note or a
 * line drawn within it; a note anywhere in its box. The last drawn wins, as it is drawn on top.
 */
export function annotationAt(marks: readonly Annotation[], point: ScanPoint, viewScale: number): number | null {
  const scale = viewScale > 0 ? viewScale : 1;
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    if (mark.kind === "text") {
      if (insideBox(point, textMarkBox(mark, scale))) return i;
      continue;
    }
    const reach = (mark.style.thickness / 2 + HIT_SLOP) / scale;
    const off =
      mark.kind === "ellipse"
        ? distanceToEllipse(point, mark.a, mark.b)
        : distanceToSegment(point, mark.a, mark.b);
    if (off <= reach) return i;
  }
  return null;
}

/** The rectangle a mark occupies on the picture — where the viewer outlines a selected one. */
export function annotationBounds(mark: Annotation, viewScale: number): Box {
  if (mark.kind === "text") return textMarkBox(mark, viewScale);
  return {
    x: Math.min(mark.a.x, mark.b.x),
    y: Math.min(mark.a.y, mark.b.y),
    w: Math.abs(mark.b.x - mark.a.x),
    h: Math.abs(mark.b.y - mark.a.y),
  };
}

function insideBox(point: ScanPoint, box: Box): boolean {
  return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
}

function distanceToSegment(p: ScanPoint, a: ScanPoint, b: ScanPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** How far a point is from the outline of the ellipse inscribed in the box a–b, measured along the ray
 * from its centre — close enough to the true distance for a hit test. */
function distanceToEllipse(p: ScanPoint, a: ScanPoint, b: ScanPoint): number {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const r = Math.hypot(dx, dy);
  if (rx <= 0 || ry <= 0) return distanceToSegment(p, a, b);
  const d = Math.hypot(dx / rx, dy / ry);
  if (d === 0) return Math.min(rx, ry);
  return Math.abs(r - r / d);
}

// ── Primitives: what both surfaces draw ─────────────────────────────────────────────────────────

/** One thing to draw, in output pixels. Strokes carry their own colour and width; so does type. */
export type Primitive =
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number }
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number; stroke: string; width: number }
  | { type: "rect"; x: number; y: number; w: number; h: number; stroke: string; width: number }
  | { type: "circle"; cx: number; cy: number; r: number; stroke: string; width: number }
  | {
      type: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      fill: string;
      /** A halo under the glyphs, drawn as a stroke of the same text first. */
      halo: string | null;
      haloWidth: number;
      anchor: "start" | "middle" | "end";
      weight: number;
    }
  | { type: "plate"; x: number; y: number; w: number; h: number; r: number; fill: string };

/**
 * Where marks land and at what size.
 *
 * - `origin` and `scale` place a picture point: output = (point − origin) × scale.
 * - `screen` is how many output pixels one screen pixel covers — 1 in the viewer, and the ratio of
 *   the snapshot's resolution to the screen's in a snapshot.
 */
export interface MarkPlacement {
  origin: ScanPoint;
  scale: number;
  screen: number;
}

/** Font the marks' type is set in — the collage labels' stack (#312), which the image ships the faces
 * for (`Dockerfile`), so the server renders the same glyphs on every deployment. The viewer asks for
 * the same stack, so the note on screen is the note in the photo. */
export const ANNOTATION_FONT_FAMILY = "DejaVu Sans, Verdana, Arial, Helvetica, sans-serif";

/** An average glyph's advance as a share of the font size — an estimate, and a generous one. */
const TEXT_WIDTH_EM = 0.62;
const TEXT_LINE_EM = 1.25;
/** How far apart a ruler mark's finest graduations may come on screen before a coarser step is used. */
const MIN_TICK_SPACING = 6;
/** Graduation steps in millimetres, finest first, each with the step its longer ticks fall on. */
const TICK_STEPS = [
  { minor: 0.1, major: 0.5 },
  { minor: 0.5, major: 1 },
  { minor: 1, major: 5 },
  { minor: 5, major: 10 },
  { minor: 10, major: 50 },
] as const;
/** Beyond this many graduations a mark is drawn with its ends only — a line across a whole sheet at
 * a zoom that shows it, not something to set a thousand ticks along. */
const MAX_TICKS = 2000;

/**
 * The graduations a ruler mark carries at a zoom, in millimetres from its first end — the finest
 * step that still leaves {@link MIN_TICK_SPACING} screen pixels between ticks, and which of them are
 * the longer ones. The ends themselves are not graduations: they are drawn as the mark's end caps.
 */
export function rulerTicks(
  lengthMm: number,
  screenPxPerMm: number
): { minor: number; ticks: { mm: number; major: boolean }[] } {
  const step = TICK_STEPS.find((s) => s.minor * screenPxPerMm >= MIN_TICK_SPACING) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const count = Math.floor(lengthMm / step.minor + 1e-9);
  if (!(count > 0) || count > MAX_TICKS) return { minor: step.minor, ticks: [] };
  const ticks: { mm: number; major: boolean }[] = [];
  const perMajor = Math.round(step.major / step.minor);
  for (let i = 1; i <= count; i++) {
    const mm = i * step.minor;
    // The far end is its own cap; a graduation a hair before it would draw over the cap.
    if (lengthMm - mm < step.minor * 0.25) break;
    ticks.push({ mm: roundTo(mm, 6), major: i % perMajor === 0 });
  }
  return { minor: step.minor, ticks };
}

/**
 * One mark as primitives, in drawing order: every halo first, then every stroke on top, then type —
 * so a graduation's halo never cuts across the line it sits on.
 */
export function markPrimitives(mark: SnapshotMark, place: MarkPlacement): Primitive[] {
  const { style } = mark;
  const { colour, halo } = paletteOf(style);
  const s = place.screen;
  const at = (p: ScanPoint) => ({
    x: (p.x - place.origin.x) * place.scale,
    y: (p.y - place.origin.y) * place.scale,
  });
  const width = style.thickness * s;
  const haloWidth = width + 2 * s;

  type Shape =
    | { type: "line"; x1: number; y1: number; x2: number; y2: number }
    | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
    | { type: "rect"; x: number; y: number; w: number; h: number }
    | { type: "circle"; cx: number; cy: number; r: number };
  const shapes: Shape[] = [];
  const type: Primitive[] = [];

  if (mark.kind === "text") {
    const p = at(mark.at);
    const size = style.fontSize * s;
    type.push(textPrimitive(mark.text, p.x, p.y + size * 0.8, size, colour, halo, "start", 600));
    return type;
  }

  const a = at(mark.a);
  const b = at(mark.b);
  if (mark.kind === "ellipse") {
    shapes.push({
      type: "ellipse",
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      rx: Math.abs(b.x - a.x) / 2,
      ry: Math.abs(b.y - a.y) / 2,
    });
  } else if (mark.kind === "box") {
    shapes.push({
      type: "rect",
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    });
  } else {
    shapes.push({ type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }

  if (mark.kind === "distance") {
    // Rings rather than dots: the thing aimed at is the centre of a perforation hole.
    const r = (3 + style.thickness) * s;
    shapes.push({ type: "circle", cx: a.x, cy: a.y, r }, { type: "circle", cx: b.x, cy: b.y, r });
  }

  if (mark.kind === "rulerMark") {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0) {
      const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      // The side the figure is set on: upwards, or to the right for an upright line.
      let n = { x: -u.y, y: u.x };
      if (n.y > 1e-9 || (Math.abs(n.y) <= 1e-9 && n.x < 0)) n = { x: -n.x, y: -n.y };
      const minorHalf = (3 + style.thickness) * s;
      const majorHalf = (6 + style.thickness * 1.5) * s;
      const tick = (p: { x: number; y: number }, half: number) =>
        shapes.push({
          type: "line",
          x1: p.x - n.x * half,
          y1: p.y - n.y * half,
          x2: p.x + n.x * half,
          y2: p.y + n.y * half,
        });
      tick(a, majorHalf);
      tick(b, majorHalf);

      const pictureLength = Math.hypot(mark.b.x - mark.a.x, mark.b.y - mark.a.y);
      const lengthMm = scanPixelsToMm(pictureLength, mark.dpi);
      const pxPerMm = len / lengthMm;
      for (const t of rulerTicks(lengthMm, pxPerMm / s).ticks) {
        tick({ x: a.x + u.x * t.mm * pxPerMm, y: a.y + u.y * t.mm * pxPerMm }, t.major ? majorHalf : minorHalf);
      }

      const size = style.fontSize * s;
      const offset = majorHalf + 4 * s;
      const mid = { x: (a.x + b.x) / 2 + n.x * offset, y: (a.y + b.y) / 2 + n.y * offset };
      const sideways = Math.abs(n.x) >= 0.7;
      // The length alone (#1342). The scale it was drawn at is on the mark and in the viewer's
      // reading while measuring; set on the picture beside every mark it was clutter.
      type.push(
        textPrimitive(
          `${formatMillimetres(lengthMm)} mm`,
          mid.x,
          sideways ? mid.y + size * 0.35 : mid.y - size * 0.2,
          size,
          colour,
          halo,
          sideways ? (n.x > 0 ? "start" : "end") : "middle",
          600
        )
      );
    }
  }

  if ((mark.kind === "distance" || mark.kind === "box") && mark.label) {
    // The viewer's reading plate, set above the line's far end as the viewer sets it: 12 px type in a
    // dark plate, 0.75 rem clear of the point. Its own colours rather than the mark's — it is the
    // viewer's figure, and it must read over paper and ink alike whatever colour the line is.
    const size = 12 * s;
    const padX = 6 * s;
    const padY = 2 * s;
    const w = mark.label.length * size * TEXT_WIDTH_EM + padX * 2;
    const h = size * 1.2 + padY * 2;
    const x = b.x - w / 2;
    const y = b.y - h - 12 * s;
    type.push(
      { type: "plate", x, y, w, h, r: 4 * s, fill: "rgba(17,17,17,0.85)" },
      textPrimitive(mark.label, x + w / 2, y + padY + size * 0.95, size, "#ffffff", null, "middle", 600)
    );
  }

  return [
    ...shapes.map((shape) => ({ ...shape, stroke: halo, width: haloWidth }) as Primitive),
    ...shapes.map((shape) => ({ ...shape, stroke: colour, width }) as Primitive),
    ...type,
  ];
}

function textPrimitive(
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  halo: string | null,
  anchor: "start" | "middle" | "end",
  weight: number
): Primitive {
  return { type: "text", x, y, text, size, fill, halo, haloWidth: Math.max(2, size * 0.18), anchor, weight };
}

// ── The snapshot ────────────────────────────────────────────────────────────────────────────────

export interface SnapshotRequest {
  photoId: string;
  /** The part of the picture to keep, in the picture's own frame. */
  region: Box;
  /** Each in the style it was drawn in on screen (#1342). */
  marks: SnapshotMark[];
  title: string;
  /** Screen pixels per picture pixel when it was taken — what turns the style's screen pixels into
   * the snapshot's (#1300). */
  viewScale: number;
}

/**
 * The part of the picture on screen, in whole picture pixels — what a snapshot keeps.
 *
 * Grown outwards to whole pixels and clamped to the picture, so a view panned past the edge keeps
 * the picture and not the empty panel around it. Null when nothing of the picture is visible.
 */
export function snapshotRegion(
  view: Viewport,
  picture: { width: number; height: number },
  size: ViewportSize
): Box | null {
  if (picture.width <= 0 || picture.height <= 0 || size.width <= 0 || size.height <= 0) return null;
  const topLeft = toSheetPoint(view, 0, 0);
  const bottomRight = toSheetPoint(view, size.width, size.height);
  const x = clamp(Math.floor(topLeft.x), 0, picture.width);
  const y = clamp(Math.floor(topLeft.y), 0, picture.height);
  const x1 = clamp(Math.ceil(bottomRight.x), 0, picture.width);
  const y1 = clamp(Math.ceil(bottomRight.y), 0, picture.height);
  const box = { x, y, w: x1 - x, h: y1 - y };
  return box.w >= MIN_SNAPSHOT_REGION && box.h >= MIN_SNAPSHOT_REGION ? box : null;
}

/**
 * A snapshot request as it arrives from the client, checked field by field. Null for anything that
 * is not one — a server action is an endpoint, and its argument is whatever was sent.
 */
export function parseSnapshotRequest(raw: unknown): SnapshotRequest | null {
  if (!isRecord(raw)) return null;
  const { photoId, region, marks, title, viewScale } = raw;
  if (typeof photoId !== "string" || photoId.length === 0 || photoId.length > 64) return null;

  if (!isRecord(region)) return null;
  const box = {
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
  };
  if (!isWhole(box.x) || !isWhole(box.y) || !isWhole(box.w) || !isWhole(box.h)) return null;
  if (box.x < 0 || box.y < 0 || box.w < MIN_SNAPSHOT_REGION || box.h < MIN_SNAPSHOT_REGION) {
    return null;
  }

  if (!Array.isArray(marks) || marks.length > MAX_SNAPSHOT_MARKS) return null;
  const parsed: SnapshotMark[] = [];
  for (const m of marks) {
    const mark = parseMark(m);
    if (!mark) return null;
    parsed.push(mark);
  }

  let name = DEFAULT_SNAPSHOT_TITLE;
  if (title != null) {
    if (typeof title !== "string") return null;
    const trimmed = title.trim();
    if (trimmed.length > MAX_SNAPSHOT_TITLE) return null;
    if (trimmed) name = trimmed;
  }

  if (typeof viewScale !== "number" || !Number.isFinite(viewScale)) return null;
  if (viewScale < MIN_VIEW_SCALE || viewScale > MAX_VIEW_SCALE) return null;

  return {
    photoId,
    region: box as Box,
    marks: parsed,
    title: name,
    viewScale,
  };
}

function parseMark(raw: unknown): SnapshotMark | null {
  if (!isRecord(raw)) return null;
  // Every mark in a style the viewer could have drawn it in (#1342).
  const style = parseAnnotationStyle(raw.style);
  if (!style) return null;
  if (raw.kind === "text") {
    const at = parsePoint(raw.at);
    if (!at || typeof raw.text !== "string") return null;
    const text = raw.text.trim();
    if (!text || text.length > MAX_TEXT_MARK) return null;
    return { kind: "text", at, text, style };
  }
  const a = parsePoint(raw.a);
  const b = parsePoint(raw.b);
  if (!a || !b) return null;
  if (raw.kind === "ellipse" || raw.kind === "line") return { kind: raw.kind, a, b, style };
  if (raw.kind === "rulerMark") {
    // A ruler mark never travels without the scale it was drawn at — its length is computed from it.
    const { dpi } = raw;
    if (!isWhole(dpi) || dpi < MIN_SCAN_DPI || dpi > MAX_SCAN_DPI) return null;
    return { kind: "rulerMark", a, b, dpi, style };
  }
  if (raw.kind === "distance" || raw.kind === "box") {
    if (typeof raw.label !== "string") return null;
    const label = raw.label.trim();
    if (!label || label.length > MAX_SNAPSHOT_LABEL) return null;
    return { kind: raw.kind, a, b, label, style };
  }
  return null;
}

function parsePoint(raw: unknown): ScanPoint | null {
  if (!isRecord(raw)) return null;
  const { x, y } = raw;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * How large to render a snapshot whose source holds `source` pixels of the region: the source's own
 * size, enlarged to {@link MIN_SNAPSHOT_EDGE} when it is smaller and shrunk to `maxEdge` when it is
 * larger. The aspect is the region's, always.
 */
export function snapshotOutputSize(
  region: { w: number; h: number },
  source: { width: number; height: number },
  maxEdge: number
): { width: number; height: number } {
  const longestSource = Math.max(source.width, source.height, 1);
  const target = clamp(longestSource, Math.min(MIN_SNAPSHOT_EDGE, maxEdge), maxEdge);
  const scale = target / Math.max(region.w, region.h);
  return {
    width: Math.max(1, Math.round(region.w * scale)),
    height: Math.max(1, Math.round(region.h * scale)),
  };
}

/**
 * The marks as one SVG the size of the snapshot, to composite over the cropped picture — the same
 * primitives the viewer drew, each mark in its own style, placed in the region and sized by how many
 * snapshot pixels each screen pixel covered. A reading's plate is nudged inside the picture when it
 * would be cut off.
 */
export function snapshotOverlaySvg(
  marks: readonly SnapshotMark[],
  region: Box,
  out: { width: number; height: number },
  viewScale: number
): string {
  const scale = out.width / region.w;
  const place: MarkPlacement = { origin: { x: region.x, y: region.y }, scale, screen: scale / viewScale };
  const parts = marks.flatMap((mark) => clampPlates(markPrimitives(mark, place), out).map(primitiveSvg));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${out.width}" height="${out.height}">` +
    parts.join("") +
    `</svg>`
  );
}

/** A plate and the figure set in it moved together, so the plate is inside the picture. */
function clampPlates(primitives: Primitive[], out: { width: number; height: number }): Primitive[] {
  const result = [...primitives];
  for (let i = 0; i < result.length; i++) {
    const plate = result[i];
    if (plate.type !== "plate") continue;
    const dx = clamp(plate.x, 0, Math.max(0, out.width - plate.w)) - plate.x;
    const dy = clamp(plate.y, 0, Math.max(0, out.height - plate.h)) - plate.y;
    result[i] = { ...plate, x: plate.x + dx, y: plate.y + dy };
    const label = result[i + 1];
    if (label?.type === "text") result[i + 1] = { ...label, x: label.x + dx, y: label.y + dy };
  }
  return result;
}

function primitiveSvg(p: Primitive): string {
  switch (p.type) {
    case "line":
      return `<line x1="${round(p.x1)}" y1="${round(p.y1)}" x2="${round(p.x2)}" y2="${round(p.y2)}" stroke="${p.stroke}" stroke-width="${round(p.width)}" stroke-linecap="round"/>`;
    case "ellipse":
      return `<ellipse cx="${round(p.cx)}" cy="${round(p.cy)}" rx="${round(p.rx)}" ry="${round(p.ry)}" fill="none" stroke="${p.stroke}" stroke-width="${round(p.width)}"/>`;
    case "rect":
      return `<rect x="${round(p.x)}" y="${round(p.y)}" width="${round(p.w)}" height="${round(p.h)}" fill="none" stroke="${p.stroke}" stroke-width="${round(p.width)}"/>`;
    case "circle":
      return `<circle cx="${round(p.cx)}" cy="${round(p.cy)}" r="${round(p.r)}" fill="none" stroke="${p.stroke}" stroke-width="${round(p.width)}"/>`;
    case "plate":
      return `<rect x="${round(p.x)}" y="${round(p.y)}" width="${round(p.w)}" height="${round(p.h)}" rx="${round(p.r)}" fill="${p.fill}"/>`;
    case "text": {
      const common = `x="${round(p.x)}" y="${round(p.y)}" font-family="${ANNOTATION_FONT_FAMILY}" font-size="${round(p.size)}" font-weight="${p.weight}" text-anchor="${p.anchor}"`;
      const text = escapeXml(p.text);
      const halo = p.halo
        ? `<text ${common} fill="none" stroke="${p.halo}" stroke-width="${round(p.haloWidth)}" stroke-linejoin="round">${text}</text>`
        : "";
      return `${halo}<text ${common} fill="${p.fill}">${text}</text>`;
    }
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWhole(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
