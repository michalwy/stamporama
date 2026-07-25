/**
 * Pure input fingerprint for an offer's generated photos (#311) — no Prisma, unit-testable, so the
 * exact same rule decides "out of date" on the server and could later drive a client-side hint.
 *
 * What it is for
 * --------------
 * Generated images are **files that were downloaded, not recomputed**. The plan therefore has to be
 * able to say whether the images on disk still match what the offer looks like now. That is all this
 * is: a hash of everything the renderer read. Compare the hash stored with the last successful run
 * against the current one, and a mismatch marks the plan out of date.
 *
 * It is a **signal, never a trigger**. Nothing regenerates on download; while nothing has changed the
 * stored files are simply served, and when something has changed the collector decides whether the
 * new images are worth a re-upload to the platform.
 *
 * What goes in
 * ------------
 * Everything `planOfferPhotos` (#309) and `renderCollage` (#310) consume:
 *
 * - the **composition and its order** — which sets, in which order, holding which copies, in which
 *   effective order (#306);
 * - the **source photo ids** per copy and side. Photo rows are immutable per id (replacing a front
 *   scan writes a new row), so an id captures the bytes;
 * - the **offer's photo configuration** (#308) — sides, the two tile label templates (#312) and the
 *   collage numbers;
 * - the **rendered tile labels** (#312), not just their template: the labels are drawn into the
 *   images, so editing the location ref of a copy changes the pixels exactly as replacing its scan
 *   does, and has to read as out of date for the same reason;
 * - the **platform's output limits** (#308), which the renderer reads live: raising the file-size cap
 *   changes the encoded result, so it belongs here even though it lives on the platform.
 *
 * Only the *effective* order is hashed, not the raw `sortOrder` values: reordering copies into the
 * order catalog order already produced is not a change to the images.
 *
 * `FINGERPRINT_VERSION` is bumped by hand when the renderer's own output changes (a layout fix, a
 * different encoder default), which invalidates every stored fingerprint at once — otherwise images
 * produced by the old code would keep claiming to be current.
 */

import { createHash } from "node:crypto";
import type { OfferCollageValues, PhotoSides, PlatformPhotoLimits } from "./offer-photo-config";
import { compareSets, sortSetItems, type SetItemOrderRow, type SetOrderRow } from "./offer-set-order";

/** Bumped when the renderer's output changes, invalidating every stored fingerprint. `2`: tiles
 * carry their label (#312). `3`: the gap and the label strip became percentages of the stamp rather
 * than pixels (#312), so the same numbers describe a different geometry. */
export const FINGERPRINT_VERSION = 3;

/** One copy as the fingerprint sees it: its order fields (#306) plus the scans its tiles come from. */
export interface FingerprintCopy extends SetItemOrderRow {
  frontPhotoId: string | null;
  backPhotoId: string | null;
}

export interface FingerprintSet extends SetOrderRow {
  items: readonly FingerprintCopy[];
}

/** Everything the generator read, in whatever order the caller happened to read it. */
export interface OfferPhotoFingerprintInput {
  sets: readonly FingerprintSet[];
  photoSides: PhotoSides;
  photoLabelLeftTemplate: string | null;
  photoLabelRightTemplate: string | null;
  /** The two annotations each copy's tile is drawn with (#312), as `[itemId, left, right]` rows in
   * any order. A side with nothing to say is an empty string; copies with neither are absent. */
  tileLabels: readonly (readonly [string, string, string])[];
  collage: OfferCollageValues | null;
  limits: PlatformPhotoLimits;
}

/**
 * Hashes the generator's inputs into a stable hex digest. Deterministic and order-insensitive at the
 * *input* level: the sets and copies are put into their effective order first, so reading them in a
 * different order yields the same fingerprint.
 */
export function fingerprintOfferPhotoInputs(input: OfferPhotoFingerprintInput): string {
  // Built as nested arrays rather than objects: array order is the canonical form, so there is no
  // key-ordering question to get wrong when this is serialized.
  const composition = [...input.sets].sort(compareSets).map((set) => [
    set.id,
    sortSetItems(set.items).map((copy) => [copy.itemId, copy.frontPhotoId, copy.backPhotoId]),
  ]);

  // Sorted by copy id: which order the labels were read in is not a change to the images.
  const tileLabels = [...input.tileLabels].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const config = [
    input.photoSides,
    input.photoLabelLeftTemplate,
    input.photoLabelRightTemplate,
    tileLabels,
    input.collage
      ? [
          input.collage.collageRows,
          input.collage.collageColumns,
          input.collage.collageGapPercent,
          input.collage.collageBackground,
          input.collage.collageLabelPercent,
        ]
      : null,
  ];

  const limits = [
    input.limits.maxPhotos,
    input.limits.maxPhotoEdge,
    input.limits.maxPhotoFileSizeMib,
  ];

  return createHash("sha256")
    .update(JSON.stringify([FINGERPRINT_VERSION, composition, config, limits]))
    .digest("hex");
}
