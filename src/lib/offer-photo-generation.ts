import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import {
  getActiveStorage,
  getStorage,
  permanentPrefix,
  variantKey,
  type PhotoVariant,
} from "./storage";
import { COLLAGE_MIME, renderCollage, type CollageTileSource } from "./photos/collage";
import { thumbnailFor } from "./photos/process";
import { normalizePhotoSides, type OfferCollageValues, type PlatformPhotoLimits } from "./offer-photo-config";
import { planOfferPhotos, type PlannedCollage } from "./offer-photo-plan";
import { fingerprintOfferPhotoInputs } from "./offer-photo-fingerprint";
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

/** Raised by {@link enqueueOfferPhotoGeneration} when there is nothing sensible to render. */
export class OfferPhotoGenerationError extends Error {}

/** One stored image of the plan, as the panel reads it. */
export interface OfferPhotoImage {
  photoId: string;
  sortOrder: number;
  /** `collage` today; `copy_photo` / `upload` arrive with manual attachments (#313). */
  source: string;
  side: "front" | "back" | null;
  /** Links the front/back pair rendered from the same copies. */
  pairKey: string | null;
  setIds: string[];
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/** What pressing Generate right now would produce — the plan, not the stored images. */
export interface OfferPhotoPlanPreview {
  /** False while the offer carries no collage numbers (#308): nothing can be laid out. */
  configured: boolean;
  imageCount: number;
  /** Groups the platform's photo-count limit would drop from the end (#309). */
  droppedGroups: number;
  /** The plan exceeds the platform's limit through protected attachments alone (#309). */
  exceedsLimit: boolean;
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

/** Everything one run reads, gathered once so the plan and the fingerprint cannot disagree. */
interface GenerationInputs {
  offerId: string;
  collectionId: string;
  ownerId: string;
  sets: PlanSet[];
  photoSides: ReturnType<typeof normalizePhotoSides>;
  photoLabelTemplate: string | null;
  collage: OfferCollageValues | null;
  limits: PlatformPhotoLimits;
  sourceById: Map<string, SourcePhoto>;
}

const SIDE_ROLES = ["front", "back"];

async function readInputs(offerId: string): Promise<GenerationInputs | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      collectionId: true,
      photoSides: true,
      photoLabelTemplate: true,
      collageRows: true,
      collageColumns: true,
      collageGap: true,
      collageBackground: true,
      collageLabelStripHeight: true,
      collection: { select: { ownerId: true } },
      // Limits are read **live** from the platform (#308): they say what it accepts today.
      platform: {
        select: { maxPhotos: true, maxPhotoEdge: true, maxPhotoFileSizeMib: true },
      },
      sets: {
        select: {
          id: true,
          sortOrder: true,
          items: {
            select: {
              itemId: true,
              sortOrder: true,
              item: {
                select: {
                  stamp: { select: { primaryCatalogSortKey: true } },
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
    },
  });
  if (!offer) return null;

  const sourceById = new Map<string, SourcePhoto>();
  const sets: PlanSet[] = offer.sets.map((set) => ({
    id: set.id,
    sortOrder: set.sortOrder,
    items: set.items.map((li): PlanCopy => {
      const bySide = new Map(li.item.photos.map((p) => [p.role, p]));
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

  const hasCollage =
    offer.collageRows != null &&
    offer.collageColumns != null &&
    offer.collageGap != null &&
    offer.collageBackground != null &&
    offer.collageLabelStripHeight != null;

  return {
    offerId: offer.id,
    collectionId: offer.collectionId,
    ownerId: offer.collection.ownerId,
    sets,
    photoSides: normalizePhotoSides(offer.photoSides),
    photoLabelTemplate: offer.photoLabelTemplate,
    collage: hasCollage
      ? {
          collageRows: offer.collageRows!,
          collageColumns: offer.collageColumns!,
          collageGap: offer.collageGap!,
          collageBackground: offer.collageBackground!,
          collageLabelStripHeight: offer.collageLabelStripHeight!,
        }
      : null,
    limits: {
      maxPhotos: offer.platform.maxPhotos,
      maxPhotoEdge: offer.platform.maxPhotoEdge,
      maxPhotoFileSizeMib: offer.platform.maxPhotoFileSizeMib,
    },
    sourceById,
  };
}

/** The plan these inputs produce. Manual attachments (#313) do not exist yet, so none are passed. */
function planFor(inputs: GenerationInputs) {
  return planOfferPhotos({
    sets: inputs.sets,
    photoSides: inputs.photoSides,
    collage: inputs.collage,
    maxPhotos: inputs.limits.maxPhotos,
  });
}

function fingerprintFor(inputs: GenerationInputs): string {
  return fingerprintOfferPhotoInputs({
    sets: inputs.sets,
    photoSides: inputs.photoSides,
    photoLabelTemplate: inputs.photoLabelTemplate,
    collage: inputs.collage,
    limits: inputs.limits,
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
        photo: { select: { mime: true, width: true, height: true, sizeBytes: true } },
      },
    }),
  ]);

  const plan = planFor(inputs);
  const images: OfferPhotoImage[] = entries.map((e) => ({
    photoId: e.photoId,
    sortOrder: e.sortOrder,
    source: e.source,
    side: e.side === "front" || e.side === "back" ? e.side : null,
    pairKey: e.pairKey,
    setIds: e.setIds,
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
      generation.fingerprint !== fingerprintFor(inputs),
    plannedCount: generation?.plannedCount ?? 0,
    renderedCount: generation?.renderedCount ?? 0,
    error: generation?.status === "failed" ? generation.error : null,
    startedAt: generation?.startedAt ?? null,
    finishedAt: generation?.finishedAt ?? null,
    images,
    plan: {
      configured: plan.configured,
      imageCount: plan.images.length,
      droppedGroups: plan.droppedGroups,
      exceedsLimit: plan.exceedsLimit,
    },
  };
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

/** Read a stored photo's `full` bytes into memory — a collage tile has to be decoded as a whole. */
async function readFullBytes(photo: SourcePhoto): Promise<Buffer> {
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
 * Delete the stored bytes of an offer's generated images. Prisma's cascade drops the rows with the
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
  side: "front" | "back";
  pairKey: string;
  setIds: string[];
}

async function renderPlannedCollage(
  image: PlannedCollage,
  index: number,
  inputs: GenerationInputs
): Promise<RenderedImage> {
  const sources: CollageTileSource[] = [];
  for (const tile of image.tiles) {
    const source = inputs.sourceById.get(tile.photoId);
    if (!source) {
      // The plan was built from the same read, so a missing source is a bug, not a race.
      throw new Error(`Planned tile references unknown photo ${tile.photoId}.`);
    }
    sources.push({ buffer: await readFullBytes(source) });
  }

  const collage = inputs.collage!;
  const rendered = await renderCollage(
    sources,
    {
      columns: collage.collageColumns,
      gap: collage.collageGap,
      labelStripHeight: collage.collageLabelStripHeight,
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
    side: image.side,
    pairKey: image.groupKey,
    setIds: image.setIds,
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
  const fingerprint = fingerprintFor(inputs);
  await prisma.offerPhotoGeneration.update({
    where: { offerId },
    data: { plannedCount: plan.images.length },
  });

  const rendered: RenderedImage[] = [];
  try {
    for (const [index, image] of plan.images.entries()) {
      // Manual attachments (#313) are not implemented yet and the plan is built without them; an
      // unexpected one is skipped rather than guessed at.
      if (image.kind !== "collage") continue;
      rendered.push(await renderPlannedCollage(image, index, inputs));
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
  // `Photo` cascades to its plan entry, so the entries need no separate delete.
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
          source: "collage",
          side: image.side,
          pairKey: image.pairKey,
          setIds: image.setIds,
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
