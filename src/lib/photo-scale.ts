// A photo's scale (#2061) — what a picture was scanned with, and the resolution that makes of the
// stored picture. Pure, beside `scanning-profile.ts` and `photo-measure-frame.ts`, whose numbers it
// composes: whether two pictures are drawn at one scale is a claim a collage makes about stamps, and
// a rule inside a component or a Prisma read is one nothing can test.
//
// ## What a scale is
//
// A copy's picture names a scanning profile (#1443), or carries a resolution typed for it when no
// profile fits — the measuring bar's *Another resolution…* — or neither, which is *no scale*: a phone
// photo, or a picture nobody has said anything about. **It is never read out of the image file**, the
// rule profiles already follow. A tile cut from a card is given the card's profile as it is cut.
//
// ## The resolution of the stored picture
//
// A profile's resolution is the **upload's**, and what the app keeps has been through `FULL_MAX_EDGE`.
// So the stored picture's resolution is the upload's scaled by how far it was shrunk, read off the
// frame `photo-measure-frame.ts` already derives for the measuring tools: the upload's own size, or
// the stored size where it cannot have been shrunk. Where no frame can be known — a picture at the cap
// from before the upload's size was recorded — there is no scale either, for the measuring tools' own
// reason: a resolution the app merely assumed is the one thing a scale must never be.
//
// A calibrated profile's two axes differ by a fraction of a percent and a picture is drawn at one
// scale, so the scale is their mean — as *Compare with the copies you hold* reads one (#1641).

import { parseScanDpi } from "./scan-measure";
import { photoMeasureFrame, type PhotoPixels } from "./photo-measure-frame";
import { profileLabel, profileScale, type ScanningProfileView, type ScanningSetup } from "./scanning-profile";

/** What a picture was scanned with, as written to it. */
export type PhotoScaleInput =
  | { kind: "profile"; profileId: string }
  | { kind: "typed"; dpi: number }
  | { kind: "none" };

/** The two columns a scale is stored in — at most one of them set. */
export interface PhotoScaleColumns {
  scanningProfileId: string | null;
  scanDpi: number | null;
}

export function photoScaleColumns(scale: PhotoScaleInput): PhotoScaleColumns {
  if (scale.kind === "profile") return { scanningProfileId: scale.profileId, scanDpi: null };
  if (scale.kind === "typed") return { scanningProfileId: null, scanDpi: scale.dpi };
  return { scanningProfileId: null, scanDpi: null };
}

export function photoScaleOf(columns: PhotoScaleColumns): PhotoScaleInput {
  if (columns.scanningProfileId) return { kind: "profile", profileId: columns.scanningProfileId };
  if (columns.scanDpi != null) return { kind: "typed", dpi: columns.scanDpi };
  return { kind: "none" };
}

/** Whether a picture says what it was scanned with. */
export function hasPhotoScale(columns: PhotoScaleColumns): boolean {
  return columns.scanningProfileId != null || columns.scanDpi != null;
}

/**
 * A scale as sent from a form or a request, or null when it is not one: a profile id must be a
 * non-empty string, a typed resolution a whole number in the range a stated dpi may take. Whether the
 * profile is this collection's is the write's to check.
 */
export function parsePhotoScaleInput(value: unknown): PhotoScaleInput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { kind?: unknown; profileId?: unknown; dpi?: unknown };
  if (v.kind === "none") return { kind: "none" };
  if (v.kind === "profile") {
    return typeof v.profileId === "string" && v.profileId ? { kind: "profile", profileId: v.profileId } : null;
  }
  if (v.kind === "typed") {
    const dpi = typeof v.dpi === "number" ? parseScanDpi(String(v.dpi)) : null;
    return dpi == null ? null : { kind: "typed", dpi };
  }
  return null;
}

/** The scale a picture is added with when nothing else is chosen: the collection's default profile,
 *  else its first, else none. */
export function defaultPhotoScale(setup: ScanningSetup): PhotoScaleInput {
  const ids = new Set(setup.profiles.map((p) => p.id));
  if (setup.defaultProfileId && ids.has(setup.defaultProfileId)) {
    return { kind: "profile", profileId: setup.defaultProfileId };
  }
  const first = setup.profiles[0];
  return first ? { kind: "profile", profileId: first.id } : { kind: "none" };
}

/** A scale in words, as the screens name it: the profile's own label, `600 dpi (typed)`, or
 *  `No scale`. A profile no longer in the setup reads as an unnamed one rather than as none. */
export function photoScaleLabel(scale: PhotoScaleInput, setup: ScanningSetup): string {
  if (scale.kind === "typed") return `${scale.dpi} dpi (typed)`;
  if (scale.kind === "none") return "No scale";
  const profile = setup.profiles.find((p) => p.id === scale.profileId);
  return profile ? profileLabel(profile) : "A scanning profile";
}

/** The resolution the picture was **uploaded** at, in dots per inch, or null for no scale. */
export function uploadDpi(
  scale: { profile: Pick<ScanningProfileView, "nominalDpi" | "calibration"> | null; scanDpi: number | null }
): number | null {
  if (scale.profile) {
    const axes = profileScale({ id: "", name: "", ...scale.profile });
    return (axes.x + axes.y) / 2;
  }
  return scale.scanDpi != null && scale.scanDpi > 0 ? scale.scanDpi : null;
}

/**
 * The resolution of the **stored** picture — the upload's, scaled by how far `FULL_MAX_EDGE` shrank
 * it — or null where the picture has no scale or no frame to reckon it in. `maxEdge` is passed in so
 * this module stays free of `sharp`.
 */
export function storedPhotoDpi(pixels: PhotoPixels, dpi: number | null, maxEdge: number): number | null {
  if (dpi == null || !(dpi > 0)) return null;
  const frame = photoMeasureFrame(pixels, maxEdge);
  if (!frame) return null;
  return (dpi * Math.max(pixels.width, pixels.height)) / Math.max(frame.width, frame.height);
}

// ## The picker
//
// One select names a profile, *Another resolution…* (with a field for it) or *No scale*, as the
// measuring bar's does; the field's text is kept as typed, so the draft below is what the picker
// holds and {@link scaleFromDraft} is what it means.

export const SCALE_CHOICE_TYPED = "__typed";
export const SCALE_CHOICE_NONE = "__none";

export interface PhotoScaleDraft {
  /** A profile id, {@link SCALE_CHOICE_TYPED} or {@link SCALE_CHOICE_NONE}. */
  choice: string;
  /** The resolution as typed, read only when the choice is a typed one. */
  dpiText: string;
}

export function draftFromScale(scale: PhotoScaleInput): PhotoScaleDraft {
  if (scale.kind === "profile") return { choice: scale.profileId, dpiText: "" };
  if (scale.kind === "typed") return { choice: SCALE_CHOICE_TYPED, dpiText: String(scale.dpi) };
  return { choice: SCALE_CHOICE_NONE, dpiText: "" };
}

/** What the draft says, or null while a typed resolution is not one. */
export function scaleFromDraft(draft: PhotoScaleDraft): PhotoScaleInput | null {
  if (draft.choice === SCALE_CHOICE_NONE) return { kind: "none" };
  if (draft.choice === SCALE_CHOICE_TYPED) {
    const dpi = parseScanDpi(draft.dpiText);
    return dpi == null ? null : { kind: "typed", dpi };
  }
  return draft.choice ? { kind: "profile", profileId: draft.choice } : null;
}

/** Whether two scales say the same thing. */
export function sameScale(a: PhotoScaleInput, b: PhotoScaleInput): boolean {
  if (a.kind === "profile" && b.kind === "profile") return a.profileId === b.profileId;
  if (a.kind === "typed" && b.kind === "typed") return a.dpi === b.dpi;
  return a.kind === b.kind;
}
