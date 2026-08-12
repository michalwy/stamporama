import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import {
  extForMime,
  getActiveStorage,
  getStorage,
  permanentPrefix,
  variantKey,
  type PhotoVariant,
} from "./storage";
import { makeOfferLabeller, STAMP_LABEL_SELECT } from "./offer-labels";
import { CLOSED_OFFER_STATES, isOfferState, isTerminalState } from "./offer-rules";
import { closedOfferPhotoCutoff, closedOfferPhotoTtlMs } from "./offer-photo-cleanup-rules";
import { zip, type ZipEntry } from "./zip";
import { COLLAGE_MIME, renderCollage, type CollageTileSource } from "./photos/collage";
import type { TileLabelTexts } from "./collage-label";
import {
  resolveCollageColumns,
  trueScaledSizes,
  type CollageTileTrueSize,
} from "./collage-layout";
import { normalizeCollageGridMode } from "./collage-template-rules";
import { thumbnailFor } from "./photos/process";
import { normalizePhotoSides, type OfferCollageValues, type PlatformPhotoLimits } from "./offer-photo-config";
import {
  planOfferPhotos,
  type PlanAttachment,
  type PlannedAttachment,
  type PlannedCollage,
} from "./offer-photo-plan";
import { fingerprintOfferPhotoInputs } from "./offer-photo-fingerprint";
import { renderTitleTemplate } from "./offer-title-template";
import { makeTitleCopyMapper, TITLE_COPY_SELECT, type TitleCopyRow } from "./title-copy";
import type { PlanCopy, PlanSet } from "./offer-photo-plan";

/**
 * Persisted generated offer images (#311) — the server side that turns the pure plan (#309) and the
 * collage renderer (#310) into stored `Photo` rows.
 *
 * Why it is stored at all
 * -----------------------
 * The collector uploads these images to a marketplace, so what matters is a **file that can be
 * downloaded again unchanged**: the same bytes the buyer already sees in a live listing, and the same
 * labels a buyer may be quoting back (#312). Rendering on download would silently produce a different
 * file after any change. So generation is explicit, its output is persisted, and staleness is only ever
 * *reported* (`outOfDate`), never repaired behind the collector's back.
 *
 * Why it is a background job
 * --------------------------
 * A single collage decodes every scan in the group and then re-encodes the canvas repeatedly to hit the
 * platform's byte limit (#310). A 40-copy offer is therefore seconds of CPU, not milliseconds — far too
 * much for a request. Pressing Generate only writes `status = 'queued'`; the worker started from
 * `instrumentation.ts` `register()` drains the queue (see `offer-photo-worker.ts`).
 *
 * Replacement, not patching
 * -------------------------
 * A run renders the **whole** plan, then swaps: the new rows are inserted and the previous generated
 * photos (rows and bytes) are dropped in one transaction. Rendering first means a failed run leaves the
 * previously generated images intact — a half-replaced plan would be worse than a stale one. Every new
 * image is a new `Photo` id, so nothing is ever mutated in place and the immutable-bytes-per-key
 * assumption the serving route's cache headers rely on holds.
 *
 * Sold sets (#315)
 * ----------------
 * A set that has gone — sold through this offer's own sale line, sold from under it by another
 * offer, or held by an offer in active bidding (ADR-0013 §4) — is dropped from the plan's inputs
 * here, before the engine ever sees it. The unit is the **whole set**: an `OfferSet` sells together
 * and indivisibly, so a series missing one stamp is not sellable and its collage must not advertise
 * it. Because the composition is also what the fingerprint hashes, a sale marks the stored images
 * out of date by itself — no new flag, and still no implicit regeneration.
 *
 * A manual attachment (#313) is not derived from a rule, so nothing here rebuilds one — but one that
 * *names a copy from a set that has gone* goes with the set (#461). Showing it would defeat the
 * exclusion: the collage stops advertising the stamp and the attachment beside it carries on doing
 * exactly that. A hand-built collage (#331) loses only the tiles whose copies went, and drops
 * entirely when that leaves it empty. The rows are kept — only the plan drops them — so a set held
 * back by bidding brings its attachments back when it frees up.
 */

/**
 * Which manual mode an attachment is (#313, #331). `manual_collage` rather than `collage`, because
 * in the plan's vocabulary plain `collage` already means a group the rules derived from the offer's
 * composition — and the whole point of a hand-composed one is that it is not that.
 */
export type AttachmentSource = "copy_photo" | "upload" | "manual_collage";

/**
 * Lifecycle of one offer's generation. `none` is the synthetic state of an offer never generated;
 * `purged` is the one it reaches from `ready` without a run — the sweep (#512) deleted the images of
 * a listing that has been closed longer than the grace period. It is deliberately not `none`: the
 * collector generated these images and uploaded them somewhere, and a card that read "never
 * generated" would be telling them something untrue about their own listing.
 */
export type OfferPhotoGenerationStatus =
  | "none"
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "purged";

const ACTIVE_STATUSES = ["queued", "running"] as const;

/** Stands in for a set or copy the plan was rendered from that the offer no longer holds. The image
 * is a snapshot; the mismatch is what `outOfDate` reports, not something to hide. */
const REMOVED_LABEL = "removed";

/** `wegry-01.jpg`, `wegry-02.jpg`… — the offer's own slug, then the upload position, 1-based and
 * zero-padded so a file manager sorts them right.
 *
 * The slug is there because these files leave the app (#326): downloaded one at a time or unpacked
 * from the ZIP, they land in a folder beside another offer's `01.jpg`, and a bare number says
 * nothing about which listing it belongs to. It is the same slug the archive itself is named with,
 * so a ZIP and its contents read as one set.
 *
 * `prefix` names the images that are *not* part of the upload run (#313), which get their own dense
 * sequence so no number of theirs can be mistaken for a slot in the listing. */
function planFileName(offerSlug: string, index: number, mime: string, prefix = ""): string {
  return `${offerSlug}-${prefix}${String(index + 1).padStart(2, "0")}.${extForMime(mime)}`;
}

/** Raised by {@link enqueueOfferPhotoGeneration} when there is nothing sensible to render. */
export class OfferPhotoGenerationError extends Error {}

/** One stored image of the plan, as the panel reads it. */
export interface OfferPhotoImage {
  photoId: string;
  sortOrder: number;
  /** The plan identity this image was rendered for (#313), or null on a row too old to match. It is
   * what the panel drags and marks — the stored list and the plan speak the same tokens. */
  token: string | null;
  /** `collage` for a group of set copies; `copy_photo` / `upload` / `manual_collage` for a manual
   * attachment (#313, #331). */
  source: string;
  side: "front" | "back" | null;
  /** Links the front/back pair rendered from the same copies. */
  pairKey: string | null;
  setIds: string[];
  itemIds: string[];
  /** False when the collector marked this image do-not-publish (#313) — stored and downloadable,
   * but not part of the upload set. */
  publish: boolean;
  /** True when this image falls past the platform's photo limit in plan order (#313) — stored all
   * the same, so the collector can see what did not fit and reorder to change that. */
  overLimit: boolean;
  /**
   * The name this image takes when downloaded, on its own or inside the plan's ZIP (#314):
   * `<offer>-01.jpg`, `<offer>-02.jpg`… The offer's own slug (#326) so a file still says which
   * listing it belongs to once it is sitting in a folder next to another offer's, then the number
   * in **upload** order, because the whole point is a folder that sorts into upload order in any
   * file manager. Our numbering is not the platform's — position there is whatever was uploaded —
   * and that is fine: labels identify copies independently (#312).
   *
   * Images outside the upload set take a name that is deliberately not part of that run
   * (`<offer>-unpublished-01.jpg`, `<offer>-over-limit-01.jpg`), so a number never implies a slot
   * the image does not have and the ZIP's `01…n` stays dense.
   */
  fileName: string;
  /** The copies the image shows, in tile order. Ids no longer in the offer resolve to a placeholder
   * rather than vanishing: the image really does show something that has since been removed. */
  copyLabels: string[];
  setLabels: string[];
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/** Why a set is no longer part of the plan (#315). `sold` covers both a sale through this offer's
 * own line and a copy sold from under it elsewhere; `bidding` is the same collision without a sale
 * line yet (#215). */
export type OfferPhotoExcludedReason = "sold" | "bidding";

/** A set the plan leaves out because it is no longer available (#315) — named so the collector can
 * see *why* the offer plans fewer images than it holds sets. */
export interface OfferPhotoExcludedSet {
  setId: string;
  label: string;
  reason: OfferPhotoExcludedReason;
}

/** A side the current plan cannot produce, named so it can be fixed (#314). */
export interface OfferPhotoSkippedSide {
  side: "front" | "back";
  setLabels: string[];
  /** How many copies are in the group. */
  copyCount: number;
  /** The copies with no scan for this side — what to go and scan. */
  missingCopyLabels: string[];
}

/**
 * One image the current plan would produce, in plan order — including the manual attachments (#313)
 * sitting between the generated groups. This is the sequence the card draws, and the only surface on
 * which an attachment's position can be seen and changed: the generated groups it sits between do
 * not exist as files until a run finishes, so a list of stored images could never show where an
 * attachment goes.
 */
export interface OfferPhotoPlannedImage {
  /** Stable within one plan — a React key, not a persistent id. */
  key: string;
  /** This image's **stable** identity for the manual plan order (#313): what the card sends back to
   * record a reorder. `c:<side>:<sortedItemIds>` for a collage side, `a:<attachmentId>` for an
   * attachment. */
  token: string;
  /** `collage` for a planned group; `copy_photo` / `upload` / `manual_collage` for a manual
   * attachment (#313, #331). */
  source: "collage" | AttachmentSource;
  side: "front" | "back" | null;
  /** Set for an attachment: what to drag, rename or remove. Null for a generated group. */
  attachmentId: string | null;
  /** The collector's caption for an attachment; null for a generated group. */
  title: string | null;
  /**
   * An image to preview the entry with. Once a run has produced this very image — matched by token —
   * it is that image: previewing a generated collage with its first stamp's scan was a small lie
   * about what the plan holds. Falls back to the attachment's own source photo, or to the collage's
   * first tile while nothing has been rendered for it yet.
   */
  previewPhotoId: string | null;
  /** The stored image rendered for this entry (#313), or null when there is none yet. Also what says
   * the entry is already generated, as opposed to merely planned. */
  generatedPhotoId: string | null;
  /** How many tiles the image is composited from. 1 for a single-photo attachment; the collector's
   * own count for a hand-built collage (#331), which is what identifies it in the plan. */
  tileCount: number;
  /** False when the collector marked this entry do-not-publish (#313): rendered, but not uploaded. */
  publish: boolean;
  /** True when this entry falls past the platform's photo limit in plan order (#313). */
  overLimit: boolean;
  setLabels: string[];
  copyLabels: string[];
}

/** What pressing Generate right now would produce — the plan, not the stored images. */
export interface OfferPhotoPlanPreview {
  /** False while the offer carries no collage numbers (#308): nothing can be laid out. */
  configured: boolean;
  imageCount: number;
  /** The planned sequence in upload order (#313), attachments included. */
  images: OfferPhotoPlannedImage[];
  /** How many planned images fall past the platform's photo limit (#313). They are still rendered
   * and stored — only kept out of the numbered upload run and the ZIP. */
  overLimitCount: number;
  /** How many images the plan holds that would actually be uploaded. */
  uploadCount: number;
  /** Sides no group can produce for want of a complete set of scans. A set of eight losing its back
   * collage over one missing reverse is easy to overlook, so the panel says so out loud (#314). */
  skipped: OfferPhotoSkippedSide[];
  /** Sets the plan leaves out because they have sold or are committed elsewhere (#315). */
  excludedSets: OfferPhotoExcludedSet[];
}

export interface OfferPhotoPlanState {
  status: OfferPhotoGenerationStatus;
  /** The stored images were produced from inputs that have since changed. A signal only. */
  outOfDate: boolean;
  plannedCount: number;
  renderedCount: number;
  /** Why the last run failed, shown verbatim; null unless `status` is `failed`. */
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  images: OfferPhotoImage[];
  plan: OfferPhotoPlanPreview;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

/** A source scan: the plan references it by id, the renderer needs its bytes. */
interface SourcePhoto {
  id: string;
  storageBackend: string;
  storageKey: string;
  mime: string;
  /** The stored `full` derivative's size, and the size the upload was measured at before
   * `FULL_MAX_EDGE` clamped it. The renderer needs the pair to put scans back on a common scale;
   * `originalWidth`/`originalHeight` are null for photos uploaded before they were recorded. */
  width: number;
  height: number;
  originalWidth: number | null;
  originalHeight: number | null;
}

/** Every read that feeds `sourceById` selects exactly this — the renderer needs the same columns
 * whether a tile arrives from a copy's scan, an attachment's photo or a manual collage's tile. */
const SOURCE_PHOTO_SELECT = {
  id: true,
  storageBackend: true,
  storageKey: true,
  mime: true,
  width: true,
  height: true,
  originalWidth: true,
  originalHeight: true,
} as const;

/** Display labels for the ids a plan is written in terms of — the panel's only job for them. */
interface PlanLabels {
  copies: Map<string, string>;
  sets: Map<string, string>;
}

/**
 * The two annotations drawn on each tile's label strip (#312), keyed by copy id — the offer's own
 * left / right label templates resolved against that copy by the title-template engine, in the
 * platform's listing language. Empty when the offer carries neither template, and a side is left
 * empty for a copy whose tokens all came out empty: an unlabelled tile is the intended result, not
 * a special case.
 *
 * Resolved per copy rather than per group, because a token resolved across the copies of a collage
 * would render the same joined value under every stamp — the opposite of identifying one of them.
 */
async function readTileLabels(
  ownerId: string,
  collectionId: string,
  itemIds: readonly string[],
  templates: { left: string | null; right: string | null },
  language: string | null
): Promise<Map<string, TileLabelTexts>> {
  const labels = new Map<string, TileLabelTexts>();
  const left = templates.left?.trim() || null;
  const right = templates.right?.trim() || null;
  if ((!left && !right) || itemIds.length === 0) return labels;

  const [rows, mapCopy] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: [...itemIds] }, collectionId },
      select: TITLE_COPY_SELECT,
    }),
    makeTitleCopyMapper(ownerId, collectionId, language),
  ]);
  for (const row of rows as TitleCopyRow[]) {
    const copy = [mapCopy(row)];
    const texts: TileLabelTexts = {
      left: left ? renderTitleTemplate(left, copy).trim() : "",
      right: right ? renderTitleTemplate(right, copy).trim() : "",
    };
    if (texts.left || texts.right) labels.set(row.id, texts);
  }
  return labels;
}

/** Everything one run reads, gathered once so the plan and the fingerprint cannot disagree. */
interface GenerationInputs {
  offerId: string;
  offerName: string | null;
  collectionId: string;
  ownerId: string;
  /** The sets the plan is built from: the offer's sets **minus** the ones that have gone (#315). */
  sets: PlanSet[];
  /** The sets left out, in set order — the panel's only way to explain the missing collages. */
  excludedSets: OfferPhotoExcludedSet[];
  labels: PlanLabels;
  photoSides: ReturnType<typeof normalizePhotoSides>;
  /** #521: photograph single-copy sets on their own while the platform's limit has room. */
  preferSingles: boolean;
  photoLabelLeftTemplate: string | null;
  photoLabelRightTemplate: string | null;
  /** The rendered tile annotations per copy id (#312) — what is actually drawn, not the template. */
  tileLabels: Map<string, TileLabelTexts>;
  /** The annotation an attachment with no copy is drawn with (#313 mode b): the same templates
   * resolved against nothing, so inventory tokens come out empty — the engine tidies the separators
   * they leave behind — while literal text still renders. Null when neither template says anything
   * without a copy, which is the common case and yields an unlabelled tile. */
  uploadTileLabel: TileLabelTexts | null;
  collage: OfferCollageValues | null;
  limits: PlatformPhotoLimits;
  sourceById: Map<string, SourcePhoto>;
  /** The offer's manual plan order (#313): image tokens in the collector's chosen order. Empty means
   * the derived order. */
  photoPlanOrder: string[];
  /** Plan tokens marked do-not-publish (#313): rendered, but out of the upload set. */
  photoPlanUnpublished: string[];
  /** The offer's manual attachments (#313), already resolved to the photo each one shows. */
  attachments: PlanAttachment[];
  /** Each attachment's caption, by attachment id — for the panel only. */
  attachmentTitles: Map<string, string | null>;
  /** Which mode each attachment is, by attachment id (#313, #331). */
  attachmentSources: Map<string, AttachmentSource>;
}

const SIDE_ROLES = ["front", "back"];

/**
 * The sets this offer can no longer sell (#315), by set id, in one batched lookup — the same
 * derivation the offers list and the detail screen use for "needs action" (ADR-0013 §4), applied to
 * the photo plan:
 *
 * - the set sold through **this** offer (it has its own sale line) — a multi-set offer stays active
 *   while its remaining sets are still for sale, and the sold one must leave the collages;
 * - one of its copies sold through **another** offer's set;
 * - one of its copies is held by another active offer **in active bidding** (#215) — committed
 *   before a sale line exists, and treated the same way.
 *
 * A copy is enough to condemn the whole set: sets sell indivisibly, so a series short one stamp is
 * not sellable and photographing it would advertise something that cannot be bought.
 *
 * Empty for a terminal offer (sold / withdrawn): its images document a listing that is over, and
 * recomputing them against an empty composition would only declare them out of date forever.
 */
async function excludedSetsFor(offer: {
  id: string;
  state: string;
  sets: readonly {
    id: string;
    saleLines: readonly unknown[];
    items: readonly { itemId: string }[];
  }[];
}): Promise<Map<string, OfferPhotoExcludedReason>> {
  const excluded = new Map<string, OfferPhotoExcludedReason>();
  const state = isOfferState(offer.state) ? offer.state : "active";
  if (isTerminalState(state)) return excluded;

  const itemIds = [...new Set(offer.sets.flatMap((s) => s.items.map((li) => li.itemId)))];
  if (itemIds.length === 0) return excluded;

  const [soldRows, biddingRows] = await Promise.all([
    prisma.saleLineItem.findMany({
      where: { itemId: { in: itemIds } },
      select: { itemId: true, saleLine: { select: { offerSetId: true } } },
    }),
    prisma.offerSetItem.findMany({
      where: {
        itemId: { in: itemIds },
        offerSet: { offer: { id: { not: offer.id }, inActiveBidding: true, state: "active" } },
      },
      select: { itemId: true },
    }),
  ]);
  const soldViaSet = new Map(soldRows.map((r) => [r.itemId, r.saleLine.offerSetId]));
  const biddingElsewhere = new Set(biddingRows.map((r) => r.itemId));

  for (const set of offer.sets) {
    if (set.saleLines.length > 0 || set.items.some((li) => soldViaSet.has(li.itemId))) {
      excluded.set(set.id, "sold");
      continue;
    }
    if (set.items.some((li) => biddingElsewhere.has(li.itemId))) {
      excluded.set(set.id, "bidding");
    }
  }
  return excluded;
}

async function readInputs(offerId: string): Promise<GenerationInputs | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      name: true,
      collectionId: true,
      // A terminal offer's photos are history: nothing is regenerated against what is still
      // available, because nothing is being sold any more (#315).
      state: true,
      photoSides: true,
      photoPreferSingles: true,
      photoLabelLeftTemplate: true,
      photoLabelRightTemplate: true,
      collageGridMode: true,
      collageRows: true,
      collageColumns: true,
      collageGapPercent: true,
      collageBackground: true,
      collageLabelPercent: true,
      photoPlanOrder: true,
      photoPlanUnpublished: true,
      collection: { select: { ownerId: true } },
      // Limits are read **live** from the platform (#308): they say what it accepts today. The
      // listing language comes along so a tile label reads the way the listing does (#293).
      platform: {
        select: {
          maxPhotos: true,
          maxPhotoEdge: true,
          maxPhotoFileSizeMib: true,
          titleLanguage: true,
        },
      },
      sets: {
        select: {
          id: true,
          title: true,
          sortOrder: true,
          // Its own sale, if any: the set sold through this very offer (#315).
          saleLines: { select: { id: true }, take: 1 },
          items: {
            select: {
              itemId: true,
              sortOrder: true,
              item: {
                select: {
                  stamp: {
                    // Labels are for the panel only; they never reach the plan or the fingerprint.
                    select: STAMP_LABEL_SELECT.stamp.select,
                  },
                  photos: {
                    where: { role: { in: SIDE_ROLES } },
                    select: { ...SOURCE_PHOTO_SELECT, role: true },
                  },
                },
              },
            },
          },
        },
      },
      // Manual attachments (#313), with the image each one shows. A `copy_photo` points at a copy's
      // own scan (which may or may not also be a tile of a collage) and an `upload` at an image
      // owned by the offer itself; either way the renderer needs its bytes.
      photoAttachments: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          sortOrder: true,
          source: true,
          itemId: true,
          collageColumns: true,
          title: true,
          photo: {
            select: SOURCE_PHOTO_SELECT,
          },
          // A manual collage (#331) shows its tiles instead of a single photo, in their own order.
          tiles: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: {
              itemId: true,
              photo: { select: SOURCE_PHOTO_SELECT },
            },
          },
        },
      },
    },
  });
  if (!offer) return null;

  const sourceById = new Map<string, SourcePhoto>();
  // The offer's own label vocabulary (#379), so the photo card names a set exactly as the sets card
  // above it does. Labels are display-only here — no stored image goes out of date over one.
  const labeller = await makeOfferLabeller(offer.collectionId);
  const labels: PlanLabels = { copies: new Map(), sets: new Map() };
  const allSets: PlanSet[] = offer.sets.map((set) => ({
    id: set.id,
    sortOrder: set.sortOrder,
    items: set.items.map((li): PlanCopy => {
      const bySide = new Map(li.item.photos.map((p) => [p.role, p]));
      labels.copies.set(li.itemId, labeller.copy(li.item.stamp));
      for (const photo of li.item.photos) {
        sourceById.set(photo.id, photo);
      }
      return {
        itemId: li.itemId,
        sortOrder: li.sortOrder,
        catalogSortKey: li.item.stamp.primaryCatalogSortKey,
        frontPhotoId: bySide.get("front")?.id ?? null,
        backPhotoId: bySide.get("back")?.id ?? null,
      };
    }),
  }));

  // Labels cover **every** set, excluded ones included: a stored image rendered from a set that has
  // since sold still has to be able to name it (#315), exactly as it names a set since removed.
  for (const set of offer.sets) {
    labels.sets.set(set.id, labeller.set(set));
  }

  // Sets that have gone leave the plan's inputs here (#315) — the engine, the fingerprint and the
  // renderer all see the offer as what is still sellable, and nothing downstream needs to know.
  const excluded = await excludedSetsFor(offer);
  const sets = allSets.filter((set) => !excluded.has(set.id));
  const excludedSets: OfferPhotoExcludedSet[] = offer.sets
    .filter((set) => excluded.has(set.id))
    .map((set) => ({
      setId: set.id,
      label: labels.sets.get(set.id) ?? REMOVED_LABEL,
      reason: excluded.get(set.id)!,
    }));

  const hasCollage =
    offer.collageRows != null &&
    offer.collageColumns != null &&
    offer.collageGapPercent != null &&
    offer.collageBackground != null &&
    offer.collageLabelPercent != null;

  // The copies the offer can still sell: the members of the sets that survived the exclusion above.
  // A manual attachment naming anything else is showing a stamp the buyer cannot get (#461).
  const sellableItemIds = new Set(sets.flatMap((set) => set.items.map((copy) => copy.itemId)));

  // Attachments (#313). Their photos join the source map so the renderer can read the bytes, and a
  // `copy_photo`'s copy joins the label subjects — a copy attached on its own need not be one the
  // collages already cover.
  const attachments: PlanAttachment[] = [];
  const attachmentTitles = new Map<string, string | null>();
  const attachmentSources = new Map<string, AttachmentSource>();
  for (const row of offer.photoAttachments) {
    // One shape for all three modes: a manual collage (#331) is its tiles at its own width, and the
    // single-image modes are one tile in one column — which is what the renderer has always made of
    // them (#310, #312).
    const source: AttachmentSource =
      row.source === "upload"
        ? "upload"
        : row.source === "manual_collage"
          ? "manual_collage"
          : "copy_photo";
    const photos = (
      source === "manual_collage"
        ? row.tiles.map((tile) => ({ photo: tile.photo, itemId: tile.itemId }))
        : row.photo
          ? [{ photo: row.photo, itemId: row.itemId }]
          : []
    ).filter((t) => t.itemId == null || sellableItemIds.has(t.itemId));
    // A collage whose every tile lost its source scan — or whose every tile named a copy that has
    // gone (#461) — plans nothing rather than an empty image.
    if (photos.length === 0) continue;
    attachments.push({
      id: row.id,
      position: row.sortOrder,
      tiles: photos.map((t) => ({ photoId: t.photo.id, itemId: t.itemId })),
      columns: source === "manual_collage" ? row.collageColumns ?? 1 : 1,
    });
    attachmentTitles.set(row.id, row.title);
    attachmentSources.set(row.id, source);
    for (const { photo } of photos) {
      sourceById.set(photo.id, photo);
    }
  }

  const labelSubjects = [
    ...sets.flatMap((set) => set.items.map((copy) => copy.itemId)),
    ...attachments.flatMap((a) => a.tiles.flatMap((tile) => (tile.itemId ? [tile.itemId] : []))),
  ];
  const tileLabels = await readTileLabels(
    offer.collection.ownerId,
    offer.collectionId,
    [...new Set(labelSubjects)],
    { left: offer.photoLabelLeftTemplate, right: offer.photoLabelRightTemplate },
    offer.platform.titleLanguage
  );
  // An attachment naming a copy the offer no longer sells leaves the plan with the copy (#461),
  // exactly as the set it came from does (#315) — attaching one is guarded
  // (`attachOfferCopyPhoto`), and a copy leaving the offer afterwards is now guarded here. Only the
  // *plan* drops it: the row survives, so a set held back by bidding elsewhere brings its
  // attachments back with it when it frees up.

  return {
    offerId: offer.id,
    offerName: offer.name,
    collectionId: offer.collectionId,
    ownerId: offer.collection.ownerId,
    sets,
    excludedSets,
    labels,
    photoSides: normalizePhotoSides(offer.photoSides),
    preferSingles: offer.photoPreferSingles,
    photoLabelLeftTemplate: offer.photoLabelLeftTemplate,
    photoLabelRightTemplate: offer.photoLabelRightTemplate,
    tileLabels,
    uploadTileLabel: renderCopylessTileLabel({
      left: offer.photoLabelLeftTemplate,
      right: offer.photoLabelRightTemplate,
    }),
    collage: hasCollage
      ? {
          // Null is `fixed` (#413) — an offer prepared before the mode existed renders exactly as
          // it did, which is also why the mode is not one of the columns `hasCollage` tests.
          collageGridMode: normalizeCollageGridMode(offer.collageGridMode),
          collageRows: offer.collageRows!,
          collageColumns: offer.collageColumns!,
          collageGapPercent: offer.collageGapPercent!,
          collageBackground: offer.collageBackground!,
          collageLabelPercent: offer.collageLabelPercent!,
        }
      : null,
    limits: {
      maxPhotos: offer.platform.maxPhotos,
      maxPhotoEdge: offer.platform.maxPhotoEdge,
      maxPhotoFileSizeMib: offer.platform.maxPhotoFileSizeMib,
    },
    sourceById,
    photoPlanOrder: offer.photoPlanOrder,
    photoPlanUnpublished: offer.photoPlanUnpublished,
    attachments,
    attachmentTitles,
    attachmentSources,
  };
}

/**
 * The tile annotation for an attachment with no copy (#313 mode b): the offer's label templates
 * resolved against **no copies at all**. Every inventory token comes out empty and the engine tidies
 * the separators they leave, so what survives is whatever literal text the template carries — a
 * "Detail" or a shop name renders, a `{ref}` does not. Null when that leaves both sides blank, which
 * is the ordinary result and means an unlabelled tile.
 */
function renderCopylessTileLabel(templates: {
  left: string | null;
  right: string | null;
}): TileLabelTexts | null {
  const left = templates.left?.trim() ? renderTitleTemplate(templates.left, []).trim() : "";
  const right = templates.right?.trim() ? renderTitleTemplate(templates.right, []).trim() : "";
  return left || right ? { left, right } : null;
}

/** The plan these inputs produce, manual attachments (#313) included — the engine places them at
 * their positions and protects them from truncation. */
function planFor(inputs: GenerationInputs) {
  return planOfferPhotos({
    sets: inputs.sets,
    photoSides: inputs.photoSides,
    collage: inputs.collage,
    maxPhotos: inputs.limits.maxPhotos,
    preferSingles: inputs.preferSingles,
    attachments: inputs.attachments,
    order: inputs.photoPlanOrder,
    unpublished: inputs.photoPlanUnpublished,
  });
}

function fingerprintFor(inputs: GenerationInputs, plan: ReturnType<typeof planFor>): string {
  return fingerprintOfferPhotoInputs({
    sets: inputs.sets,
    photoSides: inputs.photoSides,
    photoLabelLeftTemplate: inputs.photoLabelLeftTemplate,
    photoLabelRightTemplate: inputs.photoLabelRightTemplate,
    tileLabels: [...inputs.tileLabels].map(
      ([itemId, texts]) => [itemId, texts.left ?? "", texts.right ?? ""] as const
    ),
    collage: inputs.collage,
    preferSingles: inputs.preferSingles,
    limits: inputs.limits,
    // A single-image attachment hashes as its one photo, exactly as it always did; a hand-composed
    // collage (#331) hashes its tiles and its width instead, because those are what it draws.
    attachments: inputs.attachments.map((attachment) =>
      inputs.attachmentSources.get(attachment.id) === "manual_collage"
        ? {
            id: attachment.id,
            position: attachment.position,
            photoId: null,
            itemId: null,
            collage: {
              columns: attachment.columns,
              tiles: attachment.tiles.map((tile) => [tile.photoId, tile.itemId] as const),
            },
          }
        : {
            id: attachment.id,
            position: attachment.position,
            photoId: attachment.tiles[0].photoId,
            itemId: attachment.tiles[0].itemId,
          }
    ),
    uploadTileLabel: inputs.uploadTileLabel
      ? [inputs.uploadTileLabel.left ?? "", inputs.uploadTileLabel.right ?? ""]
      : undefined,
    // The set of images the plan renders, hashed only when a manual order or a do-not-publish mark
    // is in play — those are the only things that can change it without changing the composition or
    // the limits, which are hashed already. The *order* is deliberately absent: a reorder is applied
    // to the stored images themselves, so it can never leave them stale.
    renderedTokens:
      inputs.photoPlanOrder.length > 0 || inputs.photoPlanUnpublished.length > 0
        ? plan.images.map((image) => image.token)
        : undefined,
  });
}

// ── Read model ───────────────────────────────────────────────────────────────

async function assertOfferOwner(ownerId: string, offerId: string): Promise<string> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!offer || offer.collection.ownerId !== ownerId) {
    throw new OfferPhotoGenerationError("Offer not found or access denied.");
  }
  return offer.collectionId;
}

/**
 * The offer's photo plan as the panel shows it: the job's state, the stored images in upload order,
 * whether they are out of date, and what a Generate right now would produce. Owner-checked.
 */
export async function getOfferPhotoPlanState(
  ownerId: string,
  offerId: string
): Promise<OfferPhotoPlanState> {
  await assertOfferOwner(ownerId, offerId);
  const inputs = await readInputs(offerId);
  if (!inputs) throw new OfferPhotoGenerationError("Offer not found.");

  const [generation, entries] = await Promise.all([
    prisma.offerPhotoGeneration.findUnique({ where: { offerId } }),
    prisma.offerPhotoEntry.findMany({
      where: { offerId },
      orderBy: { sortOrder: "asc" },
      select: {
        photoId: true,
        sortOrder: true,
        token: true,
        source: true,
        side: true,
        pairKey: true,
        setIds: true,
        itemIds: true,
        photo: { select: { mime: true, width: true, height: true, sizeBytes: true } },
      },
    }),
  ]);

  const plan = planFor(inputs);
  // The plan's marks, by token, so a stored image can say whether it is part of the upload set. A
  // stored image whose token the plan no longer holds (its set sold, its attachment removed) is
  // treated as published: it *was* uploaded, and the plan not planning it any more is what
  // `outOfDate` already reports.
  const planned = new Map(plan.images.map((image) => [image.token, image]));
  const marksFor = (token: string | null) => {
    const match = token ? planned.get(token) : undefined;
    return { publish: match?.publish ?? true, overLimit: match?.overLimit ?? false };
  };
  const counters = { upload: 0, unpublished: 0, overLimit: 0 };
  // Every image is named for the offer it belongs to (#326), so a file keeps saying which listing
  // it is for once it has left the app.
  const offerSlug = offerFileSlug(inputs.offerName, offerId);
  const images: OfferPhotoImage[] = entries.map((e) => {
    const { publish, overLimit } = marksFor(e.token);
    // Numbered by position among the images that are actually uploaded, so the run is a dense 1..n
    // for a bulk upload. The other two get their own sequences under a name that cannot be mistaken
    // for an upload slot.
    const fileName = !publish
      ? planFileName(offerSlug, counters.unpublished++, e.photo.mime, "unpublished-")
      : overLimit
        ? planFileName(offerSlug, counters.overLimit++, e.photo.mime, "over-limit-")
        : planFileName(offerSlug, counters.upload++, e.photo.mime);
    return {
    photoId: e.photoId,
    sortOrder: e.sortOrder,
    token: e.token,
    source: e.source,
    side: e.side === "front" || e.side === "back" ? e.side : null,
    pairKey: e.pairKey,
    setIds: e.setIds,
    itemIds: e.itemIds,
    publish,
    overLimit,
    fileName,
    copyLabels: e.itemIds.map((id) => inputs.labels.copies.get(id) ?? REMOVED_LABEL),
    setLabels: e.setIds.map((id) => inputs.labels.sets.get(id) ?? REMOVED_LABEL),
    mime: e.photo.mime,
    width: e.photo.width,
    height: e.photo.height,
    sizeBytes: e.photo.sizeBytes,
    };
  });
  // Which stored image was rendered for which plan entry, so the plan can preview a generated
  // collage with the image itself rather than with one of its stamps.
  const storedByToken = new Map(
    images.flatMap((image) => (image.token ? [[image.token, image.photoId] as const] : []))
  );

  return {
    status: (generation?.status as OfferPhotoGenerationStatus) ?? "none",
    // Only stored images can be stale, and only against a recorded fingerprint.
    outOfDate:
      images.length > 0 &&
      generation?.fingerprint != null &&
      generation.fingerprint !== fingerprintFor(inputs, plan),
    plannedCount: generation?.plannedCount ?? 0,
    renderedCount: generation?.renderedCount ?? 0,
    error: generation?.status === "failed" ? generation.error : null,
    startedAt: generation?.startedAt ?? null,
    finishedAt: generation?.finishedAt ?? null,
    images,
    plan: {
      configured: plan.configured,
      imageCount: plan.images.length,
      images: plan.images.map((image, index): OfferPhotoPlannedImage => {
        const generatedPhotoId = storedByToken.get(image.token) ?? null;
        if (image.kind === "attachment") {
          return {
            key: image.attachmentId,
            token: image.token,
            source: inputs.attachmentSources.get(image.attachmentId) ?? "upload",
            side: null,
            attachmentId: image.attachmentId,
            title: inputs.attachmentTitles.get(image.attachmentId) ?? null,
            // The rendered image once there is one — an attachment is annotated too, so its source
            // photo is not what the listing shows either. Before that, its first tile stands in,
            // exactly as a derived collage's first stamp does.
            previewPhotoId: generatedPhotoId ?? image.tiles[0]?.photoId ?? null,
            generatedPhotoId,
            tileCount: image.tiles.length,
            publish: image.publish,
            overLimit: image.overLimit,
            setLabels: [],
            copyLabels: image.tiles.flatMap((tile) =>
              tile.itemId ? [inputs.labels.copies.get(tile.itemId) ?? REMOVED_LABEL] : []
            ),
          };
        }
        return {
          key: `${image.groupKey}-${image.side}-${index}`,
          token: image.token,
          source: "collage",
          side: image.side,
          attachmentId: null,
          title: null,
          // The generated collage itself when it exists; its first stamp only stands in while
          // nothing has been rendered for this entry yet.
          previewPhotoId: generatedPhotoId ?? image.tiles[0]?.photoId ?? null,
          generatedPhotoId,
          tileCount: image.tiles.length,
          publish: image.publish,
          overLimit: image.overLimit,
          setLabels: image.setIds.map((id) => inputs.labels.sets.get(id) ?? REMOVED_LABEL),
          copyLabels: image.tiles.map(
            (tile) => inputs.labels.copies.get(tile.itemId) ?? REMOVED_LABEL
          ),
        };
      }),
      overLimitCount: plan.overLimitCount,
      uploadCount: plan.uploaded.length,
      excludedSets: inputs.excludedSets,
      skipped: plan.skipped.map((s) => ({
        side: s.side,
        setLabels: s.setIds.map((id) => inputs.labels.sets.get(id) ?? REMOVED_LABEL),
        copyCount: s.itemIds.length,
        missingCopyLabels: s.missingItemIds.map(
          (id) => inputs.labels.copies.get(id) ?? REMOVED_LABEL
        ),
      })),
    },
  };
}

/**
 * Just enough of the plan state to judge whether this offer's photos let it be marked **Ready**
 * (#311 gate): the run's status, whether the stored images are stale, how many there are, and how
 * many one right now would produce. The rules over it are pure (`offer-photo-readiness.ts`).
 *
 * Not owner-checked, unlike {@link getOfferPhotoPlanState}: the one caller is the offers domain,
 * which has already established ownership of the offer it is about to move. Returns `null` for an
 * offer that does not exist.
 *
 * It re-derives the plan rather than reading a stored count because a *stale* plan is exactly what
 * it is looking for — the whole question is whether what would be rendered now still matches what
 * was rendered then. It stops short of the read model's image list and previews, which the gate has
 * no use for.
 */
export async function readOfferPhotoReadiness(offerId: string): Promise<{
  status: OfferPhotoGenerationStatus;
  outOfDate: boolean;
  storedCount: number;
  plannedCount: number;
} | null> {
  const inputs = await readInputs(offerId);
  if (!inputs) return null;
  const [generation, storedCount] = await Promise.all([
    prisma.offerPhotoGeneration.findUnique({
      where: { offerId },
      select: { status: true, fingerprint: true },
    }),
    prisma.offerPhotoEntry.count({ where: { offerId } }),
  ]);
  const plan = planFor(inputs);
  return {
    status: (generation?.status as OfferPhotoGenerationStatus) ?? "none",
    // Same rule as the panel's: only stored images can be stale, and only against a recorded
    // fingerprint.
    outOfDate:
      storedCount > 0 &&
      generation?.fingerprint != null &&
      generation.fingerprint !== fingerprintFor(inputs, plan),
    storedCount,
    plannedCount: plan.images.length,
  };
}

// ── Archive ──────────────────────────────────────────────────────────────────

/**
 * The offer's **upload set** as one ZIP, in plan order, named `<offer>-01.jpg`, `<offer>-02.jpg`…
 * — the file the collector drops into a marketplace's bulk upload (#314). Owner-checked.
 *
 * The names come straight from the read model, so a file unpacked here is called exactly what the
 * same file downloaded on its own is called, and both carry the offer's slug (#326): these files
 * end up in a folder with another listing's, where a bare `01.jpg` names nothing.
 *
 * Only the images that are actually going up are in it (#313): an image marked do-not-publish, or
 * one past the platform's photo limit, is stored and downloadable on its own but has no place in a
 * bulk upload. Their absence is what keeps the archive's `01…n` dense, which is the whole point of
 * the numbering.
 *
 * Buffered rather than streamed: the archive is bounded by the platform's own photo-count and
 * per-file limits (#308), which is a handful of megabytes, and a stream would have to hold the same
 * central directory anyway.
 *
 * @throws {OfferPhotoGenerationError} when the offer has no images to upload.
 */
export async function buildOfferPhotoArchive(
  ownerId: string,
  offerId: string
): Promise<{ fileName: string; bytes: Buffer }> {
  const one = await readOfferUploadSet(ownerId, offerId);
  if ("reason" in one) throw new OfferPhotoGenerationError(one.reason);
  return { fileName: `${one.slug}-photos.zip`, bytes: zip(one.images.map(zipEntryOf)) };
}

/**
 * The upload sets of **several** offers as one ZIP, a folder per offer (#323) — what the bulk
 * listing workspace hands over for a whole posting session rather than one listing at a time.
 *
 * A folder rather than a filename prefix: the files are already named for their offer (#326), so a
 * prefix would only repeat the stem, while a folder is what a marketplace's per-listing upload
 * actually wants — open the offer's folder, select all, done. Two offers sharing a name (the title
 * is generated, so it happens) get their ids appended, because a collision would silently merge two
 * listings' uploads into one folder.
 *
 * Offers with nothing to upload are **skipped, not refused**: a batch is shown as a batch, and one
 * offer that was never generated should not deny the collector the other thirty. Which ones were
 * left out is returned so the caller can say so.
 *
 * @throws {OfferPhotoGenerationError} when no offer in the batch has anything to upload.
 */
export async function buildOffersPhotoArchive(
  ownerId: string,
  offerIds: readonly string[]
): Promise<{
  fileName: string;
  bytes: Buffer;
  offerCount: number;
  imageCount: number;
  skipped: { offerId: string; reason: string }[];
}> {
  const sets = await Promise.all(offerIds.map((offerId) => readOfferUploadSet(ownerId, offerId)));

  const skipped: { offerId: string; reason: string }[] = [];
  const entries: ZipEntry[] = [];
  const folders = new Map<string, number>();
  let offerCount = 0;

  sets.forEach((set, index) => {
    const offerId = offerIds[index];
    if ("reason" in set) {
      skipped.push({ offerId, reason: set.reason });
      return;
    }
    const taken = folders.get(set.slug);
    folders.set(set.slug, (taken ?? 0) + 1);
    // The first offer keeps the plain slug; a later namesake carries its id, so the folders stay
    // readable in the common case and unambiguous in the rare one.
    const folder = taken === undefined ? set.slug : `${set.slug}-${offerId.slice(-6)}`;
    offerCount += 1;
    for (const image of set.images) {
      const file = zipEntryOf(image);
      entries.push({ ...file, name: `${folder}/${file.name}` });
    }
  });

  if (entries.length === 0) {
    throw new OfferPhotoGenerationError(
      "None of these offers has images to upload — generate them first."
    );
  }

  return {
    fileName: `offers-photos-${offerCount}.zip`,
    bytes: zip(entries),
    offerCount,
    imageCount: entries.length,
    skipped,
  };
}

/** An upload-set image as the archive stores it. The name is the plan's own, so a file in a ZIP and
 *  a file sent to a marketplace are the same file under the same name. */
function zipEntryOf(image: OfferUploadImage): ZipEntry {
  return { name: image.fileName, contents: image.bytes };
}

/** One image of the upload run, with the bytes: what a ZIP entry is built from, and what an upload
 *  to a marketplace's image store sends (#487). */
export interface OfferUploadImage {
  photoId: string;
  /** The name it takes on upload — `<offer>-01.jpg`… in plan order (#314/#326). */
  fileName: string;
  mime: string;
  bytes: Buffer;
}

/**
 * One offer's upload set as named files, or the reason it has none. Owner-checked (through the read
 * model), and the single source both archives are built from — so a file unpacked from the bulk ZIP
 * is byte-identical to, and named exactly as, the same file taken from the offer on its own.
 *
 * Since #487 it is what an **API upload** reads too, which is why the mime and the photo id travel
 * beside the bytes: an image a marketplace refuses has to be reported as the image it was, and a
 * ZIP entry's name alone cannot say which photo that is.
 */
async function readOfferUploadSet(
  ownerId: string,
  offerId: string
): Promise<{ slug: string; images: OfferUploadImage[] } | { reason: string }> {
  const state = await getOfferPhotoPlanState(ownerId, offerId);
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: { name: true } });

  // The read model already resolved every image's marks and its upload name against the current
  // plan, so the archive cannot disagree with the panel about what goes up or what it is called.
  const uploaded = state.images.filter((image) => image.publish && !image.overLimit);
  if (uploaded.length === 0) {
    return {
      reason:
        state.images.length === 0
          ? "This offer has no generated images yet."
          : "Every generated image of this offer is held back — nothing to upload.",
    };
  }

  const photos = await prisma.photo.findMany({
    where: { id: { in: uploaded.map((image) => image.photoId) } },
    select: { id: true, storageBackend: true, storageKey: true, mime: true },
  });
  const byId = new Map(photos.map((photo) => [photo.id, photo]));

  const images = await Promise.all(
    uploaded.map(async (image): Promise<OfferUploadImage> => {
      const photo = byId.get(image.photoId)!;
      return {
        photoId: image.photoId,
        fileName: image.fileName,
        mime: photo.mime,
        bytes: await readFullBytes(photo),
      };
    })
  );

  return { slug: offerFileSlug(offer?.name, offerId), images };
}

/**
 * The offer's upload set — the images that are actually going up, in plan order, with their bytes.
 * Owner-checked. This is the ZIP's own read (#314) exposed for a caller that uploads them through an
 * API instead of handing the collector a file (#487), so the two can never disagree about which
 * images a listing gets or what they are called.
 *
 * @throws {OfferPhotoGenerationError} when the offer has nothing to upload — the same sentence the
 * ZIP refuses with, because it is the same situation.
 */
export async function readOfferUploadImages(
  ownerId: string,
  offerId: string
): Promise<OfferUploadImage[]> {
  const one = await readOfferUploadSet(ownerId, offerId);
  if ("reason" in one) throw new OfferPhotoGenerationError(one.reason);
  return one.images;
}

/**
 * A safe, recognisable file-name stem for one offer — used for the archive and, since #326, for
 * every image inside it and every image downloaded on its own.
 *
 * The offer's own name when it has one (it usually does: the title is generated at creation from
 * the platform's template, #209/#210). When it does not, the fall-back is a slice of its id rather
 * than a bare `offer`, because a constant stem would put every unnamed offer's `01.jpg` straight
 * back in collision with every other's — the very thing the stem is here to prevent.
 */
function offerFileSlug(name: string | null | undefined, offerId: string): string {
  const slug = (name ?? "")
    // Decompose, then drop the combining marks: "Węgry" becomes "wegry" rather than "w-gry".
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return slug || `offer-${offerId.slice(-6)}`;
}

// ── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Queue a generation run for an offer. Idempotent: a run already queued or in flight is left alone
 * rather than stacked, so pressing Generate twice renders once.
 *
 * @throws {OfferPhotoGenerationError} when the offer carries no collage numbers, or when its current
 * composition plans no images at all — queueing a job that can only produce nothing would report a
 * bogus "ready" state.
 */
export async function enqueueOfferPhotoGeneration(
  ownerId: string,
  offerId: string
): Promise<void> {
  await assertOfferOwner(ownerId, offerId);
  const inputs = await readInputs(offerId);
  if (!inputs) throw new OfferPhotoGenerationError("Offer not found.");

  const plan = planFor(inputs);
  if (!plan.configured) {
    throw new OfferPhotoGenerationError(
      "This offer has no collage numbers yet. Pick a collage template in its photo settings first."
    );
  }
  if (plan.images.length === 0) {
    throw new OfferPhotoGenerationError(
      inputs.excludedSets.length > 0 && inputs.sets.length === 0
        ? "Nothing to generate: every set in this offer has sold or is committed elsewhere."
        : "Nothing to generate: this offer's copies have no scans for the chosen sides."
    );
  }

  const existing = await prisma.offerPhotoGeneration.findUnique({
    where: { offerId },
    select: { status: true },
  });
  if (existing && (ACTIVE_STATUSES as readonly string[]).includes(existing.status)) return;

  const queued = {
    status: "queued",
    plannedCount: plan.images.length,
    renderedCount: 0,
    error: null,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
  };
  await prisma.offerPhotoGeneration.upsert({
    where: { offerId },
    create: { offerId, ...queued },
    update: queued,
  });
}

// ── Queue mechanics ──────────────────────────────────────────────────────────

/**
 * Claim the oldest queued run, or null when the queue is empty. The claim is a conditional update, so
 * two callers cannot claim the same row even though only one worker exists today.
 *
 * `only` narrows the claim to one offer. The worker never passes it — the queue is global by design;
 * it exists for tests, which share a single database across concurrently-running files and would
 * otherwise claim each other's runs.
 */
export async function claimNextOfferPhotoGeneration(only?: { offerId: string }): Promise<string | null> {
  const next = await prisma.offerPhotoGeneration.findFirst({
    where: { status: "queued", ...(only ? { offerId: only.offerId } : {}) },
    orderBy: { queuedAt: "asc" },
    select: { id: true, offerId: true },
  });
  if (!next) return null;
  const { count } = await prisma.offerPhotoGeneration.updateMany({
    where: { id: next.id, status: "queued" },
    data: { status: "running", startedAt: new Date(), renderedCount: 0, error: null },
  });
  return count === 1 ? next.offerId : null;
}

/**
 * Requeue runs left `running` by a process that went away (a container restart mid-render). Called once
 * at boot: a render is a full replacement, so re-running it is always safe. Returns how many.
 *
 * `only` narrows it to one offer, for the same test-isolation reason as
 * {@link claimNextOfferPhotoGeneration}; the boot path passes nothing.
 */
export async function requeueStalledOfferPhotoGenerations(only?: { offerId: string }): Promise<number> {
  const { count } = await prisma.offerPhotoGeneration.updateMany({
    where: { status: "running", ...(only ? { offerId: only.offerId } : {}) },
    data: { status: "queued", startedAt: null, renderedCount: 0 },
  });
  return count;
}

// ── Bytes ────────────────────────────────────────────────────────────────────

/** Read a stored photo's `full` bytes into memory — a collage tile has to be decoded as a whole, and
 * an archived image has to be handed over whole. */
async function readFullBytes(photo: {
  storageBackend: string;
  storageKey: string;
  mime: string;
}): Promise<Buffer> {
  const object = await getStorage(photo.storageBackend).get(
    variantKey(photo.storageKey, "full", photo.mime),
    photo.mime
  );
  const chunks: Buffer[] = [];
  for await (const chunk of object.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Best-effort deletion of both variants under a prefix; byte cleanup never fails a caller. */
async function deleteVariants(backend: string, storageKey: string, mime: string): Promise<void> {
  const storage = getStorage(backend);
  await Promise.all(
    (["full", "thumb"] as PhotoVariant[]).map((v) =>
      storage.delete(variantKey(storageKey, v, mime)).catch(() => {})
    )
  );
}

/**
 * Delete the stored bytes of every image the offer owns — the generated ones and the originals
 * uploaded straight to it for a manual attachment (#313). Prisma's cascade drops the rows with the
 * offer, but never the files — same contract as the copy/stamp paths in `photos.ts`. Call *before*
 * deleting the offer, while the rows can still be read.
 */
export async function deleteOfferPhotoBytes(offerId: string): Promise<void> {
  const rows = await prisma.photo.findMany({
    where: { offerId },
    select: { storageBackend: true, storageKey: true, mime: true },
  });
  await Promise.all(rows.map((r) => deleteVariants(r.storageBackend, r.storageKey, r.mime)));
}

/** What one pass of {@link purgeClosedOfferPhotos} freed. */
export interface ClosedOfferPhotoPurge {
  /** Offers whose generated images were deleted. */
  offers: number;
  /** Images deleted across them. */
  photos: number;
  /** `sizeBytes` those images were carrying — what the collection's storage total (#144) drops by. */
  bytes: number;
}

/**
 * Purge the generated images of offers that have been **closed** longer than the grace period
 * (#512). An hourly sweep started from `instrumentation.ts` `register()`, alongside the staging-upload
 * orphan GC (#112) it is modelled on: idempotent, best-effort, and never anything but a delete.
 *
 * What goes is every `Photo` the offer owns with `kind: "generated"` — collage sides and rendered
 * manual attachments alike, since both are output the plan can produce again from the same inputs.
 * What stays is everything that is a **source**: the copies' scans, and the original uploaded
 * straight to the offer for an attachment (#313), which no rule could recreate. The plan itself also
 * stays — the offer's photo settings, its attachment rows and its manual plan order are untouched —
 * so the only thing lost is the bytes, and Regenerate makes them again.
 *
 * Three things it refuses to touch:
 *
 *  - an offer with a `queued` or `running` job, which is the worker's row to write and about to hold
 *    fresh images anyway;
 *  - an offer whose `closedAt` is null — a listing closed before the column existed is backfilled by
 *    the migration, so this only ever means "not closed";
 *  - anything at all, when the TTL is switched off.
 *
 * `only` narrows the sweep to one offer, for the same test-isolation reason as
 * {@link claimNextOfferPhotoGeneration}; the boot path passes nothing.
 */
export async function purgeClosedOfferPhotos(
  now: Date = new Date(),
  only?: { offerId: string }
): Promise<ClosedOfferPhotoPurge> {
  const empty: ClosedOfferPhotoPurge = { offers: 0, photos: 0, bytes: 0 };
  const cutoff = closedOfferPhotoCutoff(now, closedOfferPhotoTtlMs());
  if (!cutoff) return empty;

  const candidates = await prisma.offer.findMany({
    where: {
      ...(only ? { id: only.offerId } : {}),
      state: { in: [...CLOSED_OFFER_STATES] },
      closedAt: { lt: cutoff },
      photos: { some: { kind: "generated" } },
    },
    select: { id: true, photoGeneration: { select: { status: true } } },
  });

  const result = { ...empty };
  for (const offer of candidates) {
    const status = offer.photoGeneration?.status;
    if (status && (ACTIVE_STATUSES as readonly string[]).includes(status)) continue;

    const photos = await prisma.photo.findMany({
      where: { offerId: offer.id, kind: "generated" },
      select: { id: true, storageBackend: true, storageKey: true, mime: true, sizeBytes: true },
    });
    if (photos.length === 0) continue;

    // Rows first, in one transaction — deleting a `Photo` cascades to its plan entry, exactly as a
    // regeneration's swap does. The generation row moves to `purged` rather than being deleted, so
    // the card can say what happened; `fingerprint` goes with the images it described.
    await prisma.$transaction(async (tx) => {
      await tx.photo.deleteMany({ where: { id: { in: photos.map((p) => p.id) } } });
      const purged = {
        status: "purged",
        fingerprint: null,
        plannedCount: 0,
        renderedCount: 0,
        error: null,
        finishedAt: now,
      };
      await tx.offerPhotoGeneration.upsert({
        where: { offerId: offer.id },
        create: { offerId: offer.id, ...purged, queuedAt: now, startedAt: null },
        update: purged,
      });
    });

    // Post-commit: the files. Their rows are already gone, so a failure here leaves at worst an
    // unreferenced object the way any other byte deletion does.
    await Promise.all(photos.map((p) => deleteVariants(p.storageBackend, p.storageKey, p.mime)));

    result.offers += 1;
    result.photos += photos.length;
    result.bytes += photos.reduce((sum, p) => sum + p.sizeBytes, 0);
  }
  return result;
}

// ── The run ──────────────────────────────────────────────────────────────────

/** One rendered image, written to storage and waiting for its rows. */
interface RenderedImage {
  photoId: string;
  storageKey: string;
  storageBackend: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  sortOrder: number;
  /** The plan identity this image was rendered for (#313) — stored on its entry, so the panel can
   * match the file back to its planned place. */
  token: string;
  /** `collage` for a planned group; `copy_photo` / `upload` / `manual_collage` for a manual
   * attachment (#313, #331). */
  source: "collage" | AttachmentSource;
  side: "front" | "back" | null;
  pairKey: string | null;
  setIds: string[];
  itemIds: string[];
}

/** One tile's bytes plus the annotation drawn under it. Shared by the collage and the attachment
 * paths — an attachment is a one-tile collage, which is the whole reason nothing is ever passed
 * through unlabelled (#310, #312). */
async function tileSource(
  photoId: string,
  labels: TileLabelTexts | null,
  inputs: GenerationInputs
): Promise<CollageTileSource> {
  const source = inputs.sourceById.get(photoId);
  if (!source) {
    // The plan was built from the same read, so a missing source is a bug, not a race.
    throw new Error(`Planned tile references unknown photo ${photoId}.`);
  }
  return {
    buffer: await readFullBytes(source),
    labels,
    // Null on anything uploaded before the originals were recorded; the renderer reads that as
    // "never downscaled", which is what it assumed of every scan until then.
    originalSize:
      source.originalWidth != null && source.originalHeight != null
        ? { width: source.originalWidth, height: source.originalHeight }
        : null,
  };
}

/**
 * Render one image from its tiles and store it. `columns` is the collage's own width for a group and
 * 1 for an attachment; everything else — gap, label strip, background, the platform's output limits
 * — is identical, so an attachment looks like the images around it rather than like a pass-through.
 */
async function renderTiles(
  sources: CollageTileSource[],
  columns: number,
  index: number,
  inputs: GenerationInputs
): Promise<Omit<RenderedImage, "token" | "source" | "side" | "pairKey" | "setIds" | "itemIds">> {
  const collage = inputs.collage!;
  const rendered = await renderCollage(
    sources,
    {
      columns,
      gapPercent: collage.collageGapPercent,
      labelPercent: collage.collageLabelPercent,
      background: collage.collageBackground,
    },
    {
      maxEdge: inputs.limits.maxPhotoEdge,
      maxBytes:
        inputs.limits.maxPhotoFileSizeMib != null
          ? inputs.limits.maxPhotoFileSizeMib * 1024 * 1024
          : null,
    }
  );
  if (rendered.exceedsFileSizeLimit) {
    // The renderer returns its best attempt rather than throwing (#310). Worth a log line, not a
    // failed run: the collector can lower the collage size or accept a bigger file.
    console.warn(
      `[offer-photos] image ${index} of offer ${inputs.offerId} is ${rendered.buffer.byteLength} B, over the platform's limit`
    );
  }

  const thumb = await thumbnailFor(rendered.buffer, COLLAGE_MIME);
  const photoId = randomUUID();
  const prefix = permanentPrefix(inputs.collectionId, photoId);
  const storage = getActiveStorage();
  try {
    await storage.put(variantKey(prefix, "full", COLLAGE_MIME), rendered.buffer, COLLAGE_MIME);
    await storage.put(variantKey(prefix, "thumb", COLLAGE_MIME), thumb.buffer, COLLAGE_MIME);
  } catch (err) {
    await deleteVariants(storage.backend, prefix, COLLAGE_MIME);
    throw err;
  }

  return {
    photoId,
    storageKey: prefix,
    storageBackend: storage.backend,
    mime: COLLAGE_MIME,
    width: rendered.width,
    height: rendered.height,
    sizeBytes: rendered.buffer.byteLength,
    sortOrder: index,
  };
}

/**
 * The stored sizes of a planned group's tiles, in plan order — what `auto` mode measures its grid
 * against (#514). Read from the photo rows the plan was built from, so nothing has to be decoded to
 * decide the shape. A tile whose row is missing its dimensions comes back `0 × 0`, which the
 * resolver reads as "no usable sizes" and answers on the count alone, exactly as #413 did.
 */
function plannedTileSizes(image: PlannedCollage, inputs: GenerationInputs): CollageTileTrueSize[] {
  return image.tiles.map((tile) => {
    const source = inputs.sourceById.get(tile.photoId);
    return {
      stored: { width: source?.width ?? 0, height: source?.height ?? 0 },
      original:
        source?.originalWidth != null && source.originalHeight != null
          ? { width: source.originalWidth, height: source.originalHeight }
          : null,
    };
  });
}

/** A planned collage group: every tile is a copy's scan, annotated from that copy's own data. */
async function renderPlannedCollage(
  image: PlannedCollage,
  index: number,
  inputs: GenerationInputs
): Promise<RenderedImage> {
  const sources: CollageTileSource[] = [];
  for (const tile of image.tiles) {
    sources.push(await tileSource(tile.photoId, inputs.tileLabels.get(tile.itemId) ?? null, inputs));
  }
  return {
    // The width is resolved per image (#413): in `fixed` mode it is the offer's `collageColumns`,
    // in `auto` it is solved from the tiles this group actually holds — from their sizes (#514),
    // read off the photo rows, so the grid is chosen before any scan is decoded.
    ...(await renderTiles(
      sources,
      resolveCollageColumns(trueScaledSizes(plannedTileSizes(image, inputs)), {
        gridMode: inputs.collage!.collageGridMode,
        rows: inputs.collage!.collageRows,
        columns: inputs.collage!.collageColumns,
      }),
      index,
      inputs
    )),
    token: image.token,
    source: "collage",
    side: image.side,
    pairKey: image.groupKey,
    setIds: image.setIds,
    itemIds: image.tiles.map((t) => t.itemId),
  };
}

/**
 * A manual attachment (#313, #331): the tiles the collector chose, at the width they chose,
 * annotated like any other. A tile showing a copy's photo resolves its label from that copy, so a
 * detail shot carries the same `A234` as that copy's tile in a derived collage — which is the point
 * of attaching one. A tile with no copy gets the copyless label: literal text only, or nothing at
 * all. The single-image modes are this with one tile in one column.
 *
 * It carries no side and no pair: an attachment is one deliberate image, not half of a front/back.
 */
async function renderPlannedAttachment(
  image: PlannedAttachment,
  index: number,
  inputs: GenerationInputs
): Promise<RenderedImage> {
  const sources: CollageTileSource[] = [];
  for (const tile of image.tiles) {
    const labels = tile.itemId
      ? inputs.tileLabels.get(tile.itemId) ?? null
      : inputs.uploadTileLabel;
    sources.push(await tileSource(tile.photoId, labels, inputs));
  }
  return {
    ...(await renderTiles(sources, image.columns, index, inputs)),
    token: image.token,
    source: inputs.attachmentSources.get(image.attachmentId) ?? "upload",
    side: null,
    pairKey: null,
    setIds: [],
    itemIds: image.tiles.flatMap((tile) => (tile.itemId ? [tile.itemId] : [])),
  };
}

/**
 * Render an offer's whole photo plan and replace whatever it had. Runs in the worker, so it takes no
 * `ownerId`: the caller is the queue, and the row it claimed is authorization enough.
 *
 * Everything is rendered before anything is replaced, so a failure leaves the previous images intact.
 * Progress is written per image (`renderedCount`) purely so the panel can show it.
 *
 * @throws whatever the renderer or storage throws; the worker records it on the row.
 */
export async function runOfferPhotoGeneration(offerId: string): Promise<void> {
  const inputs = await readInputs(offerId);
  if (!inputs) throw new OfferPhotoGenerationError("Offer not found.");

  const plan = planFor(inputs);
  const fingerprint = fingerprintFor(inputs, plan);
  await prisma.offerPhotoGeneration.update({
    where: { offerId },
    data: { plannedCount: plan.images.length },
  });

  const rendered: RenderedImage[] = [];
  try {
    for (const [index, image] of plan.images.entries()) {
      rendered.push(
        image.kind === "collage"
          ? await renderPlannedCollage(image, index, inputs)
          : await renderPlannedAttachment(image, index, inputs)
      );
      await prisma.offerPhotoGeneration.update({
        where: { offerId },
        data: { renderedCount: rendered.length },
      });
    }
  } catch (err) {
    await Promise.all(
      rendered.map((r) => deleteVariants(r.storageBackend, r.storageKey, r.mime))
    );
    throw err;
  }

  // Swap: the previous generated photos go, the new ones arrive, in one transaction. Deleting a
  // `Photo` cascades to its plan entry, so the entries need no separate delete. Only `generated`
  // rows are swapped: an attachment's uploaded original (#313) is a source, not an output, and is
  // rendered from again on every run.
  const previous = await prisma.photo.findMany({
    where: { offerId, kind: "generated" },
    select: { id: true, storageBackend: true, storageKey: true, mime: true },
  });
  await prisma.$transaction(async (tx) => {
    if (previous.length > 0) {
      await tx.photo.deleteMany({ where: { id: { in: previous.map((p) => p.id) } } });
    }
    for (const image of rendered) {
      await tx.photo.create({
        data: {
          id: image.photoId,
          offerId,
          kind: "generated",
          // Plan images take their order from the entry, never from a role slot.
          role: null,
          storageBackend: image.storageBackend,
          storageKey: image.storageKey,
          mime: image.mime,
          width: image.width,
          height: image.height,
          sizeBytes: image.sizeBytes,
          sortOrder: image.sortOrder,
        },
      });
      await tx.offerPhotoEntry.create({
        data: {
          offerId,
          photoId: image.photoId,
          sortOrder: image.sortOrder,
          token: image.token,
          source: image.source,
          side: image.side,
          pairKey: image.pairKey,
          setIds: image.setIds,
          itemIds: image.itemIds,
        },
      });
    }
    await tx.offerPhotoGeneration.update({
      where: { offerId },
      data: {
        status: "ready",
        fingerprint,
        plannedCount: plan.images.length,
        renderedCount: rendered.length,
        error: null,
        finishedAt: new Date(),
      },
    });
  });

  // Post-commit: the displaced files. Their rows are already gone.
  await Promise.all(
    previous.map((p) => deleteVariants(p.storageBackend, p.storageKey, p.mime))
  );
}

/** Record a failed run on its row, so the panel can show why. Never throws. */
export async function failOfferPhotoGeneration(offerId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.offerPhotoGeneration
    .update({
      where: { offerId },
      data: { status: "failed", error: message.slice(0, 500), finishedAt: new Date() },
    })
    .catch(() => {});
}
