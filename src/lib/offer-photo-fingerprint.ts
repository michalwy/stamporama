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
 *   collage numbers, and the grid mode that says how those numbers are read (#413);
 * - the **rendered tile labels** (#312), not just their template: the labels are drawn into the
 *   images, so editing the location ref of a copy changes the pixels exactly as replacing its scan
 *   does, and has to read as out of date for the same reason;
 * - the **manual attachments** (#313) — which image, from which copy, at which position, and the
 *   annotation an attachment with no copy is drawn with. Adding, removing or replacing one changes
 *   what gets rendered, so it is the same kind of change as any other. A manual collage (#331) adds
 *   its tiles and its column count, for the same reason: both are drawn into the image;
 * - the **set of images the plan renders** (#313), when the offer carries a manual order or a
 *   do-not-publish mark: either can change *which* images fit under the platform's photo limit.
 *
 * What is deliberately **not** in it is the upload **order**. A reorder is applied to the stored
 * images themselves — their entries are renumbered, their bytes untouched — so it cannot leave them
 * stale, and reporting it as staleness would ask for a re-render that changes nothing.
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
  /** The offer's manual attachments (#313), in any order. */
  attachments?: readonly FingerprintAttachment[];
  /** The annotation an attachment with no copy is drawn with (#313 mode b) — the label templates
   * resolved against nothing, so only their literal text survives. Hashed because it is drawn into
   * those images, exactly like a copy's own tile labels. */
  uploadTileLabel?: readonly [string, string];
  /**
   * The tokens of the images the plan actually renders (#313), in any order — a **set**, not a
   * sequence.
   *
   * Order itself is deliberately *not* hashed: a reorder is applied to the stored images directly
   * (their entries are renumbered, the bytes untouched), so it can never make them stale. What can
   * is *which* images exist — and order and do-not-publish both affect that, because truncation
   * follows the order and an unpublished image frees a slot under `maxPhotos`. Hashing the resolved
   * set catches exactly that and nothing else.
   *
   * Passed **only when the offer carries a custom order or an unpublished token**. Without either,
   * the rendered set follows from the composition and the limits, which are hashed already — so
   * leaving it out keeps every such offer hashing exactly as it did before this existed.
   */
  renderedTokens?: readonly string[];
}

/** One manual attachment as the fingerprint sees it: what it shows, from which copy, and where it
 * sits in the plan. A manual collage (#331) shows several photos and no single one, so it names
 * neither `photoId` nor `itemId` and carries `collage` instead. */
export interface FingerprintAttachment {
  id: string;
  position: number;
  photoId: string | null;
  itemId: string | null;
  /** A manual collage's contents (#331): the tiles it composites, in order, and how wide it is laid
   * out. Absent for the single-image modes, so those keep hashing exactly as they did. */
  collage?: {
    columns: number;
    tiles: readonly (readonly [string, string | null])[];
  };
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
          // The grid mode (#413) is appended **only when it is `auto`**, for the same reason the
          // manual features below are appended only when used: `fixed` is what every offer rendered
          // as before the mode existed, so hashing it unconditionally would declare every already
          // generated plan in the collection out of date over images unchanged by a pixel.
          ...(input.collage.collageGridMode === "auto" ? ["auto"] : []),
        ]
      : null,
  ];

  const limits = [
    input.limits.maxPhotos,
    input.limits.maxPhotoEdge,
    input.limits.maxPhotoFileSizeMib,
  ];

  // The manual features (#313) extend the hashed payload only when the offer uses them. An offer
  // with neither attachments nor a custom order is precisely the offer the original shape described,
  // so widening the inputs does not declare every already-generated plan out of date — which is what
  // appending an empty element (or bumping the version) would do, for images unchanged by a pixel.
  // Each extension is appended in a fixed order after the base, so adding a later one leaves an offer
  // that uses only an earlier one hashing exactly as it did.
  const attachments = [...(input.attachments ?? [])]
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    // A manual collage appends its contents as a fifth element (#331): its tiles and its width are
    // what it renders, so editing either is the same kind of change as swapping a single
    // attachment's photo. Appended rather than woven in, so a single-image attachment — the only
    // kind that could already exist — hashes exactly as it did.
    .map((a) =>
      a.collage
        ? [a.id, a.position, a.photoId, a.itemId, [a.collage.columns, a.collage.tiles]]
        : [a.id, a.position, a.photoId, a.itemId]
    );
  // Sorted, because this is the set of images that exist, not the order they go up in.
  const rendered = [...(input.renderedTokens ?? [])].sort();

  const payload: unknown[] = [FINGERPRINT_VERSION, composition, config, limits];
  if (attachments.length > 0) payload.push(attachments, input.uploadTileLabel ?? null);
  if (rendered.length > 0) payload.push(["rendered", rendered]);

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
