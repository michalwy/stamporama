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
 * ## Two kinds of card, and the one thing that differs
 *
 * #574 built this on the background being black, *"a constant of the routine rather than a happy
 * accident"*. #1195 withdrew that: an **album page** is a light page with a black hawid mount glued
 * to it and the stamp inside the mount, so the light and the dark run the other way round — and
 * they alternate **three deep**: page, mount, stamp.
 *
 * What that changes is smaller than it sounds. A stockbook card is one separation — the piece
 * against the card — and an album page is the **same separation run twice**: the mount against the
 * page, then the stamp against the mount. Every step below is shared; the kind decides which end of
 * the luminance range the background is elected from, and whether the answer is the region found or
 * the region found inside it.
 *
 * The kind is **told to this module**, not guessed by it ({@link SheetKind}). {@link
 * recogniseSheetKind} is what guesses, once, when a scan is uploaded, so that the collector has an
 * answer to correct rather than a question to answer — and correcting it re-runs this pass.
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
 *
 * ## Two ways of asking, one separation
 *
 * #1196 added a second question to the same pixels: not *where are the pieces* but *what is the
 * piece under this point*, asked by the collector clicking a stamp the pass got wrong. The decode,
 * the background election, the threshold, the morphology and the erosion are one arrangement
 * ({@link separateSheet}) and both questions read it. The pass labels the whole mask and filters
 * what it finds; the click takes the one region the finger landed in and skips the filters, because
 * the click is the evidence those filters were standing in for.
 *
 * They must not drift: a click that answered differently from the pass over the same pixels would
 * be a second detector wearing the first one's constants, and the collector would have no way to
 * tell which of the two boxes on the card came from which.
 */

/**
 * What kind of card a scan is — the one thing detection has to be told (#1195).
 *
 * `stockbook`: a black stockbook card, stamps laid straight onto it. The piece is the lighter thing
 * on a dark ground, and the detected region **is** the answer.
 *
 * `album`: an album page, light, with black hawid mounts glued to it and a stamp inside each mount.
 * The detected region is the **mount**, and the answer is one level inside it. A tile carrying the
 * mount, or the page around it, is the failure this kind exists to prevent.
 */
export type SheetKind = "stockbook" | "album";

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

// ── The album page's own constants (#1195) ─────────────────────────────────────────────────────
//
// **Fitted on three real album-page scans at 1200 dpi**: a full page of thirteen Deutsche Post
// Osten overprints in individual mounts, the same page's backs, and a close crop of two of them.
// They were the collector's own pages, supplied for this, and no synthetic image was used — #574
// refused to start on generated images on the grounds that constants fitted to them are worse than
// none, and that reasoning did not stop applying because the background changed colour.
//
// Only three values are new; everything else on an album page is the stockbook constants doing the
// same work a second time. That is the measure of the kind being one parameter rather than a
// second detector.

/** …and its mirror, for a page: a candidate is kept if its luminance is within
 * {@link BACKGROUND_LUM_MARGIN} of the **brightest** candidate's, or above this outright. 255 − 60,
 * so the two polarities are the same rule read from opposite ends and neither can drift from the
 * other. The brightness rule is what stops a mount running off the edge of the page from being
 * elected as the page. */
const PAGE_LUM_FLOOR = 195;

/** How much of a mount's own box a stamp inside it must fill to be believed.
 *
 * A mount is cut a little larger than the stamp it holds — that is what makes it a mount — so the
 * share is high and it is the **weak** half of the test. It is stated low enough for **two** stamps
 * in one mount to both clear it, which is the case it is really guarding: every enclosed region
 * over the share is returned, so the share is what separates a stamp from a fragment of one, not
 * what picks a winner. The strong half is that the stamp must not
 * touch the mount's edge: the page is light, the mount dark, the stamp light again, so the middle
 * level **encloses** the inner one, and a thing with nothing enclosed inside it is not a mount. A
 * printed numeral under a mount is dark on light and passes the first separation exactly as a mount
 * does; what it has not got is something lighter strictly inside it, which is the whole of why the
 * page's own printing is not proposed as a tile. Measured at 0.60–0.75 on the collector's pages. */
const STAMP_MIN_MOUNT_SHARE = 0.3;

/** Ring luminance above which a scan is read as an **album page** rather than a stockbook card
 * ({@link recogniseSheetKind}). Not a fitted constant so much as the midpoint of a gap: the border
 * of a stockbook card measures around 15 and the border of an album page around 225, and there is
 * nothing in between for a threshold to be wrong about. The collector can change the answer either
 * way, which is what makes a guess here the right shape at all. */
const ALBUM_RING_LUM = 128;

// ── The pass ───────────────────────────────────────────────────────────────────────────────────

/** What a detection pass found, beside the boxes: enough to say *why* on a card that came out
 * wrong, without turning the log into an image dump. */
export interface DetectionReport {
  boxes: Box[];
  /** Which kind the pass ran as — the one input that changes what a region *means*. */
  kind: SheetKind;
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
  /** Album pages only: dark regions with nothing lighter enclosed inside them — the page's own
   * printing, and whatever else is a mark rather than a mount. */
  droppedWithoutStamp: number;
}

/**
 * Propose the pieces on a card scan, in the sheet's **oriented original pixels** and in reading
 * order — the same coordinate space, and the same order, a hand-drawn cut is committed in.
 *
 * `original` is the retained scan's own bytes. The mask is computed on a downscale (JPEG
 * shrink-on-load means a 66 Mpx card is never decoded at full size), and the boxes are scaled back
 * before they are returned: nothing that leaves this module is measured on a resampled image.
 */
export async function detectSheetBoxes(original: Buffer, kind: SheetKind): Promise<Box[]> {
  return (await detectSheetBoxesReported(original, kind)).boxes;
}

/** {@link detectSheetBoxes} with the numbers behind the answer — what the regression harness reads
 * and what a card that came out wrong is diagnosed from. */
export async function detectSheetBoxesReported(
  original: Buffer,
  kind: SheetKind
): Promise<DetectionReport> {
  const sep = await separateSheet(original, kind);
  const { data, w, h, sheet, scale, grow } = sep;

  const regions = labelComponents(sep.labelled, w, h).map((r) => grownBy(r, grow, w, h));

  const minArea = minimumRegionArea(sep.density, scale, regions);
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

  // On a stockbook card the regions **are** the pieces. On an album page they are the mounts, and
  // the piece is one level inside each of them — so the second separation runs here, over the very
  // buffer the first one read, and what comes back is already a stamp box in working pixels.
  const pieces = kind === "album" ? stampsInsideMounts(data, w, h, kept, grow) : kept;

  const scaled = pieces.map((r) => scaleBox(r, scale, paddingFor(kind, sep), sheet));
  const ordered = readingOrder(scaled).map((i) => scaled[i]);

  return {
    boxes: ordered,
    kind,
    workingWidth: w,
    workingHeight: h,
    backgrounds: sep.background.clusters.map((c) => c.median),
    threshold: sep.background.threshold,
    maskCoverage: sep.coverage,
    erosionRadius: sep.erosionRadius,
    droppedSmall: regions.length - bigEnough.length,
    droppedContained: bigEnough.length - kept.length,
    droppedWithoutStamp: kept.length - pieces.length,
  };
}

// ── The separation both questions read (#1196) ─────────────────────────────────────────────────

/**
 * The working image, the ground it was separated from, and the mask that separation produced.
 *
 * One arrangement, two readers. {@link detectSheetBoxesReported} labels the whole mask; {@link
 * pickBoxAt} takes the single region a click landed in. Nothing here knows which is about to ask.
 */
interface Separation {
  /** The working image's RGB pixels. */
  data: Buffer;
  w: number;
  h: number;
  /** The sheet's own oriented dimensions, and sheet pixels per working pixel. */
  sheet: { width: number; height: number };
  scale: number;
  /** The scan's recorded resolution, or undefined — what the physical rules are measured through. */
  density: number | undefined;
  background: BackgroundEstimate;
  /** Share of the working frame the mask covered. A card is mostly black and a page shows its own
   * border, so a figure near 1 means the background estimate went wrong rather than that the card
   * is full. */
  coverage: number;
  /** What regions are labelled from: the eroded mask where the erosion left anything, the plain
   * mask where it did not. Grow anything labelled from it back by {@link Separation.grow}. */
  labelled: Uint8Array;
  /** The mask **before** the erosion. The pass never reads it; a click does, when the erosion has
   * taken the very pixel that was clicked. */
  mask: Uint8Array;
  grow: number;
  erosionRadius: number;
}

/** Decode, elect the ground, threshold against it, and clean up — everything up to the point where
 * *where are the pieces* and *what is the piece here* become different questions. */
async function separateSheet(original: Buffer, kind: SheetKind): Promise<Separation> {
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

  // The **card**, or the **page**: the one place the kind reaches the separation itself. Which end
  // of the range the background is elected from is the whole of the difference — everything below
  // this line runs identically for both, because the question *what is far from the background* is
  // the same question either way.
  const background = estimateBackground(data, w, h, kind === "album" ? "light" : "dark");
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

  return {
    data,
    w,
    h,
    sheet,
    scale: sheet.width / w,
    density: meta.density,
    background,
    coverage,
    labelled,
    mask,
    grow: labelled === eroded ? erosionRadius : 0,
    erosionRadius,
  };
}

/** How far a box is grown outward on the way to the sheet's own pixels. **None on an album page**:
 * the stockbook pad exists because a mask stops at the last pixel that differs from the card and a
 * perforation tip is the faintest part of a stamp, so a crop flush to the mask clips teeth. Against
 * a black mount the selvedge is the strongest edge on the page and the mask reaches the paper
 * itself; growing the box there would put mount in the tile, which is precisely what that kind
 * exists to keep out of it. */
function paddingFor(kind: SheetKind, sep: Separation): number {
  return kind === "album" ? 0 : paddingPixels(sep.density, sep.scale, sep.erosionRadius);
}

// ── The piece under one point (#1196) ──────────────────────────────────────────────────────────

/**
 * The box around the piece the collector **clicked**, in the sheet's oriented original pixels, or
 * null when its edges cannot be determined.
 *
 * ## Why a click is a different question and the same answer
 *
 * The pass is reached when it has already gone wrong: a stamp it missed, or one it ran into its
 * neighbour. Running the same pass again would miss it again, so the click has to carry something
 * the pass had not got — and what it carries is exactly one bit of ground truth, *there is a piece
 * here*. That bit is worth precisely the filters: the minimum area, the containment rule and the
 * album page's enclosure share are all stand-ins for *is this a piece*, and a finger on it answers
 * better than any of them. So the click reads {@link separateSheet}'s mask and takes the one region
 * the point lies in, unfiltered, rather than searching the card again.
 *
 * Everything else is the pass, deliberately: the same working resolution, the same ground, the same
 * threshold, the same morphology, the same erosion and the same grow-back, the same second
 * separation inside a mount, and the same padding rule. A box from here is a box from there.
 *
 * ## What it refuses, and why refusing is the feature
 *
 * A wrong box is worse than no box: it looks exactly like a right one, and it is found much later —
 * after the tile has been identified, and after the card has been broken up. So every case where
 * the answer would be a guess returns null and the editor says so, leaving the hand-drawn box
 * (#566) as the move that always works. That is the whole of the error budget here.
 *
 * It refuses when the point is on the ground itself (a click on the black card, or on the page
 * between mounts), when a mount holds nothing enclosed the click is inside of, when what was found
 * is under the same physical floor the pass drops specks by, and when the mask covered so much of
 * the frame that the background estimate has plainly failed — the one case that could otherwise
 * hand back the entire card as a single tile.
 *
 * **What it does not refuse is two stamps the mask holds as one.** The region under the click is
 * the region, teeth interlocked and all; that is the information limit stated at the top of this
 * file, and the editor's Split is what answers it.
 */
export async function pickBoxAt(
  original: Buffer,
  kind: SheetKind,
  point: { x: number; y: number }
): Promise<Box | null> {
  const sep = await separateSheet(original, kind);
  const { data, w, h, sheet, scale, grow } = sep;

  if (sep.coverage >= FAILED_ESTIMATE_COVERAGE) return null;

  const ax = Math.round(point.x / scale);
  const ay = Math.round(point.y / scale);
  if (ax < 0 || ay < 0 || ax >= w || ay >= h) return null;

  // The eroded mask first, so that a click on a piece the pass also found answers with the very
  // box the pass proposed for it. Where the erosion has taken the clicked pixel itself — within a
  // radius of the piece's own edge, or of a notch the artwork left in the mask — the mask before it
  // answers instead, ungrown, because nothing was taken off that one to give back. That box is the
  // honest extent of the same piece and runs a few pixels wider than the pass's, which is the right
  // way round: the alternative is refusing a click that landed squarely on a stamp.
  const eroded = componentAt(sep.labelled, w, h, ax, ay);
  const regionGrow = eroded ? grow : 0;
  const region = eroded ?? componentAt(sep.mask, w, h, ax, ay);
  if (!region) return null;
  const piece = grownBy(region, regionGrow, w, h);

  // On a stockbook card that region **is** the piece. On an album page it is the mount, and the
  // stamp is one level inside it — the pass's second separation, asked for the one region the
  // click landed in rather than for every one the mount holds. The stamp's own selvedge is what
  // comes back, for the reason {@link stampsInsideMounts} states: the edge being measured is white
  // paper against black film, and the printed design is never asked about.
  let answer = piece;
  if (kind === "album") {
    const held = insideMount(data, w, h, piece, regionGrow);
    if (!held) return null;
    const { win, inner } = held;
    const lx = ax - win.x;
    const ly = ay - win.y;
    if (lx < 0 || ly < 0 || lx >= win.w || ly >= win.h) return null;
    const stamp = componentAt(inner, win.w, win.h, lx, ly);
    if (!stamp || !isStampInMount(stamp, win)) return null;
    answer = { x: win.x + stamp.x, y: win.y + stamp.y, w: stamp.w, h: stamp.h };
  }

  // The pass's own physical floor, with no regions to fall back on — which is the right answer for
  // a scan that records no resolution: there the floor is unmeasurable, and a click is still an
  // assertion that something is there.
  if (answer.w * answer.h < minimumRegionArea(sep.density, scale, [])) return null;

  return scaleBox(answer, scale, paddingFor(kind, sep), sheet);
}

/** Mask coverage at which the ground has plainly been mis-elected rather than the card being full.
 * The regression harness asserts the same figure over the whole set and the densest card in it
 * measures 81%; here it is the refusal itself, because the failure it prevents — a click anywhere
 * handing back the entire card as one tile — is the worst outcome this step has. */
const FAILED_ESTIMATE_COVERAGE = 0.9;

/**
 * The bounding box of the connected region one pixel belongs to, or null when that pixel is
 * background.
 *
 * 4-connected, like {@link labelComponents}, and for the same reason: a region reached only through
 * a corner is a different region, and a click has to mean what the labelling means.
 */
function componentAt(mask: Uint8Array, w: number, h: number, x: number, y: number): Box | null {
  const seed = y * w + x;
  if (mask[seed] === 0) return null;

  const seen = new Uint8Array(mask.length);
  const stack = [seed];
  seen[seed] = 1;
  let x0 = x;
  let x1 = x;
  let y0 = y;
  let y1 = y;

  while (stack.length > 0) {
    const i = stack.pop()!;
    const px = i % w;
    const py = (i - px) / w;
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
    const push = (j: number) => {
      if (mask[j] === 1 && seen[j] === 0) {
        seen[j] = 1;
        stack.push(j);
      }
    };
    if (px > 0) push(i - 1);
    if (px < w - 1) push(i + 1);
    if (py > 0) push(i - w);
    if (py < h - 1) push(i + w);
  }

  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** A labelled region grown back by what the erosion took off it, clamped to the working image. */
function grownBy(r: Box, by: number, w: number, h: number): Box {
  const x = Math.max(0, r.x - by);
  const y = Math.max(0, r.y - by);
  return { x, y, w: Math.min(w, r.x + r.w + by) - x, h: Math.min(h, r.y + r.h + by) - y };
}

/**
 * Read a scan's **kind** off its border (#1195), so that a scan arrives already knowing what it is.
 *
 * A guess, made once at upload and recorded on the sheet, where the collector can see it and change
 * it — never asked as a question and never re-derived later, because a kind that answered
 * differently on a re-cut than it did on the first cut would be the worst version of this.
 *
 * The evidence is the **median luminance of the border ring**, the one part of a scan that is
 * background by construction on both kinds: a stockbook card's border is the black card and an
 * album page's is the page. The median is what makes it robust to a tight crop — the close crop of
 * two mounts in the fixture set has mount black along part of its ring and still reads as a page.
 *
 * Read on the sheet's `view` derivative rather than its original: the answer is a median over
 * hundreds of thousands of pixels and a downscale cannot move it, while decoding a 200 MB card a
 * second time to learn one bit would be the expensive way to be no more certain.
 */
export async function recogniseSheetKind(image: Buffer): Promise<SheetKind> {
  const { data, info } = await sharp(image, { failOn: "error" })
    .rotate()
    .resize(RECOGNITION_MAX_EDGE, RECOGNITION_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .removeAlpha()
    .toColorspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const lums = ringPixels(info.width, info.height).map((p) =>
    luminance([data[p], data[p + 1], data[p + 2]])
  );
  if (lums.length === 0) return "stockbook";
  return medianOf(lums) >= ALBUM_RING_LUM ? "album" : "stockbook";
}

/** Enough of the border to take a median of, and no more — the ring alone decides this, and at a
 * few hundred pixels on a side it already holds tens of thousands of them. */
const RECOGNITION_MAX_EDGE = 400;

// ── The second separation: the stamp inside the mount (#1195) ──────────────────────────────────

/**
 * Turn each **mount** into the **stamp** it holds, and drop what turns out not to be a mount.
 *
 * The page is light, the mount is black, the stamp is lighter again — so this is the first
 * separation run a second time with the polarity the other way round, inside each region rather
 * than over the whole page. That is deliberate to the point of being the design: one estimator, one
 * threshold, one morphology, applied twice.
 *
 * Two things come out of it at once.
 *
 * **The tile is the whole stamp, selvedge included.** The edge being measured is white perforated
 * paper against black film, which is the strongest boundary on the page; the printed design's own
 * edge — the obvious one, and the one a detector aimed at *the stamp's picture* would stop at — is
 * never asked about, because the background here is the mount and the design is nowhere near it.
 * Stopping at the design would silently crop the perforations off every stamp on the page, and this
 * is the arrangement under which that cannot happen rather than a rule against it.
 *
 * **The page's own printing is not a tile.** The numerals under the mounts are dark marks on a light
 * ground and survive the first separation exactly as a mount does. What they have not got is
 * something lighter *enclosed* inside them: the region found within a numeral's own box is the page
 * around it, which runs to the edge of the box. So the test is enclosure — a region touching the
 * box's border is not a stamp in a mount — and it is a statement of the three-deep alternation
 * rather than a filter fitted to numerals. A caption, a heading or a rule fails it for the same
 * reason.
 */
function stampsInsideMounts(
  data: Buffer,
  w: number,
  h: number,
  mounts: readonly Box[],
  grow: number
): Box[] {
  const stamps: Box[] = [];
  for (const mount of mounts) {
    const held = insideMount(data, w, h, mount, grow);
    if (!held) continue;
    const { win, inner } = held;

    // Enclosed, and then **every** one of them that is big enough — not the largest. A mount
    // usually holds one stamp and the two readings agree; where they differ is a mount holding
    // two, and there the largest would quietly return one of them. #574's asymmetry decides it:
    // a surviving extra box costs one click, while a stamp dropped is simply absent from a page
    // the collector has moved on from, with nothing on screen saying so.
    for (const stamp of labelComponents(inner, win.w, win.h)) {
      if (!isStampInMount(stamp, win)) continue;
      stamps.push({ x: win.x + stamp.x, y: win.y + stamp.y, w: stamp.w, h: stamp.h });
    }
  }
  return stamps;
}

/**
 * One mount's own window, and the mask of what lies inside it — the second separation itself,
 * without the question of which region in it is the answer.
 *
 * Its own function because two callers ask it differently (#1196): the pass wants every stamp the
 * mount holds, a click wants the one the point is in. They must see the same window and the same
 * mask, or a page would carry boxes from two subtly different second separations.
 *
 * Returns null for a window too small for a ring, a threshold and a morphology to mean anything —
 * whatever it holds is a speck rather than a mount.
 */
function insideMount(
  data: Buffer,
  w: number,
  h: number,
  mount: Box,
  grow: number
): { win: Box; inner: Uint8Array } | null {
  // Back to the mount's own outline. The regions were grown by the erosion radius on the way out
  // of the first separation, which on a card gives back the pixels the erosion took; here it
  // would put a band of **page** around the window, and the window's border has to be mount for
  // the ring to elect the mount as its background.
  const win = insetBox(mount, grow, w, h);
  if (win.w < MIN_MOUNT_WINDOW_PX || win.h < MIN_MOUNT_WINDOW_PX) return null;

  const sub = cropRgb(data, w, win);
  const inner = thresholdAgainst(sub, win.w, win.h, estimateBackground(sub, win.w, win.h, "dark"));
  closeSquare(inner, win.w, win.h, 3);
  fillHoles(inner, win.w, win.h);
  openSquare(inner, win.w, win.h, 5);
  fillHoles(inner, win.w, win.h);
  return { win, inner };
}

/** Whether a region found inside a mount's window is a stamp the mount holds: **enclosed** by the
 * mount on every side, and filling enough of the window to be a stamp rather than a fragment of
 * one. The page leaking in at a corner of the window is the thing most likely to be *bigger* than
 * the stamp, and it is also the one thing guaranteed to touch the border. */
function isStampInMount(r: Box, win: Box): boolean {
  return (
    r.x > 0 &&
    r.y > 0 &&
    r.x + r.w < win.w &&
    r.y + r.h < win.h &&
    r.w * r.h >= STAMP_MIN_MOUNT_SHARE * win.w * win.h
  );
}

/** Below this a window has too few pixels for a ring, a threshold and a morphology to mean
 * anything, and whatever it holds is a speck rather than a mount. In working pixels, where a mount
 * on a 1200 dpi page measures several hundred on a side. */
const MIN_MOUNT_WINDOW_PX = 24;

/** A box pulled in by `by` on every side, clamped so it stays inside the image and never inverts. */
function insetBox(b: Box, by: number, w: number, h: number): Box {
  const x = Math.min(Math.max(0, b.x + by), w);
  const y = Math.min(Math.max(0, b.y + by), h);
  return {
    x,
    y,
    w: Math.max(0, Math.min(w, b.x + b.w - by) - x),
    h: Math.max(0, Math.min(h, b.y + b.h - by) - y),
  };
}

/** The window's own RGB pixels, copied out so that every function below it can go on taking a plain
 * `w`-wide buffer. A mount is a few hundred pixels on a side at the working resolution, so the copy
 * is a fraction of a megabyte and buys the whole of the second separation being the same code. */
function cropRgb(data: Buffer, w: number, win: Box): Buffer {
  const out = Buffer.allocUnsafe(win.w * win.h * 3);
  for (let y = 0; y < win.h; y++) {
    data.copy(out, y * win.w * 3, ((win.y + y) * w + win.x) * 3, ((win.y + y) * w + win.x + win.w) * 3);
  }
  return out;
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
 * The ground's own colour, taken from a ring along the four edges — the one part of a scan, or of a
 * mount's own box, that is background by construction.
 *
 * **Several clusters are kept on purpose.** The ground is not uniform: scanner banding, vignetting
 * and the shadow a mounted stamp throws all move it. Comparing against the darkest cluster alone
 * made a mid-tone patch of background exceed the threshold, and the mask ballooned to 96% of one
 * frame.
 *
 * **`polarity` says which end of the range the ground is at**, and it is the one thing the two kinds
 * of card disagree about (#1195). `dark` elects the darkest candidates — a stockbook card, and a
 * hawid mount seen from inside its own box. `light` elects the brightest — an album page. The rule
 * is otherwise the same one read from the opposite end, and it earns its keep the same way in both
 * directions: it is what stops a pale object running off the edge of a card, or a mount running off
 * the edge of a page, from being elected as the ground it is lying on.
 */
function estimateBackground(
  data: Buffer,
  w: number,
  h: number,
  polarity: "dark" | "light"
): BackgroundEstimate {
  const ring = ringPixels(w, h);

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

  const clusters =
    polarity === "dark"
      ? (() => {
          const darkest = Math.min(...measured.map((c) => c.lum));
          const ceiling = Math.max(BACKGROUND_LUM_CEILING, darkest + BACKGROUND_LUM_MARGIN);
          return measured.filter((c) => c.lum <= ceiling);
        })()
      : (() => {
          const brightest = Math.max(...measured.map((c) => c.lum));
          const floor = Math.min(PAGE_LUM_FLOOR, brightest - BACKGROUND_LUM_MARGIN);
          return measured.filter((c) => c.lum >= floor);
        })();
  const furthest = polarity === "dark" ? (a: number, b: number) => b < a : (a: number, b: number) => b > a;
  const kept =
    clusters.length > 0
      ? clusters
      : [measured.reduce((a, b) => (furthest(a.lum, b.lum) ? b : a))];

  const threshold = Math.max(
    THRESHOLD_FLOOR,
    THRESHOLD_SPREAD_FACTOR * Math.max(...kept.map((c) => c.spread))
  );
  return { clusters: kept.map(({ median, spread }) => ({ median, spread })), threshold };
}

/** Offsets into a `w`×`h` RGB buffer of the pixels in the border ring — the band along the four
 * edges that is background by construction. Shared by the estimator and by {@link
 * recogniseSheetKind}, which ask two different questions of the same pixels. */
function ringPixels(w: number, h: number): number[] {
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
  return ring;
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
