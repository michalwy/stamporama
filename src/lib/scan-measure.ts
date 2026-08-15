// Measuring on a scan (#598): a distance in millimetres between two points of a card, and the
// perforation gauge that is arithmetic over it.
//
// Pure — no DOM, no React, no Prisma — for the same reason `scan-viewport.ts` is: the numbers here
// are the whole product. A ruler whose conversion is a line inside a component is a conversion
// nothing can test, and this one is quoted back to a collector as a fact about a stamp.
//
// ## The scale is stated, never inferred
//
// Everything below takes `dpi` as an argument and nothing anywhere derives one. A scan's own
// metadata is not consulted: #574's source corpus claimed 1200 dpi in EXIF while the image was
// 3841 px against an EXIF width of 5121 — stale metadata from an earlier edit — and it concluded
// to ignore it. That mattered less there, because detection only needed *relative* geometry. A
// gauge is an **absolute** claim, and philately separates perf 11½ from perf 12 — under 4%. A
// scale taken from a field that can be stale yields a number that looks precise, is wrong, and is
// then written down as a variant's defining feature.
//
// Which is also why every formatter here that states a figure takes the dpi and puts it in the
// string ({@link formatMillimetresAt}, {@link formatGaugeAt}): *11½* is a claim, *11½ at 1200 dpi*
// is a claim with its assumption attached, and the second one cannot quietly become a fact taken
// under the wrong default.
//
// ## Measurements are read, never stored
//
// Nothing here writes and no caller does either. See `docs/agents/purchases-and-intake.md` — in
// short, a stored *measured perf* would sit beside the catalogue's and disagree with it for reasons
// nobody recorded, and the collector's own conclusion already has a home (the stamp, its variant,
// a parked tile's note).

/** Millimetres per inch. The one constant the whole module turns on. */
export const MM_PER_INCH = 25.4;

/** What a collection's scale field starts at — the resolution this app's own reference corpus was
 * scanned at, and the one a flatbed set up for stamps is usually left on. A default, not a
 * detection: it is prefilled into the field and the field is on screen beside the result. */
export const DEFAULT_SCAN_DPI = 1200;

/** Bounds on a stated scale. Wide on purpose — they exist to catch a typo (`120`, `12000`), not to
 * have an opinion about scanners. Below the floor a stamp would be a few dozen pixels wide; above
 * the ceiling no flatbed is sampling optically. */
export const MIN_SCAN_DPI = 72;
export const MAX_SCAN_DPI = 9600;

/** Perforation is quoted as teeth per **2 cm** — the length a physical odontometer is graduated
 * over. Everything about the gauge follows from this one convention. */
export const GAUGE_REFERENCE_MM = 20;

/** Catalogues quote perforation in quarter steps — 11, 11¼, 11½, 11¾, 12. The **step** is what a
 * catalogue says and what a collector compares against; the measured figure is what says whether
 * the piece sits comfortably on that step or awkwardly between two, which is the case worth
 * knowing about. Both are reported, always, and neither replaces the other. */
export const GAUGE_STEP = 0.25;

/** Sanity bounds on a gauge, used only to tell a plausible reading from an obvious slip — a run
 * marked backwards, a tooth count of 1 over a whole stamp's width. Real philatelic perforations run
 * roughly 7 to 16. */
export const MIN_PLAUSIBLE_GAUGE = 3;
export const MAX_PLAUSIBLE_GAUGE = 30;

/** A point on the picture, in its own **scan** pixels — which is what `toSheetPoint` produces and
 * what a tile's box is expressed in. Fractional: a click lands between pixels and rounding it here
 * would throw away precision the measurement is entitled to. */
export interface ScanPoint {
  x: number;
  y: number;
}

/**
 * A stated scale, parsed from what was typed into the field beside the result.
 *
 * Whole numbers only. A scanner profile is 600 or 1200, never 1200.5, and a decimal point in this
 * field is a slip rather than a precision — the fourth digit of a dpi is far below the error in
 * where a click lands.
 */
export function parseScanDpi(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < MIN_SCAN_DPI || n > MAX_SCAN_DPI) return null;
  return n;
}

/**
 * How many teeth lie between the two marks (#598).
 *
 * Whole and at least one. **Teeth between the marks, not holes**: a run marked from the first hole
 * to the last has one fewer tooth than it has holes, and asking for the count the collector can see
 * between two marks removes the off-by-one from the collector's side of the arithmetic entirely.
 */
export function parseToothCount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** The straight-line distance between two points of the scan, in scan pixels. */
export function distanceInScanPixels(a: ScanPoint, b: ScanPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Scan pixels to millimetres at a stated scale. The whole of the pixels → millimetres step, in one
 * place, so there is exactly one line in the app that could have it wrong. */
export function scanPixelsToMm(px: number, dpi: number): number {
  if (!(dpi > 0)) return 0;
  return (px / dpi) * MM_PER_INCH;
}

/** The ruler: two points and a stated scale, in millimetres — with the pixel count kept, because a
 * reading taken across nine pixels is a different kind of number from one taken across nine
 * hundred, and the toolbar says so. */
export function measureDistance(
  a: ScanPoint,
  b: ScanPoint,
  dpi: number
): { px: number; mm: number } {
  const px = distanceInScanPixels(a, b);
  return { px, mm: scanPixelsToMm(px, dpi) };
}

/**
 * The perforation gauge: teeth per 2 cm.
 *
 * `mm` is the distance between the two marks and `teeth` how many teeth lie between them, so the
 * pitch is `mm / teeth` and the gauge is how many of those pitches fit in 20 mm. That is exactly
 * what an odontometer reads off, which is the point — nothing new has to be learned to use this,
 * and a collector who already gauges by hand is checking a familiar number.
 *
 * Null when the inputs cannot produce one, rather than a figure of `Infinity` or `0` that would
 * render as a plausible-looking reading.
 */
export function perforationGauge(mm: number, teeth: number): number | null {
  if (!(mm > 0) || !(teeth >= 1)) return null;
  return (teeth * GAUGE_REFERENCE_MM) / mm;
}

/** Whether a gauge is in the range perforations actually occupy. A reading outside it is a marked
 * run or a tooth count that is wrong, and saying so is better than quoting `47.3`. */
export function isPlausibleGauge(gauge: number): boolean {
  return gauge >= MIN_PLAUSIBLE_GAUGE && gauge <= MAX_PLAUSIBLE_GAUGE;
}

/** The catalogue step a measured gauge is nearest to — quarter gauges, {@link GAUGE_STEP}. */
export function nearestCatalogueGauge(gauge: number): number {
  return Math.round(gauge / GAUGE_STEP) * GAUGE_STEP;
}

/**
 * A quarter-step gauge as a catalogue writes it: `11`, `11¼`, `11½`, `11¾`.
 *
 * Vulgar fractions rather than `11.25`, because that is the notation on the page the reading is
 * about to be compared against, and a collector matching `11½` against `11.5` is doing a conversion
 * this app could have done.
 */
export function formatGaugeStep(gauge: number): string {
  const quarters = Math.round(gauge / GAUGE_STEP);
  const whole = Math.floor(quarters / 4);
  const fraction = ["", "¼", "½", "¾"][((quarters % 4) + 4) % 4];
  if (!fraction) return String(whole);
  return whole === 0 ? fraction : `${whole}${fraction}`;
}

/** The measured gauge itself, two decimals — enough to tell a piece sitting on a step from one
 * sitting between two, and not so many digits that it claims a precision a click does not have. */
export function formatMeasuredGauge(gauge: number): string {
  return gauge.toFixed(2);
}

/** A distance, two decimals of a millimetre. At 1200 dpi one scan pixel is about 0.021 mm, so the
 * second decimal is roughly where the scan itself stops having anything to say. */
export function formatMillimetres(mm: number): string {
  return mm.toFixed(2);
}

/** A distance **with the scale it was taken at**, which is the only form this app states one in. */
export function formatMillimetresAt(mm: number, dpi: number): string {
  return `${formatMillimetres(mm)} mm at ${dpi} dpi`;
}

/** A gauge with the scale it was taken at — *11½ at 1200 dpi*, never *11½*. The measured figure
 * rides along in parentheses: the step is what a catalogue says, the raw one is what says how
 * comfortably the piece sits on it. */
export function formatGaugeAt(gauge: number, dpi: number): string {
  return `${formatGaugeStep(nearestCatalogueGauge(gauge))} (${formatMeasuredGauge(gauge)}) at ${dpi} dpi`;
}
