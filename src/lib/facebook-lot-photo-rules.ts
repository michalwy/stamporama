// A lot's one photo in a captioned Facebook post (#1841; ADR-0061 §2 as amended) — pure, no Prisma
// and no image library, so the arrangement is decided and tested apart from the pixels.
//
// In a captioned post each lot is **exactly one photo**, its caption the lot's text, so one photo is
// one price. A lot that already is one photo uses it as it is. A lot of several is joined into one
// image here, from the images its offer would upload — its upload set, in plan order, the collector's
// own marks and order included — laid out with the offer's collage settings:
//
// - **Fronts and backs are two halves.** The fronts' images form one half and the backs' the other,
//   each in the same grid, so a back sits where its front does in the other half: a back is matched to
//   its front by the pair the plan rendered them from. A paired image (#694) and an attachment are
//   fronts with no back, and so is a back whose front is held back. A lot photographing fronts only
//   has one half and no separator.
// - **A visible separator** runs between the halves — a line across the gap, in a tone that stands
//   out from the collage's background.
// - **Side by side or one above the other, whichever brings the result closer to the shape the
//   offer's collage aims at** (#1699) — its auto grid's target shape, and square when it names none
//   (a fixed grid). With the offer's auto grid, the halves' column count is chosen with the direction;
//   with a fixed grid it is the offer's own column count. The cost is the auto grid's own pair of
//   terms: empty cells, and the log distance outside the target band.
// - Images keep their native size — the stamps on them are already on one scale (#310) — and each
//   cell is as large as the larger of its front and back, both centred in it.

import { COLLAGE_SHAPE_BANDS } from "./collage-layout";
import type { CollageGridMode, CollageGridShape } from "./collage-template-rules";

/** One image of a lot's upload set, as the arrangement needs it. */
export interface LotPhotoImage {
  width: number;
  height: number;
  /** `front`, `back`, `paired`, or null for an attachment. */
  side: string | null;
  /** The front/back pair the image was rendered for; null for an attachment. */
  pairKey: string | null;
}

/** The offer's collage settings the arrangement reads. */
export interface LotPhotoCollage {
  gridMode: CollageGridMode;
  gridShape: CollageGridShape;
  /** Tiles per row in `fixed` mode. */
  columns: number;
  /** The gap between tiles and around the whole, as a percent of the median tile height (#312). */
  gapPercent: number;
}

/** Where an image goes on the joined canvas — its top-left corner, at native size. */
export interface LotPhotoPlacement {
  image: number;
  x: number;
  y: number;
}

export type LotPhotoDirection = "sideBySide" | "stacked";

/** The one photo a lot contributes: one of its images as it is, or several joined. */
export type LotPhotoArrangement =
  | { kind: "asIs"; image: number }
  | {
      kind: "joined";
      width: number;
      height: number;
      columns: number;
      /** Null when the lot has fronts only — one half, no separator. */
      direction: LotPhotoDirection | null;
      placements: LotPhotoPlacement[];
      /** The line between the halves; null with one half. */
      separator: { x: number; y: number; width: number; height: number } | null;
    };

/** What a step away from the target shape costs, in empty cells — the auto grid's weight (#526). */
const SHAPE_WEIGHT = 3;

/** How thick the separator line is, as a share of the median cell height — thin, but never under
 *  two pixels, so it survives the downscale to a feed. */
const SEPARATOR_SHARE = 0.006;
const SEPARATOR_MIN = 2;

function shapePenalty(width: number, height: number, band: { min: number; max: number }): number {
  const ratio = width / height;
  if (ratio < band.min) return Math.log(band.min / ratio);
  if (ratio > band.max) return Math.log(ratio / band.max);
  return 0;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/** The fronts in plan order, each with the back rendered from the same copies. */
function pairUp(images: readonly LotPhotoImage[]): { front: number; back: number | null }[] {
  const isBack = (img: LotPhotoImage) => img.side === "back";
  const backs = new Map<string, number>();
  images.forEach((img, i) => {
    if (isBack(img) && img.pairKey && !backs.has(img.pairKey)) backs.set(img.pairKey, i);
  });
  const fronts = images.flatMap((img, i) => (isBack(img) ? [] : [i]));
  const matched = new Set<number>();
  const cells = fronts.map((front) => {
    const key = images[front].pairKey;
    const back = key && images[front].side === "front" ? (backs.get(key) ?? null) : null;
    if (back !== null) matched.add(back);
    return { front, back };
  });
  // A back whose front is not in the upload set is still a photo of the lot: it stands as its own
  // cell, in plan order among the rest.
  const orphans = images.flatMap((img, i) => (isBack(img) && !matched.has(i) ? [i] : []));
  return [...cells, ...orphans.map((back) => ({ front: back, back: null }))].sort((a, b) => a.front - b.front);
}

interface Half {
  width: number;
  height: number;
  /** Each cell's box within the half. */
  boxes: { x: number; y: number; width: number; height: number }[];
  rows: number;
}

function layOutHalf(cells: readonly { width: number; height: number }[], columns: number, gap: number): Half {
  const rows: { cells: number[]; width: number; height: number }[] = [];
  for (let i = 0; i < cells.length; i += columns) {
    const members = cells.slice(i, i + columns).map((_, k) => i + k);
    rows.push({
      cells: members,
      width: members.reduce((sum, c) => sum + cells[c].width, 0) + gap * (members.length - 1),
      height: members.reduce((tallest, c) => Math.max(tallest, cells[c].height), 0),
    });
  }
  const width = rows.reduce((widest, row) => Math.max(widest, row.width), 0);
  const boxes: Half["boxes"] = [];
  let y = 0;
  for (const row of rows) {
    // Each row centred, as a short last row of a collage reads best.
    let x = Math.floor((width - row.width) / 2);
    for (const c of row.cells) {
      boxes[c] = { x, y, width: cells[c].width, height: row.height };
      x += cells[c].width + gap;
    }
    y += row.height + gap;
  }
  return { width, height: y - gap, boxes, rows: rows.length };
}

/**
 * The one photo a lot contributes to a captioned post (#1841): its only image as it is, or its images
 * joined — fronts and backs as two halves in one grid, with a separator, side by side or stacked
 * toward the collage's target shape.
 */
export function arrangeFacebookLotPhoto(
  images: readonly LotPhotoImage[],
  collage: LotPhotoCollage
): LotPhotoArrangement | null {
  if (images.length === 0) return null;
  if (images.length === 1) return { kind: "asIs", image: 0 };

  const pairs = pairUp(images);
  const twoHalves = pairs.some((p) => p.back !== null);
  const cells = pairs.map(({ front, back }) => ({
    width: Math.max(images[front].width, back === null ? 0 : images[back].width),
    height: Math.max(images[front].height, back === null ? 0 : images[back].height),
  }));
  const reference = median(cells.map((c) => c.height));
  const gap = Math.max(0, Math.round((reference * Math.max(0, collage.gapPercent)) / 100));
  const line = Math.max(SEPARATOR_MIN, Math.round(reference * SEPARATOR_SHARE));
  // The separator stands in a gap of its own on either side, so it never touches a stamp.
  const band = gap * 2 + line;
  const shape = COLLAGE_SHAPE_BANDS[collage.gridMode === "auto" ? collage.gridShape : "square"];

  const columnChoices =
    collage.gridMode === "auto"
      ? Array.from({ length: pairs.length }, (_, i) => i + 1)
      : [Math.min(pairs.length, Math.max(1, Math.round(collage.columns)))];
  const directions: (LotPhotoDirection | null)[] = twoHalves ? ["sideBySide", "stacked"] : [null];

  let best: { columns: number; direction: LotPhotoDirection | null; half: Half; cost: number } | null = null;
  // Ties go to side by side, then to the wider grid: text sits beside an image in a feed as on a
  // marketplace page, so height costs more than width (#413's rule).
  for (const direction of directions) {
    for (const columns of columnChoices) {
      const half = layOutHalf(cells, columns, gap);
      const width = direction === "sideBySide" ? half.width * 2 + band : half.width;
      const height = direction === "stacked" ? half.height * 2 + band : half.height;
      const empty = half.rows * columns - pairs.length;
      const cost = empty + SHAPE_WEIGHT * shapePenalty(width + gap * 2, height + gap * 2, shape);
      const cheaper = !best || cost < best.cost - 1e-9;
      const widerTie =
        best !== null && Math.abs(cost - best.cost) <= 1e-9 && direction === best.direction && columns > best.columns;
      if (cheaper || widerTie) best = { columns, direction, half, cost };
    }
  }
  const { columns, direction, half } = best!;

  // The second half starts past the first and the separator's band.
  const offset = direction === "sideBySide" ? { x: half.width + band, y: 0 } : direction === "stacked" ? { x: 0, y: half.height + band } : null;
  const place = (image: number, box: Half["boxes"][number], shift: { x: number; y: number }): LotPhotoPlacement => ({
    image,
    x: gap + shift.x + box.x + Math.floor((box.width - images[image].width) / 2),
    y: gap + shift.y + box.y + Math.floor((box.height - images[image].height) / 2),
  });
  const placements: LotPhotoPlacement[] = [];
  pairs.forEach(({ front, back }, i) => {
    placements.push(place(front, half.boxes[i], { x: 0, y: 0 }));
    if (back !== null && offset) placements.push(place(back, half.boxes[i], offset));
  });

  const width = (direction === "sideBySide" ? half.width * 2 + band : half.width) + gap * 2;
  const height = (direction === "stacked" ? half.height * 2 + band : half.height) + gap * 2;
  const separator =
    direction === "sideBySide"
      ? { x: gap + half.width + gap, y: gap, width: line, height: half.height }
      : direction === "stacked"
        ? { x: gap, y: gap + half.height + gap, width: half.width, height: line }
        : null;
  return { kind: "joined", width, height, columns, direction, placements, separator };
}

/** The separator's colour: a mid grey leaning away from the background, so it reads on black and on
 *  white alike. */
export function lotPhotoSeparatorColor(background: string): string {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(background.trim());
  const [r, g, b] = match ? match.slice(1).map((h) => parseInt(h, 16) / 255) : [0, 0, 0];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 0.5 ? "#a6a6a6" : "#595959";
}

// ── Stored, not drawn on every view (#1861) ───────────────────────────────────────────────────────
//
// The photo is drawn once, in the background, and stored. What decides whether the stored one is
// still the lot's is a fingerprint of everything it is drawn from — the images, in order, with the
// facts the arrangement reads off them, and the offer's collage settings and its platform's limits —
// so a change to any of them, and to nothing else, rebuilds it.

/** Raised when a drawing change should rebuild every stored lot photo. */
export const FACEBOOK_LOT_PHOTO_DRAWING = 1;

/** Everything a lot's photo is drawn from, as it is fingerprinted. */
export interface LotPhotoSource {
  /** The upload set in plan order. The photo id stands for the bytes: a regenerated image is a new
   *  photo, a reorder or a held-back image a different list. */
  images: readonly (LotPhotoImage & { photoId: string })[];
  collage: LotPhotoCollage;
  background: string;
  maxEdge: number | null;
  maxBytes: number | null;
}

/** The canonical text a lot photo's fingerprint is the hash of — every input, in a fixed order. */
export function lotPhotoFingerprintPayload(source: LotPhotoSource): string {
  return JSON.stringify([
    FACEBOOK_LOT_PHOTO_DRAWING,
    source.images.map((i) => [i.photoId, i.side, i.pairKey, i.width, i.height]),
    [source.collage.gridMode, source.collage.gridShape, source.collage.columns, source.collage.gapPercent],
    source.background,
    source.maxEdge,
    source.maxBytes,
  ]);
}

/** A lot's photo as the post's screen shows it. */
export type FacebookLotPhotoState =
  | { status: "ready"; photoId: string }
  | { status: "generating" }
  | { status: "failed"; error: string }
  /** Nothing to draw it from — the offer has no images going up. */
  | { status: "none"; reason: string };

/** The stored row, as the decision reads it. */
export interface StoredLotPhoto {
  status: string;
  fingerprint: string | null;
  photoId: string | null;
  error: string | null;
}

/** What to do about a lot's stored photo, and what the screen shows meanwhile. */
export interface LotPhotoDecision {
  state: FacebookLotPhotoState;
  /** `enqueue` draws it (again); `drop` deletes the stored row and image. */
  action: "enqueue" | "drop" | null;
}

/**
 * Whether a lot's stored photo is the one to show, or has to be drawn (again) or dropped (#1861).
 *
 * - Not wanted — the lot is in no captioned post — is dropped.
 * - A run queued or under way is shown as such, whatever is stored.
 * - **A published lot keeps the photo it went up with** (as its text is frozen, #1800), however its
 *   images have changed since. A repost keeps it too: the repost dialog shows no photos, so what goes
 *   up again is the photo the post's screen showed.
 * - Nothing to draw it from — the offer has no images going up — is said so, and a stored photo of an
 *   unpublished lot goes: it would be an image of nothing the offer now uploads.
 * - A stored photo of the current fingerprint is served; a failure on the current fingerprint stays
 *   failed until something it is drawn from changes, so a broken image is not retried in a loop.
 * - Anything else is queued, and is never served stale meanwhile.
 */
export function decideLotPhoto(input: {
  wanted: boolean;
  posted: boolean;
  stored: StoredLotPhoto | null;
  current: { fingerprint: string } | { reason: string };
}): LotPhotoDecision {
  const { stored, current } = input;
  if (!input.wanted) return { state: { status: "none", reason: "" }, action: stored ? "drop" : null };
  if (stored && (stored.status === "queued" || stored.status === "running")) {
    return { state: { status: "generating" }, action: null };
  }
  const fresh = "fingerprint" in current && stored?.fingerprint === current.fingerprint;
  if (stored?.photoId && stored.status === "ready" && input.posted) {
    return { state: { status: "ready", photoId: stored.photoId }, action: null };
  }
  if ("reason" in current) {
    return { state: { status: "none", reason: current.reason }, action: stored ? "drop" : null };
  }
  if (fresh && stored?.status === "ready" && stored.photoId) {
    return { state: { status: "ready", photoId: stored.photoId }, action: null };
  }
  if (fresh && stored?.status === "failed") {
    return { state: { status: "failed", error: stored.error ?? "The photo could not be drawn." }, action: null };
  }
  return { state: { status: "generating" }, action: "enqueue" };
}

/** Why a captioned post's photos cannot be downloaded yet, or null when every lot's photo is ready or
 *  has nothing to be drawn from (#1861) — the archive is refused until it is whole. */
export function lotPhotosNotReady(
  lots: readonly { lotNo: number; state: FacebookLotPhotoState }[]
): string | null {
  const named = (status: FacebookLotPhotoState["status"]) => {
    const numbers = lots.filter((l) => l.state.status === status).map((l) => l.lotNo);
    if (numbers.length === 0) return null;
    return numbers.length === 1 ? `The photo of lot ${numbers[0]} is` : `The photos of lots ${numbers.join(", ")} are`;
  };
  const generating = named("generating");
  if (generating) return `${generating} still being generated — download the photos once they are ready.`;
  const failed = named("failed");
  if (failed) return `${failed} not generated: drawing failed — see the post's screen.`;
  return null;
}
