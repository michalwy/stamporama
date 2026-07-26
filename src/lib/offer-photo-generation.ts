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
import { deriveSetLabel } from "./offer-set-rules";
import { sortSetItems } from "./offer-set-order";
import { zip } from "./zip";
import { COLLAGE_MIME, renderCollage, type CollageTileSource } from "./photos/collage";
import type { TileLabelTexts } from "./collage-label";
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
 */

/** Lifecycle of one offer's generation. `none` is the synthetic state of an offer never generated. */
export type OfferPhotoGenerationStatus = "none" | "queued" | "running" | "ready" | "failed";

const ACTIVE_STATUSES = ["queued", "running"] as const;

/** Stands in for a set or copy the plan was rendered from that the offer no longer holds. The image
 * is a snapshot; the mismatch is what `outOfDate` reports, not something to hide. */
const REMOVED_LABEL = "removed";

/** `01.jpg`, `02.jpg`… — plan position, 1-based, zero-padded so a file manager sorts them right. */
function planFileName(index: number, mime: string): string {
  return `${String(index + 1).padStart(2, "0")}.${extForMime(mime)}`;
}

/** Raised by {@link enqueueOfferPhotoGeneration} when there is nothing sensible to render. */
export class OfferPhotoGenerationError extends Error {}

/** One stored image of the plan, as the panel reads it. */
export interface OfferPhotoImage {
  photoId: string;
  sortOrder: number;
  /** `collage` for a group of set copies, `copy_photo` / `upload` for a manual attachment (#313). */
  source: string;
  side: "front" | "back" | null;
  /** Links the front/back pair rendered from the same copies. */
  pairKey: string | null;
  setIds: string[];
  itemIds: string[];
  /**
   * The name this image takes when downloaded, on its own or inside the plan's ZIP (#314):
   * `01.jpg`, `02.jpg`… Plain numbers in plan order, because the whole point is a folder that
   * sorts into upload order in any file manager. Our numbering is not the platform's — position
   * there is whatever was uploaded — and that is fine: labels identify copies independently (#312).
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
  /** `collage` for a planned group; `copy_photo` / `upload` for a manual attachment. */
  source: "collage" | "copy_photo" | "upload";
  side: "front" | "back" | null;
  /** Set for an attachment: what to drag, rename or remove. Null for a generated group. */
  attachmentId: string | null;
  /** The collector's caption for an attachment; null for a generated group. */
  title: string | null;
  /** An image to preview the entry with — an attachment's own source photo, or the first tile of a
   * planned collage. The planned collage itself does not exist yet, so its first stamp stands in. */
  previewPhotoId: string | null;
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
  /** Groups the platform's photo-count limit would drop from the end (#309). */
  droppedGroups: number;
  /** The plan exceeds the platform's limit through protected attachments alone (#309). */
  exceedsLimit: boolean;
  /** Sides no group can produce for want of a complete set of scans. A set of eight losing its back
   * collage over one missing reverse is easy to overlook, so the panel says so out loud (#314). */
  skipped: OfferPhotoSkippedSide[];
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
}

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
  sets: PlanSet[];
  labels: PlanLabels;
  photoSides: ReturnType<typeof normalizePhotoSides>;
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
  /** The offer's manual attachments (#313), already resolved to the photo each one shows. */
  attachments: PlanAttachment[];
  /** Each attachment's caption, by attachment id — for the panel only. */
  attachmentTitles: Map<string, string | null>;
  /** Which mode each attachment is, by attachment id: `copy_photo` or `upload`. */
  attachmentSources: Map<string, "copy_photo" | "upload">;
}

const SIDE_ROLES = ["front", "back"];

async function readInputs(offerId: string): Promise<GenerationInputs | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      name: true,
      collectionId: true,
      photoSides: true,
      photoLabelLeftTemplate: true,
      photoLabelRightTemplate: true,
      collageRows: true,
      collageColumns: true,
      collageGapPercent: true,
      collageBackground: true,
      collageLabelPercent: true,
      photoPlanOrder: true,
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
          items: {
            select: {
              itemId: true,
              sortOrder: true,
              item: {
                select: {
                  stamp: {
                    select: {
                      primaryCatalogSortKey: true,
                      // Labels are for the panel only; they never reach the plan or the fingerprint.
                      name: true,
                      catalogNumbers: { select: { number: true }, take: 1 },
                    },
                  },
                  photos: {
                    where: { role: { in: SIDE_ROLES } },
                    select: {
                      id: true,
                      role: true,
                      storageBackend: true,
                      storageKey: true,
                      mime: true,
                    },
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
          title: true,
          photo: {
            select: {
              id: true,
              storageBackend: true,
              storageKey: true,
              mime: true,
            },
          },
        },
      },
    },
  });
  if (!offer) return null;

  const sourceById = new Map<string, SourcePhoto>();
  const labels: PlanLabels = { copies: new Map(), sets: new Map() };
  const sets: PlanSet[] = offer.sets.map((set) => ({
    id: set.id,
    sortOrder: set.sortOrder,
    items: set.items.map((li): PlanCopy => {
      const bySide = new Map(li.item.photos.map((p) => [p.role, p]));
      labels.copies.set(
        li.itemId,
        li.item.stamp.catalogNumbers[0]?.number ?? li.item.stamp.name ?? "Copy"
      );
      for (const photo of li.item.photos) {
        sourceById.set(photo.id, {
          id: photo.id,
          storageBackend: photo.storageBackend,
          storageKey: photo.storageKey,
          mime: photo.mime,
        });
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

  for (const [index, set] of offer.sets.entries()) {
    labels.sets.set(
      set.id,
      deriveSetLabel(
        set.title,
        sortSetItems(sets[index].items).map((c) => labels.copies.get(c.itemId) ?? "Copy")
      )
    );
  }

  const hasCollage =
    offer.collageRows != null &&
    offer.collageColumns != null &&
    offer.collageGapPercent != null &&
    offer.collageBackground != null &&
    offer.collageLabelPercent != null;

  // Attachments (#313). Their photos join the source map so the renderer can read the bytes, and a
  // `copy_photo`'s copy joins the label subjects — a copy attached on its own need not be one the
  // collages already cover.
  const attachments: PlanAttachment[] = [];
  const attachmentTitles = new Map<string, string | null>();
  const attachmentSources = new Map<string, "copy_photo" | "upload">();
  for (const row of offer.photoAttachments) {
    attachments.push({
      id: row.id,
      position: row.sortOrder,
      photoId: row.photo.id,
      itemId: row.itemId,
    });
    attachmentTitles.set(row.id, row.title);
    attachmentSources.set(row.id, row.source === "upload" ? "upload" : "copy_photo");
    sourceById.set(row.photo.id, {
      id: row.photo.id,
      storageBackend: row.photo.storageBackend,
      storageKey: row.photo.storageKey,
      mime: row.photo.mime,
    });
  }

  const labelSubjects = [
    ...sets.flatMap((set) => set.items.map((copy) => copy.itemId)),
    ...attachments.flatMap((a) => (a.itemId ? [a.itemId] : [])),
  ];
  const tileLabels = await readTileLabels(
    offer.collection.ownerId,
    offer.collectionId,
    [...new Set(labelSubjects)],
    { left: offer.photoLabelLeftTemplate, right: offer.photoLabelRightTemplate },
    offer.platform.titleLanguage
  );
  // An attachment naming a copy the offer no longer holds keeps its place and renders: the plan is
  // what the collector arranged, and the panel shows the copy as `removed` rather than dropping the
  // image behind their back. Attaching one is guarded (`attachOfferCopyPhoto`); a copy leaving the
  // offer afterwards is not.

  return {
    offerId: offer.id,
    offerName: offer.name,
    collectionId: offer.collectionId,
    ownerId: offer.collection.ownerId,
    sets,
    labels,
    photoSides: normalizePhotoSides(offer.photoSides),
    photoLabelLeftTemplate: offer.photoLabelLeftTemplate,
    photoLabelRightTemplate: offer.photoLabelRightTemplate,
    tileLabels,
    uploadTileLabel: renderCopylessTileLabel({
      left: offer.photoLabelLeftTemplate,
      right: offer.photoLabelRightTemplate,
    }),
    collage: hasCollage
      ? {
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
    attachments: inputs.attachments,
    order: inputs.photoPlanOrder,
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
    limits: inputs.limits,
    attachments: inputs.attachments,
    uploadTileLabel: inputs.uploadTileLabel
      ? [inputs.uploadTileLabel.left ?? "", inputs.uploadTileLabel.right ?? ""]
      : undefined,
    // The **resolved** order the plan actually produced, not the raw stored list — so a stale token
    // (a sold-out collage) does not keep the plan out of date forever, and reordering the images a
    // buyer is looking at reads as a change. Passed only when the offer carries a custom order, so an
    // offer never reordered by hand hashes exactly as it did before this existed.
    order: inputs.photoPlanOrder.length > 0 ? plan.images.map((image) => image.token) : undefined,
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
  const images: OfferPhotoImage[] = entries.map((e, index) => ({
    photoId: e.photoId,
    sortOrder: e.sortOrder,
    source: e.source,
    side: e.side === "front" || e.side === "back" ? e.side : null,
    pairKey: e.pairKey,
    setIds: e.setIds,
    itemIds: e.itemIds,
    // Numbered by position in the stored plan, not by `sortOrder`: the file names have to be a dense
    // 1..n run for a bulk upload, and a plan that ever renders partially would leave gaps.
    fileName: planFileName(index, e.photo.mime),
    copyLabels: e.itemIds.map((id) => inputs.labels.copies.get(id) ?? REMOVED_LABEL),
    setLabels: e.setIds.map((id) => inputs.labels.sets.get(id) ?? REMOVED_LABEL),
    mime: e.photo.mime,
    width: e.photo.width,
    height: e.photo.height,
    sizeBytes: e.photo.sizeBytes,
  }));

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
        if (image.kind === "attachment") {
          return {
            key: image.attachmentId,
            token: image.token,
            source: inputs.attachmentSources.get(image.attachmentId) ?? "upload",
            side: null,
            attachmentId: image.attachmentId,
            title: inputs.attachmentTitles.get(image.attachmentId) ?? null,
            previewPhotoId: image.photoId,
            setLabels: [],
            copyLabels: image.itemId
              ? [inputs.labels.copies.get(image.itemId) ?? REMOVED_LABEL]
              : [],
          };
        }
        return {
          key: `${image.groupKey}-${image.side}-${index}`,
          token: image.token,
          source: "collage",
          side: image.side,
          attachmentId: null,
          title: null,
          previewPhotoId: image.tiles[0]?.photoId ?? null,
          setLabels: image.setIds.map((id) => inputs.labels.sets.get(id) ?? REMOVED_LABEL),
          copyLabels: image.tiles.map(
            (tile) => inputs.labels.copies.get(tile.itemId) ?? REMOVED_LABEL
          ),
        };
      }),
      droppedGroups: plan.droppedGroups,
      exceedsLimit: plan.exceedsLimit,
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

// ── Archive ──────────────────────────────────────────────────────────────────

/**
 * The offer's stored images as one ZIP, in plan order, named `01.jpg`, `02.jpg`… — the file the
 * collector drops into a marketplace's bulk upload (#314). Owner-checked.
 *
 * Buffered rather than streamed: the archive is bounded by the platform's own photo-count and
 * per-file limits (#308), which is a handful of megabytes, and a stream would have to hold the same
 * central directory anyway.
 *
 * @throws {OfferPhotoGenerationError} when the offer has no generated images to archive.
 */
export async function buildOfferPhotoArchive(
  ownerId: string,
  offerId: string
): Promise<{ fileName: string; bytes: Buffer }> {
  await assertOfferOwner(ownerId, offerId);
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: { name: true } });
  const entries = await prisma.offerPhotoEntry.findMany({
    where: { offerId },
    orderBy: { sortOrder: "asc" },
    select: {
      photo: { select: { storageBackend: true, storageKey: true, mime: true } },
    },
  });
  if (entries.length === 0) {
    throw new OfferPhotoGenerationError("This offer has no generated images yet.");
  }

  const files = await Promise.all(
    entries.map(async (e, index) => ({
      name: planFileName(index, e.photo.mime),
      contents: await readFullBytes(e.photo),
    }))
  );

  return { fileName: `${archiveSlug(offer?.name)}-photos.zip`, bytes: zip(files) };
}

/** A safe, recognisable archive name from the offer's own name. */
function archiveSlug(name: string | null | undefined): string {
  const slug = (name ?? "")
    // Decompose, then drop the combining marks: "Węgry" becomes "wegry" rather than "w-gry".
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return slug || "offer";
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
      "Nothing to generate: this offer's copies have no scans for the chosen sides."
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
 */
export async function claimNextOfferPhotoGeneration(): Promise<string | null> {
  const next = await prisma.offerPhotoGeneration.findFirst({
    where: { status: "queued" },
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
 */
export async function requeueStalledOfferPhotoGenerations(): Promise<number> {
  const { count } = await prisma.offerPhotoGeneration.updateMany({
    where: { status: "running" },
    data: { status: "queued", startedAt: null, renderedCount: 0 },
  });
  return count;
}

// ── Bytes ────────────────────────────────────────────────────────────────────

/** Read a stored photo's `full` bytes into memory — a collage tile has to be decoded as a whole, and
 * an archived image has to be handed over whole. */
async function readFullBytes(photo: Omit<SourcePhoto, "id">): Promise<Buffer> {
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
  /** `collage` for a planned group, `copy_photo` / `upload` for a manual attachment (#313). */
  source: "collage" | "copy_photo" | "upload";
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
  return { buffer: await readFullBytes(source), labels };
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
): Promise<Omit<RenderedImage, "source" | "side" | "pairKey" | "setIds" | "itemIds">> {
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
    ...(await renderTiles(sources, inputs.collage!.collageColumns, index, inputs)),
    source: "collage",
    side: image.side,
    pairKey: image.groupKey,
    setIds: image.setIds,
    itemIds: image.tiles.map((t) => t.itemId),
  };
}

/**
 * A manual attachment (#313): one tile, annotated like any other. A `copy_photo` resolves its label
 * from the copy it shows, so a detail shot carries the same `A234` as that copy's tile in a collage
 * — which is the point of attaching one. An `upload` has no copy, so it gets the copyless label:
 * literal text only, or nothing at all.
 *
 * It carries no side and no pair: an attachment is one deliberate image, not half of a front/back.
 */
async function renderPlannedAttachment(
  image: PlannedAttachment,
  index: number,
  inputs: GenerationInputs
): Promise<RenderedImage> {
  const labels = image.itemId
    ? inputs.tileLabels.get(image.itemId) ?? null
    : inputs.uploadTileLabel;
  const source = await tileSource(image.photoId, labels, inputs);
  return {
    ...(await renderTiles([source], 1, index, inputs)),
    source: inputs.attachmentSources.get(image.attachmentId) ?? "upload",
    side: null,
    pairKey: null,
    setIds: [],
    itemIds: image.itemId ? [image.itemId] : [],
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
