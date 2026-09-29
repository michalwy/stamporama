// Scanning profiles (#1443): a scanner at a resolution, its calibration, and the scale a measurement
// is taken at.
//
// Pure — no Prisma, no React, no DOM — for `scan-measure.ts`'s reason: these numbers are quoted back
// to a collector as facts about a stamp, and a rule written inside a component is a rule nothing can
// test. The reads and writes are `scanning-profiles.ts`.
//
// ## A scale names itself
//
// #598's rule was *no figure without the scale it was taken at*, and it was kept by printing the dpi.
// With profiles the dpi alone no longer says enough — *1200 dpi* is true of a calibrated and an
// uncalibrated profile alike — so a {@link MeasureScale} carries its own sentence ({@link scaleLabel}):
// *Epson V600, 1200 dpi (calibrated)*, or *1200 dpi (typed)* for a resolution typed for the sitting.
// Every reading is printed with it.
//
// ## Calibration
//
// A ruler is scanned, one stretch of it is marked across the scan and one along it, and their true
// lengths are typed. Each marked line gives one equation in the two unknown resolutions — its
// horizontal component through one, its vertical through the other — so the two lines together are
// solved exactly ({@link calibrateProfile}), and a ruler lying a degree askew on the glass costs
// nothing. What protects the figure is on the input side: a stretch of at least
// {@link MIN_CALIBRATION_MM}, so a tick missed by a pixel is spread over thousands of them, and a
// result within {@link MAX_CALIBRATION_DEVIATION} of nominal, since anything further is a slip —
// a wrong length typed, the two lines swapped — and not a scanner.
//
// The two stretches may be marked on one scan or on two (#1486), and the solve is the same: it reads
// only each stretch's own components, and every scan the scanner takes at one resolution has the
// same pixel frame — x along the sensor, y along the carriage — wherever the ruler lay and however
// large the picture was. What two scans do change is who checks: the browser solves for the figure
// it shows, and the server solves again from the marked stretches ({@link readCalibrationStretches}),
// so the minimum length and the band hold whoever sent the request.

import {
  MAX_SCAN_DPI,
  MIN_SCAN_DPI,
  MM_PER_INCH,
  type ScanPoint,
  type ScanScale,
} from "./scan-measure";
import { isSideways, type QuarterTurn } from "./tile-turn";

/** A profile as every screen reads one. `calibration` is both axes or null — the column pair's own
 * rule, collapsed to a value. */
export interface ScanningProfileView {
  id: string;
  name: string;
  nominalDpi: number;
  calibration: ScanScale | null;
}

/** A collection's profiles and which one is its default — what a page hands to everything that
 * measures, in place of #598's single `scanDpi`. */
export interface ScanningSetup {
  profiles: ScanningProfileView[];
  defaultProfileId: string | null;
}

/** One row of the Settings list: the profile, whether it is the default, and what uses it — so the
 * delete control can say why it is refused before it is pressed. */
export interface ScanningProfileListRow extends ScanningProfileView {
  isDefault: boolean;
  scanCount: number;
  stampSizeCount: number;
}

/** The scale a measurement is taken at, and what it was taken with. */
export interface MeasureScale extends ScanScale {
  /** The profile, or null for a resolution typed for the sitting. */
  profileId: string | null;
  /** Whether the axes are a calibration's rather than the nominal figure. */
  calibrated: boolean;
  /** The scale's own sentence, printed after every figure taken with it. */
  label: string;
}

/** Longest a profile's name may be — a scanner's model, not a description of it. */
export const MAX_PROFILE_NAME = 60;

/** The shortest stretch of ruler a calibration is taken over, in millimetres. At 1200 dpi 100 mm is
 * about 4700 pixels, so an end placed a pixel off a tick moves the result by about 0.02% — well
 * below the few tenths of a per cent a scanner is actually off by. */
export const MIN_CALIBRATION_MM = 100;

/** How far a calibration may put a scanner from its nominal resolution before it is refused as a
 * probable mistake. Real flatbeds are off by a fraction of a per cent; a figure 5% out is a length
 * typed wrong or a stretch marked from the wrong tick, and writing it would quietly make every later
 * measurement wrong by that much. */
export const MAX_CALIBRATION_DEVIATION = 0.03;

/** A line marked for calibration may lean this far off its axis, in degrees — enough for a ruler
 * laid down by hand, not enough to mistake the stretch across for the stretch along. */
export const MAX_CALIBRATION_TILT_DEGREES = 15;

/** Decimals a calibrated resolution is kept to — the column's precision. */
const CALIBRATION_DECIMALS = 2;

/** What a profile is called wherever a figure is printed with it: the collector's name, the nominal
 * resolution, and whether it is calibrated — *Epson V600, 1200 dpi (calibrated)*. The resolution is
 * always in it, so #598's *no figure without its scale* holds whatever the profile is named. */
export function profileLabel(profile: Pick<ScanningProfileView, "name" | "nominalDpi" | "calibration">): string {
  return `${profile.name}, ${profile.nominalDpi} dpi (${profile.calibration ? "calibrated" : "uncalibrated"})`;
}

/** The calibration itself, for the screens that show it: *1195.37 × 1198.02 dpi*. */
export function formatCalibration(calibration: ScanScale): string {
  return `${formatDpi(calibration.x)} × ${formatDpi(calibration.y)} dpi`;
}

function formatDpi(dpi: number): string {
  return Number.isInteger(dpi) ? String(dpi) : dpi.toFixed(CALIBRATION_DECIMALS);
}

/** The scale a profile measures at: its calibration, or its nominal dpi on both axes. */
export function profileScale(profile: ScanningProfileView): MeasureScale {
  const axes = profile.calibration ?? { x: profile.nominalDpi, y: profile.nominalDpi };
  return {
    x: axes.x,
    y: axes.y,
    profileId: profile.id,
    calibrated: profile.calibration !== null,
    label: profileLabel(profile),
  };
}

/** A resolution typed for the sitting — #598's field, kept for a picture no profile fits. */
export function typedScale(dpi: number): MeasureScale {
  return { x: dpi, y: dpi, profileId: null, calibrated: false, label: `${dpi} dpi (typed)` };
}

/**
 * The scale in the frame of a picture turned by a quarter turn (#1006).
 *
 * A tile stood the right way up shows the scanner's x axis running down the screen, and its marks are
 * placed in that turned frame — so the axes swap for a sideways turn. A half turn leaves them where
 * they were: it reverses both, and a resolution has no sign.
 */
export function scaleForTurn<S extends ScanScale>(scale: S, turn: QuarterTurn): S {
  return isSideways(turn) ? { ...scale, x: scale.y, y: scale.x } : scale;
}

/**
 * Which profile a measurement opens on: the one the scan was taken with, when it is still one of the
 * collection's, else the default, else the first — and null only when the collection has none, where
 * the viewer falls back to a typed resolution.
 */
export function initialProfileId(setup: ScanningSetup, taken: string | null | undefined): string | null {
  const ids = new Set(setup.profiles.map((p) => p.id));
  if (taken && ids.has(taken)) return taken;
  if (setup.defaultProfileId && ids.has(setup.defaultProfileId)) return setup.defaultProfileId;
  return setup.profiles[0]?.id ?? null;
}

/** A profile's name as typed, or null when it is not one: blank, or longer than a name. */
export function parseProfileName(text: string): string | null {
  const name = text.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_PROFILE_NAME) return null;
  return name;
}

/** Whether a nominal resolution is one a profile may have — #598's bounds on a stated dpi. */
export function isNominalDpi(dpi: number): boolean {
  return Number.isInteger(dpi) && dpi >= MIN_SCAN_DPI && dpi <= MAX_SCAN_DPI;
}

/** Whether a calibration is one this module would produce — both axes within the refusal band of
 * the nominal figure. {@link calibrateProfile} ends with it, and the write solves the stretches
 * again rather than accepting a figure, so a request cannot slip one past the rule. */
export function isPlausibleCalibration(nominalDpi: number, calibration: ScanScale): boolean {
  return [calibration.x, calibration.y].every(
    (dpi) =>
      Number.isFinite(dpi) && Math.abs(dpi / nominalDpi - 1) <= MAX_CALIBRATION_DEVIATION + 1e-9
  );
}

/** One stretch of ruler marked for calibration: its two ends in the scan's own pixels, and the true
 * length between them in millimetres. */
export interface CalibrationStretch {
  a: ScanPoint;
  b: ScanPoint;
  mm: number;
}

/** The two stretches a calibration is solved from, each marked on the same scan or on its own. */
export interface CalibrationStretches {
  across: CalibrationStretch;
  along: CalibrationStretch;
}

/**
 * The two stretches as a request carries them, or null when it does not carry both: a calibration
 * is solved from a stretch on each axis, never saved with one of them missing.
 */
export function readCalibrationStretches(value: unknown): CalibrationStretches | null {
  if (typeof value !== "object" || value === null) return null;
  const { across, along } = value as Record<string, unknown>;
  const a = readStretch(across);
  const b = readStretch(along);
  return a && b ? { across: a, along: b } : null;
}

function readStretch(value: unknown): CalibrationStretch | null {
  if (typeof value !== "object" || value === null) return null;
  const { a, b, mm } = value as Record<string, unknown>;
  const pa = readPoint(a);
  const pb = readPoint(b);
  if (!pa || !pb || typeof mm !== "number" || !Number.isFinite(mm)) return null;
  return { a: pa, b: pb, mm };
}

function readPoint(value: unknown): ScanPoint | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export type CalibrationResult =
  | { ok: true; calibration: ScanScale }
  | { ok: false; reason: string };

/**
 * The effective resolution of each axis, from a stretch marked across the scan and one along it —
 * on one scan or on two, which the solve does not need to know.
 *
 * Each stretch satisfies `(dx / X)² + (dy / Y)² = L²`, with its components in pixels and its true
 * length `L` in inches — linear in `1/X²` and `1/Y²`, so the two stretches are solved exactly rather
 * than each being read as if it lay perfectly on its axis. A ruler askew on the glass is then no
 * error at all; the tilt limit is there only to catch the two stretches being the wrong way round.
 *
 * Refused, with the reason, when a stretch is shorter than {@link MIN_CALIBRATION_MM}, leans too far
 * off its axis, or the answer is further than {@link MAX_CALIBRATION_DEVIATION} from nominal.
 */
export function calibrateProfile(
  nominalDpi: number,
  horizontal: CalibrationStretch,
  vertical: CalibrationStretch
): CalibrationResult {
  for (const [stretch, name] of [
    [horizontal, "across"],
    [vertical, "along"],
  ] as const) {
    if (!(stretch.mm >= MIN_CALIBRATION_MM)) {
      return {
        ok: false,
        reason: `The stretch ${name} the scan must be at least ${MIN_CALIBRATION_MM} mm long.`,
      };
    }
  }
  const h = { dx: horizontal.b.x - horizontal.a.x, dy: horizontal.b.y - horizontal.a.y };
  const v = { dx: vertical.b.x - vertical.a.x, dy: vertical.b.y - vertical.a.y };
  const tilt = Math.tan((MAX_CALIBRATION_TILT_DEGREES * Math.PI) / 180);
  if (!(Math.abs(h.dy) <= Math.abs(h.dx) * tilt)) {
    return { ok: false, reason: "Mark the stretch across the scan along a ruler lying left to right." };
  }
  if (!(Math.abs(v.dx) <= Math.abs(v.dy) * tilt)) {
    return { ok: false, reason: "Mark the stretch along the scan on a ruler lying top to bottom." };
  }

  const lh = horizontal.mm / MM_PER_INCH;
  const lv = vertical.mm / MM_PER_INCH;
  const det = h.dx ** 2 * v.dy ** 2 - v.dx ** 2 * h.dy ** 2;
  if (!(Math.abs(det) > 0)) {
    return { ok: false, reason: "Mark both stretches before calibrating." };
  }
  const u = (lh ** 2 * v.dy ** 2 - lv ** 2 * h.dy ** 2) / det;
  const w = (h.dx ** 2 * lv ** 2 - v.dx ** 2 * lh ** 2) / det;
  if (!(u > 0) || !(w > 0)) {
    return { ok: false, reason: "Those lengths do not fit the marked stretches — check both." };
  }
  const factor = 10 ** CALIBRATION_DECIMALS;
  const calibration = {
    x: Math.round((1 / Math.sqrt(u)) * factor) / factor,
    y: Math.round((1 / Math.sqrt(w)) * factor) / factor,
  };
  if (!isPlausibleCalibration(nominalDpi, calibration)) {
    return {
      ok: false,
      reason: `That gives ${formatCalibration(calibration)}, more than ${Math.round(
        MAX_CALIBRATION_DEVIATION * 100
      )}% from ${nominalDpi} dpi — probably a length typed wrong or a stretch marked from the wrong tick.`,
    };
  }
  return { ok: true, calibration };
}
