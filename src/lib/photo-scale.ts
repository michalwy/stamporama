// A photo's scale (#2061) — what a picture was scanned with, and the resolution that makes of the
// stored picture. Pure, beside `scanning-profile.ts` and `photo-measure-frame.ts`, whose numbers it
// composes: whether two pictures are drawn at one scale is a claim a collage makes about stamps, and
// a rule inside a component or a Prisma read is one nothing can test.
//
// ## What a scale is
//
// A copy's picture names a scanning profile (#1443), or carries a resolution typed for it when no
// profile fits — the measuring bar's *Another resolution…* — or is marked *No scale*: a phone photo.
// **It is never read out of the image file**, the rule profiles already follow. A tile cut from a card
// is given the card's profile as it is cut.
//
// A picture nobody has said anything about — every one added before scales existed — is **never
// given a scale**, which is not *No scale* (#2066): it is taken at the collection's default profile,
// read when the image is drawn, so changing the default changes it. {@link resolvePhotoScale} is that
// reading, and a screen naming such a scale says it comes from the default.
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

/** What a picture was scanned with, as written to it: a profile, a typed resolution, *No scale*
 *  (`none`), or nothing said — `default`, the collection's default profile when it is drawn. */
export type PhotoScaleInput =
  | { kind: "profile"; profileId: string }
  | { kind: "typed"; dpi: number }
  | { kind: "none" }
  | { kind: "default" };

/** The three columns a scale is stored in — at most one of them set; none set is `default`. */
export interface PhotoScaleColumns {
  scanningProfileId: string | null;
  scanDpi: number | null;
  noScale: boolean;
}

export function photoScaleColumns(scale: PhotoScaleInput): PhotoScaleColumns {
  if (scale.kind === "profile") return { scanningProfileId: scale.profileId, scanDpi: null, noScale: false };
  if (scale.kind === "typed") return { scanningProfileId: null, scanDpi: scale.dpi, noScale: false };
  return { scanningProfileId: null, scanDpi: null, noScale: scale.kind === "none" };
}

export function photoScaleOf(columns: PhotoScaleColumns): PhotoScaleInput {
  if (columns.scanningProfileId) return { kind: "profile", profileId: columns.scanningProfileId };
  if (columns.scanDpi != null) return { kind: "typed", dpi: columns.scanDpi };
  return columns.noScale ? { kind: "none" } : { kind: "default" };
}

/** A scale as it is drawn: a picture never given one takes the collection's default profile, or none
 *  where the collection has no default. `fromDefault` says the profile is that default rather than
 *  the picture's own choice — what a screen must say so the two are never mistaken (#2066). */
export interface ResolvedPhotoScale {
  scale: Exclude<PhotoScaleInput, { kind: "default" }>;
  fromDefault: boolean;
}

export function resolvePhotoScale(scale: PhotoScaleInput, defaultProfileId: string | null): ResolvedPhotoScale {
  if (scale.kind !== "default") return { scale, fromDefault: false };
  return defaultProfileId
    ? { scale: { kind: "profile", profileId: defaultProfileId }, fromDefault: true }
    : { scale: { kind: "none" }, fromDefault: false };
}

/** Whether a picture lacks a scale **as drawn** (#2066): marked *No scale*, or never given one in a
 *  collection with no default profile. */
export function lacksPhotoScale(scale: PhotoScaleInput, defaultProfileId: string | null): boolean {
  return resolvePhotoScale(scale, defaultProfileId).scale.kind === "none";
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
  if (v.kind === "default") return { kind: "default" };
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
 *  `No scale`; a picture never given one names the default profile with `(default)` after it, so a
 *  default is never read as a choice (#2066). A profile no longer in the setup reads as an unnamed
 *  one rather than as none. */
export function photoScaleLabel(scale: PhotoScaleInput, setup: ScanningSetup): string {
  const resolved = resolvePhotoScale(scale, defaultProfileIdOf(setup));
  const drawn = resolved.scale;
  if (drawn.kind === "typed") return `${drawn.dpi} dpi (typed)`;
  if (drawn.kind === "none") return "No scale";
  const profile = setup.profiles.find((p) => p.id === drawn.profileId);
  const name = profile ? profileLabel(profile) : "A scanning profile";
  return resolved.fromDefault ? `${name} (default)` : name;
}

/** The setup's default profile, while it is one of its profiles. */
export function defaultProfileIdOf(setup: ScanningSetup): string | null {
  return setup.defaultProfileId && setup.profiles.some((p) => p.id === setup.defaultProfileId)
    ? setup.defaultProfileId
    : null;
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
// measuring bar's does — and, where a saved photo's scale is edited, *the collection's default*, to
// put a photo back to never having been given one; the field's text is kept as typed, so the draft
// below is what the picker holds and {@link scaleFromDraft} is what it means.

export const SCALE_CHOICE_TYPED = "__typed";
export const SCALE_CHOICE_NONE = "__none";
export const SCALE_CHOICE_DEFAULT = "__default";

export interface PhotoScaleDraft {
  /** A profile id, {@link SCALE_CHOICE_TYPED}, {@link SCALE_CHOICE_NONE} or {@link SCALE_CHOICE_DEFAULT}. */
  choice: string;
  /** The resolution as typed, read only when the choice is a typed one. */
  dpiText: string;
}

export function draftFromScale(scale: PhotoScaleInput): PhotoScaleDraft {
  if (scale.kind === "profile") return { choice: scale.profileId, dpiText: "" };
  if (scale.kind === "typed") return { choice: SCALE_CHOICE_TYPED, dpiText: String(scale.dpi) };
  if (scale.kind === "default") return { choice: SCALE_CHOICE_DEFAULT, dpiText: "" };
  return { choice: SCALE_CHOICE_NONE, dpiText: "" };
}

/** What the draft says, or null while a typed resolution is not one. */
export function scaleFromDraft(draft: PhotoScaleDraft): PhotoScaleInput | null {
  if (draft.choice === SCALE_CHOICE_NONE) return { kind: "none" };
  if (draft.choice === SCALE_CHOICE_DEFAULT) return { kind: "default" };
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
