// Pure, Prisma-free photo-plan engine (#309). Turns an offer's sets, copies, photo configuration
// (#308) and the platform's limits into an **ordered list of planned images**. Mirrors the
// `offer-title-template.ts` pattern: no side effects, no DB, unit-tested without a database, so
// both the server (generation, #311) and the client (previewing a plan before anything is rendered)
// run the very same rules.
//
// An offer's photos are not "one main image plus extras" — they are an ordered sequence, part
// collage, part single. A single image is just a 1×1 collage (#310): there is no pass-through path,
// because every tile is annotated (#312). A manual attachment (#313) is the same thing the collector
// placed by hand, and since #331 it may hold several chosen tiles at a chosen width — a collage
// composed deliberately, where the derived ones are composed by the grouping rules below.
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
// Single photos first (#521)
// --------------------------
// With `preferSingles`, the single-copy pool is grouped against the platform's **photo limit**
// instead of against the collage's capacity alone. A collage is a compromise — the way to fit more
// stamps than the listing has slots — so where there are slots to spare, a stamp is better shown on
// its own: three one-stamp sets on a platform taking five photos are three photos, not one collage
// of three.
//
// - The budget is the **whole plan**: `maxPhotos` less the images the multi-copy sets and the manual
//   attachments already spend, counted as they actually fall (a group whose back scans are
//   incomplete costs one image, not two) and ignoring anything marked do-not-publish, which spends
//   nothing.
// - Of N singles at capacity C with R slots left, the largest k whose plan fits is taken: k copies
//   photographed alone, the remaining N−k chunked into collages of C. The tail therefore eats single
//   slots one at a time — R=5, N=10, C≥6 is 4 singles and a collage; the same at C=4 is 3 singles
//   and two collages.
// - k is **never zero** while the pool has a copy in it: the plan's first image is what a
//   marketplace shows as the listing's thumbnail, and one stamp says more there than a grid of six.
//   The slot is spent even when the budget cannot afford it, `overLimit` reporting what falls off.
// - No `maxPhotos` is no limit, so every single-copy set gets its own image. An offer the budget
//   cannot fit at all falls back to one single and the rest chunked, `overLimit` reporting the tail:
//   the limit decides the *composition* only while the composition can do something about it.
// - Multi-copy sets are untouched: a set is one collage because it is one thing being sold.
// - Placement follows the sets. Singles are emitted where their sets fall, and the tail collages sit
//   at the end of the **last** run of singles — the arithmetic is over the whole pool, so a run
//   split by a multi-copy set is still counted once.
// - Off, grouping is exactly what it was before #521, which is what an offer prepared under the old
//   rule keeps.
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
// Paired cells (#694)
// -------------------
// `photoSides: "paired"` photographs exactly the scans `both` does and arranges them differently: a
// group yields **one** image whose every cell holds a copy's front and back side by side, instead of
// a collage of fronts and a separate one of backs. The grid is untouched — a cell is simply wider —
// so capacity, grouping and the platform's limits all read as they always did, and a paired group
// costs one upload slot rather than two.
//
// The all-or-nothing rule does **not** apply here, and deliberately: a cell pairs whatever its copy
// has. Both scans give a paired cell, one scan gives a narrower single-scan cell in the same collage,
// and the image is never lost over an unscanned reverse — the gap is visible in the picture itself,
// which is the thing the rule exists to guarantee for the other modes. What *is* reported is a copy
// with **no scan at all**: that one contributes no cell and would otherwise vanish from the listing
// unremarked (#314). A group where no copy has a scan produces no image, and the report names all of
// them.
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

/** One tile of a manual attachment: the photo to composite and the copy whose data annotates it
 * (#312), or null for an image uploaded straight to the offer — its inventory tokens resolve empty
 * and only the label template's literal text renders. */
export interface PlanAttachmentTile {
  photoId: string;
  itemId: string | null;
}

/**
 * A manual attachment (#313) already resolved to the photos it shows.
 *
 * One shape for all three modes: a copy photo and an upload are a single tile in a single column,
 * and a manual collage (#331) is the same thing with the tiles the collector chose and the width
 * they picked. That is not a generalisation for its own sake — an attachment has always been
 * rendered as a one-tile collage (#310/#312), so the only thing #331 adds here is that the number of
 * tiles and the number of columns are no longer fixed at one.
 */
export interface PlanAttachment {
  id: string;
  /** 0-based position in the finished plan. Out-of-range values clamp to the end. */
  position: number;
  /** The images this attachment shows, in tile order. Never empty. */
  tiles: readonly PlanAttachmentTile[];
  /** How many tiles per row (#331). 1 for the single-image modes. */
  columns: number;
}

export interface OfferPhotoPlanInput {
  sets: readonly PlanSet[];
  /** The offer's scan sides (#308). */
  photoSides: PhotoSides;
  /** The offer's collage numbers, or null while none have been copied in yet. */
  collage: PlanCollageCapacity | null;
  /** The platform's `maxPhotos` limit (#308); null means no limit and so no truncation. With
   * `preferSingles` it also decides the grouping of the single-copy pool (#521). */
  maxPhotos: number | null;
  /** Photograph single-copy sets **on their own** while the limit has room, collaging only the tail
   * (#521). Absent is off: the pool is chunked to the collage's capacity as it was before. */
  preferSingles?: boolean;
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

/** A scan side a copy can have. */
export type PlanSide = "front" | "back";

/** What one group renders as: one of the two sides on its own, or `paired` — both of them, in one
 * image whose cells each hold a copy's front and back side by side (#694). */
export type PlanImageSide = PlanSide | "paired";

/** What an image's side is called on screen. `paired` names both, because the image *is* both: one
 * cell per stamp, holding its front and its back (#694). */
export const PLAN_IMAGE_SIDE_LABELS: Record<PlanImageSide, string> = {
  front: "Front",
  back: "Back",
  paired: "Front + back",
};

/** One tile of a collage: the photo to composite and the copy whose data annotates it (#312). */
export interface PlannedTile {
  itemId: string;
  photoId: string;
  /** The second scan drawn beside `photoId` in the same cell, in paired mode (#694). Null
   * everywhere else — including for a paired copy that has only one of its two scans, whose cell is
   * a single-scan one like any other. When it is set, `photoId` is the front and this is the back. */
  pairedPhotoId?: string | null;
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
  side: PlanImageSide;
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
 * there, and only they take it out. One tile for the single-image modes; the chosen photos at the
 * chosen width for a manual collage (#331). */
export interface PlannedAttachment extends PlannedImageBase {
  kind: "attachment";
  attachmentId: string;
  /** This image's stable identity for the manual plan order (#313): `a:<attachmentId>`. Unlike a
   * collage's token it does not describe the contents, so editing what a manual collage shows keeps
   * its place in the plan — which is the point of an image the collector composed by hand. */
  token: string;
  tiles: PlanAttachmentTile[];
  /** How many tiles per row this image is laid out at (#331). */
  columns: number;
}

export type PlannedImage = PlannedCollage | PlannedAttachment;

/** The stable token of a collage side — the copies it shows, sorted so tile order does not change
 * it, prefixed by the side so a front and its back stay distinct. */
export function collageToken(side: PlanImageSide, itemIds: readonly string[]): string {
  return `c:${side}:${[...itemIds].sort().join(",")}`;
}

/** The stable token of a manual attachment. */
export function attachmentToken(attachmentId: string): string {
  return `a:${attachmentId}`;
}

/**
 * Copies a group could not draw, and the image it cost (#314). Reported rather than dropped in
 * silence: the collector's fix is to scan the missing reverses, and they can only do that if they
 * are told which ones.
 *
 * For `front` and `back` the rule is all-or-nothing, so an entry always means the whole side was
 * lost. For `paired` (#694) it means the named copies have **no scan at all** and so appear in no
 * cell; the image itself still renders from the copies that do — unless none of them does, which is
 * the case where every copy is named.
 */
export interface SkippedSide {
  side: PlanImageSide;
  /** The group's key — the same value the group's other side carries as `groupKey`. */
  groupKey: string;
  setIds: string[];
  /** Every copy in the group, in tile order. */
  itemIds: string[];
  /** The copies that have no photo for this side — or, in paired mode, none at all. Always a
   * non-empty subset of `itemIds`. */
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

/** The images to attempt per group, in emission order. `paired` is one image, not two (#694). */
function sidesFor(photoSides: PhotoSides): PlanImageSide[] {
  if (photoSides === "front") return ["front"];
  if (photoSides === "back") return ["back"];
  if (photoSides === "paired") return ["paired"];
  return ["front", "back"];
}

function photoFor(copy: PlanCopy, side: PlanSide): string | null {
  return side === "front" ? copy.frontPhotoId : copy.backPhotoId;
}

/** One image a group would produce, before it is given its group key and its set ids. */
interface GroupImage {
  side: PlanImageSide;
  /** The cells, in copy order. Empty when the image cannot be drawn at all. */
  tiles: PlannedTile[];
  /** The copies this image cannot draw: with no scan for the side, or — in paired mode — with no
   * scan at all. Empty when every copy is covered. */
  missingItemIds: string[];
  /** Whether the image is drawn. Distinct from `missingItemIds` being empty: a paired image renders
   * around the copies it cannot draw, where a single-sided one does not. */
  produced: boolean;
}

/**
 * What one group of copies produces, per attempted side. The single place that answers it: the
 * grouping arithmetic (#521) counts the upload slots a group costs, and the plan below renders the
 * images — and the two must never disagree about which images exist.
 *
 * The two rules meet here rather than being written twice:
 *
 * - `front` / `back` — **all or nothing**. Every copy needs a scan for that side, and one that does
 *   not cancels the side for the whole group. Every copy is still examined, so the report can name
 *   all of them rather than the first.
 * - `paired` (#694) — **per copy**. A copy with both scans gets a paired cell, one with a single
 *   scan gets a single-scan cell, and one with neither gets no cell and is named. The image is drawn
 *   as long as one cell survives.
 */
function groupImages(
  copies: readonly PlanCopy[],
  sides: readonly PlanImageSide[]
): GroupImage[] {
  return sides.map((side) => {
    const tiles: PlannedTile[] = [];
    const missingItemIds: string[] = [];

    if (side === "paired") {
      for (const copy of copies) {
        const front = copy.frontPhotoId;
        const back = copy.backPhotoId;
        if (front && back) tiles.push({ itemId: copy.itemId, photoId: front, pairedPhotoId: back });
        else if (front ?? back) tiles.push({ itemId: copy.itemId, photoId: (front ?? back)! });
        else missingItemIds.push(copy.itemId);
      }
      return { side, tiles, missingItemIds, produced: tiles.length > 0 };
    }

    for (const copy of copies) {
      const photoId = photoFor(copy, side);
      if (photoId) tiles.push({ itemId: copy.itemId, photoId });
      else missingItemIds.push(copy.itemId);
    }
    return { side, tiles, missingItemIds, produced: missingItemIds.length === 0 };
  });
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

/** One single-copy set, kept with its set id so a chunk can name every set it covers. */
interface SingleEntry {
  setId: string;
  copy: PlanCopy;
}

/** The sets walked in explicit order, each contributing either its own collage-sized groups or a
 * lone copy the two grouping rules treat differently. */
type SetSlot = { kind: "multi"; group: CopyGroup } | { kind: "single"; entry: SingleEntry };

function walkSets(sets: readonly PlanSet[], capacity: number): SetSlot[] {
  const slots: SetSlot[] = [];
  for (const set of [...sets].sort(compareSets)) {
    const copies = sortSetItems(set.items);
    if (copies.length === 0) continue;
    if (copies.length === 1) {
      slots.push({ kind: "single", entry: { setId: set.id, copy: copies[0] } });
      continue;
    }
    for (const part of chunk(copies, capacity)) {
      slots.push({ kind: "multi", group: { setIds: [set.id], copies: part } });
    }
  }
  return slots;
}

function groupOf(entries: readonly SingleEntry[]): CopyGroup {
  return {
    setIds: [...new Set(entries.map((e) => e.setId))],
    copies: entries.map((e) => e.copy),
  };
}

/**
 * How many **upload slots** a group of copies costs (#521): one per side every copy in it has a scan
 * for — a group whose backs are incomplete produces one image, not two — less any of those images
 * the collector marked do-not-publish, which take no slot by definition.
 */
function groupSlotCost(
  copies: readonly PlanCopy[],
  sides: readonly PlanImageSide[],
  unpublished: ReadonlySet<string>
): number {
  return groupImages(copies, sides).filter(
    (image) =>
      image.produced &&
      !unpublished.has(collageToken(image.side, image.tiles.map((t) => t.itemId)))
  ).length;
}

/** What the single-copy pool costs when its first `k` copies stand alone and the rest are chunked. */
function poolSlotCost(
  singles: readonly SingleEntry[],
  k: number,
  capacity: number,
  sides: readonly PlanImageSide[],
  unpublished: ReadonlySet<string>
): number {
  let cost = 0;
  for (let i = 0; i < k; i += 1) cost += groupSlotCost([singles[i].copy], sides, unpublished);
  for (const part of chunk(singles.slice(k), capacity)) {
    cost += groupSlotCost(part.map((e) => e.copy), sides, unpublished);
  }
  return cost;
}

/**
 * How many of the single-copy pool's copies are photographed alone (#521): the largest `k` whose
 * plan still fits the slots the rest of the plan leaves. Scanned downwards from "all of them"
 * because the cost is not strictly monotonic in `k` — dropping one copy out of the tail can remove a
 * whole chunk — and what is wanted is the most singles that fit, not the first fit found.
 */
function singlesThatFit(
  singles: readonly SingleEntry[],
  budget: number,
  capacity: number,
  sides: readonly PlanImageSide[],
  unpublished: ReadonlySet<string>
): number {
  for (let k = singles.length; k > 0; k -= 1) {
    if (poolSlotCost(singles, k, capacity, sides, unpublished) <= budget) return k;
  }
  return 0;
}

interface GroupingOptions {
  capacity: number;
  sides: readonly PlanImageSide[];
  unpublished: ReadonlySet<string>;
  /** #521's rule; off is the grouping as it stood before it. */
  preferSingles: boolean;
  /** The platform's photo limit, or null for none. Only read by #521's rule. */
  maxPhotos: number | null;
  /** Slots the manual attachments spend — one each, bar the ones marked do-not-publish. */
  attachmentCost: number;
}

/** Walks the sets in explicit order and splits their copies into collage-sized groups. */
function buildGroups(sets: readonly PlanSet[], options: GroupingOptions): CopyGroup[] {
  const { capacity, preferSingles, maxPhotos, sides, unpublished, attachmentCost } = options;
  const slots = walkSets(sets, capacity);
  const singles = slots.flatMap((slot) => (slot.kind === "single" ? [slot.entry] : []));

  // How many of the pool's copies stand alone. Without #521's rule none of them do, which is the
  // original behaviour: every run of singles is chunked to the collage's capacity.
  let alone = 0;
  if (preferSingles) {
    if (maxPhotos == null) {
      alone = singles.length;
    } else {
      const fixed =
        attachmentCost +
        slots.reduce(
          (sum, slot) =>
            slot.kind === "multi" ? sum + groupSlotCost(slot.group.copies, sides, unpublished) : sum,
          0
        );
      // At least one, always (#521): the first image is what a marketplace shows as the listing's
      // thumbnail, and a thumbnail of a collage says far less about what is for sale than one stamp
      // does. A pool with no room for even that spends the slot anyway and lets the truncation
      // report whatever now falls off the end — the collector's order can still overrule it.
      alone = Math.max(1, singlesThatFit(singles, maxPhotos - fixed, capacity, sides, unpublished));
    }
  }

  const groups: CopyGroup[] = [];
  const tail: SingleEntry[] = [];
  /** Where the tail's collages go: the end of the last run of singles. */
  let tailAt = 0;
  /** The run of single-copy sets accumulated since the last multi-copy set — the pre-#521 path. */
  let run: SingleEntry[] = [];
  let seen = 0;

  const flushRun = () => {
    for (const part of chunk(run, capacity)) groups.push(groupOf(part));
    run = [];
  };

  for (const slot of slots) {
    if (slot.kind === "single") {
      if (!preferSingles) {
        run.push(slot.entry);
        continue;
      }
      if (seen < alone) groups.push(groupOf([slot.entry]));
      else tail.push(slot.entry);
      seen += 1;
      tailAt = groups.length;
      continue;
    }
    flushRun();
    groups.push(slot.group);
  }
  flushRun();

  if (tail.length > 0) {
    groups.splice(tailAt, 0, ...chunk(tail, capacity).map(groupOf));
  }

  return groups;
}

/** What one group yields: an image per side it can draw — front before back, or the single paired
 * image (#694) — plus what it could not draw. */
interface GroupPlan {
  key: string;
  images: PlannedCollage[];
  skipped: SkippedSide[];
}

function renderGroup(group: CopyGroup, sides: PlanImageSide[], groupKey: string): GroupPlan {
  const images: PlannedCollage[] = [];
  const skipped: SkippedSide[] = [];
  for (const image of groupImages(group.copies, sides)) {
    // Reported and rendered are independent questions (#694): a paired image draws around the copies
    // it cannot draw, and names them anyway — they would otherwise leave the listing unremarked.
    if (image.missingItemIds.length > 0) {
      skipped.push({
        side: image.side,
        groupKey,
        setIds: group.setIds,
        itemIds: group.copies.map((c) => c.itemId),
        missingItemIds: image.missingItemIds,
      });
    }
    if (!image.produced) continue;
    images.push({
      kind: "collage",
      side: image.side,
      groupKey,
      token: collageToken(image.side, image.tiles.map((t) => t.itemId)),
      setIds: group.setIds,
      tiles: image.tiles,
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
      tiles: [...attachment.tiles],
      columns: Math.max(1, attachment.columns),
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
  const unpublished = new Set(input.unpublished ?? []);
  const groups = configured
    ? buildGroups(input.sets, {
        capacity,
        sides,
        unpublished,
        preferSingles: input.preferSingles ?? false,
        maxPhotos: input.maxPhotos,
        // Every attachment is one image; a do-not-publish mark on one frees its slot exactly as it
        // does for a collage, so the budget #521 hands the composition sees the same plan the
        // truncation below does.
        attachmentCost: attachments.filter((a) => !unpublished.has(attachmentToken(a.id))).length,
      }).map((group, index) => renderGroup(group, sides, `g${index}`))
    : [];

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
