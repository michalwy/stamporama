import "server-only";
import { createHash, randomUUID } from "node:crypto";
import sharp, { type OverlayOptions } from "sharp";
import { prisma } from "./db";
import { getActiveStorage, permanentPrefix, variantKey } from "./storage";
import { zip, type ZipEntry } from "./zip";
import { COLLAGE_MIME, COLLAGE_QUALITY_MAX, COLLAGE_QUALITY_MIN } from "./photos/collage";
import { isAcceptedMime, thumbnailFor } from "./photos/process";
import { normalizeCollageGridMode, normalizeCollageGridShape } from "./collage-template-rules";
import { offerFileSlug } from "./offer-rules";
import {
  buildFacebookPostPhotoArchive,
  deleteVariants,
  OfferPhotoGenerationError,
  readFullBytes,
  readOfferUploadPlans,
  type OfferPhotoGenerationStatus,
  type OfferUploadPlanImage,
} from "./offer-photo-generation";
import { facebookPostLayout, readFacebookGroupSettings } from "./facebook-auctions";
import {
  arrangeFacebookLotPhoto,
  decideLotPhoto,
  lotPhotoFingerprintPayload,
  lotPhotosNotReady,
  lotPhotoSeparatorColor,
  type FacebookLotPhotoState,
  type LotPhotoCollage,
} from "./facebook-lot-photo-rules";
import { facebookLotPhotoFileName, facebookPostPhotoArchiveName, readFacebookFrozenLot } from "./facebook-post-rules";

// The photos of a captioned Facebook post (#1841; ADR-0061 §2 as amended): **one photo per lot**,
// its caption the lot's text. A lot whose upload set is one image contributes it as it is; a lot of
// several contributes them joined into one — fronts and backs as two halves of one grid with a
// separator, side by side or stacked toward the offer's collage shape. The arrangement is
// `facebook-lot-photo-rules.ts`'s; this module reads the images and draws it.
//
// **Drawn once, in the background, and stored** (#1861) — no longer on every view and every
// download, which made a post of twenty lots slow every time it was opened. `FacebookLotPhoto` is the
// queue row and the record of the stored image, as `OfferPhotoGeneration` is for the offer's own; the
// offer photo worker drains both, the offer's images first, since a lot's photo is made of them. The
// stored image is a generated `Photo` of the offer, so it counts in the collection's storage and goes
// with the closed-offer sweep (#512).
//
// Whether a stored photo is still the lot's is its fingerprint against the one of now — the images
// it is drawn from and the offer's collage shape — asked on every read, so a stale one is never
// served: it is shown as being generated and queued again. A published lot keeps the photo it went up
// with (#1800's rule for its text). Nothing is drawn while a request waits.

const DEFAULT_BACKGROUND = "#000000";
const ACTIVE_STATUSES = ["queued", "running"];

/** Raised when a captioned post's photos are downloaded before every lot's is ready (#1861): the
 *  archive is refused until it is whole, so an incomplete set is never what gets posted. */
export class FacebookLotPhotosNotReadyError extends Error {}

/** One lot's photo as the post's screen shows it (#1861). */
export interface FacebookPostLotPhoto {
  offerId: string;
  lotNo: number;
  state: FacebookLotPhotoState;
  /** What one click downloads it as — the name the post's ZIP gives it. */
  fileName: string;
}

/** The offer's collage settings and its platform's output limits, as the joined image is drawn with. */
interface LotPhotoStyle {
  collage: LotPhotoCollage;
  background: string;
  maxEdge: number | null;
  maxBytes: number | null;
}

/** Each offer's {@link LotPhotoStyle}, by offer id, in one read. */
async function readLotPhotoStyles(offerIds: readonly string[]): Promise<Map<string, LotPhotoStyle>> {
  const offers = await prisma.offer.findMany({
    where: { id: { in: [...offerIds] } },
    select: {
      id: true,
      collageGridMode: true,
      collageGridShape: true,
      collageColumns: true,
      collageGapPercent: true,
      collageBackground: true,
      platform: { select: { maxPhotoEdge: true, maxPhotoFileSizeMib: true } },
    },
  });
  return new Map(
    offers.map((offer) => [
      offer.id,
      {
        collage: {
          gridMode: normalizeCollageGridMode(offer.collageGridMode),
          gridShape: normalizeCollageGridShape(offer.collageGridShape),
          columns: offer.collageColumns ?? 1,
          gapPercent: offer.collageGapPercent ?? 0,
        },
        background: offer.collageBackground ?? DEFAULT_BACKGROUND,
        maxEdge: offer.platform?.maxPhotoEdge ?? null,
        maxBytes: offer.platform?.maxPhotoFileSizeMib != null ? offer.platform.maxPhotoFileSizeMib * 1024 * 1024 : null,
      },
    ])
  );
}

type LotPhotoSource =
  | { reason: string }
  | { slug: string; images: OfferUploadPlanImage[]; style: LotPhotoStyle; fingerprint: string };

/** What a lot's photo would be drawn from now, fingerprinted — or why there is nothing to draw. */
async function readLotPhotoSource(ownerId: string, offerId: string): Promise<LotPhotoSource> {
  const source = (await readLotPhotoSources(ownerId, [offerId])).get(offerId);
  if (!source) throw new OfferPhotoGenerationError("Offer not found or access denied.");
  return source;
}

/** {@link readLotPhotoSource} for several lots at once, by offer id (#2222): their upload plans and
 *  styles each read once for all of them. An offer that is not the owner's is absent. */
async function readLotPhotoSources(
  ownerId: string,
  offerIds: readonly string[]
): Promise<Map<string, LotPhotoSource>> {
  const sources = new Map<string, LotPhotoSource>();
  if (offerIds.length === 0) return sources;
  const [plans, styles] = await Promise.all([readOfferUploadPlans(ownerId, offerIds), readLotPhotoStyles(offerIds)]);
  for (const [offerId, { plan }] of plans) {
    const style = styles.get(offerId);
    if ("reason" in plan || !style) {
      sources.set(offerId, "reason" in plan ? plan : { reason: "Offer not found." });
      continue;
    }
    const fingerprint = createHash("sha256")
      .update(lotPhotoFingerprintPayload({ images: plan.images, ...style }))
      .digest("hex");
    sources.set(offerId, { ...plan, style, fingerprint });
  }
  return sources;
}

/** The bytes a lot's photo is: its only image as it is, or its images joined. */
async function drawLotPhoto(
  images: readonly (OfferUploadPlanImage & { bytes: Buffer })[],
  style: LotPhotoStyle
): Promise<{ mime: string; bytes: Buffer }> {
  const arrangement = arrangeFacebookLotPhoto(images, style.collage)!;
  if (arrangement.kind === "asIs") {
    const image = images[arrangement.image];
    return { mime: image.mime, bytes: image.bytes };
  }

  const layers: OverlayOptions[] = [];
  for (const placement of arrangement.placements) {
    const image = images[placement.image];
    // Decoded at the size the read model states, so a stored image of another size still sits in its
    // cell rather than spilling over the next.
    const input = await sharp(image.bytes, { failOn: "error" })
      .rotate()
      .resize(image.width, image.height, { fit: "inside" })
      .toBuffer();
    layers.push({ input, left: placement.x, top: placement.y });
  }
  if (arrangement.separator) {
    const { x, y, width, height } = arrangement.separator;
    layers.push({
      input: {
        create: { width, height, channels: 3, background: lotPhotoSeparatorColor(style.background) },
      },
      left: x,
      top: y,
    });
  }
  const canvas = await sharp({
    create: { width: arrangement.width, height: arrangement.height, channels: 3, background: style.background },
  })
    .composite(layers)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // The platform's limits, as every offer image keeps them (#308): the longest edge, then the file
  // size by stepping the quality down — the joined image is made of images already within them, so
  // a handful of steps is all it can need.
  const edge = Math.min(Math.max(canvas.info.width, canvas.info.height), style.maxEdge ?? Infinity);
  let bytes = Buffer.alloc(0);
  for (let quality = COLLAGE_QUALITY_MAX; quality >= COLLAGE_QUALITY_MIN; quality -= 10) {
    bytes = await sharp(canvas.data, {
      raw: { width: canvas.info.width, height: canvas.info.height, channels: canvas.info.channels },
    })
      .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (style.maxBytes == null || bytes.byteLength <= style.maxBytes) break;
  }
  return { mime: COLLAGE_MIME, bytes };
}

// ── Which lots want a photo, and whether theirs is current ──────────────────────────────────────

const POST_SELECT = {
  id: true,
  postNo: true,
  title: true,
  layout: true,
  groupId: true,
  collection: { select: { ownerId: true } },
  lots: {
    orderBy: { facebookLotNo: "asc" },
    select: {
      id: true,
      name: true,
      offerNo: true,
      facebookLotNo: true,
      facebookPostSnapshot: true,
      facebookLotPhoto: { select: { status: true, fingerprint: true, photoId: true, error: true } },
    },
  },
} as const;

type PostRow = NonNullable<Awaited<ReturnType<typeof readPostRow>>>;

function readPostRow(postId: string) {
  return prisma.facebookPost.findUnique({ where: { id: postId }, select: POST_SELECT });
}

/** How a post is laid out as its photos are drawn: as it was published, read off its last lot's
 *  frozen text (#1800), else as it is set now — the card's own rule. */
async function postPhotoLayout(post: Pick<PostRow, "layout" | "groupId" | "lots">) {
  const frozen = readFacebookFrozenLot(post.lots.at(-1)?.facebookPostSnapshot);
  if (frozen) return frozen.layout;
  return facebookPostLayout(
    { layout: post.layout, lotCount: post.lots.length },
    await readFacebookGroupSettings(post.groupId)
  );
}

/** Queue a lot's photo to be drawn. A run already queued or under way is left alone. */
async function enqueueLotPhoto(offerId: string): Promise<void> {
  const queued = { status: "queued", error: null, queuedAt: new Date(), startedAt: null, finishedAt: null };
  await prisma.facebookLotPhoto.upsert({
    where: { offerId },
    create: { offerId, ...queued },
    update: queued,
  });
}

/** Delete these offers' lot photos — the rows, the photo rows and then the bytes. */
async function dropLotPhotos(offerIds: readonly string[]): Promise<number> {
  if (offerIds.length === 0) return 0;
  const rows = await prisma.facebookLotPhoto.findMany({
    where: { offerId: { in: [...offerIds] } },
    select: { id: true, photo: { select: { id: true, storageBackend: true, storageKey: true, mime: true } } },
  });
  if (rows.length === 0) return 0;
  const photos = rows.flatMap((r) => (r.photo ? [r.photo] : []));
  await prisma.$transaction([
    prisma.facebookLotPhoto.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
    prisma.photo.deleteMany({ where: { id: { in: photos.map((p) => p.id) } } }),
  ]);
  // Post-commit: the files. Their rows are already gone.
  await Promise.all(photos.map((p) => deleteVariants(p.storageBackend, p.storageKey, p.mime)));
  return rows.length;
}

/**
 * Bring a post's lot photos in line with the post as it is now (#1861), and say where each stands: a
 * lot of a captioned post whose stored photo is missing or stale is queued, one in no captioned
 * post loses it, and the rest is left as it is. Every read of the photos goes through here, which is
 * what keeps a stale photo from ever being served; the writes that change what a photo is made of
 * call it too, so the photo is on its way before anyone looks. Not owner-checked: the callers have
 * done that, or are the worker. Null for a post that is gone.
 *
 * `only` brings just those lots in line and answers for them alone (#2221) — what the screen asks
 * while some lots' photos are being drawn, and after one lot's row changed — since asking what each
 * lot would be drawn from is a read of its upload plan.
 */
export async function syncFacebookPostLotPhotos(
  postId: string,
  only?: readonly string[]
): Promise<FacebookPostLotPhoto[] | null> {
  const post = await readPostRow(postId);
  if (!post) return null;
  const wanted = (await postPhotoLayout(post)) === "captions";
  const result: FacebookPostLotPhoto[] = [];
  const enqueue: string[] = [];
  const drop: string[] = [];
  const lots = [...post.lots.entries()]
    .filter(([, lot]) => !only || only.includes(lot.id))
    .map(([index, lot]) => {
      const stored = lot.facebookLotPhoto;
      const posted = readFacebookFrozenLot(lot.facebookPostSnapshot) !== null;
      // What it would be drawn from now only matters where it can change the answer — not for a lot
      // that wants no photo, one being drawn, or a published one keeping the photo it went up with.
      const settled =
        !wanted ||
        (stored !== null && ACTIVE_STATUSES.includes(stored.status)) ||
        (posted && stored?.status === "ready" && stored.photoId !== null);
      return { index, lot, stored, posted, settled };
    });
  // Every lot's source in one go (#2222), rather than a read of its upload plan each.
  const sources = await readLotPhotoSources(
    post.collection.ownerId,
    lots.filter((l) => !l.settled).map((l) => l.lot.id)
  );
  for (const { index, lot, stored, posted, settled } of lots) {
    const current = settled ? { reason: "" } : (sources.get(lot.id) ?? { reason: "Offer not found." });
    const decision = decideLotPhoto({
      wanted,
      posted,
      stored,
      current: "fingerprint" in current ? { fingerprint: current.fingerprint } : { reason: current.reason },
    });
    if (decision.action === "enqueue") enqueue.push(lot.id);
    if (decision.action === "drop") drop.push(lot.id);
    const lotNo = lot.facebookLotNo ?? index + 1;
    result.push({
      offerId: lot.id,
      lotNo,
      state: decision.state,
      fileName: facebookLotPhotoFileName(lotNo, `${offerFileSlug(lot.name, lot.offerNo)}.jpg`),
    });
  }
  for (const offerId of enqueue) await enqueueLotPhoto(offerId);
  await dropLotPhotos(drop);
  return result;
}

/**
 * Drop the lot photos of a collection's offers that are no longer a lot of any post (#1861) — taken
 * out, or left alone when their post was dissolved. A post's own lots are `syncFacebookPostLotPhotos`'
 * to keep in line; this is for the offers that have none to be synced through. Returns how many went.
 */
export async function pruneFacebookLotPhotos(collectionId: string): Promise<number> {
  const orphans = await prisma.facebookLotPhoto.findMany({
    where: { offer: { collectionId, facebookPostId: null } },
    select: { offerId: true },
  });
  return dropLotPhotos(orphans.map((o) => o.offerId));
}

/**
 * Every post of a collection brought in line (#1861), and the photos of offers in no post dropped —
 * after a change to the group settings a post may follow live, which can turn its layout to
 * captions or away from them.
 */
export async function refreshFacebookLotPhotos(collectionId: string): Promise<void> {
  await pruneFacebookLotPhotos(collectionId);
  const posts = await prisma.facebookPost.findMany({ where: { collectionId }, select: { id: true } });
  for (const post of posts) await syncFacebookPostLotPhotos(post.id);
}

/** A group's posts brought in line (#1861) — after its settings changed, which a post following them
 *  reads live. */
export async function refreshFacebookGroupLotPhotos(groupId: string): Promise<void> {
  const posts = await prisma.facebookPost.findMany({ where: { groupId }, select: { id: true } });
  for (const post of posts) await syncFacebookPostLotPhotos(post.id);
}

/** An offer's own images changed (#1861): the post it is a lot of is brought in line, or its lot
 *  photo dropped when it is a lot of none. */
export async function refreshFacebookLotPhotosForOffer(offerId: string): Promise<void> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { facebookPostId: true },
  });
  if (!offer) return;
  if (offer.facebookPostId) await syncFacebookPostLotPhotos(offer.facebookPostId);
  else await dropLotPhotos([offerId]);
}

/** The post a lot belongs to, owner-checked. */
async function readOwnedPost(ownerId: string, postId: string): Promise<PostRow> {
  const post = await readPostRow(postId);
  if (!post || post.collection.ownerId !== ownerId) throw new OfferPhotoGenerationError("Post not found.");
  return post;
}

/** A captioned post's lot photos as its screen shows them (#1861), owner-checked — brought in line
 *  first, so what is shown is never stale. Empty for a post laid out in its text. `only` answers for
 *  those lots alone (#2221). */
export async function readFacebookPostLotPhotos(
  ownerId: string,
  postId: string,
  only?: readonly string[]
): Promise<FacebookPostLotPhoto[]> {
  const post = await readOwnedPost(ownerId, postId);
  const lots = (await syncFacebookPostLotPhotos(postId, only)) ?? [];
  return (await postPhotoLayout(post)) === "captions" ? lots : [];
}

/** One lot's photos in a post laid out as text (#1848): its upload set, the very files the post's ZIP
 *  carries — empty while it has none — and where its own photo run stands. */
export interface FacebookTextLotPhotos {
  offerId: string;
  status: OfferPhotoGenerationStatus;
  images: { photoId: string; fileName: string }[];
}

/** What a post's screen shows of its lots' photos (#2222), in lot order, read with the post: a
 *  captioned post's one photo per lot (#1861), or each lot's upload set in a post laid out as text. */
export type FacebookPostPhotos =
  | { layout: "captions"; lots: FacebookPostLotPhoto[] }
  | { layout: "text"; lots: FacebookTextLotPhotos[] };

/**
 * Every lot's photos as the post's screen shows them (#2222), owner-checked, in a few reads whatever
 * the number of lots — the captioned photos brought in line first, as
 * {@link readFacebookPostLotPhotos} does. `only` answers for those lots alone: what the screen asks
 * after while their photos are being drawn.
 */
export async function readFacebookPostPhotos(
  ownerId: string,
  postId: string,
  only?: readonly string[]
): Promise<FacebookPostPhotos> {
  const post = await readOwnedPost(ownerId, postId);
  const captioned = (await syncFacebookPostLotPhotos(postId, only)) ?? [];
  if ((await postPhotoLayout(post)) === "captions") return { layout: "captions", lots: captioned };
  const offerIds = post.lots.map((lot) => lot.id).filter((id) => !only || only.includes(id));
  const plans = await readOfferUploadPlans(ownerId, offerIds);
  return {
    layout: "text",
    lots: offerIds.flatMap((offerId) => {
      const read = plans.get(offerId);
      if (!read) return [];
      const images = "reason" in read.plan ? [] : read.plan.images;
      return [
        {
          offerId,
          status: read.status,
          images: images.map((image) => ({ photoId: image.photoId, fileName: image.fileName })),
        },
      ];
    }),
  };
}

/**
 * A post's photos as one ZIP, in lot order (#1544, #1841). A captioned post gives **one photo per
 * lot**, its stored photo (#1861), named `lot-01-<offer>.jpg`…; a post laid out in its text gives
 * every lot's upload set as before (`buildFacebookPostPhotoArchive`). A lot with nothing to upload is
 * left out; the archive is refused when no lot has anything, and while any lot's photo is still being
 * generated or failed, so an incomplete set is never what gets posted.
 */
export async function buildFacebookPostPhotos(
  ownerId: string,
  postId: string
): Promise<{ fileName: string; bytes: Buffer }> {
  const post = await readOwnedPost(ownerId, postId);
  if ((await postPhotoLayout(post)) !== "captions") return buildFacebookPostPhotoArchive(ownerId, postId);
  const lots = (await syncFacebookPostLotPhotos(postId)) ?? [];
  const notReady = lotPhotosNotReady(lots);
  if (notReady) throw new FacebookLotPhotosNotReadyError(notReady);

  const ready = lots.flatMap((lot) => (lot.state.status === "ready" ? [{ ...lot, photoId: lot.state.photoId }] : []));
  const photos = await prisma.photo.findMany({
    where: { id: { in: ready.map((lot) => lot.photoId) } },
    select: { id: true, storageBackend: true, storageKey: true, mime: true },
  });
  const byId = new Map(photos.map((p) => [p.id, p]));
  const entries: ZipEntry[] = [];
  for (const lot of ready) {
    const photo = byId.get(lot.photoId);
    if (!photo) continue;
    // `delivery` (#591): the collector's download, not work the server is about to repeat.
    entries.push({ name: lot.fileName, contents: await readFullBytes(photo, "delivery") });
  }
  if (entries.length === 0) {
    throw new OfferPhotoGenerationError("None of this post's lots has images to upload — generate them first.");
  }
  return { fileName: facebookPostPhotoArchiveName(post.postNo, post.title), bytes: zip(entries) };
}

// ── The queue ───────────────────────────────────────────────────────────────────────────────────

/**
 * Claim the oldest queued lot photo, or null when none waits. A conditional update, as the offer
 * photo queue's claim. `only` narrows it to one offer, for tests sharing one database.
 */
export async function claimNextFacebookLotPhoto(only?: { offerId: string }): Promise<string | null> {
  const next = await prisma.facebookLotPhoto.findFirst({
    where: { status: "queued", ...(only ? { offerId: only.offerId } : {}) },
    orderBy: { queuedAt: "asc" },
    select: { id: true, offerId: true },
  });
  if (!next) return null;
  const { count } = await prisma.facebookLotPhoto.updateMany({
    where: { id: next.id, status: "queued" },
    data: { status: "running", startedAt: new Date(), error: null },
  });
  return count === 1 ? next.offerId : null;
}

/** Requeue lot photos left `running` by a process that went away. Called once at boot; drawing one
 *  replaces it whole, so running it again is always safe. */
export async function requeueStalledFacebookLotPhotos(only?: { offerId: string }): Promise<number> {
  const { count } = await prisma.facebookLotPhoto.updateMany({
    where: { status: "running", ...(only ? { offerId: only.offerId } : {}) },
    data: { status: "queued", startedAt: null },
  });
  return count;
}

/** Record a failed run on its row — with what it tried to draw, when that was read, so the same
 *  failure is not queued again until it changes. Never throws. */
export async function failFacebookLotPhoto(offerId: string, err: unknown, fingerprint?: string): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await prisma.facebookLotPhoto
    .update({
      where: { offerId },
      data: {
        status: "failed",
        error: message.slice(0, 500),
        finishedAt: new Date(),
        ...(fingerprint ? { fingerprint } : {}),
      },
    })
    .catch(() => {});
}

/**
 * Draw a lot's photo and store it in place of the one it had (#1861). Runs in the worker, so it takes
 * no `ownerId`: the row it claimed is authorization enough. The new image is written before the old
 * one goes, so a failure leaves the previous photo where it was; a failure is recorded on the row.
 */
export async function runFacebookLotPhoto(offerId: string): Promise<void> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!offer) return; // Deleted since it was queued; its row went with it.

  const source = await readLotPhotoSource(offer.collection.ownerId, offerId);
  if ("reason" in source) {
    await failFacebookLotPhoto(offerId, new OfferPhotoGenerationError(source.reason));
    return;
  }

  const photoId = randomUUID();
  const prefix = permanentPrefix(offer.collectionId, photoId);
  const storage = getActiveStorage();
  let writtenMime: string | null = null;
  try {
    const rows = await prisma.photo.findMany({
      where: { id: { in: source.images.map((image) => image.photoId) } },
      select: { id: true, storageBackend: true, storageKey: true, mime: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const images = await Promise.all(
      source.images.map(async (image) => {
        const row = byId.get(image.photoId);
        if (!row) throw new OfferPhotoGenerationError("The offer's images changed while its lot photo was drawn.");
        // `work` (#591): read to be composed, as the offer's own run reads its sources.
        return { ...image, bytes: await readFullBytes(row, "work") };
      })
    );
    const drawn = await drawLotPhoto(images, source.style);
    const meta = await sharp(drawn.bytes).metadata();
    const thumbMime = isAcceptedMime(drawn.mime) ? drawn.mime : COLLAGE_MIME;
    const thumb = await thumbnailFor(drawn.bytes, thumbMime);
    writtenMime = drawn.mime;
    // `delivery` on both (#591): output, read only to be shown or posted.
    await storage.put(variantKey(prefix, "full", drawn.mime), drawn.bytes, drawn.mime, "delivery");
    await storage.put(variantKey(prefix, "thumb", drawn.mime), thumb.buffer, drawn.mime, "delivery");

    const previous = await prisma.facebookLotPhoto.findUnique({
      where: { offerId },
      select: { photo: { select: { id: true, storageBackend: true, storageKey: true, mime: true } } },
    });
    await prisma.$transaction(async (tx) => {
      await tx.photo.create({
        data: {
          id: photoId,
          offerId,
          kind: "generated",
          role: null,
          storageBackend: storage.backend,
          storageKey: prefix,
          mime: drawn.mime,
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          sizeBytes: drawn.bytes.byteLength,
        },
      });
      // Throws when the row was dropped meanwhile — the lot left its post — which undoes the photo.
      await tx.facebookLotPhoto.update({
        where: { offerId },
        data: {
          status: "ready",
          fingerprint: source.fingerprint,
          photoId,
          error: null,
          finishedAt: new Date(),
        },
      });
      if (previous?.photo) await tx.photo.delete({ where: { id: previous.photo.id } });
    });
    if (previous?.photo) {
      const old = previous.photo;
      await deleteVariants(old.storageBackend, old.storageKey, old.mime);
    }
  } catch (err) {
    if (writtenMime) await deleteVariants(storage.backend, prefix, writtenMime);
    await failFacebookLotPhoto(offerId, err, source.fingerprint);
    throw err;
  }
}
