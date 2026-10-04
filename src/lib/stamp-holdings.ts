import "server-only";
import { prisma } from "./db";
import { countHeldCopyRowsByStamp, heldCopiesWhere } from "./copy-counts";
import {
  tracePhotoScan,
  type ConsumedTileSide,
  type HeldCopyPhoto,
  type HeldCopyPicture,
  type HeldCopyRow,
} from "./held-copies";
import { measureFrameOf, PHOTO_FRAME_SELECT, sortPhotos } from "./photos";
import { asQuarterTurn, turnedSize } from "./tile-turn";
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
      photos: {
        select: { id: true, role: true, title: true, sortOrder: true, ...PHOTO_FRAME_SELECT },
      },
      // The tiles the copy was made from (#567), so each photo still their crop is drawn at its
      // card's resolution in the comparison (#1641).
      scanTiles: {
        where: { state: "consumed" },
        select: {
          frontW: true,
          frontH: true,
          frontTurn: true,
          backW: true,
          backH: true,
          backTurn: true,
          frontSheet: { select: { scanningProfileId: true } },
          backSheet: { select: { scanningProfileId: true } },
        },
      },
    },
    orderBy: { itemNo: "asc" },
  });
  return rows.map((row) => {
    const sides = row.scanTiles.flatMap(consumedTileSides);
    return {
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
        .map((p): HeldCopyPhoto => {
          const role = p.role === "front" || p.role === "back" ? p.role : null;
          const frame = measureFrameOf(p);
          return {
            id: p.id,
            role,
            title: p.title,
            sortOrder: p.sortOrder,
            frame,
            scan: tracePhotoScan({ role, frame }, sides),
          };
        })
        .sort(sortPhotos),
    };
  });
}

/** A consumed tile's sides with a box on a card, each as its crop was cut — turned. */
function consumedTileSides(tile: {
  frontW: number | null;
  frontH: number | null;
  frontTurn: number;
  backW: number | null;
  backH: number | null;
  backTurn: number;
  frontSheet: { scanningProfileId: string | null } | null;
  backSheet: { scanningProfileId: string | null } | null;
}): ConsumedTileSide[] {
  const sides: ConsumedTileSide[] = [];
  const add = (
    role: "front" | "back",
    w: number | null,
    h: number | null,
    turn: number,
    sheet: { scanningProfileId: string | null } | null
  ) => {
    if (w == null || h == null || !sheet) return;
    const size = turnedSize({ width: w, height: h }, asQuarterTurn(turn));
    sides.push({ role, ...size, scanningProfileId: sheet.scanningProfileId });
  };
  add("front", tile.frontW, tile.frontH, tile.frontTurn, tile.frontSheet);
  add("back", tile.backW, tile.backH, tile.backTurn, tile.backSheet);
  return sides;
}
