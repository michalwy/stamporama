import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { getOfferPhotoPlanState } from "./offer-photo-generation";
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
 * Two modes, one row
 * ------------------
 * - `copy_photo` — a **specific** photo of a copy already in the offer: its front, its back, or one
 *   of its extras. The point is showing one detail on its own (a perforation, a flaw, a cancel), so
 *   the choice is per photo and not per copy. Its tile annotation resolves from that copy as usual.
 * - `upload` — an arbitrary image uploaded to the offer itself, promoted from the owner-agnostic
 *   `PhotoUpload` staging (#112) into an offer-owned `Photo` with `kind = original`. It has no copy,
 *   so inventory tokens resolve empty and only the literal text of the label template renders.
 *
 * Neither is passed through unlabelled: the generator renders both as a one-tile collage with the
 * same label strip as every other tile (#312).
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
 * in `photos.ts`.
 */

export class OfferPhotoAttachmentError extends Error {}

/** What the card shows for one attachment. */
export interface OfferPhotoAttachmentRow {
  id: string;
  sortOrder: number;
  source: "copy_photo" | "upload";
  photoId: string;
  itemId: string | null;
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
  photoId: string;
  itemId: string | null;
  title: string | null;
}): OfferPhotoAttachmentRow {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    source: row.source === "upload" ? "upload" : "copy_photo",
    photoId: row.photoId,
    itemId: row.itemId,
    title: row.title,
  };
}

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
    select: { id: true, sortOrder: true, source: true, photoId: true, itemId: true, title: true },
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

  for (const input of inputs) {
    const membership = await prisma.offerSetItem.findFirst({
      where: { itemId: input.itemId, offerSet: { offerId } },
      select: { itemId: true },
    });
    if (!membership) {
      throw new OfferPhotoAttachmentError("That copy is not in this offer.");
    }
    const photo = await prisma.photo.findFirst({
      where: { id: input.photoId, itemId: input.itemId },
      select: { id: true },
    });
    if (!photo) {
      throw new OfferPhotoAttachmentError("That photo does not belong to the chosen copy.");
    }
  }

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
        select: { id: true, sortOrder: true, source: true, photoId: true, itemId: true, title: true },
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

  const uploads = await prisma.photoUpload.findMany({
    where: { id: { in: inputs.map((i) => i.uploadId) }, collectionId },
  });
  const uploadById = new Map(uploads.map((u) => [u.id, u]));
  for (const input of inputs) {
    if (!uploadById.has(input.uploadId)) {
      throw new OfferPhotoAttachmentError("Staged upload not found or expired.");
    }
  }

  // Move each upload's bytes to a fresh permanent prefix, remembering enough to write the rows and to
  // clean up if any later step throws.
  const prepared = inputs.map((input) => {
    const upload = uploadById.get(input.uploadId)!;
    const photoId = randomUUID();
    return { input, upload, photoId, toPrefix: permanentPrefix(collectionId, photoId) };
  });

  const moved: { backend: string; prefix: string; mime: string }[] = [];
  try {
    for (const p of prepared) {
      const storage = getStorage(p.upload.storageBackend);
      for (const variant of ["full", "thumb"] as PhotoVariant[]) {
        await storage.move(
          variantKey(p.upload.storageKey, variant, p.upload.mime),
          variantKey(p.toPrefix, variant, p.upload.mime)
        );
      }
      moved.push({ backend: p.upload.storageBackend, prefix: p.toPrefix, mime: p.upload.mime });
    }

    const base = await nextPosition(ownerId, offerId);
    return await prisma.$transaction(async (tx) => {
      const rows: OfferPhotoAttachmentRow[] = [];
      for (const [index, p] of prepared.entries()) {
        const title = p.input.title?.trim() || null;
        await tx.photo.create({
          data: {
            id: p.photoId,
            offerId,
            kind: "original",
            // Offer-owned images take their order from the plan, never from a role slot.
            role: null,
            title,
            storageBackend: p.upload.storageBackend,
            storageKey: p.toPrefix,
            mime: p.upload.mime,
            width: p.upload.width,
            height: p.upload.height,
            sizeBytes: p.upload.sizeBytes,
            sortOrder: 0,
          },
        });
        const created = await tx.offerPhotoAttachment.create({
          data: {
            offerId,
            sortOrder: base + index,
            source: "upload",
            photoId: p.photoId,
            itemId: null,
            title,
          },
          select: {
            id: true,
            sortOrder: true,
            source: true,
            photoId: true,
            itemId: true,
            title: true,
          },
        });
        rows.push(toRow(created));
      }
      await tx.photoUpload.deleteMany({ where: { id: { in: prepared.map((p) => p.upload.id) } } });
      return rows;
    });
  } catch (err) {
    // The rows never landed, so every moved file is nobody's. Best-effort, same as every other
    // cleanup path: an orphan file is the failure we tolerate least, so we try.
    await Promise.all(moved.map((m) => deleteVariants(m.backend, m.prefix, m.mime)));
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
 * `copy_photo` only ever pointed at the copy's own scan and leaves it alone.
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

  const ownPhoto =
    attachment.source === "upload"
      ? await prisma.photo.findFirst({
          where: { id: attachment.photoId, offerId: attachment.offerId },
          select: { id: true, storageBackend: true, storageKey: true, mime: true },
        })
      : null;

  await prisma.$transaction(async (tx) => {
    await tx.offerPhotoAttachment.delete({ where: { id: attachment.id } });
    // Deleting the photo would cascade the attachment away anyway; both are written explicitly so
    // the order of operations does not depend on the cascade.
    if (ownPhoto) await tx.photo.delete({ where: { id: ownPhoto.id } });
  });

  if (ownPhoto) {
    await deleteVariants(ownPhoto.storageBackend, ownPhoto.storageKey, ownPhoto.mime);
  }
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
