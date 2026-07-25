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
// Ordering and truncation
// -----------------------
// - Group order follows the explicit set order (#306); tile order inside a group follows copy order.
// - Manual attachments (#313) occupy explicit positions and are **protected**: when the platform's
//   photo-count limit is exceeded, whole generated groups are dropped from the end instead, and a
//   front/back pair always drops together.
// - Every platform limit is optional; with no photo-count limit there is no truncation at all.

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
}

// ── Output ───────────────────────────────────────────────────────────────────

export type PlanSide = "front" | "back";

/** One tile of a collage: the photo to composite and the copy whose data annotates it (#312). */
export interface PlannedTile {
  itemId: string;
  photoId: string;
}

/** A collage to render (#310) — including the 1×1 case. */
export interface PlannedCollage {
  kind: "collage";
  side: PlanSide;
  /** Groups sharing a key are the front/back pair rendered from the same copies. Stable within one
   * plan only — it is a pairing marker, not an identity. */
  groupKey: string;
  /** The sets that contributed copies, in plan order. One id for a multi-copy set's group; possibly
   * several for a chunk of single-copy sets. */
  setIds: string[];
  tiles: PlannedTile[];
}

/** A manual attachment placed in the plan (#313). Carried through untouched — it is not derived
 * from a rule and is never truncated. */
export interface PlannedAttachment {
  kind: "attachment";
  attachmentId: string;
  photoId: string;
  itemId: string | null;
}

export type PlannedImage = PlannedCollage | PlannedAttachment;

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
  /** The planned images, in upload order. */
  images: PlannedImage[];
  /** Sides no group could produce for want of a complete set of scans, in group order. */
  skipped: SkippedSide[];
  /** How many generated groups the photo-count limit dropped from the end. */
  droppedGroups: number;
  /** True when the plan still exceeds the platform's limit because protected attachments alone
   * do — the collector has to remove attachments; the engine will not. */
  exceedsLimit: boolean;
  /** False when the offer carries no collage numbers yet (#308): nothing can be laid out, so only
   * attachments appear in the plan. */
  configured: boolean;
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
    images.push({ kind: "collage", side, groupKey, setIds: group.setIds, tiles });
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
      photoId: attachment.photoId,
      itemId: attachment.itemId,
    });
  }
  return images;
}

/**
 * Plans an offer's images. Deterministic and total: any input produces a plan, possibly an empty
 * one (no sets, no collage numbers, or a photo limit consumed entirely by attachments).
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

  // Truncation drops whole groups from the end — a front/back pair always goes together — and never
  // touches attachments, which hold their slots.
  let kept = groups.filter((group) => group.images.length > 0);
  const truncated = new Set<string>();
  let droppedGroups = 0;
  if (input.maxPhotos != null) {
    const allowance = Math.max(0, input.maxPhotos - attachments.length);
    let count = kept.reduce((sum, group) => sum + group.images.length, 0);
    while (count > allowance && kept.length > 0) {
      const last = kept[kept.length - 1];
      count -= last.images.length;
      truncated.add(last.key);
      kept = kept.slice(0, -1);
      droppedGroups += 1;
    }
  }

  const images = placeAttachments(
    kept.flatMap((group) => group.images),
    attachments
  );

  return {
    images,
    // A group the photo limit removed outright is already reported as a drop; its missing back side
    // would be a second notice about an image nobody is getting either way.
    skipped: groups.flatMap((group) => (truncated.has(group.key) ? [] : group.skipped)),
    droppedGroups,
    exceedsLimit: input.maxPhotos != null && images.length > input.maxPhotos,
    configured,
  };
}
