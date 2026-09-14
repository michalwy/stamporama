// Marking up a detail and keeping it as a photo (#674) — the shapes, the rectangle a snapshot takes,
// and the drawing that is burnt into it. Pure: no DOM, no React, no `sharp`, no Prisma.
//
// ## One drawing, two surfaces
//
// A mark is drawn twice — live, over the picture in the viewer, and once more into the snapshot the
// server writes. Both read the same shapes in the same frame (the picture's own pixels: a tile's box
// on the card, a photo's upload), so what the collector marked is what lands in the photo rather
// than an approximation of it redone somewhere else. The server's half is {@link snapshotOverlaySvg}.
//
// ## Nothing here is stored as a mark
//
// Marks are ephemeral to the snapshot (#674's scope): the result is a new photo with the drawing in
// its pixels, and the original picture is not touched. There is no annotation table and no editable
// overlay to come back to. That is also what keeps this independent of the comparison view
// (ADR-0049 §4) — a layer of shapes over *a* picture, which that view can mount later without either
// viewer growing drawing code of its own.

import type { Box } from "./scan-boxes";
import type { ScanPoint } from "./scan-measure";
import { toSheetPoint, type Viewport, type ViewportSize } from "./scan-viewport";

/** A mark the collector drew to point at something: a ring around a detail, or a straight line for
 * reference. Neither says anything numeric — the ruler is the tool that does. */
export type AnnotationKind = "ellipse" | "line";

export interface Annotation {
  kind: AnnotationKind;
  a: ScanPoint;
  b: ScanPoint;
}

/**
 * Everything a snapshot draws: the annotations, plus the measurement standing on the viewer when it
 * is taken — a distance (the ruler, the perforation run) or a box (the size tool), with the figure
 * the viewer showed for it.
 *
 * The figure travels as **text**, already formatted by the viewer — and so already carrying the
 * scale it was taken at (`formatMillimetresAt` / `formatGaugeAt`). A snapshot that re-derived it
 * would be a second place a millimetre could be computed, and a photo carrying a number without its
 * dpi is exactly what the measuring stack refuses to produce.
 */
export type SnapshotMark =
  | Annotation
  | { kind: "distance" | "box"; a: ScanPoint; b: ScanPoint; label: string };

export interface SnapshotRequest {
  photoId: string;
  /** The part of the picture to keep, in the picture's own frame. */
  region: Box;
  marks: SnapshotMark[];
  title: string;
}

/** What a snapshot is called when the collector does not say. */
export const DEFAULT_SNAPSHOT_TITLE = "Detail";
export const MAX_SNAPSHOT_TITLE = 120;
export const MAX_SNAPSHOT_LABEL = 120;
/** Far above anything drawn by hand; it bounds what one request can make the server render. */
export const MAX_SNAPSHOT_MARKS = 100;
/** A snapshot is at least this large on its longest edge. A detail zoomed deep into is a few dozen
 * source pixels across, and kept at that size it is a thumbnail of itself: enlarging it adds no
 * detail, but it keeps the marks and the figure legible at the size the photo is looked at. */
export const MIN_SNAPSHOT_EDGE = 800;
/** Below this on either edge a region is a slip of the hand rather than a detail. */
export const MIN_SNAPSHOT_REGION = 4;

/**
 * An annotation from the two ends of a drag, or null when the drag drew nothing: a ring needs a
 * width **and** a height, and a line needs a length. A click that never became a drag is not a mark.
 */
export function annotationFromDrag(kind: AnnotationKind, a: ScanPoint, b: ScanPoint): Annotation | null {
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (kind === "ellipse" ? w <= 0 || h <= 0 : Math.hypot(w, h) <= 0) return null;
  return { kind, a, b };
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
  const { photoId, region, marks, title } = raw;
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

  return {
    photoId,
    region: box as Box,
    marks: parsed,
    title: name,
  };
}

function parseMark(raw: unknown): SnapshotMark | null {
  if (!isRecord(raw)) return null;
  const a = parsePoint(raw.a);
  const b = parsePoint(raw.b);
  if (!a || !b) return null;
  if (raw.kind === "ellipse" || raw.kind === "line") return { kind: raw.kind, a, b };
  if (raw.kind === "distance" || raw.kind === "box") {
    if (typeof raw.label !== "string") return null;
    const label = raw.label.trim();
    if (!label || label.length > MAX_SNAPSHOT_LABEL) return null;
    return { kind: raw.kind, a, b, label };
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
 * The marks as one SVG the size of the snapshot, to composite over the cropped picture.
 *
 * Every shape is drawn twice, dark under light — the viewer's own rule, for the viewer's reason: a
 * stamp is white paper in some places and printing ink in others, and a single stroke colour vanishes
 * over one of them. Strokes and type scale with the output rather than staying at screen pixels, so
 * the marks read the same on a 800 px snapshot as on a 2500 px one.
 *
 * A figure sits in a dark plate above the end of its line (or above the box's lower corner), where the
 * viewer puts it, nudged inside the picture when that would cut it off.
 */
export function snapshotOverlaySvg(
  marks: readonly SnapshotMark[],
  region: Box,
  out: { width: number; height: number }
): string {
  const sx = out.width / region.w;
  const sy = out.height / region.h;
  const px = (p: ScanPoint) => ({ x: round((p.x - region.x) * sx), y: round((p.y - region.y) * sy) });
  const unit = Math.max(1, round(Math.max(out.width, out.height) / 600));
  const dark = `stroke="rgba(0,0,0,0.65)" stroke-width="${round(unit * 3)}"`;
  const light = `stroke="#ffffff" stroke-width="${unit}"`;
  const fontSize = Math.max(11, Math.round(Math.max(out.width, out.height) / 45));

  const parts: string[] = [];
  const labels: string[] = [];
  for (const mark of marks) {
    const a = px(mark.a);
    const b = px(mark.b);
    if (mark.kind === "ellipse" || mark.kind === "box") {
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = round(Math.abs(b.x - a.x));
      const h = round(Math.abs(b.y - a.y));
      if (mark.kind === "ellipse") {
        const cx = round(x + w / 2);
        const cy = round(y + h / 2);
        const shape = `cx="${cx}" cy="${cy}" rx="${round(w / 2)}" ry="${round(h / 2)}" fill="none"`;
        parts.push(`<ellipse ${shape} ${dark}/>`, `<ellipse ${shape} ${light}/>`);
      } else {
        const shape = `x="${x}" y="${y}" width="${w}" height="${h}" fill="none"`;
        parts.push(`<rect ${shape} ${dark}/>`, `<rect ${shape} ${light}/>`);
      }
    } else {
      const shape = `x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"`;
      parts.push(`<line ${shape} ${dark}/>`, `<line ${shape} ${light}/>`);
      if (mark.kind === "distance") {
        // Rings rather than dots, as on screen: the thing aimed at is the centre of a hole.
        for (const p of [a, b]) {
          parts.push(
            `<circle cx="${p.x}" cy="${p.y}" r="${round(unit * 4)}" fill="none" ${dark}/>`,
            `<circle cx="${p.x}" cy="${p.y}" r="${round(unit * 4)}" fill="none" ${light}/>`
          );
        }
      }
    }
    if (mark.kind === "distance" || mark.kind === "box") {
      labels.push(labelPlate(mark.label, b, fontSize, out));
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${out.width}" height="${out.height}">` +
    parts.join("") +
    labels.join("") +
    `</svg>`
  );
}

/** Font the snapshot figure is set in — the collage labels' stack (#312), which the image ships the
 * faces for (`Dockerfile`), so the server renders the same glyphs on every deployment. */
const SNAPSHOT_FONT_FAMILY = "DejaVu Sans, Verdana, Arial, Helvetica, sans-serif";

function labelPlate(
  text: string,
  at: { x: number; y: number },
  fontSize: number,
  out: { width: number; height: number }
): string {
  const padX = round(fontSize * 0.4);
  const padY = round(fontSize * 0.25);
  // An estimate rather than a measurement — there is no font metrics on this side — and a generous
  // one: a plate slightly wide is a margin, a plate too narrow cuts the figure.
  const width = round(text.length * fontSize * 0.62 + padX * 2);
  const height = round(fontSize * 1.2 + padY * 2);
  const x = round(clamp(at.x - width / 2, 0, Math.max(0, out.width - width)));
  const y = round(clamp(at.y - height - fontSize * 0.75, 0, Math.max(0, out.height - height)));
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${round(fontSize * 0.25)}" fill="rgba(17,17,17,0.85)"/>` +
    `<text x="${round(x + width / 2)}" y="${round(y + padY + fontSize * 0.95)}" font-family="${SNAPSHOT_FONT_FAMILY}" font-size="${fontSize}" font-weight="600" fill="#ffffff" text-anchor="middle">${escapeXml(text)}</text>`
  );
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

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
