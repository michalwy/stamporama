// Laying a reference over a stamp (#1004, ADR-0049 §5): the similarity transform that puts one
// picture on the other, found from two landmarks clicked on each, and the rule for when the scale it
// applied may be shown.
//
// **Two photos with no shared geometry.** The collector's side is a scan tile at a stated dpi or a
// plain photo of a held copy; the reference is nearly always a screenshot from an auction, Colnect or
// a forum, with no dpi at all. So nothing here converts to millimetres and nothing assumes the two
// have the same resolution: the transform maps the reference's own pixels onto the stamp's own
// pixels (the **stage** — a tile's box in scan pixels, or the photo's pixels where there is no box),
// and that is the whole of what it knows.
//
// **The applied scale is a result, never a setting.** Photo-lithographic forgeries differ in the size
// of the printed design by a few percent, and a fit-to-eye slider is adjusted until that difference is
// gone and never says what it absorbed. Two landmarks on each picture fix scale, rotation and
// translation together, and the scale they fix is shown as a number. An alignment made by hand shows
// **no** figure — a scale derived from dragging a mouse is a number nobody can check — which is the
// line `formatGaugeAt` already holds by printing *11½ at 1200 dpi* rather than *11½*.
// {@link appliedScaleFigure} is where that rule lives, so it is one unit test rather than a habit.
//
// Pure — no DOM, no React, no Prisma — beside `scan-viewport.ts`, whose view transform the overlay is
// drawn through. Nothing here states anything about authenticity, and it must not begin to.

import type { Viewport } from "./scan-viewport";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Where the reference lies on the stage: a reference pixel `p` is drawn at
 * `(x, y) + R(rotation) · (scale · p)`, in stage pixels.
 *
 * Rotation is in **degrees**, clockwise on screen (y grows downwards), normalised to (−180, 180].
 * Degrees because the only rotation a collector makes by hand here is a skew of a degree or two, and
 * that is the unit the step buttons speak.
 */
export interface Placement {
  scale: number;
  rotation: number;
  x: number;
  y: number;
}

/** How the placement on screen was arrived at. */
export type AlignmentMethod = "unaligned" | "landmarks" | "manual";

export interface Alignment {
  method: AlignmentMethod;
  placement: Placement;
}

/** Below this many pixels apart, two landmarks on one picture say nothing about scale or rotation —
 * a double click, or a second click meant for the other picture. */
export const MIN_LANDMARK_SEPARATION = 4;

/** Two landmarks per picture, and never more: two points fix a similarity exactly, and a third would
 * need a fit whose residual is a second number to explain. */
export const LANDMARKS_PER_PICTURE = 2;

/** One press of a skew step, in degrees — a scan laid a little crooked is off by one or two. */
export const ROTATE_STEP_DEG = 0.25;

/** One press of a scale step by hand, as a factor. Shown as a step, never accumulated into a
 * figure. */
export const SCALE_STEP = 1.005;

const RAD = Math.PI / 180;

function normaliseDegrees(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/** A reference pixel, as a stage pixel. */
export function mapReferencePoint(pl: Placement, p: Point): Point {
  const c = Math.cos(pl.rotation * RAD);
  const s = Math.sin(pl.rotation * RAD);
  return {
    x: pl.x + pl.scale * (c * p.x - s * p.y),
    y: pl.y + pl.scale * (s * p.x + c * p.y),
  };
}

/** A stage pixel, as a reference pixel — the inverse of {@link mapReferencePoint}. */
export function unmapStagePoint(pl: Placement, q: Point): Point {
  if (pl.scale <= 0) return { x: 0, y: 0 };
  const c = Math.cos(pl.rotation * RAD);
  const s = Math.sin(pl.rotation * RAD);
  const dx = (q.x - pl.x) / pl.scale;
  const dy = (q.y - pl.y) / pl.scale;
  return { x: c * dx + s * dy, y: -s * dx + c * dy };
}

/**
 * The placement that puts the reference's two landmarks on the stamp's two, in order: reference
 * landmark 1 onto stamp landmark 1, 2 onto 2.
 *
 * Null when either pair is missing a point or its two points are too close together to say anything
 * ({@link MIN_LANDMARK_SEPARATION}) — the caller then has no alignment rather than a wild one.
 */
export function placementFromLandmarks(
  stamp: readonly Point[],
  reference: readonly Point[]
): Placement | null {
  if (stamp.length < LANDMARKS_PER_PICTURE || reference.length < LANDMARKS_PER_PICTURE) return null;
  const [a1, a2] = stamp;
  const [b1, b2] = reference;
  const ax = a2.x - a1.x;
  const ay = a2.y - a1.y;
  const bx = b2.x - b1.x;
  const by = b2.y - b1.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < MIN_LANDMARK_SEPARATION || lb < MIN_LANDMARK_SEPARATION) return null;

  const scale = la / lb;
  const rotation = normaliseDegrees((Math.atan2(ay, ax) - Math.atan2(by, bx)) / RAD);
  // Whatever lands reference landmark 1 on stamp landmark 1 once scaled and turned.
  const turned = mapReferencePoint({ scale, rotation, x: 0, y: 0 }, b1);
  return { scale, rotation, x: a1.x - turned.x, y: a1.y - turned.y };
}

/**
 * The reference centred over the stamp and fitted inside it, unturned — where it is drawn before
 * anything has been aligned. **Not a finding**: the scale this picks is the ratio of two picture sizes,
 * which says nothing about either design, and it is never shown.
 */
export function fittedPlacement(stamp: Size, reference: Size): Placement {
  if (reference.width <= 0 || reference.height <= 0 || stamp.width <= 0 || stamp.height <= 0) {
    return { scale: 1, rotation: 0, x: 0, y: 0 };
  }
  const scale = Math.min(stamp.width / reference.width, stamp.height / reference.height);
  return {
    scale,
    rotation: 0,
    x: (stamp.width - reference.width * scale) / 2,
    y: (stamp.height - reference.height * scale) / 2,
  };
}

/** Move the reference by a stage-pixel delta. */
export function translatePlacement(pl: Placement, dx: number, dy: number): Placement {
  return { ...pl, x: pl.x + dx, y: pl.y + dy };
}

/** Turn the reference by `deg` about a stage point, which stays where it is. */
export function rotatePlacementAbout(pl: Placement, deg: number, pivot: Point): Placement {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  const dx = pl.x - pivot.x;
  const dy = pl.y - pivot.y;
  return {
    scale: pl.scale,
    rotation: normaliseDegrees(pl.rotation + deg),
    x: pivot.x + c * dx - s * dy,
    y: pivot.y + s * dx + c * dy,
  };
}

/** Scale the reference by `factor` about a stage point, which stays where it is. */
export function scalePlacementAbout(pl: Placement, factor: number, pivot: Point): Placement {
  if (!(factor > 0)) return pl;
  return {
    scale: pl.scale * factor,
    rotation: pl.rotation,
    x: pivot.x + factor * (pl.x - pivot.x),
    y: pivot.y + factor * (pl.y - pivot.y),
  };
}

/** The middle of the reference, where it is drawn — what a step by hand turns and scales about, so
 * the picture stays under the eye instead of swinging round its corner. */
export function referenceCentre(pl: Placement, reference: Size): Point {
  return mapReferencePoint(pl, { x: reference.width / 2, y: reference.height / 2 });
}

/**
 * The CSS `matrix()` that draws the reference — an element of its own natural size with its
 * transform origin at the top-left corner — inside a viewport showing the stage through `view`.
 *
 * The stage is drawn as `offset + view.scale · stage`, so the two transforms compose into one: the
 * reference is never drawn through a nested transform whose rounding could drift from the stamp's.
 */
export function referenceMatrix(view: Viewport, pl: Placement): [number, number, number, number, number, number] {
  const k = view.scale * pl.scale;
  const c = Math.cos(pl.rotation * RAD);
  const s = Math.sin(pl.rotation * RAD);
  return [k * c, k * s, -k * s, k * c, view.offsetX + view.scale * pl.x, view.offsetY + view.scale * pl.y];
}

/**
 * How the pair is aligned now.
 *
 * A placement made by hand wins while it exists — it was made after whatever came before it, and
 * moving a landmark is what clears it (the caller's job, since only the caller knows a landmark moved).
 * Otherwise two complete, usable pairs of landmarks align it; otherwise it is merely fitted.
 */
export function resolveAlignment(args: {
  stamp: Size;
  reference: Size;
  stampLandmarks: readonly Point[];
  referenceLandmarks: readonly Point[];
  manual: Placement | null;
}): Alignment {
  if (args.manual) return { method: "manual", placement: args.manual };
  const fromLandmarks = placementFromLandmarks(args.stampLandmarks, args.referenceLandmarks);
  if (fromLandmarks) return { method: "landmarks", placement: fromLandmarks };
  return { method: "unaligned", placement: fittedPlacement(args.stamp, args.reference) };
}

/** The applied scale as it is printed: `×1.034`. Three decimals, because the difference it exists to
 * show is a few percent and two decimals would round most of it away. */
export function formatAppliedScale(scale: number): string {
  return `×${scale.toFixed(3)}`;
}

/**
 * The figure an alignment may show, or null.
 *
 * **Only an alignment on landmarks has one.** By hand there is no figure at all, and before any
 * alignment the fitted scale is the ratio of two picture sizes — both are numbers nobody can check,
 * and printing either beside the one that can be checked would make the three indistinguishable.
 */
export function appliedScaleFigure(alignment: Alignment): string | null {
  return alignment.method === "landmarks" ? formatAppliedScale(alignment.placement.scale) : null;
}

/**
 * Which landmark a press lands on, if any: the nearest one within `radius` picture pixels, so a
 * landmark placed a little off can be dragged into place rather than placed again.
 */
export function landmarkAt(landmarks: readonly Point[], at: Point, radius: number): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  landmarks.forEach((p, i) => {
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    if (d <= radius && d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/**
 * The landmarks after a click that is not on one: the next one is placed while there are fewer than
 * two, and once both are down the **nearer** of them moves — a third click is a correction, and
 * starting the pair again would throw away the one that was right.
 */
export function withLandmark(landmarks: readonly Point[], at: Point): Point[] {
  if (landmarks.length < LANDMARKS_PER_PICTURE) return [...landmarks, at];
  const nearest =
    Math.hypot(landmarks[0].x - at.x, landmarks[0].y - at.y) <=
    Math.hypot(landmarks[1].x - at.x, landmarks[1].y - at.y)
      ? 0
      : 1;
  return landmarks.map((p, i) => (i === nearest ? at : p));
}
