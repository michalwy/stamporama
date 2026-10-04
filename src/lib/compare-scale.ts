// Two pictures side by side at one scale, and one viewer's zoom and pan carried to the other (#1641)
// — the arithmetic of *Compare with the copies you hold*.
//
// Pure, beside `scan-viewport.ts` whose numbers it composes, for that module's reason: whether two
// pictures are drawn at the same size on paper is a claim the window states to the collector, and a
// rule written inside a component is one nothing can test.
//
// ## When two pictures are at the same scale
//
// A viewer's scale is display pixels per **picture** pixel — scan pixels for a tile, the upload's own
// pixels for a photo. That is the same magnification on two pictures only when their pixels are the
// same size on paper, which is exactly what a resolution says. So the pair is drawn at one scale when
// **both** resolutions are known, and only then: each viewer's scale is the shared display pixels per
// inch over its own picture's dpi. Where either is not known, nothing relates the two pictures' pixels
// and each fits its own viewer — the window says so rather than implying a comparison of sizes.
//
// A resolution is known from a scanning profile (#1443) and from nothing else: a tile's card was
// scanned with one, and a held copy's photo is known only while it is still the crop of the tile it
// was made from (`tracePhotoScan`). A calibrated profile's two axes differ by a fraction of a percent,
// and one picture cannot be drawn at two scales, so the pair uses their mean.
//
// ## Fit, for a pair
//
// At the same scale, *Fit* is the larger of the two pictures fitting its viewer and the smaller drawn
// at that same scale — otherwise fitting each to its own viewer would draw a stamp cut with a wide
// margin smaller than one cut tight, and the sizes on screen would stop being sizes on paper.
//
// ## Carrying a view
//
// Linked, a move in one viewer puts the other on **the same place of the stamp** at **the same
// magnification**. At the same scale both are physical: the scale converts through the two
// resolutions, and the point at the centre is carried as its distance from the picture's centre in
// inches, which lands on the same corner of the stamp however differently the two were cropped.
// Otherwise both are relative: the zoom as a multiple of each viewer's fit, the point as a fraction
// of each picture.

import {
  MAX_SCALE,
  MIN_FIT_MULTIPLE,
  clampOffsets,
  fitScale,
  toSheetPoint,
  type Viewport,
  type ViewportSize,
} from "./scan-viewport";
import { initialProfileId, profileScale, type ScanningSetup } from "./scanning-profile";

export interface PictureSize {
  width: number;
  height: number;
}

/** One viewer of the pair as the arithmetic needs it. */
export interface PairedLayout {
  /** The picture in its own pixels — the frame the viewer's scale is taken in. */
  picture: PictureSize;
  viewport: ViewportSize;
  /** The picture's pixels per inch, or null when not known. */
  dpi: number | null;
}

/**
 * A picture's resolution: the profile its scan was taken with — the collection's default for a card
 * that does not say, as the measuring bar opens on (#1443) — or null where there is no scan behind
 * the picture, or no profile to read one from.
 */
export function pictureDpi(
  setup: ScanningSetup,
  scan: { scanningProfileId: string | null } | null
): number | null {
  if (!scan) return null;
  const id = initialProfileId(setup, scan.scanningProfileId);
  const profile = setup.profiles.find((p) => p.id === id);
  if (!profile) return null;
  const scale = profileScale(profile);
  return (scale.x + scale.y) / 2;
}

/** Whether the pair is drawn at one scale — both resolutions known. */
export function atSameScale(a: PairedLayout, b: PairedLayout): boolean {
  return a.dpi !== null && b.dpi !== null;
}

/**
 * What *Fit* means in each viewer of the pair — display pixels per picture pixel — or null when the
 * two are not at one scale and each fits its own viewer.
 */
export function pairedFitScales(
  a: PairedLayout,
  b: PairedLayout
): { a: number; b: number } | null {
  if (a.dpi === null || b.dpi === null) return null;
  const perInch = Math.min(
    fitScale(a.picture, a.viewport) * a.dpi,
    fitScale(b.picture, b.viewport) * b.dpi
  );
  return { a: perInch / a.dpi, b: perInch / b.dpi };
}

/** The picture whole and centred at a given scale — *Fit*, when the scale is the pair's. */
export function fitAt(picture: PictureSize, viewport: ViewportSize, scale: number): Viewport {
  return clampOffsets({ scale, offsetX: 0, offsetY: 0 }, picture, viewport);
}

/**
 * One viewer's view carried to the other: the same place of the stamp at the same magnification.
 * `fit` is what *Fit* means in each — the pair's scale, or the viewer's own.
 */
export function carryView(
  view: Viewport,
  from: PairedLayout & { fit: number },
  to: PairedLayout & { fit: number }
): Viewport {
  const centre = toSheetPoint(view, from.viewport.width / 2, from.viewport.height / 2);
  let scale: number;
  let x: number;
  let y: number;
  if (from.dpi !== null && to.dpi !== null) {
    // The same display pixels per inch: a picture of finer pixels is drawn at fewer per pixel.
    scale = (view.scale * from.dpi) / to.dpi;
    const ratio = to.dpi / from.dpi;
    x = to.picture.width / 2 + (centre.x - from.picture.width / 2) * ratio;
    y = to.picture.height / 2 + (centre.y - from.picture.height / 2) * ratio;
  } else {
    scale = (view.scale / from.fit) * to.fit;
    x = (centre.x / from.picture.width) * to.picture.width;
    y = (centre.y / from.picture.height) * to.picture.height;
  }
  // The viewer's own bounds, with the pair's fit standing for its own where it is the smaller —
  // a picture drawn smaller than its own fit, to match the other, must stay reachable.
  const floor = Math.min(to.fit, fitScale(to.picture, to.viewport)) * MIN_FIT_MULTIPLE;
  const bounded = Math.min(MAX_SCALE, Math.max(floor, scale));
  return clampOffsets(
    {
      scale: bounded,
      offsetX: to.viewport.width / 2 - x * bounded,
      offsetY: to.viewport.height / 2 - y * bounded,
    },
    to.picture,
    to.viewport
  );
}
