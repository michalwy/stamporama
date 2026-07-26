// Pure, Prisma-free photo-plan engine (#309). Turns an offer's sets, copies, photo configuration
// (#308) and the platform's limits into an **ordered list of planned images**. Mirrors the
// `offer-title-template.ts` pattern: no side effects, no DB, unit-tested without a database, so
// both the server (generation, #311) and the client (previewing a plan before anything is rendered)
// run the very same rules.
//
// An offer's photos are not "one main image plus extras" — they are an ordered sequence, part
// collage, part single. A single image is just a 1×1 collage (#310): there is no pass-through path,
// because every tile is annotated (#312).
//
// Grouping
// --------
// - **Multi-copy sets** get their own image group, never mixed with another set's copies. A set
//   holding more copies than the collage's capacity is split into consecutive groups of its own —
//   the alternative would be silently dropping copies.
// - **Single-copy sets** are collected across set boundaries and chunked up to capacity, because a
//   collage of one stamp is pointless.
// - Offers mixing both kinds are not designed for. The rule is simply predictable: sets are walked
//   in order, a run of single-copy sets accumulates, and a multi-copy set flushes whatever has
//   accumulated before emitting its own group. Plan order therefore always follows set order.
//
// Front / back
// ------------
// - Which sides are attempted comes from the offer's `photoSides` (#308).
// - A side's collage is produced **only if every copy in the group has a photo for that side** —
//   all or nothing, no gaps. Stated for backs, applied to both sides for the same reason: a collage
//   with a hole in it is worse than one image fewer. A side dropped this way is *reported*
//   (`skipped`), never silently omitted: a set of eight losing its back collage over one missing
//   reverse scan is exactly the kind of absence nobody notices (#314).
// - Front and back have identical contents and are emitted interleaved (front, back, front, back…),
//   so a group yields two images — or one, when the other side is incomplete. Nothing may assume a
//   group has two members.
//
// Ordering, and what actually gets uploaded
// -----------------------------------------
// - Group order follows the explicit set order (#306); tile order inside a group follows copy order.
//   Manual attachments (#313) are then placed at their positions, and the collector's **manual plan
//   order** — a list of image tokens — re-seats whatever it names.
// - **Everything planned is rendered.** Nothing is dropped from the plan for want of a slot: an
//   image the collector cannot upload today is still an image they want to see, and a plan that
//   silently produced fewer files than it listed was the confusing part.
// - Two marks say an image is not part of the upload set, and only that:
//   - `publish: false` — the collector marked it **do not publish** (#313). A generated collage
//     cannot be deleted the way an attachment can, so this is how one is set aside.
//   - `overLimit: true` — derived: among the published images, in plan order, this one falls past
//     the platform's `maxPhotos`. The order is therefore the **priority** order — the limit fills up
//     from the front — and nothing is protected: not a front/back pair, not an attachment. Once the
//     collector can arrange the sequence, protecting anything would silently contradict it.
// - Neither mark stops an image being rendered and stored; both keep it out of the numbered upload
//   run and out of the plan's ZIP. Marking an image do-not-publish frees its slot, so hiding one can
//   bring another back under the limit.
// - Every platform limit is optional; with no photo-count limit nothing is ever over it.

import type { PhotoSides } from "./offer-photo-config";
import {
  compareSets,
  sortSetItems,
  type SetItemOrderRow,
  type SetOrderRow,
} from "./offer-set-order";

// ── Input ────────────────────────────────────────────────────────────────────

/** One copy in a set: its order fields (#306) plus the photos its tiles can be rendered from. */
export interface PlanCopy extends SetItemOrderRow {
  /** Id of the copy's `front`-role photo, or null when it has none. */
  frontPhotoId: string | null;
  /** Id of the copy's `back`-role photo, or null when it has none. */
  backPhotoId: string | null;
}

/** One offer set with its copies, in whatever order the caller read them. */
export interface PlanSet extends SetOrderRow {
  items: readonly PlanCopy[];
}

/** The collage's capacity, copied onto the offer from a collage template (#307). Rows × columns is
 * a ceiling, not a frame: the renderer shrinks the canvas to the actual contents. */
export interface PlanCollageCapacity {
  collageRows: number;
  collageColumns: number;
}

/** A manual attachment (#313) already resolved to the photo it shows. `itemId` is the copy the
 * photo belongs to (its label tokens resolve from that copy); null for an image uploaded straight
 * to the offer. */
export interface PlanAttachment {
  id: string;
  /** 0-based position in the finished plan. Out-of-range values clamp to the end. */
  position: number;
  photoId: string;
  itemId: string | null;
}

export interface OfferPhotoPlanInput {
  sets: readonly PlanSet[];
  /** The offer's scan sides (#308). */
  photoSides: PhotoSides;
  /** The offer's collage numbers, or null while none have been copied in yet. */
  collage: PlanCollageCapacity | null;
  /** The platform's `maxPhotos` limit (#308); null means no limit and so no truncation. */
  maxPhotos: number | null;
  attachments?: readonly PlanAttachment[];
  /** A manual plan order (#313): the image tokens the collector dragged into place, in their order.
   * An override of the derived order — tokens no longer present are ignored, images not in the list
   * keep their natural position. Empty/absent means the derived order, unchanged. Applied *before*
   * truncation, because the order is also the priority order. */
  order?: readonly string[];
  /** Image tokens marked **do not publish** (#313): planned and rendered, but out of the upload set,
   * so they take no upload number and do not count toward `maxPhotos`. */
  unpublished?: readonly string[];
}

// ── Output ───────────────────────────────────────────────────────────────────

export type PlanSide = "front" | "back";

/** One tile of a collage: the photo to composite and the copy whose data annotates it (#312). */
export interface PlannedTile {
  itemId: string;
  photoId: string;
}

/** What every planned image carries, whatever produced it. */
interface PlannedImageBase {
  /** False when the collector marked this image **do not publish** (#313): still rendered, but out
   * of the upload set — no upload number, not in the ZIP, and not counted against `maxPhotos`. */
  publish: boolean;
  /** True when this published image falls past the platform's `maxPhotos` in plan order (#313).
   * Still rendered and shown — it is only kept out of the upload set, so the collector can see what
   * did not fit and reorder to change what does. */
  overLimit: boolean;
}

/** A collage to render (#310) — including the 1×1 case. */
export interface PlannedCollage extends PlannedImageBase {
  kind: "collage";
  side: PlanSide;
  /** Groups sharing a key are the front/back pair rendered from the same copies. Stable within one
   * plan only — it is a pairing marker, not an identity. */
  groupKey: string;
  /** A **stable** identity for this image across plans (#313), so a manual plan order can name it:
   * `c:<side>:<sortedItemIds>`. Unlike `groupKey` it does not move with position — it is the copies
   * the image shows, which is what the collector reordered. */
  token: string;
  /** The sets that contributed copies, in plan order. One id for a multi-copy set's group; possibly
   * several for a chunk of single-copy sets. */
  setIds: string[];
  tiles: PlannedTile[];
}

/** A manual attachment placed in the plan (#313). Not derived from a rule: the collector put it
 * there, and only they take it out. */
export interface PlannedAttachment extends PlannedImageBase {
  kind: "attachment";
  attachmentId: string;
  /** This image's stable identity for the manual plan order (#313): `a:<attachmentId>`. */
  token: string;
  photoId: string;
  itemId: string | null;
}

export type PlannedImage = PlannedCollage | PlannedAttachment;

/** The stable token of a collage side — the copies it shows, sorted so tile order does not change
 * it, prefixed by the side so a front and its back stay distinct. */
export function collageToken(side: PlanSide, itemIds: readonly string[]): string {
  return `c:${side}:${[...itemIds].sort().join(",")}`;
}

/** The stable token of a manual attachment. */
export function attachmentToken(attachmentId: string): string {
  return `a:${attachmentId}`;
}

/**
 * A side a group could not produce, because at least one of its copies has no scan for that side
 * (#314). Reported rather than dropped in silence: the collector's fix is to scan the missing
 * reverses, and they can only do that if they are told which ones.
 */
export interface SkippedSide {
  side: PlanSide;
  /** The group's key — the same value the group's other side carries as `groupKey`. */
  groupKey: string;
  setIds: string[];
  /** Every copy in the group, in tile order. */
  itemIds: string[];
  /** The copies that have no photo for this side. Always a non-empty subset of `itemIds`. */
  missingItemIds: string[];
}

export interface OfferPhotoPlan {
  /** Every planned image, in plan order. Nothing is left out: the ones marked do-not-publish and
   * the ones past the platform's limit are all rendered, and carry `publish` / `overLimit` to say
   * they are not part of the upload set. */
  images: PlannedImage[];
  /** The images that *are* uploaded — published and within the limit — in order. A convenience over
   * `images`, so callers cannot disagree about what the ZIP holds. */
  uploaded: PlannedImage[];
  /** Sides no group could produce for want of a complete set of scans, in group order. */
  skipped: SkippedSide[];
  /** How many published images fall past the platform's photo limit. */
  overLimitCount: number;
  /** False when the offer carries no collage numbers yet (#308): nothing can be laid out, so only
   * attachments appear in the plan. */
  configured: boolean;
}

/** Whether a planned image is part of the upload set: published, and within the platform's limit. */
export function isUploaded(image: PlannedImage): boolean {
  return image.publish && !image.overLimit;
}

// ── Engine ───────────────────────────────────────────────────────────────────

/** The sides to attempt, in emission order. */
function sidesFor(photoSides: PhotoSides): PlanSide[] {
  if (photoSides === "front") return ["front"];
  if (photoSides === "back") return ["back"];
  return ["front", "back"];
}

function photoFor(copy: PlanCopy, side: PlanSide): string | null {
  return side === "front" ? copy.frontPhotoId : copy.backPhotoId;
}

/** A group of copies destined for one collage (or one front/back pair of collages). */
interface CopyGroup {
  setIds: string[];
  copies: PlanCopy[];
}

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Walks the sets in explicit order and splits their copies into collage-sized groups. */
function buildGroups(sets: readonly PlanSet[], capacity: number): CopyGroup[] {
  const groups: CopyGroup[] = [];
  /** The run of single-copy sets accumulated since the last multi-copy set. */
  let singles: { setId: string; copy: PlanCopy }[] = [];

  const flushSingles = () => {
    for (const part of chunk(singles, capacity)) {
      groups.push({
        setIds: [...new Set(part.map((p) => p.setId))],
        copies: part.map((p) => p.copy),
      });
    }
    singles = [];
  };

  for (const set of [...sets].sort(compareSets)) {
    const copies = sortSetItems(set.items);
    if (copies.length === 0) continue;
    if (copies.length === 1) {
      singles.push({ setId: set.id, copy: copies[0] });
      continue;
    }
    flushSingles();
    for (const part of chunk(copies, capacity)) {
      groups.push({ setIds: [set.id], copies: part });
    }
  }
  flushSingles();

  return groups;
}

/** What one group yields: an image per side whose photos are complete, front before back, plus the
 * sides it could not produce. */
interface GroupPlan {
  key: string;
  images: PlannedCollage[];
  skipped: SkippedSide[];
}

function renderGroup(group: CopyGroup, sides: PlanSide[], groupKey: string): GroupPlan {
  const images: PlannedCollage[] = [];
  const skipped: SkippedSide[] = [];
  for (const side of sides) {
    const tiles: PlannedTile[] = [];
    const missingItemIds: string[] = [];
    for (const copy of group.copies) {
      const photoId = photoFor(copy, side);
      // All or nothing: one missing photo cancels this side for the whole group. Every copy is still
      // examined, so the report can name all of them and not just the first.
      if (photoId) tiles.push({ itemId: copy.itemId, photoId });
      else missingItemIds.push(copy.itemId);
    }
    if (missingItemIds.length > 0) {
      skipped.push({
        side,
        groupKey,
        setIds: group.setIds,
        itemIds: group.copies.map((c) => c.itemId),
        missingItemIds,
      });
      continue;
    }
    images.push({
      kind: "collage",
      side,
      groupKey,
      token: collageToken(side, tiles.map((t) => t.itemId)),
      setIds: group.setIds,
      tiles,
      // Publishing and the limit are decided once, over the whole ordered plan, so grouping stays
      // about grouping.
      publish: true,
      overLimit: false,
    });
  }
  return { key: groupKey, images, skipped };
}

/** Places attachments at their explicit positions, appending anything out of range. */
function placeAttachments(
  generated: PlannedImage[],
  attachments: readonly PlanAttachment[]
): PlannedImage[] {
  const images = [...generated];
  const ordered = [...attachments].sort(
    (a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  for (const attachment of ordered) {
    const at = Math.min(Math.max(attachment.position, 0), images.length);
    images.splice(at, 0, {
      kind: "attachment",
      attachmentId: attachment.id,
      token: attachmentToken(attachment.id),
      photoId: attachment.photoId,
      itemId: attachment.itemId,
      publish: true,
      overLimit: false,
    });
  }
  return images;
}

/**
 * Applies the collector's manual plan order (#313) to the derived sequence. The stored order is an
 * **override**, not a replacement: every image keeps a natural position (its index here), and the
 * stored order only re-seats the images whose token it names.
 *
 * - An image whose token is in `order` sorts to that token's rank.
 * - An image the order does not name — one added since the last reorder — sorts **just after its
 *   natural predecessor**, so a freshly added collage or attachment lands where the derivation put
 *   it rather than being flung to the end.
 * - A token in `order` that no longer maps to any image is simply absent, so a sold-out collage or a
 *   deleted attachment leaves no gap.
 *
 * The sort is stable, so images sharing a rank (consecutive newcomers) keep their natural order.
 */
function applyManualOrder(images: PlannedImage[], order: readonly string[]): PlannedImage[] {
  if (order.length === 0) return images;
  const rank = new Map(order.map((token, index) => [token, index] as const));

  // A key per image: its stored rank when named, otherwise a fraction just past the last named
  // image's rank so it trails its natural predecessor. `-1` seats leading newcomers before rank 0.
  let anchor = -1;
  let gap = 0;
  const keyed = images.map((image, index) => {
    const named = rank.get(image.token);
    if (named !== undefined) {
      anchor = named;
      gap = 0;
    } else {
      gap += 1;
    }
    return { image, index, key: named !== undefined ? named : anchor + gap / (images.length + 1) };
  });

  return keyed
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.image);
}

/**
 * Plans an offer's images. Deterministic and total: any input produces a plan, possibly an empty one
 * (no sets and no attachments, or no collage numbers).
 *
 * The pipeline is: group the composition → render each group's sides → place the attachments → apply
 * the manual order → mark what is not published → mark what falls past the platform's limit.
 *
 * Ordering deliberately comes **before** the limit is applied: the collector's sequence is what says
 * which images matter most, so the allowance fills from the front. Nothing is removed, though —
 * every planned image is rendered, and the two marks only decide what the upload set contains.
 */
export function planOfferPhotos(input: OfferPhotoPlanInput): OfferPhotoPlan {
  const attachments = input.attachments ?? [];
  const configured = input.collage != null;

  const capacity = input.collage
    ? Math.max(1, input.collage.collageRows * input.collage.collageColumns)
    : 0;

  const sides = sidesFor(input.photoSides);
  const groups = configured
    ? buildGroups(input.sets, capacity).map((group, index) =>
        renderGroup(group, sides, `g${index}`)
      )
    : [];

  const unpublished = new Set(input.unpublished ?? []);
  const ordered = applyManualOrder(
    placeAttachments(groups.flatMap((group) => group.images), attachments),
    input.order ?? []
  );

  // Walk the ordered plan once, filling the platform's allowance from the front. An unpublished
  // image is not being uploaded, so it neither consumes a slot nor can be over the limit; every
  // published image past the allowance is marked — the second half of a front/back pair and a
  // late attachment included, because the collector's order is the priority order.
  const images: PlannedImage[] = [];
  let overLimitCount = 0;
  let taken = 0;
  for (const image of ordered) {
    const publish = !unpublished.has(image.token);
    const overLimit = publish && input.maxPhotos != null && taken >= input.maxPhotos;
    if (publish && !overLimit) taken += 1;
    if (overLimit) overLimitCount += 1;
    images.push({ ...image, publish, overLimit });
  }

  return {
    images,
    uploaded: images.filter(isUploaded),
    // Every group that produced an image keeps it, so a missing side is always worth reporting:
    // there is no longer a case where the notice would be about an image nobody is getting.
    skipped: groups.flatMap((group) => group.skipped),
    overLimitCount,
    configured,
  };
}
