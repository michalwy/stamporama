import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { getOfferPhotoPlanState } from "./offer-photo-generation";
import { MAX_COLLAGE_AXIS, MIN_COLLAGE_AXIS } from "./collage-template-rules";
import {
  getStorage,
  permanentPrefix,
  variantKey,
  type PhotoVariant,
} from "./storage";

/**
 * Manual photo attachments on an offer (#313) — the server side of the plan entries a collector adds
 * by hand, as opposed to the collages a rule produces (#309).
 *
 * Three modes, one row
 * --------------------
 * - `copy_photo` — a **specific** photo of a copy already in the offer: its front, its back, or one
 *   of its extras. The point is showing one detail on its own (a perforation, a flaw, a cancel), so
 *   the choice is per photo and not per copy. Its tile annotation resolves from that copy as usual.
 * - `upload` — an arbitrary image uploaded to the offer itself, promoted from the owner-agnostic
 *   `PhotoUpload` staging (#112) into an offer-owned `Photo` with `kind = original`. It has no copy,
 *   so inventory tokens resolve empty and only the literal text of the label template renders.
 * - `manual_collage` (#331) — several chosen photos, of either kind and mixed freely, composited into
 *   **one** image at a column count the collector picks. This is the grouping the automatic rules
 *   cannot produce: they group by set composition (#309), and sometimes what the listing wants to
 *   show is a selection that cuts across that. Its images are `OfferPhotoAttachmentTile` rows and
 *   its own `photoId` is null.
 *
 * None is passed through unlabelled: the generator renders all three through the same collage path,
 * with the same label strip as every other tile (#310, #312). The first two are simply that path
 * with one tile — which is why the third needed no new plan concept, only more tiles and a width.
 *
 * Positions
 * ---------
 * A new attachment lands at the **end** of the plan (`sortOrder` past the last planned image, which
 * the engine clamps); from there it is dragged. Reordering, though, is not per attachment: the
 * collector drags the *whole* plan — collages and attachments together — so the order is stored on
 * the offer as a token list (`setOfferPhotoPlanOrder`), and an attachment's `sortOrder` only decides
 * where it sits **before** any manual reorder names it.
 *
 * Ownership of bytes
 * ------------------
 * A `copy_photo` attachment only *points at* a copy's scan — the copy owns those bytes and nothing
 * here may delete them. An `upload` attachment's photo exists for the attachment alone, so removing
 * the attachment deletes the row and its bytes; Prisma's cascade drops rows, never files, exactly as
 * in `photos.ts`. A `manual_collage`'s tiles follow the same rule one by one, which is why each tile
 * records which kind it is.
 */

export class OfferPhotoAttachmentError extends Error {}

export type OfferPhotoAttachmentSource = "copy_photo" | "upload" | "manual_collage";

/** What the card shows for one attachment. */
export interface OfferPhotoAttachmentRow {
  id: string;
  sortOrder: number;
  source: OfferPhotoAttachmentSource;
  /** Null for a `manual_collage` (#331), whose images are its tiles. */
  photoId: string | null;
  itemId: string | null;
  /** A manual collage's width in tiles (#331); null for the single-image modes. */
  collageColumns: number | null;
  title: string | null;
}

// ── Authorization ────────────────────────────────────────────────────────────

async function assertOfferOwner(ownerId: string, offerId: string): Promise<string> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!offer || offer.collection.ownerId !== ownerId) {
    throw new OfferPhotoAttachmentError("Offer not found or access denied.");
  }
  return offer.collectionId;
}

function toRow(row: {
  id: string;
  sortOrder: number;
  source: string;
  photoId: string | null;
  itemId: string | null;
  collageColumns: number | null;
  title: string | null;
}): OfferPhotoAttachmentRow {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    source:
      row.source === "upload"
        ? "upload"
        : row.source === "manual_collage"
          ? "manual_collage"
          : "copy_photo",
    photoId: row.photoId,
    itemId: row.itemId,
    collageColumns: row.collageColumns,
    title: row.title,
  };
}

const ATTACHMENT_SELECT = {
  id: true,
  sortOrder: true,
  source: true,
  photoId: true,
  itemId: true,
  collageColumns: true,
  title: true,
} as const;

// ── Read ─────────────────────────────────────────────────────────────────────

/** An offer's attachments in plan order. Owner-checked. */
export async function listOfferPhotoAttachments(
  ownerId: string,
  offerId: string
): Promise<OfferPhotoAttachmentRow[]> {
  await assertOfferOwner(ownerId, offerId);
  const rows = await prisma.offerPhotoAttachment.findMany({
    where: { offerId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: ATTACHMENT_SELECT,
  });
  return rows.map(toRow);
}

/**
 * Where a new attachment lands: after everything the offer currently plans — the generated groups
 * included, which is why this asks the plan rather than counting attachments. Anything past the end
 * clamps there anyway, so being exact only matters for reading well; from there it is dragged.
 */
async function nextPosition(ownerId: string, offerId: string): Promise<number> {
  const state = await getOfferPhotoPlanState(ownerId, offerId);
  return state.plan.imageCount;
}

// ── Attach ───────────────────────────────────────────────────────────────────

/** One copy-photo attachment to add: a photo of a copy in the offer. */
export interface CopyPhotoAttachmentInput {
  itemId: string;
  photoId: string;
  title?: string | null;
}

/**
 * Every pick really is a photo of a copy this offer holds. Checked **before** anything is written,
 * so a bad pick fails the whole batch rather than half-attaching.
 *
 * @throws {OfferPhotoAttachmentError} when a copy is not in any of the offer's sets, or when a photo
 * is not that copy's — a photo of a copy the listing does not hold would show a stamp the buyer is
 * not being sold.
 */
async function assertCopyPhotos(
  offerId: string,
  picks: readonly { itemId: string; photoId: string }[]
): Promise<void> {
  for (const pick of picks) {
    const membership = await prisma.offerSetItem.findFirst({
      where: { itemId: pick.itemId, offerSet: { offerId } },
      select: { itemId: true },
    });
    if (!membership) {
      throw new OfferPhotoAttachmentError("That copy is not in this offer.");
    }
    const photo = await prisma.photo.findFirst({
      where: { id: pick.photoId, itemId: pick.itemId },
      select: { id: true },
    });
    if (!photo) {
      throw new OfferPhotoAttachmentError("That photo does not belong to the chosen copy.");
    }
  }
}

/**
 * Attach one or more specific photos of copies in this offer (#313 mode a). A batch, because the
 * dialog lets the collector pick several at once; they land in the order given, at the end of the
 * plan, and are dragged from there.
 *
 * Every item is validated **before** anything is written, so a bad pick fails the whole batch rather
 * than half-attaching.
 *
 * @throws {OfferPhotoAttachmentError} when the offer is not the caller's, when a copy is not in any
 * of the offer's sets, or when a photo is not that copy's — a photo of a copy the listing does not
 * hold would show a stamp the buyer is not being sold.
 */
export async function attachOfferCopyPhotos(
  ownerId: string,
  offerId: string,
  inputs: readonly CopyPhotoAttachmentInput[]
): Promise<OfferPhotoAttachmentRow[]> {
  await assertOfferOwner(ownerId, offerId);
  if (inputs.length === 0) return [];

  await assertCopyPhotos(offerId, inputs);

  const base = await nextPosition(ownerId, offerId);
  const created = await prisma.$transaction(
    inputs.map((input, index) =>
      prisma.offerPhotoAttachment.create({
        data: {
          offerId,
          sortOrder: base + index,
          source: "copy_photo",
          photoId: input.photoId,
          itemId: input.itemId,
          title: input.title?.trim() || null,
        },
        select: ATTACHMENT_SELECT,
      })
    )
  );
  return created.map(toRow);
}

/** {@link attachOfferCopyPhotos} for a single photo. */
export async function attachOfferCopyPhoto(
  ownerId: string,
  offerId: string,
  input: CopyPhotoAttachmentInput
): Promise<OfferPhotoAttachmentRow> {
  const [row] = await attachOfferCopyPhotos(ownerId, offerId, [input]);
  return row;
}

/** One uploaded image to attach: a staged upload id (#112) and an optional caption. */
export interface UploadAttachmentInput {
  uploadId: string;
  title?: string | null;
}

/**
 * Attach one or more images uploaded straight to the offer (#313 mode b): promote each staged upload
 * (#112) into an offer-owned `Photo` with `kind = original`, then point an attachment at it. A batch,
 * because the dialog lets the collector drop several files at once; they land in the order given, at
 * the end of the plan.
 *
 * Every upload's bytes are moved to their permanent key **before** the rows are written, as
 * everywhere else, so a committed row always references existing bytes; the staging rows are consumed
 * in the same transaction. A failure anywhere best-effort deletes every moved file so nothing
 * dangles, and the whole batch rolls back rather than half-attaching.
 *
 * @throws {OfferPhotoAttachmentError} when an upload is unknown, expired, or belongs to another
 * collection.
 */
export async function attachOfferUploads(
  ownerId: string,
  offerId: string,
  inputs: readonly UploadAttachmentInput[]
): Promise<OfferPhotoAttachmentRow[]> {
  const collectionId = await assertOfferOwner(ownerId, offerId);
  if (inputs.length === 0) return [];

  const prepared = await stageUploads(collectionId, inputs.map((i) => i.uploadId));
  try {
    const base = await nextPosition(ownerId, offerId);
    return await prisma.$transaction(async (tx) => {
      const rows: OfferPhotoAttachmentRow[] = [];
      for (const [index, p] of prepared.entries()) {
        const title = inputs[index].title?.trim() || null;
        await tx.photo.create({ data: photoDataFor(p, offerId, title) });
        const created = await tx.offerPhotoAttachment.create({
          data: {
            offerId,
            sortOrder: base + index,
            source: "upload",
            photoId: p.photoId,
            itemId: null,
            title,
          },
          select: ATTACHMENT_SELECT,
        });
        rows.push(toRow(created));
      }
      await tx.photoUpload.deleteMany({ where: { id: { in: prepared.map((p) => p.uploadId) } } });
      return rows;
    });
  } catch (err) {
    await discardStagedUploads(prepared);
    throw err;
  }
}

/** A staged upload whose bytes already sit at their permanent key, waiting for its `Photo` row. */
interface StagedUpload {
  uploadId: string;
  photoId: string;
  storageBackend: string;
  storageKey: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/**
 * Validate a batch of staged uploads (#112) and move their bytes to fresh permanent keys, so a row
 * written afterwards always references bytes that exist. A failure part-way cleans up whatever it
 * already moved, because those files are then nobody's.
 *
 * The caller writes the rows and, if that fails, calls {@link discardStagedUploads}.
 *
 * @throws {OfferPhotoAttachmentError} when an upload is unknown, expired, or belongs to another
 * collection.
 */
async function stageUploads(
  collectionId: string,
  uploadIds: readonly string[]
): Promise<StagedUpload[]> {
  const uploads = await prisma.photoUpload.findMany({
    where: { id: { in: [...uploadIds] }, collectionId },
  });
  const uploadById = new Map(uploads.map((u) => [u.id, u]));
  for (const uploadId of uploadIds) {
    if (!uploadById.has(uploadId)) {
      throw new OfferPhotoAttachmentError("Staged upload not found or expired.");
    }
  }

  const staged: StagedUpload[] = [];
  try {
    for (const uploadId of uploadIds) {
      const upload = uploadById.get(uploadId)!;
      const photoId = randomUUID();
      const toPrefix = permanentPrefix(collectionId, photoId);
      const storage = getStorage(upload.storageBackend);
      for (const variant of ["full", "thumb"] as PhotoVariant[]) {
        await storage.move(
          variantKey(upload.storageKey, variant, upload.mime),
          variantKey(toPrefix, variant, upload.mime)
        );
      }
      staged.push({
        uploadId,
        photoId,
        storageBackend: upload.storageBackend,
        storageKey: toPrefix,
        mime: upload.mime,
        width: upload.width,
        height: upload.height,
        sizeBytes: upload.sizeBytes,
      });
    }
  } catch (err) {
    await discardStagedUploads(staged);
    throw err;
  }
  return staged;
}

/** The rows never landed, so every moved file is nobody's. Best-effort, same as every other cleanup
 * path: an orphan file is the failure we tolerate least, so we try. */
async function discardStagedUploads(staged: readonly StagedUpload[]): Promise<void> {
  await Promise.all(staged.map((s) => deleteVariants(s.storageBackend, s.storageKey, s.mime)));
}

/** The offer-owned `Photo` row a staged upload becomes: an `original`, because it is a real image of
 * something, not one of ours. */
function photoDataFor(staged: StagedUpload, offerId: string, title: string | null) {
  return {
    id: staged.photoId,
    offerId,
    kind: "original",
    // Offer-owned images take their order from the plan, never from a role slot.
    role: null,
    title,
    storageBackend: staged.storageBackend,
    storageKey: staged.storageKey,
    mime: staged.mime,
    width: staged.width,
    height: staged.height,
    sizeBytes: staged.sizeBytes,
    sortOrder: 0,
  };
}

// ── Manual collage (#331) ────────────────────────────────────────────────────

/** One tile of a manual collage: a photo of a copy in the offer, or an image being uploaded with it.
 * The two are mixed freely — the point of composing by hand is that the selection need not follow
 * anything the automatic grouping knows about. */
export type CollageTileInput =
  | { kind: "copy_photo"; itemId: string; photoId: string }
  | { kind: "upload"; uploadId: string };

export interface CollageAttachmentInput {
  /** The tiles in the order they are laid out — left to right, row by row. */
  tiles: readonly CollageTileInput[];
  /** How many tiles per row. Rows follow from this and the tile count. */
  columns: number;
  title?: string | null;
}

/**
 * Attach one collage the collector composed by hand (#331): the photos they picked, in the order
 * they picked them, at the width they chose. It lands at the end of the plan like any other
 * attachment and is dragged from there.
 *
 * It is one attachment, not many — that is the whole request. The offer's own collage numbers (#308)
 * still supply everything else the renderer needs (gap, background, label strip), so a hand-composed
 * collage sits among the derived ones instead of looking like a foreign object; only *which* stamps
 * share the image, and how wide it is, are taken out of the rules' hands.
 *
 * Copy picks are validated and uploads are moved into place **before** any row is written, so a bad
 * pick or a failed move leaves nothing behind.
 *
 * @throws {OfferPhotoAttachmentError} when the offer is not the caller's, when there are no tiles,
 * when a pick is not a photo of a copy in this offer, or when a staged upload is unknown or expired.
 */
export async function attachOfferPhotoCollage(
  ownerId: string,
  offerId: string,
  input: CollageAttachmentInput
): Promise<OfferPhotoAttachmentRow> {
  const collectionId = await assertOfferOwner(ownerId, offerId);
  if (input.tiles.length === 0) {
    throw new OfferPhotoAttachmentError("A collage needs at least one photo.");
  }
  const columns = Math.max(
    MIN_COLLAGE_AXIS,
    Math.min(MAX_COLLAGE_AXIS, Math.trunc(input.columns) || MIN_COLLAGE_AXIS)
  );

  await assertCopyPhotos(
    offerId,
    input.tiles.flatMap((tile) => (tile.kind === "copy_photo" ? [tile] : []))
  );

  const uploadIds = input.tiles.flatMap((tile) => (tile.kind === "upload" ? [tile.uploadId] : []));
  const staged = await stageUploads(collectionId, uploadIds);
  const stagedByUploadId = new Map(staged.map((s) => [s.uploadId, s]));

  try {
    const position = await nextPosition(ownerId, offerId);
    const title = input.title?.trim() || null;
    return await prisma.$transaction(async (tx) => {
      for (const s of staged) {
        // The collage's uploaded tiles are offer-owned originals, exactly as a single uploaded
        // attachment's image is — they belong to this attachment and go when it does.
        await tx.photo.create({ data: photoDataFor(s, offerId, title) });
      }
      const created = await tx.offerPhotoAttachment.create({
        data: {
          offerId,
          sortOrder: position,
          source: "manual_collage",
          photoId: null,
          itemId: null,
          collageColumns: columns,
          title,
          tiles: {
            create: input.tiles.map((tile, index) =>
              tile.kind === "copy_photo"
                ? {
                    sortOrder: index,
                    source: "copy_photo",
                    photoId: tile.photoId,
                    itemId: tile.itemId,
                  }
                : {
                    sortOrder: index,
                    source: "upload",
                    photoId: stagedByUploadId.get(tile.uploadId)!.photoId,
                    itemId: null,
                  }
            ),
          },
        },
        select: ATTACHMENT_SELECT,
      });
      if (uploadIds.length > 0) {
        await tx.photoUpload.deleteMany({ where: { id: { in: uploadIds } } });
      }
      return toRow(created);
    });
  } catch (err) {
    await discardStagedUploads(staged);
    throw err;
  }
}

/** {@link attachOfferUploads} for a single image. */
export async function attachOfferUpload(
  ownerId: string,
  offerId: string,
  uploadId: string,
  title?: string | null
): Promise<OfferPhotoAttachmentRow> {
  const [row] = await attachOfferUploads(ownerId, offerId, [{ uploadId, title }]);
  return row;
}

// ── Mutate ───────────────────────────────────────────────────────────────────

/** Rename an attachment. The title is the collector's caption in the plan; it is never drawn on the
 * image, whose annotation comes from the offer's label templates (#312). */
export async function renameOfferPhotoAttachment(
  ownerId: string,
  attachmentId: string,
  title: string | null
): Promise<void> {
  const attachment = await readOwnedAttachment(ownerId, attachmentId);
  await prisma.offerPhotoAttachment.update({
    where: { id: attachment.id },
    data: { title: title?.trim() || null },
  });
}

/**
 * Remove an attachment. An `upload`'s photo exists only for it, so the row and its bytes go too; a
 * `copy_photo` only ever pointed at the copy's own scan and leaves it alone. A `manual_collage` (#331) is
 * the same rule read tile by tile: its uploaded tiles go with it, its copy-photo tiles do not.
 *
 * Images already generated from the attachment are untouched — they are separate `Photo` rows the
 * collector may have uploaded to a platform already. The plan simply stops planning it, which the
 * fingerprint reports as out of date.
 */
export async function removeOfferPhotoAttachment(
  ownerId: string,
  attachmentId: string
): Promise<void> {
  const attachment = await readOwnedAttachment(ownerId, attachmentId);

  // Which photo ids this attachment owns outright: its own, when it is an upload, plus every
  // uploaded tile of a collage. Scoped to the offer as well, so nothing outside it can be caught.
  const ownedIds = [
    ...(attachment.source === "upload" && attachment.photoId ? [attachment.photoId] : []),
    ...attachment.tiles.flatMap((tile) => (tile.source === "upload" ? [tile.photoId] : [])),
  ];
  const ownPhotos =
    ownedIds.length > 0
      ? await prisma.photo.findMany({
          where: { id: { in: ownedIds }, offerId: attachment.offerId },
          select: { id: true, storageBackend: true, storageKey: true, mime: true },
        })
      : [];

  await prisma.$transaction(async (tx) => {
    // Its tiles cascade with it; the row is deleted first all the same, so nothing depends on the
    // order the cascades happen to run in.
    await tx.offerPhotoAttachment.delete({ where: { id: attachment.id } });
    // Deleting the photo would cascade the attachment away anyway; both are written explicitly so
    // the order of operations does not depend on the cascade.
    if (ownPhotos.length > 0) {
      await tx.photo.deleteMany({ where: { id: { in: ownPhotos.map((p) => p.id) } } });
    }
  });

  await Promise.all(
    ownPhotos.map((photo) => deleteVariants(photo.storageBackend, photo.storageKey, photo.mime))
  );
}

/**
 * Record the collector's manual **plan order** (#313): the image tokens — collage sides and
 * attachments alike — in the sequence the card shows, stored verbatim on the offer. It is an
 * override of the derived order, so it is stored as given and reconciled at read time (a token the
 * offer no longer contains is simply ignored, an image not named keeps its natural position); there
 * is nothing to validate against the current composition, which is the whole point of letting it
 * survive one.
 *
 * The order is then **applied to the images already stored**: their entries are renumbered into it,
 * so the stored list, the upload numbering and the ZIP all follow one sequence. Only `sortOrder`
 * moves — no bytes, no ids — which is why a reorder is not a reason to regenerate, and why the same
 * drag works from either list.
 *
 * Passing an empty list clears the override, returning the plan to its derived order; the stored
 * entries are renumbered into that too.
 */
export async function setOfferPhotoPlanOrder(
  ownerId: string,
  offerId: string,
  tokens: readonly string[]
): Promise<void> {
  await assertOfferOwner(ownerId, offerId);
  // De-duplicate defensively, keeping first occurrence: a token appearing twice would give one image
  // two ranks. The card never sends duplicates, but the store should not depend on that.
  const seen = new Set<string>();
  const order = tokens.filter((token) => (seen.has(token) ? false : (seen.add(token), true)));
  await prisma.offer.update({ where: { id: offerId }, data: { photoPlanOrder: order } });
  await renumberStoredEntries(ownerId, offerId);
}

/**
 * Mark one plan image **do not publish**, or publish it again (#313). Keyed by token like the order,
 * because a generated collage has no row of its own — and unlike a manual attachment it cannot
 * simply be removed, which is exactly why it needs this.
 *
 * Nothing is deleted and nothing needs re-rendering: the image is still generated and still
 * downloadable on its own. It only leaves the upload set, which frees its slot under the platform's
 * photo limit — so hiding one can bring another image back under it. That shuffle is why the stored
 * entries are renumbered afterwards.
 */
export async function setOfferPhotoPublish(
  ownerId: string,
  offerId: string,
  token: string,
  publish: boolean
): Promise<void> {
  await assertOfferOwner(ownerId, offerId);
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { photoPlanUnpublished: true },
  });
  if (!offer) throw new OfferPhotoAttachmentError("Offer not found.");

  const current = new Set(offer.photoPlanUnpublished);
  if (publish) current.delete(token);
  else current.add(token);

  await prisma.offer.update({
    where: { id: offerId },
    data: { photoPlanUnpublished: [...current] },
  });
  await renumberStoredEntries(ownerId, offerId);
}

/**
 * Renumber the offer's stored entries into the plan's current order. The plan is the authority on
 * sequence; the entries only record where each stored file sits in it, so this is a pure
 * `sortOrder` rewrite.
 *
 * A stored image the plan no longer holds — its set sold, its attachment removed — keeps its
 * relative place at the end rather than being deleted or renumbered to the front: it is still a file
 * the collector may have uploaded, and the staleness signal is what speaks about it.
 */
async function renumberStoredEntries(ownerId: string, offerId: string): Promise<void> {
  const state = await getOfferPhotoPlanState(ownerId, offerId);
  if (state.images.length === 0) return;

  const rank = new Map(state.plan.images.map((image, index) => [image.token, index] as const));
  const positioned = state.images.map((image, index) => ({
    photoId: image.photoId,
    // Unplanned images sort after every planned one, keeping the order they already had.
    rank: image.token != null && rank.has(image.token) ? rank.get(image.token)! : Infinity,
    index,
  }));
  positioned.sort((a, b) => a.rank - b.rank || a.index - b.index);

  await prisma.$transaction(
    positioned.map((entry, sortOrder) =>
      prisma.offerPhotoEntry.update({ where: { photoId: entry.photoId }, data: { sortOrder } })
    )
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readOwnedAttachment(ownerId: string, attachmentId: string) {
  const attachment = await prisma.offerPhotoAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      offerId: true,
      source: true,
      photoId: true,
      tiles: { select: { source: true, photoId: true } },
      offer: { select: { collection: { select: { ownerId: true } } } },
    },
  });
  if (!attachment || attachment.offer.collection.ownerId !== ownerId) {
    throw new OfferPhotoAttachmentError("Attachment not found or access denied.");
  }
  return attachment;
}

/** Delete both stored variants under a photo prefix, best-effort — byte cleanup never fails a
 * caller (same contract as `photos.ts`). */
async function deleteVariants(backend: string, storageKey: string, mime: string): Promise<void> {
  const storage = getStorage(backend);
  await Promise.all(
    (["full", "thumb"] as PhotoVariant[]).map((v) =>
      storage.delete(variantKey(storageKey, v, mime)).catch(() => {})
    )
  );
}
