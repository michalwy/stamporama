import sharp from "sharp";
import { orientedSize } from "./photos/process";
import { readingOrder, type Box } from "./scan-boxes";

/**
 * Finding the stamps on a card scan (#574, ADR-0033).
 *
 * A proposal for #566's editor and nothing more: the boxes it returns are handed to the very same
 * functions a hand-drawn box is, and the editor is where they are corrected. Detection quality
 * decides how often that repair is reached, never whether it exists.
 *
 * ## There is no grid
 *
 * Nothing about the layout is fixed. Stamps differ in size, sit irregularly, and a card carries
 * anywhere from one souvenir sheet to sixty definitives. So the pieces are found by separating them
 * from the **background** — a binary mask and its connected regions — never by dividing the card
 * into cells.
 *
 * The background is black, because the stamps are laid on black stockbook cards. That is a constant
 * of the routine, not a happy accident.
 *
 * ## What this deliberately is not
 *
 * **Not Otsu, and not a global greyscale threshold** (`sharp.threshold()` is one). The reference
 * implementation tried it and a single stamp's own artwork came apart into 13–24 "stamps": a pale
 * sky and a dark cliff on one piece of paper are further apart in brightness than the cliff is from
 * the card. Thresholding on **distance from an estimated background colour** is what fixed it, and
 * it is the one decision here that must not be simplified back.
 *
 * **No fill-ratio filter** — the usual way to drop shadows and streaks, and it throws away exactly
 * the triangles and diamonds, which fill about half of their bounding box. **No aspect-ratio
 * filter** — a strip of five is as legitimately one piece as a square block. **No maximum area** —
 * a souvenir sheet fills most of a card.
 *
 * **No filter for reference slips.** A white paper slip laid on the card reads as a piece and is
 * returned as one; the collector discards it while identifying. Two thresholds fitted against the
 * two examples left in the corpus would be fitting to noise, and the errors are asymmetric anyway:
 * a surviving slip costs one click, a stamp wrongly dropped is simply absent from a card that has
 * already been broken up, with nothing on screen saying so.
 *
 * ## What it cannot do at any tuning
 *
 * **What is joined stays one region.** A se-tenant pair, a block, a strip: attached, so one region
 * and one tile. Separating them would need a periodicity model rather than blob detection, and
 * would be wrong anyway — a pair is one copy with a format (ADR-0020).
 *
 * **Interlocking perforations are an information limit.** Where two stamps abut teeth into teeth
 * the seam is white paper against white paper and no threshold finds it; the reference eroded to 14
 * iterations without splitting one. The fix is physical — leave about a tooth of gap when laying
 * the card out — and it is in the user guide for that reason.
 */

// ── The constants, and what they were fitted to ────────────────────────────────────────────────
//
// **Fitted on eight real stockbook cards, 120 physical pieces, all scanned at 1200 dpi** — the set
// in `tests/fixtures/scans/`, whose README says what each card is for. It spans one souvenir sheet
// filling a card, two cards of 28 and 29 small definitives, mixed sizes with two souvenir sheets
// beside definitives, joined pairs and a block of four, stamps on cut envelope paper, dark stamps
// on the black card, and two legacy reference slips.
//
// **Measured error: 2 pieces of 120 need a hand — 1.7%.** Both are the documented limits rather
// than tuning failures: one pair of definitives whose perforations interlock came out as one box,
// and one stamp-plus-coupon came out as two. Each is one click in the editor (Split, Merge). The
// reference implementation reported ~1.6% of stamps over ~1,450 photos, so the method survives the
// change of density — but see the harness's own note that a count is a lower bound, and that
// placement was verified by rendering the boxes over each card and looking at them.
//
// Three of these values were **refitted** for a card of dozens; the reference's corpus was 1–8
// stamps per photo, where everything relative to the frame meant something else:
//
// - the **working resolution** (900 → 2600), because a card of forty at 900 px puts a stamp at
//   ~100 px, and the gap between two neighbours below one;
// - the **erosion radius**, now tied to that resolution rather than carried over as 4 px;
// - the **minimum area**, stated physically instead of as `0.004 × frame`.
//
// And one had to be refitted for a difference the issue did not anticipate: the **threshold floor**
// (28 → 52). A flatbed at 1200 dpi resolves the stockbook card's own surface — the ridges its rows
// are creased along, its weave, loose fibres — which a phone photograph of a few stamps did not.
// At 28 those ridges were foreground: they run under a whole row of stamps, join their bottom
// edges, and once the row is a closed ring the hole fill takes the gaps between the stamps as
// interior. That, and not the perforations, is what merged a row of six into one box, and no
// erosion up to 5% of the working size undid it. The plateau is broad (48–58 all give the same
// answer) and the cliff above it is sharp: at 60 a stamp's own perforation halo starts being cut
// off its design.
//
// The reference's **whole-frame escape** (`mean(mask) > 0.90` → return one box) is deliberately not
// ported: a stockbook card always shows a black margin, so the case cannot arise, while a densely
// packed card can approach that coverage — and the failure it would produce is the entire card as a
// single tile, the worst outcome this step has. `2026-08-14-0005.jpg` is the proof: a souvenir
// sheet filling a card, mask coverage 81%, and one correct box.
//
// **Re-run the harness after every change to any of them.** In the reference implementation a
// change to the background estimator silently altered the result on 558 of 1,429 photos, and only
// a fixed set of real scans caught it.

/** Longest side the mask is computed at. The reference worked at 900 px, where a photo of 1–8
 * stamps put one piece at ~300 px; a card of forty at 900 px puts one at ~100 px, where an erosion
 * that took 1.3% of a stamp's width takes 8% of it — and where the gap between two neighbours is
 * under a pixel. Raised until a small definitive is back to a few hundred pixels. Cost is roughly
 * linear in pixels and the whole pass is ~1 s on a 66 Mpx card, JPEG shrink-on-load meaning it is
 * never decoded at full size. */
const WORKING_MAX_EDGE = 2600;

/** Radius of the erosion that separates pieces touching along a line, as a fraction of the working
 * image's longest edge — so it moves with {@link WORKING_MAX_EDGE}, which is the point of
 * expressing it this way rather than carrying the reference's 4 px over to a different scale. Raising it further
 * does not buy separation and does cost it: at 5× this the mask starts breaking single stamps at
 * their own gutters, which is a worse error than the merge it was aimed at. */
const EROSION_RADIUS_FRACTION = 0.004;

/** Smallest region kept, in **square millimetres of card**. Physical rather than a fraction of the
 * frame: `0.004 × frame` is a different real size on a card of eight than on a card of sixty, and
 * the thing being excluded — a fibre, a speck of dust, the corner of a shadow — has a physical size
 * and not a relative one. Well under the smallest stamp worth mounting (a 15×18 mm definitive is
 * 270 mm²) and well over the largest speck; anything from 30 to 120 mm² gives the same answer on
 * the set, and 10 does not. */
const MIN_PIECE_AREA_MM2 = 30;

/** Fallback for a scan whose file records no usable resolution, as a fraction of the **median**
 * region's area. Relative to the median rather than to the sheet, for the same reason the physical
 * rule exists: the median region is a piece on this card, whereas a fraction of the sheet is a
 * different stamp on every card. Only reached when the image carries no density — every scanner
 * this routine uses writes one. */
const MIN_PIECE_MEDIAN_FRACTION = 0.05;

/** Below this, a `density` is a decoder's default rather than a scanner's measurement (`sharp`
 * reports 72 for a JPEG with no JFIF density unit), and the physical rule would be nonsense. */
const MIN_TRUSTED_DENSITY_DPI = 150;

/** Grown outward on every side after scaling back, in **millimetres of card**. The mask stops at
 * the last pixel that differs from the card, and a perforation tooth's tip is the faintest part of
 * a stamp; a crop flush to the mask clips teeth. Small enough that two pieces a tooth apart still
 * come out as two boxes. */
const BOX_PAD_MM = 0.6;

// The background estimator's own constants, carried over unchanged from the reference — these are
// the ones that were validated over 1,429 photos, and the ones a change to must be re-measured.

/** Border ring depth, as a fraction of the shorter side, with a 3 px floor. */
const RING_FRACTION = 0.02;
/** A quantised colour bin is a background candidate at this share of the ring or more. */
const RING_BIN_MIN_SHARE = 0.03;
/** A candidate is kept if its luminance is within this of the darkest candidate's… */
const BACKGROUND_LUM_MARGIN = 40;
/** …or below this outright. The darkness rule is what stops a pale object running off the edge of
 * the card from being elected as the background. */
const BACKGROUND_LUM_CEILING = 60;

/** How far from the nearest background colour a pixel must be to count as a piece, at least.
 *
 * **The one reference constant this had to move**, from 28 to 52 — see the note above: a 1200 dpi
 * flatbed resolves the card's own creases and weave, which a photograph of a few stamps did not,
 * and at 28 a crease running under a row of stamps joins them all into one region. 48–58 give the
 * same answer on the set; above 60, a stamp's perforation halo starts being cut off its design. */
const THRESHOLD_FLOOR = 52;
/** …or this multiple of the widest kept cluster's own spread, when the card varies more than that.
 * Unchanged from the reference. */
const THRESHOLD_SPREAD_FACTOR = 4;

// ── The pass ───────────────────────────────────────────────────────────────────────────────────

/** What a detection pass found, beside the boxes: enough to say *why* on a card that came out
 * wrong, without turning the log into an image dump. */
export interface DetectionReport {
  boxes: Box[];
  /** Working dimensions the mask was computed at. */
  workingWidth: number;
  workingHeight: number;
  /** The background clusters elected from the border ring, as RGB triples. Several on purpose. */
  backgrounds: [number, number, number][];
  /** L∞ distance from the nearest background a pixel had to exceed to be foreground. */
  threshold: number;
  /** Share of the working frame the mask covered. A card is mostly black, so a figure near 1 means
   * the background estimate went wrong rather than that the card is full. */
  maskCoverage: number;
  /** Erosion radius actually used, in working pixels. */
  erosionRadius: number;
  /** Regions dropped for being under the minimum area. */
  droppedSmall: number;
  /** Regions dropped for lying all but inside a larger one. */
  droppedContained: number;
}

/**
 * Propose the pieces on a card scan, in the sheet's **oriented original pixels** and in reading
 * order — the same coordinate space, and the same order, a hand-drawn cut is committed in.
 *
 * `original` is the retained scan's own bytes. The mask is computed on a downscale (JPEG
 * shrink-on-load means a 66 Mpx card is never decoded at full size), and the boxes are scaled back
 * before they are returned: nothing that leaves this module is measured on a resampled image.
 */
export async function detectSheetBoxes(original: Buffer): Promise<Box[]> {
  return (await detectSheetBoxesReported(original)).boxes;
}

/** {@link detectSheetBoxes} with the numbers behind the answer — what the regression harness reads
 * and what a card that came out wrong is diagnosed from. */
export async function detectSheetBoxesReported(original: Buffer): Promise<DetectionReport> {
  const base = sharp(original, { failOn: "error" }).rotate();
  const meta = await base.metadata();

  const { data, info } = await base
    .clone()
    .resize(WORKING_MAX_EDGE, WORKING_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .toColorspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const sheet = orientedSize(meta, { width: w, height: h });

  const background = estimateBackground(data, w, h);
  const mask = thresholdAgainst(data, w, h, background);
  const coverage = countSet(mask) / (w * h);

  // Morphology, and the structuring elements are not interchangeable. The closing must stay small:
  // at 9×9 it bridges the gap between neighbours and merges a whole row into one box.
  closeSquare(mask, w, h, 3);
  fillHoles(mask, w, h);
  openSquare(mask, w, h, 5);
  fillHoles(mask, w, h);

  // Against the working image's own longest edge rather than the cap it was resized towards: a
  // scan smaller than the cap is not resized at all, and an erosion sized for 2600 px would take a
  // twentieth of a stamp on it.
  const workingEdge = Math.max(w, h);
  const erosionRadius = Math.max(1, Math.round(EROSION_RADIUS_FRACTION * workingEdge));
  // The erosion is what separates two pieces touching along a line; the bounding boxes are grown
  // back by the same radius afterwards, so the pixels it took are given back.
  const eroded = erodeDiamond(mask, w, h, erosionRadius);
  const labelled = countSet(eroded) > 0 ? eroded : mask;
  const grow = labelled === eroded ? erosionRadius : 0;

  const regions = labelComponents(labelled, w, h).map((r) => ({
    x: Math.max(0, r.x - grow),
    y: Math.max(0, r.y - grow),
    w: Math.min(w, r.x + r.w + grow) - Math.max(0, r.x - grow),
    h: Math.min(h, r.y + r.h + grow) - Math.max(0, r.y - grow),
  }));

  const scale = sheet.width / w;
  const minArea = minimumRegionArea(meta.density, scale, regions);
  const bigEnough = regions.filter((r) => r.w * r.h >= minArea);

  // Containment: a region all but inside a kept one is a piece of that piece — a fragment of a
  // stamp's own edge that the erosion cut loose, a dark panel inside a souvenir sheet's border, a
  // hole the fill missed. Largest first, so the survivor is the whole.
  //
  // **Mostly inside, not wholly inside.** The reference tested strict containment, and a fragment
  // whose bounding box overhangs its parent's by a few pixels — which is ordinary, since the two
  // were labelled separately and each keeps its own extremes — survives that test and lands on the
  // card as a spurious box over a stamp that already has one. The share is of the *smaller* box's
  // own area, so two genuinely adjacent pieces whose padded boxes graze each other are unaffected.
  const kept: Box[] = [];
  for (const r of [...bigEnough].sort((a, b) => b.w * b.h - a.w * a.h)) {
    if (!kept.some((k) => overlapShare(k, r) >= CONTAINED_OVERLAP_SHARE)) kept.push(r);
  }

  const pad = paddingPixels(meta.density, scale, erosionRadius);
  const scaled = kept.map((r) => scaleBox(r, scale, pad, sheet));
  const ordered = readingOrder(scaled).map((i) => scaled[i]);

  return {
    boxes: ordered,
    workingWidth: w,
    workingHeight: h,
    backgrounds: background.clusters.map((c) => c.median),
    threshold: background.threshold,
    maskCoverage: coverage,
    erosionRadius,
    droppedSmall: regions.length - bigEnough.length,
    droppedContained: bigEnough.length - kept.length,
  };
}

/** Millimetres of card per working pixel, or null when the scan records no usable resolution. */
function mmPerWorkingPixel(density: number | undefined, scale: number): number | null {
  if (!density || density < MIN_TRUSTED_DENSITY_DPI) return null;
  return (25.4 / density) * scale;
}

function minimumRegionArea(
  density: number | undefined,
  scale: number,
  regions: readonly Box[]
): number {
  const mm = mmPerWorkingPixel(density, scale);
  if (mm != null) return MIN_PIECE_AREA_MM2 / (mm * mm);
  if (regions.length === 0) return 0;
  const areas = regions.map((r) => r.w * r.h).sort((a, b) => a - b);
  const median = areas[areas.length >> 1];
  return MIN_PIECE_MEDIAN_FRACTION * median;
}

function paddingPixels(
  density: number | undefined,
  scale: number,
  erosionRadius: number
): number {
  const mm = mmPerWorkingPixel(density, scale);
  // Without a density, a tooth is still about the same share of a scan of a card: fall back to the
  // erosion radius, which is the one length here already tied to the working size.
  const workingPad = mm != null ? BOX_PAD_MM / mm : erosionRadius;
  return workingPad * scale;
}

/** How much of the smaller box has to lie inside a kept one for it to be part of it. */
const CONTAINED_OVERLAP_SHARE = 0.9;

/** The share of `inner`'s own area that lies inside `outer`. */
function overlapShare(outer: Box, inner: Box): number {
  const w = Math.min(outer.x + outer.w, inner.x + inner.w) - Math.max(outer.x, inner.x);
  const h = Math.min(outer.y + outer.h, inner.y + inner.h) - Math.max(outer.y, inner.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (inner.w * inner.h);
}

/** A working-pixel box in the sheet's own pixels, grown by `pad` and clamped to the sheet. */
function scaleBox(r: Box, scale: number, pad: number, sheet: { width: number; height: number }): Box {
  const left = Math.max(0, Math.round(r.x * scale - pad));
  const top = Math.max(0, Math.round(r.y * scale - pad));
  const right = Math.min(sheet.width, Math.round((r.x + r.w) * scale + pad));
  const bottom = Math.min(sheet.height, Math.round((r.y + r.h) * scale + pad));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// ── The background, estimated per image from the border ring ───────────────────────────────────

interface BackgroundCluster {
  median: [number, number, number];
  /** Median L∞ distance of the cluster's own ring pixels from its median — how much the card
   * varies where it is this colour. */
  spread: number;
}

interface BackgroundEstimate {
  clusters: BackgroundCluster[];
  threshold: number;
}

/**
 * The card's own colour, taken from a ring along the four edges — the one part of a scan that is
 * background by construction.
 *
 * **Several clusters are kept on purpose.** The card is dark but not uniform: scanner banding,
 * vignetting and the shadow a mounted stamp throws all move it. Comparing against the darkest
 * cluster alone made a mid-tone patch of background exceed the threshold, and the mask ballooned to
 * 96% of one frame. The darkness rule is the other half of it — it is what stops a pale object
 * running off the edge of the card from being elected as background.
 */
function estimateBackground(data: Buffer, w: number, h: number): BackgroundEstimate {
  const depth = Math.max(3, Math.round(RING_FRACTION * Math.min(w, h)));
  const ring: number[] = [];
  for (let y = 0; y < h; y++) {
    const edgeRow = y < depth || y >= h - depth;
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x >= depth && x < w - depth) {
        x = w - depth - 1;
        continue;
      }
      ring.push((y * w + x) * 3);
    }
  }

  // Quantised to 4 bits a channel: fine enough to keep a banded card's two tones apart, coarse
  // enough that noise does not shatter one tone into a hundred bins.
  const bins = new Map<number, number[]>();
  for (const p of ring) {
    const key = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4);
    const bucket = bins.get(key);
    if (bucket) bucket.push(p);
    else bins.set(key, [p]);
  }

  const minCount = RING_BIN_MIN_SHARE * ring.length;
  let candidates = [...bins.values()].filter((b) => b.length >= minCount);
  if (candidates.length === 0) {
    // Fallback: the largest bin. A ring of pure gradient has no bin over the share, and the card is
    // still whatever most of its edge is.
    candidates = [[...bins.values()].reduce((a, b) => (b.length > a.length ? b : a))];
  }

  const measured = candidates.map((pixels) => {
    const median: [number, number, number] = [
      medianOf(pixels.map((p) => data[p])),
      medianOf(pixels.map((p) => data[p + 1])),
      medianOf(pixels.map((p) => data[p + 2])),
    ];
    const spread = medianOf(
      pixels.map((p) =>
        Math.max(
          Math.abs(data[p] - median[0]),
          Math.abs(data[p + 1] - median[1]),
          Math.abs(data[p + 2] - median[2])
        )
      )
    );
    return { median, spread, lum: luminance(median) };
  });

  const darkest = Math.min(...measured.map((c) => c.lum));
  const ceiling = Math.max(BACKGROUND_LUM_CEILING, darkest + BACKGROUND_LUM_MARGIN);
  const clusters = measured.filter((c) => c.lum <= ceiling);
  const kept = clusters.length > 0 ? clusters : [measured.reduce((a, b) => (b.lum < a.lum ? b : a))];

  const threshold = Math.max(
    THRESHOLD_FLOOR,
    THRESHOLD_SPREAD_FACTOR * Math.max(...kept.map((c) => c.spread))
  );
  return { clusters: kept.map(({ median, spread }) => ({ median, spread })), threshold };
}

function luminance([r, g, b]: readonly [number, number, number]): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function medianOf(values: number[]): number {
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** Foreground is *far from the card*, not *bright*: `dist(p) = min over clusters of L∞(p, median)`.
 * A dark stamp on a black card is separated by hue and by the few levels the ink differs by, which
 * a brightness test cannot see at all. */
function thresholdAgainst(
  data: Buffer,
  w: number,
  h: number,
  background: BackgroundEstimate
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const thr = background.threshold;
  const clusters = background.clusters;
  for (let i = 0, p = 0; i < mask.length; i++, p += 3) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    let nearest = Infinity;
    for (const c of clusters) {
      const d = Math.max(
        Math.abs(r - c.median[0]),
        Math.abs(g - c.median[1]),
        Math.abs(b - c.median[2])
      );
      if (d < nearest) nearest = d;
      if (nearest <= thr) break;
    }
    mask[i] = nearest > thr ? 1 : 0;
  }
  return mask;
}

// ── Morphology ─────────────────────────────────────────────────────────────────────────────────
//
// Square elements separate into a row pass and a column pass, which is what makes them cheap. The
// L1 diamond used for the erosion does not separate — it is applied as `r` passes of the
// 4-neighbour minimum instead, which is exactly a diamond of radius `r` and is why it is not
// substituted with a square: the square changes which touching pieces come apart.

function dilateSquare(mask: Uint8Array, w: number, h: number, size: number): void {
  const r = (size - 1) >> 1;
  separable(mask, w, h, r, true);
}

function erodeSquare(mask: Uint8Array, w: number, h: number, size: number): void {
  const r = (size - 1) >> 1;
  separable(mask, w, h, r, false);
}

function closeSquare(mask: Uint8Array, w: number, h: number, size: number): void {
  dilateSquare(mask, w, h, size);
  erodeSquare(mask, w, h, size);
}

function openSquare(mask: Uint8Array, w: number, h: number, size: number): void {
  erodeSquare(mask, w, h, size);
  dilateSquare(mask, w, h, size);
}

/** One separable pass in each direction. `max` dilates, `min` erodes; outside the image counts as
 * background either way, so a piece running off the card's edge keeps its edge. */
function separable(mask: Uint8Array, w: number, h: number, r: number, max: boolean): void {
  if (r < 1) return;
  const tmp = new Uint8Array(mask.length);
  const want = max ? 1 : 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let hit = false;
      for (let dx = -r; dx <= r && !hit; dx++) {
        const sx = x + dx;
        const v = sx < 0 || sx >= w ? 0 : mask[row + sx];
        if (v === want) hit = true;
      }
      tmp[row + x] = hit ? want : max ? 0 : 1;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let hit = false;
      for (let dy = -r; dy <= r && !hit; dy++) {
        const sy = y + dy;
        const v = sy < 0 || sy >= h ? 0 : tmp[sy * w + x];
        if (v === want) hit = true;
      }
      mask[y * w + x] = hit ? want : max ? 0 : 1;
    }
  }
}

/** Erode by an L1 diamond of radius `r`, as `r` passes of the 4-neighbour minimum. */
function erodeDiamond(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  let current = mask;
  for (let pass = 0; pass < r; pass++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (
          current[i] === 1 &&
          (x === 0 || current[i - 1] === 1) &&
          (x === w - 1 || current[i + 1] === 1) &&
          (y === 0 || current[i - w] === 1) &&
          (y === h - 1 || current[i + w] === 1)
        ) {
          next[i] = 1;
        }
      }
    }
    current = next;
  }
  return current === mask ? new Uint8Array(mask) : current;
}

/** Fill enclosed background: flood the background inward from the border, 4-connected, and set
 * everything it did not reach. A stamp with a pale sky and a dark cliff leaves holes in the mask
 * where the artwork happens to sit near the card's own colour, and a hole is part of the stamp. */
function fillHoles(mask: Uint8Array, w: number, h: number): void {
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (i: number) => {
    if (mask[i] === 0 && outside[i] === 0) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < mask.length - w) push(i + w);
  }
  for (let i = 0; i < mask.length; i++) if (mask[i] === 0 && outside[i] === 0) mask[i] = 1;
}

// ── Connected components ───────────────────────────────────────────────────────────────────────

/** Two-pass union-find labelling, 4-connectivity, returning each component's bounding box.
 *
 * 4 and not 8: two stamps whose corners meet diagonally are two pieces, and 8-connectivity would
 * join them through a single pixel. */
function labelComponents(mask: Uint8Array, w: number, h: number): Box[] {
  const labels = new Int32Array(mask.length);
  const parent: number[] = [0];

  const find = (a: number): number => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    let node = a;
    while (parent[node] !== root) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] === 0) continue;
      const west = x > 0 ? labels[i - 1] : 0;
      const north = y > 0 ? labels[i - w] : 0;
      if (west === 0 && north === 0) {
        const label = parent.length;
        parent.push(label);
        labels[i] = label;
      } else if (west !== 0 && north !== 0) {
        labels[i] = Math.min(west, north);
        union(west, north);
      } else {
        labels[i] = west || north;
      }
    }
  }

  const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const label = labels[y * w + x];
      if (label === 0) continue;
      const root = find(label);
      const b = boxes.get(root);
      if (!b) boxes.set(root, { x0: x, y0: y, x1: x, y1: y });
      else {
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
      }
    }
  }

  return [...boxes.values()].map((b) => ({
    x: b.x0,
    y: b.y0,
    w: b.x1 - b.x0 + 1,
    h: b.y1 - b.y0 + 1,
  }));
}

function countSet(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}
