import "server-only";
import { prisma } from "./db";
import { makeOfferLabeller, STAMP_LABEL_SELECT } from "./offer-labels";
import { seedPhotoConfig } from "./offers";
import {
  offerPhotoConfigFromRow,
  type OfferPhotoConfigInput,
  type PlatformPhotoLimits,
} from "./offer-photo-config";
import { planOfferPhotos, type PlanImageSide, type PlannedCollage } from "./offer-photo-plan";
import { loadChecklistSlots } from "./offer-photo-checklists";
import {
  readCoverAskedItemIds,
  readTileLabels,
  renderPlannedCollageBytes,
  SOURCE_PHOTO_SELECT,
  type CollageRenderContext,
  type SourcePhoto,
} from "./offer-photo-generation";
import { coverWalkPhotos, offerNeedsCovers } from "./photo-cover-rules";
import { COLLAGE_MIME } from "./photos/collage";
import { collagePlanSets, type CollagePackaging } from "./copies-collage-rules";

/**
 * A one-off collage of ticked copies (#2052): an offer's photo plan with no offer, rendered in the
 * request and handed back. **Nothing is stored** — no offer, no `Photo` row, no bytes under the
 * storage interface — so there is nothing to sweep, and closing the dialog is the whole of the
 * clean-up. The settings come from the dialog, seeded from a platform the way a new offer's are
 * (`seedPhotoConfig`), and the platform's limits, listing language and symbol covering are read
 * live as an offer's run reads them.
 *
 * In the request rather than queued (ADR-0018) because there is no row for a job to fill: a queued
 * run would have to store its images to hand them over, which is the one thing this must not do. It
 * is the work an offer's run does for a handful of images, a buyer's question being a handful.
 */

export class CopiesCollageError extends Error {}

/** What the dialog seeds its settings from (#2052) — the platform's photo defaults, as a new offer
 *  on it would start, with the live facts the offer's own settings dialog shows beside them. */
export interface CollagePlatformSeed {
  platformId: string;
  platformName: string;
  config: Required<OfferPhotoConfigInput>;
  limits: PlatformPhotoLimits;
  /** Whether the platform needs symbols covered (#1665) — what *follow the platform* means. */
  platformCoverSymbols: boolean;
}

const PLATFORM_SELECT = {
  id: true,
  name: true,
  maxPhotos: true,
  maxPhotoEdge: true,
  maxPhotoFileSizeMib: true,
  titleLanguage: true,
  coverSymbols: true,
  photoSides: true,
  photoPreferSingles: true,
  tileLabelLeftTemplate: true,
  tileLabelRightTemplate: true,
  defaultCollageTemplateId: true,
  photoGroupByChecklist: true,
  defaultGroupCollageTemplateId: true,
} as const;

async function readPlatform(ownerId: string, collectionId: string, platformId: string) {
  const platform = await prisma.platform.findFirst({
    where: { id: platformId, collectionId, collection: { ownerId } },
    select: PLATFORM_SELECT,
  });
  if (!platform) throw new CopiesCollageError("Choose a platform to take the photo settings from.");
  return platform;
}

export async function getCollagePlatformSeed(
  ownerId: string,
  collectionId: string,
  platformId: string
): Promise<CollagePlatformSeed> {
  const platform = await readPlatform(ownerId, collectionId, platformId);
  const seed = await seedPhotoConfig(platform);
  return {
    platformId: platform.id,
    platformName: platform.name,
    // The platform's rule is followed until the dialog says otherwise, as on a new offer.
    config: offerPhotoConfigFromRow({ ...seed, coverSymbols: null }),
    limits: {
      maxPhotos: platform.maxPhotos,
      maxPhotoEdge: platform.maxPhotoEdge,
      maxPhotoFileSizeMib: platform.maxPhotoFileSizeMib,
    },
    platformCoverSymbols: platform.coverSymbols,
  };
}

export interface CopiesCollageRequest {
  /** The ticked copies in view, in any order — the plan puts them in catalogue order. */
  itemIds: readonly string[];
  platformId: string;
  packaging: CollagePackaging;
  config: OfferPhotoConfigInput;
}

/** One image of the collage, its bytes inline: there is nowhere else they are kept. */
export interface CopiesCollageImage {
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  side: PlanImageSide;
  /** How many stamps it shows. */
  tileCount: number;
  /** Past the platform's photo limit (#309) — still drawn, since the stamps on it are still wanted. */
  overLimit: boolean;
  /** Over the platform's file-size limit even at the lowest quality (#310). */
  exceedsFileSizeLimit: boolean;
  base64: string;
}

export interface CopiesCollageResult {
  images: CopiesCollageImage[];
  /** A side not drawn for a group because some of its copies have no scan of it (#314), naming them. */
  skipped: { side: PlanImageSide; copies: string[] }[];
  /** Ticked copies on none of the images, for want of any scan the settings photograph. */
  missing: string[];
  /** Photos drawn that were never checked for symbols though the platform needs them covered and
   *  their stamps come from an area that may carry them (#1665, #1891). */
  uncheckedCoverCount: number;
  /** The ticked copies the collage was made of — those still in the collection. */
  copyCount: number;
}

/**
 * Plan and render the collage. Throws {@link CopiesCollageError} for what the collector can fix: no
 * copies, no platform, no collage numbers to lay the stamps out with.
 */
export async function makeCopiesCollage(
  ownerId: string,
  collectionId: string,
  request: CopiesCollageRequest
): Promise<CopiesCollageResult> {
  const config = request.config;
  if (!config.collage) {
    throw new CopiesCollageError("Pick a collage template — without collage numbers the stamps cannot be laid out.");
  }
  const platform = await readPlatform(ownerId, collectionId, request.platformId);
  const items = await prisma.item.findMany({
    where: { id: { in: [...new Set(request.itemIds)] }, collectionId, collection: { ownerId } },
    select: {
      id: true,
      stampId: true,
      stamp: { select: STAMP_LABEL_SELECT.stamp.select },
      photos: {
        where: { role: { in: ["front", "back"] } },
        select: SOURCE_PHOTO_SELECT,
      },
    },
  });
  if (items.length === 0) throw new CopiesCollageError("None of the ticked copies is in this collection.");

  const groupByChecklist = config.groupByChecklist ?? false;
  const checklistSlots =
    groupByChecklist && request.packaging === "one-set"
      ? await loadChecklistSlots(
          collectionId,
          items.map((item) => ({ itemId: item.id, stampId: item.stampId }))
        )
      : null;

  const sourceById = new Map<string, SourcePhoto>();
  const sets = collagePlanSets(
    items.map((item) => {
      for (const photo of item.photos) sourceById.set(photo.id, photo);
      return {
        itemId: item.id,
        catalogSortKey: item.stamp.primaryCatalogSortKey,
        frontPhotoId: item.photos.find((p) => p.role === "front")?.id ?? null,
        backPhotoId: item.photos.find((p) => p.role === "back")?.id ?? null,
        ...(checklistSlots ? { checklists: checklistSlots.get(item.id) ?? [] } : {}),
      };
    }),
    request.packaging
  );

  const plan = planOfferPhotos({
    sets,
    photoSides: config.photoSides,
    collage: config.collage,
    maxPhotos: platform.maxPhotos,
    preferSingles: config.preferSingles,
    checklistGroups: groupByChecklist ? { collage: config.groupCollage ?? config.collage } : null,
  });
  // No attachments, so every image is a derived collage.
  const images = plan.images.filter((image): image is PlannedCollage => image.kind === "collage");

  const itemIds = items.map((item) => item.id);
  const [tileLabels, askedItemIds, labeller] = await Promise.all([
    readTileLabels(
      ownerId,
      collectionId,
      itemIds,
      { left: config.photoLabelLeftTemplate, right: config.photoLabelRightTemplate },
      platform.titleLanguage
    ),
    readCoverAskedItemIds(collectionId, itemIds),
    makeOfferLabeller(collectionId),
  ]);
  const needsCovers = offerNeedsCovers(config.coverSymbols ?? null, platform.coverSymbols);
  const context: CollageRenderContext = {
    logLabel: `a collage of ${items.length} copies`,
    sourceById,
    tileLabels,
    uploadTileLabel: null,
    collage: config.collage,
    groupCollage: config.groupCollage ?? null,
    limits: {
      maxPhotos: platform.maxPhotos,
      maxPhotoEdge: platform.maxPhotoEdge,
      maxPhotoFileSizeMib: platform.maxPhotoFileSizeMib,
    },
    needsCovers,
  };

  const rendered: CopiesCollageImage[] = [];
  for (const [index, image] of images.entries()) {
    const bytes = await renderPlannedCollageBytes(image, index, context);
    rendered.push({
      mime: COLLAGE_MIME,
      width: bytes.width,
      height: bytes.height,
      sizeBytes: bytes.buffer.byteLength,
      side: image.side,
      tileCount: image.tiles.length,
      overLimit: image.overLimit,
      exceedsFileSizeLimit: bytes.exceedsFileSizeLimit,
      base64: bytes.buffer.toString("base64"),
    });
  }

  const labelOf = new Map(items.map((item) => [item.id, labeller.copy(item.stamp)]));
  const drawn = new Set(images.flatMap((image) => image.tiles.map((tile) => tile.itemId)));
  const checked = new Set<string>();
  for (const [id, source] of sourceById) if (source.coversCheckedAt) checked.add(id);
  const uncheckedCoverCount = needsCovers
    ? coverWalkPhotos(images, checked, new Set(sourceById.keys()), askedItemIds).filter(
        (c) => c.asked && !c.checked
      ).length
    : 0;

  return {
    images: rendered,
    skipped: plan.skipped.map((s) => ({
      side: s.side,
      copies: s.missingItemIds.map((id) => labelOf.get(id) ?? id),
    })),
    missing: sets
      .flatMap((set) => set.items.map((copy) => copy.itemId))
      .filter((id) => !drawn.has(id))
      .map((id) => labelOf.get(id) ?? id),
    uncheckedCoverCount,
    copyCount: items.length,
  };
}
