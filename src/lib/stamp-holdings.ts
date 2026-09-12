import "server-only";
import { prisma } from "./db";
import { countHeldCopyRowsByStamp, heldCopiesWhere } from "./copy-counts";
import type { HeldCopyPicture, HeldCopyRow } from "./held-copies";
import { sortPhotos } from "./photos";
import { loadStampWantSummaries, type StampWantSummary } from "./wants";

/**
 * What the collection holds of **one** stamp, and what it is still after (#562) — the pair the
 * intake step states at the moment the stamp is identified, so the keep-or-sell call is taken with
 * both in front of the collector rather than after the copies exist.
 *
 * Composed here rather than inside `copy-counts.ts`, which is imported by every catalogue reader
 * and has no other reason to know about wants.
 *
 * Deliberately **one stamp**, against `loadStampCopyCounts`'s page of them: this answers a question
 * asked about the stamp that was just picked, and a second page-shaped reader beside the one every
 * list already uses would be two answers to "what does this collection hold".
 */
export interface StampHoldings {
  /** Held copies split by condition and disposition. Empty when none are held. */
  rows: HeldCopyRow[];
  /** Open wants on the stamp, null when it is on none — the marker's own rule (#532). */
  wants: StampWantSummary | null;
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

export async function getStampHoldings(
  ownerId: string,
  collectionId: string,
  stampId: string
): Promise<StampHoldings> {
  await assertCollectionOwner(ownerId, collectionId);
  const [rowsByStamp, wantsByStamp] = await Promise.all([
    countHeldCopyRowsByStamp(collectionId, [stampId]),
    loadStampWantSummaries(collectionId, [stampId]),
  ]);
  return {
    rows: rowsByStamp.get(stampId) ?? [],
    wants: wantsByStamp.get(stampId) ?? null,
  };
}

/**
 * Every copy the collection holds of **one** stamp, with its photos (#1207) — what the intake step
 * shows beside the piece being identified, so *is this one better than mine* is answered by looking.
 *
 * The set is `heldCopiesWhere`'s exactly, the one #562's line counts: sold, traded away, written off
 * and never-arrived copies are not his any more and are not shown, and a copy still on its way is.
 * The order is the client's ({@link orderHeldCopyPictures}), because the condition dictionary it
 * follows is already there.
 *
 * `excludeItemId` is the copy a scan tile **already became**, when the tile is being re-identified:
 * that copy is the piece in the tweezers, and offering it as one of the copies to compare it with
 * would be comparing the piece with itself.
 *
 * Loaded only when the comparison is opened, never beside the line: it is a photo read the
 * collector asks for on some of the stamps, not a count every identification needs.
 */
export async function listHeldCopyPictures(
  ownerId: string,
  collectionId: string,
  stampId: string,
  excludeItemId: string | null
): Promise<HeldCopyPicture[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.item.findMany({
    where: {
      ...heldCopiesWhere(collectionId, [stampId]),
      ...(excludeItemId ? { id: { not: excludeItemId } } : {}),
    },
    select: {
      id: true,
      itemNo: true,
      conditionId: true,
      certificateStatusId: true,
      deliveryState: true,
      inCollection: true,
      forSale: true,
      forTrade: true,
      photos: { select: { id: true, role: true, title: true, sortOrder: true } },
    },
    orderBy: { itemNo: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    itemNo: row.itemNo,
    conditionId: row.conditionId,
    certificateStatusId: row.certificateStatusId,
    deliveryState: row.deliveryState,
    inCollection: row.inCollection,
    forSale: row.forSale,
    forTrade: row.forTrade,
    // Narrowed as the copy list narrows them (`items.ts`): a copy's reserved slots are front and back.
    photos: row.photos
      .map((p) => ({
        id: p.id,
        role: (p.role === "front" || p.role === "back" ? p.role : null) as "front" | "back" | null,
        title: p.title,
        sortOrder: p.sortOrder,
      }))
      .sort(sortPhotos),
  }));
}
