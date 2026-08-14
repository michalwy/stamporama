import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import {
  getActiveStorage,
  getStorage,
  permanentPrefix,
  sheetPrefix,
  sheetVariantKey,
  variantKey,
  type SheetVariant,
} from "./storage";
import { deletePhotoVariants } from "./photos";
import { MAX_UPLOAD_BYTES, UnsupportedImageError } from "./photos/process";
import { cutSheet, extractSheetRegion, prepareSheet } from "./photos/sheet";
import { normalizeBox, pairByPosition, readingOrder, type Box } from "./scan-boxes";
import { detectSheetBoxes } from "./scan-detect";

/**
 * Scan sheet ingest (#566, ADR-0033): a stockbook card is scanned whole, the scan is retained, its
 * regions are cut into **tiles**, and a second scan of the same card — each stamp turned over in
 * place — pairs backs onto fronts by position.
 *
 * Boxes reach `commitCut` either drawn by hand or proposed by `proposeCut` (#574), and nothing
 * below asks which — the proposal hands the same shapes to the same functions.
 *
 * Three rules the rest of the module is arranged around:
 *
 * - **The cut is on the original.** Never `processImage` a sheet. `photos/sheet.ts` says why.
 * - **The sheet is retained.** A bad cut on a parcel already broken up cannot be undone by
 *   re-scanning, so the original stays and a batch can be re-cut from it after the fact.
 * - **A tile is not an `Item`.** `Item.stampId` is NOT NULL and stays that way; see the ADR and the
 *   migration. #567 is what turns a tile into a copy.
 */

export class ScanAuthError extends Error {}
export class ScanValidationError extends Error {}

/** A tile's three ends. `scan-tiles.ts` is what moves a tile out of the first (#567). */
export type ScanTileState = "unidentified" | "consumed" | "discarded";

export type SheetSide = "front" | "back";

// ── Authorization ─────────────────────────────────────────────────────────────────────────────

/** Shared with `scan-tiles.ts` (#567), which works on the same lots through the same check rather
 * than growing a second one that could drift from this. */
export async function assertScanLotOwner(
  ownerId: string,
  lotId: string
): Promise<{ collectionId: string; status: string }> {
  return assertLotOwner(ownerId, lotId);
}

async function assertLotOwner(
  ownerId: string,
  lotId: string
): Promise<{ collectionId: string; status: string }> {
  const lot = await prisma.purchaseLot.findUnique({
    where: { id: lotId },
    select: {
      status: true,
      purchase: { select: { collectionId: true, collection: { select: { ownerId: true } } } },
    },
  });
  if (!lot || lot.purchase.collection.ownerId !== ownerId) {
    throw new ScanAuthError("Lot not found or access denied.");
  }
  return { collectionId: lot.purchase.collectionId, status: lot.status };
}

async function assertSheetOwner(
  ownerId: string,
  sheetId: string
): Promise<{ collectionId: string; lotId: string }> {
  const sheet = await prisma.scanSheet.findUnique({
    where: { id: sheetId },
    select: { lotId: true },
  });
  if (!sheet) throw new ScanAuthError("Scan sheet not found or access denied.");
  const { collectionId } = await assertLotOwner(ownerId, sheet.lotId);
  return { collectionId, lotId: sheet.lotId };
}

// ── Uploading a sheet ─────────────────────────────────────────────────────────────────────────

export interface UploadedSheet {
  id: string;
  batchNo: number;
  side: SheetSide;
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
}

/**
 * Store a card scan against a lot.
 *
 * A **front** with no `batchNo` opens a new batch. A **back** always names the batch it belongs to,
 * because a back with no front is a scan of nothing this flow can use. Re-uploading a side replaces
 * the sheet — but only while nothing has been cut from it, since tiles hold a `Restrict` reference
 * to the sheet they came from and a replaced sheet would leave them pointing at an image that is no
 * longer the one their boxes were drawn on.
 *
 * Unlike a photo upload there is no staging step: a sheet is retained whatever happens next, so
 * there is no pending state for it to be in and nothing for the orphan sweep to collect. Cancelling
 * the review leaves a sheet and no tiles, which is exactly what a re-cut starts from.
 */
export async function uploadSheet(
  ownerId: string,
  lotId: string,
  input: { bytes: Buffer; mime: string; side: SheetSide; batchNo?: number }
): Promise<UploadedSheet> {
  const { collectionId } = await assertLotOwner(ownerId, lotId);

  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new ScanValidationError("Scan is too large (max 200 MB).");
  }

  let prepared;
  try {
    prepared = await prepareSheet(input.bytes, input.mime);
  } catch (err) {
    if (err instanceof UnsupportedImageError) throw new ScanValidationError(err.message);
    throw err;
  }

  const batchNo =
    input.side === "front" && input.batchNo == null
      ? await allocateBatchNo(lotId)
      : requireBatchNo(input);

  const existing = await prisma.scanSheet.findUnique({
    where: { lotId_batchNo_side: { lotId, batchNo, side: input.side } },
    select: { id: true, storageBackend: true, storageKey: true, mime: true, _count: { select: { frontTiles: true, backTiles: true } } },
  });
  if (existing && existing._count.frontTiles + existing._count.backTiles > 0) {
    throw new ScanValidationError(
      "This side has already been cut. Re-cut the batch first to replace the scan."
    );
  }
  if (input.side === "back") await assertBatchHasFront(lotId, batchNo);

  const id = randomUUID();
  const prefix = sheetPrefix(collectionId, id);
  const storage = getActiveStorage();
  const mime = prepared.mime;

  try {
    await storage.put(sheetVariantKey(prefix, "original", mime), prepared.original, mime);
    await storage.put(sheetVariantKey(prefix, "view", mime), prepared.view.buffer, mime);
  } catch (err) {
    await deleteSheetVariants(storage.backend, prefix, mime);
    throw err;
  }

  try {
    // Replacing an uncut sheet is a delete-then-create rather than an update: the new bytes live
    // under a new id's prefix, so the old row and the old bytes both have to go, and doing it in
    // this order means the unique `(lot, batch, side)` is never briefly violated.
    await prisma.$transaction(async (tx) => {
      if (existing) await tx.scanSheet.delete({ where: { id: existing.id } });
      await tx.scanSheet.create({
        data: {
          id,
          lotId,
          batchNo,
          side: input.side,
          storageBackend: storage.backend,
          storageKey: prefix,
          mime,
          width: prepared.width,
          height: prepared.height,
          viewWidth: prepared.view.width,
          viewHeight: prepared.view.height,
          sizeBytes: prepared.sizeBytes,
        },
      });
    });
  } catch (err) {
    await deleteSheetVariants(storage.backend, prefix, mime);
    throw err;
  }

  if (existing) {
    await deleteSheetVariants(existing.storageBackend, existing.storageKey, existing.mime);
  }

  return {
    id,
    batchNo,
    side: input.side,
    width: prepared.width,
    height: prepared.height,
    viewWidth: prepared.view.width,
    viewHeight: prepared.view.height,
  };
}

function requireBatchNo(input: { side: SheetSide; batchNo?: number }): number {
  if (input.batchNo == null) {
    throw new ScanValidationError("A back scan must name the batch its front belongs to.");
  }
  return input.batchNo;
}

async function assertBatchHasFront(lotId: string, batchNo: number): Promise<void> {
  const front = await prisma.scanSheet.findUnique({
    where: { lotId_batchNo_side: { lotId, batchNo, side: "front" } },
    select: { id: true },
  });
  if (!front) throw new ScanValidationError("That batch has no front scan.");
}

/** Next batch number for a lot, taken from the lot's own counter under a row lock so two uploads
 * racing cannot both take the same one (`allocateEntityNumber`'s rule, applied per lot). */
async function allocateBatchNo(lotId: string): Promise<number> {
  const updated = await prisma.purchaseLot.update({
    where: { id: lotId },
    data: { nextScanBatchNo: { increment: 1 } },
    select: { nextScanBatchNo: true },
  });
  return updated.nextScanBatchNo - 1;
}

// ── Committing a cut ──────────────────────────────────────────────────────────────────────────

/** What a committed cut did, for the collector to read rather than for a caller to branch on.
 *
 * A count mismatch is a **signal, not a failure**: front 12 / back 11 means a stamp fell out, two
 * regions were drawn as one, or the wrong file was uploaded — all of which the collector fixes,
 * and none of which is served by refusing the whole cut. So the pairing is reported, never forced,
 * and what found no partner is named. */
export interface CutReport {
  batchNo: number;
  side: SheetSide;
  /** Tiles created by this commit. */
  created: number;
  /** Front boxes in the batch, after this commit. */
  frontCount: number;
  /** Back boxes in this cut. Zero on a front commit. */
  backCount: number;
  /** Backs paired onto an existing front tile. */
  paired: number;
  /** Reading-order positions of front tiles still carrying no back. */
  frontWithoutBack: number[];
  /** Backs that found no mutual front and became back-only tiles, to be paired by hand. */
  backOnly: number;
}

/**
 * Turn the reviewed boxes into tiles.
 *
 * Nothing exists until this call: the whole review is free to be wrong, which is what makes drawing
 * over a scan a safe thing to do on a parcel that has already been broken up.
 *
 * On a **front** sheet each box becomes a tile, in reading order.
 *
 * On a **back** sheet the boxes are paired to the batch's front tiles **by position** — each stamp
 * having been turned over in place, so a back sits where its front sat. Mutual-nearest, no
 * mirroring, nothing forced (`scan-boxes.ts` carries the reasoning). A back that finds no front
 * becomes a **back-only tile**, which is what the collector drags onto a front tile in the sparse
 * case; a front that finds no back simply keeps having none.
 */
export async function commitCut(
  ownerId: string,
  sheetId: string,
  boxes: readonly Box[]
): Promise<CutReport> {
  const { collectionId, lotId } = await assertSheetOwner(ownerId, sheetId);

  const sheet = await prisma.scanSheet.findUniqueOrThrow({
    where: { id: sheetId },
    select: {
      batchNo: true,
      side: true,
      storageBackend: true,
      storageKey: true,
      mime: true,
      width: true,
      height: true,
    },
  });

  const alreadyCut = await prisma.scanTile.count({
    where:
      sheet.side === "front" ? { frontSheetId: sheetId } : { backSheetId: sheetId },
  });
  if (alreadyCut > 0) {
    throw new ScanValidationError(
      "This scan has already been cut. Re-cut the batch to start again."
    );
  }
  if (boxes.length === 0) {
    throw new ScanValidationError("Draw at least one box before committing the cut.");
  }
  assertBoxesInSheet(boxes, sheet);

  // Reading order first, so a box's index means the same thing to the cut, to the pairing and to
  // the position written on the tile.
  const ordered = readingOrder(boxes).map((i) => boxes[i]);

  const original = await readSheetOriginal(sheet.storageBackend, sheet.storageKey, sheet.mime);
  const crops = await cutSheet(original, ordered);

  return sheet.side === "front"
    ? commitFrontCut({ collectionId, lotId, sheetId, batchNo: sheet.batchNo, ordered, crops })
    : commitBackCut({ collectionId, lotId, sheetId, batchNo: sheet.batchNo, sheet, ordered, crops });
}

type Crops = Awaited<ReturnType<typeof cutSheet>>;

async function commitFrontCut(args: {
  collectionId: string;
  lotId: string;
  sheetId: string;
  batchNo: number;
  ordered: Box[];
  crops: Crops;
}): Promise<CutReport> {
  const { collectionId, lotId, sheetId, batchNo, ordered, crops } = args;

  const rows = ordered.map((box, i) => ({
    tileId: randomUUID(),
    photoId: randomUUID(),
    box,
    crop: crops[i],
    position: i,
  }));

  const written = await writeCropBytes(collectionId, rows);
  try {
    await prisma.$transaction(async (tx) => {
      for (const r of rows) {
        await tx.scanTile.create({
          data: {
            id: r.tileId,
            lotId,
            batchNo,
            position: r.position,
            frontSheetId: sheetId,
            frontX: r.box.x,
            frontY: r.box.y,
            frontW: r.box.w,
            frontH: r.box.h,
          },
        });
        await tx.photo.create({ data: photoData(r, collectionId, "front") });
      }
    });
  } catch (err) {
    await rollbackBytes(written);
    throw err;
  }

  return {
    batchNo,
    side: "front",
    created: rows.length,
    frontCount: rows.length,
    backCount: 0,
    paired: 0,
    frontWithoutBack: rows.map((r) => r.position),
    backOnly: 0,
  };
}

async function commitBackCut(args: {
  collectionId: string;
  lotId: string;
  sheetId: string;
  batchNo: number;
  sheet: { width: number; height: number };
  ordered: Box[];
  crops: Crops;
}): Promise<CutReport> {
  const { collectionId, lotId, sheetId, batchNo, sheet, ordered, crops } = args;

  const frontSheet = await prisma.scanSheet.findUniqueOrThrow({
    where: { lotId_batchNo_side: { lotId, batchNo, side: "front" } },
    select: { width: true, height: true },
  });

  // Only front tiles that still have no back take part: a batch's back scan can be cut more than
  // once across re-cuts, and a tile already carrying a back is not looking for one.
  const frontTiles = await prisma.scanTile.findMany({
    where: { lotId, batchNo, frontSheetId: { not: null }, backSheetId: null },
    select: { id: true, position: true, frontX: true, frontY: true, frontW: true, frontH: true },
    orderBy: { position: "asc" },
  });
  const frontBoxes: Box[] = frontTiles.map((t) => ({
    x: t.frontX ?? 0,
    y: t.frontY ?? 0,
    w: t.frontW ?? 0,
    h: t.frontH ?? 0,
  }));

  const pairing = pairByPosition(frontBoxes, frontSheet, ordered, sheet);
  const backIndexToFront = new Map(pairing.pairs.map((p) => [p.backIndex, p.frontIndex]));

  // Back-only tiles are appended after everything already in the batch, so an existing tile's
  // position — which the collector has been reading off the screen — never shifts under it.
  const maxPosition = await prisma.scanTile.aggregate({
    where: { lotId, batchNo },
    _max: { position: true },
  });
  let nextPosition = (maxPosition._max.position ?? -1) + 1;

  const rows = ordered.map((box, i) => {
    const frontIndex = backIndexToFront.get(i);
    const target = frontIndex != null ? frontTiles[frontIndex] : null;
    return {
      tileId: target?.id ?? randomUUID(),
      isNewTile: target == null,
      photoId: randomUUID(),
      box,
      crop: crops[i],
      position: target?.position ?? nextPosition++,
    };
  });

  const written = await writeCropBytes(collectionId, rows);
  try {
    await prisma.$transaction(async (tx) => {
      for (const r of rows) {
        if (r.isNewTile) {
          await tx.scanTile.create({
            data: {
              id: r.tileId,
              lotId,
              batchNo,
              position: r.position,
              backSheetId: sheetId,
              backX: r.box.x,
              backY: r.box.y,
              backW: r.box.w,
              backH: r.box.h,
            },
          });
        } else {
          await tx.scanTile.update({
            where: { id: r.tileId },
            data: {
              backSheetId: sheetId,
              backX: r.box.x,
              backY: r.box.y,
              backW: r.box.w,
              backH: r.box.h,
            },
          });
        }
        await tx.photo.create({ data: photoData(r, collectionId, "back") });
      }
    });
  } catch (err) {
    await rollbackBytes(written);
    throw err;
  }

  const frontCount = await prisma.scanTile.count({
    where: { lotId, batchNo, frontSheetId: { not: null } },
  });

  return {
    batchNo,
    side: "back",
    created: rows.filter((r) => r.isNewTile).length,
    frontCount,
    backCount: ordered.length,
    paired: pairing.pairs.length,
    frontWithoutBack: pairing.frontUnmatched.map((i) => frontTiles[i].position),
    backOnly: pairing.backUnmatched.length,
  };
}

function photoData(
  r: { tileId: string; photoId: string; crop: Crops[number] },
  collectionId: string,
  role: "front" | "back"
) {
  return {
    id: r.photoId,
    tileId: r.tileId,
    role,
    storageBackend: getActiveStorage().backend,
    storageKey: permanentPrefix(collectionId, r.photoId),
    mime: r.crop.full.mime,
    width: r.crop.full.width,
    height: r.crop.full.height,
    originalWidth: r.crop.original.width,
    originalHeight: r.crop.original.height,
    sizeBytes: r.crop.full.buffer.byteLength,
  };
}

/** Bytes go down before any row does, so a committed row never references bytes that are not
 * there. The reverse — a row that failed to write leaving bytes behind — is what `rollbackBytes`
 * is for, and is the harmless direction. */
async function writeCropBytes(
  collectionId: string,
  rows: readonly { photoId: string; crop: Crops[number] }[]
): Promise<{ backend: string; prefix: string; mime: string }[]> {
  const storage = getActiveStorage();
  const written: { backend: string; prefix: string; mime: string }[] = [];
  try {
    for (const r of rows) {
      const prefix = permanentPrefix(collectionId, r.photoId);
      const mime = r.crop.full.mime;
      await storage.put(variantKey(prefix, "full", mime), r.crop.full.buffer, mime);
      await storage.put(variantKey(prefix, "thumb", mime), r.crop.thumb.buffer, mime);
      written.push({ backend: storage.backend, prefix, mime });
    }
  } catch (err) {
    await rollbackBytes(written);
    throw err;
  }
  return written;
}

async function rollbackBytes(
  written: readonly { backend: string; prefix: string; mime: string }[]
): Promise<void> {
  await Promise.all(written.map((w) => deletePhotoVariants(w.backend, w.prefix, w.mime)));
}

function assertBoxesInSheet(
  boxes: readonly Box[],
  sheet: { width: number; height: number }
): void {
  for (const b of boxes) {
    if (
      !Number.isInteger(b.x) ||
      !Number.isInteger(b.y) ||
      !Number.isInteger(b.w) ||
      !Number.isInteger(b.h) ||
      b.w <= 0 ||
      b.h <= 0 ||
      b.x < 0 ||
      b.y < 0 ||
      b.x + b.w > sheet.width ||
      b.y + b.h > sheet.height
    ) {
      // `sharp.extract` would throw on this anyway; refusing here names the reason instead of
      // failing halfway through a cut with some tiles already written.
      throw new ScanValidationError("A box falls outside the scan.");
    }
  }
}

async function readSheetOriginal(
  backend: string,
  storageKey: string,
  mime: string
): Promise<Buffer> {
  const object = await getStorage(backend).get(sheetVariantKey(storageKey, "original", mime), mime);
  const chunks: Buffer[] = [];
  for await (const chunk of object.stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ── Proposing the cut (#574) ──────────────────────────────────────────────────────────────────

/**
 * Find the pieces on a stored scan and hand back the boxes, so the editor opens on a proposal
 * instead of an empty card.
 *
 * **A proposal and nothing more.** The result goes into the same editor a hand-drawn cut is made in
 * and through the same `commitCut` afterwards; nothing below this function knows or asks that a box
 * came from here. Which is also why a failure is the caller's to swallow into an empty canvas
 * rather than an error to show: the manual path is the primitive, and it is unaffected.
 *
 * Read from the **retained original**, like the cut itself — `scan-detect.ts` does its own
 * downscaling and hands back boxes in the sheet's own pixels. Boxes are clamped through
 * `normalizeBox` before they leave, because the editor and `commitCut` are both entitled to assume
 * a box lies inside its sheet.
 */
export async function proposeCut(ownerId: string, sheetId: string): Promise<Box[]> {
  await assertSheetOwner(ownerId, sheetId);

  const sheet = await prisma.scanSheet.findUniqueOrThrow({
    where: { id: sheetId },
    select: { storageBackend: true, storageKey: true, mime: true, width: true, height: true },
  });

  const original = await readSheetOriginal(sheet.storageBackend, sheet.storageKey, sheet.mime);
  const detected = await detectSheetBoxes(original);
  return detected
    .map((b) => normalizeBox(b, { width: sheet.width, height: sheet.height }))
    .filter((b): b is Box => b != null);
}

// ── Manual pairing ────────────────────────────────────────────────────────────────────────────

/**
 * Move a back-only tile's image onto a front tile, and delete the now-empty tile.
 *
 * This is the sparse case — backs scanned for only some stamps, or positions not reproduced. The
 * second sheet is uploaded and cut exactly as any other, and what did not pair is dragged into
 * place: same entity, same images, no third mode.
 *
 * The photo row is **re-owned rather than re-cut**: the bytes are already the right bytes, and
 * moving one column is what `Photo`'s polymorphic owner is for.
 */
export async function pairTilesManually(
  ownerId: string,
  backTileId: string,
  frontTileId: string
): Promise<void> {
  const [backTile, frontTile] = await Promise.all([
    loadTile(backTileId),
    loadTile(frontTileId),
  ]);
  if (backTile.lotId !== frontTile.lotId) {
    throw new ScanValidationError("Both tiles must be on the same lot.");
  }
  await assertLotOwner(ownerId, backTile.lotId);

  if (backTile.frontSheetId != null) {
    throw new ScanValidationError("Only a tile with no front image can be paired onto another.");
  }
  if (frontTile.frontSheetId == null) {
    throw new ScanValidationError("A back can only be paired onto a tile that has a front.");
  }
  if (frontTile.backSheetId != null) {
    throw new ScanValidationError("That tile already has a back image.");
  }
  if (frontTile.state !== "unidentified") {
    throw new ScanValidationError("That tile has already been dealt with.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.photo.updateMany({
      where: { tileId: backTileId, role: "back" },
      data: { tileId: frontTileId },
    });
    await tx.scanTile.update({
      where: { id: frontTileId },
      data: {
        backSheetId: backTile.backSheetId,
        backX: backTile.backX,
        backY: backTile.backY,
        backW: backTile.backW,
        backH: backTile.backH,
      },
    });
    // Its photo has moved, so the cascade takes nothing with it.
    await tx.scanTile.delete({ where: { id: backTileId } });
  });
}

async function loadTile(tileId: string) {
  const tile = await prisma.scanTile.findUnique({
    where: { id: tileId },
    select: {
      id: true,
      lotId: true,
      state: true,
      frontSheetId: true,
      backSheetId: true,
      backX: true,
      backY: true,
      backW: true,
      backH: true,
    },
  });
  if (!tile) throw new ScanAuthError("Tile not found or access denied.");
  return tile;
}

// ── Re-cutting and discarding ─────────────────────────────────────────────────────────────────

/**
 * Throw away a batch's tiles, keeping its sheets — so the cut can be drawn again from the retained
 * scan. This is the other half of retention, and the reason a bad cut on a broken-up stockbook is
 * recoverable at all. The previous boxes stay on screen because they are what the editor reloads;
 * they die with the tiles that carried them, so the caller reads them out first.
 *
 * **Refused if any tile has been consumed.** A consumed tile has become a copy that holds these
 * very images (#567 re-owns the `Photo` rows), and deleting the tile would take a copy's front and
 * back with it. Nothing in #566 can produce that state; the guard is written now because a guard
 * added after the state it guards is a guard that was once missing.
 */
export async function recutBatch(
  ownerId: string,
  lotId: string,
  batchNo: number
): Promise<{ discarded: number }> {
  await assertLotOwner(ownerId, lotId);

  const consumed = await prisma.scanTile.count({
    where: { lotId, batchNo, state: "consumed" },
  });
  if (consumed > 0) {
    throw new ScanValidationError(
      `${consumed} ${consumed === 1 ? "tile has" : "tiles have"} already become copies. Re-cutting would delete their images.`
    );
  }

  const discarded = await deleteTiles({ lotId, batchNo });
  // The batch is being drawn again, so it is no longer finished with (#567) — clearing the stamp
  // is what keeps #578 from sweeping away the original a re-cut is about to be taken from. A batch
  // whose tiles were all *discarded* is exactly the one that reaches here already stamped.
  await prisma.scanSheet.updateMany({
    where: { lotId, batchNo, batchDoneAt: { not: null } },
    data: { batchDoneAt: null },
  });
  return { discarded };
}

/**
 * Delete a whole batch: its tiles first, then its sheets. That order is the only one the tiles'
 * `Restrict` reference to their sheet allows, and it is also the honest one — a sheet with tiles
 * still hanging off it is not a batch anyone has finished with.
 */
export async function deleteBatch(
  ownerId: string,
  lotId: string,
  batchNo: number
): Promise<void> {
  await recutBatch(ownerId, lotId, batchNo);
  const sheets = await prisma.scanSheet.findMany({
    where: { lotId, batchNo },
    select: { id: true, storageBackend: true, storageKey: true, mime: true },
  });
  await prisma.scanSheet.deleteMany({ where: { lotId, batchNo } });
  await Promise.all(
    sheets.map((s) => deleteSheetVariants(s.storageBackend, s.storageKey, s.mime))
  );
}

/** Delete tiles matching a scope, taking their photo bytes with them. Prisma's cascade drops the
 * `Photo` rows but never the files — the same split `deletePhotoBytesForItem` exists for. */
async function deleteTiles(where: { lotId: string; batchNo?: number }): Promise<number> {
  const photos = await prisma.photo.findMany({
    where: { tile: where },
    select: { storageBackend: true, storageKey: true, mime: true },
  });
  const { count } = await prisma.scanTile.deleteMany({ where });
  await Promise.all(
    photos.map((p) => deletePhotoVariants(p.storageBackend, p.storageKey, p.mime))
  );
  return count;
}

/** Where one stored object lives, kept apart from the row that pointed at it. */
export interface ScanStorageRef {
  backend: string;
  storageKey: string;
  mime: string;
  kind: "photo" | "sheet";
}

/**
 * Every scan byte belonging to some lots — the tiles' crops and the retained sheets.
 *
 * Collected **before** the rows go and deleted only **after** they are gone, in two calls rather
 * than one, because the delete they accompany can be refused: a purchase whose lots still hold
 * copies is blocked by the DB, and a single "delete the bytes then delete the rows" helper would
 * have destroyed the collector's scans on the way to an error message. Once the rows are gone
 * there is no way back to the keys, hence collecting first; once the delete has succeeded there is
 * nothing left pointing at the files, hence deleting after.
 */
export async function collectScanStorageRefs(lotIds: readonly string[]): Promise<ScanStorageRef[]> {
  if (lotIds.length === 0) return [];
  const where = { lotId: { in: [...lotIds] } };
  const [photos, sheets] = await Promise.all([
    prisma.photo.findMany({
      where: { tile: where },
      select: { storageBackend: true, storageKey: true, mime: true },
    }),
    prisma.scanSheet.findMany({
      where,
      select: { storageBackend: true, storageKey: true, mime: true },
    }),
  ]);
  return [
    ...photos.map((p) => ({
      backend: p.storageBackend,
      storageKey: p.storageKey,
      mime: p.mime,
      kind: "photo" as const,
    })),
    ...sheets.map((s) => ({
      backend: s.storageBackend,
      storageKey: s.storageKey,
      mime: s.mime,
      kind: "sheet" as const,
    })),
  ];
}

/** Delete collected bytes, best-effort. Safe to call with refs whose rows are already gone — that
 * is the only order it is ever called in. */
export async function deleteScanStorageRefs(refs: readonly ScanStorageRef[]): Promise<void> {
  await Promise.all(
    refs.map((r) =>
      r.kind === "photo"
        ? deletePhotoVariants(r.backend, r.storageKey, r.mime)
        : deleteSheetVariants(r.backend, r.storageKey, r.mime)
    )
  );
}

async function deleteSheetVariants(
  backend: string,
  storageKey: string,
  mime: string
): Promise<void> {
  const storage = getStorage(backend);
  const variants: SheetVariant[] = ["original", "view"];
  await Promise.all(
    variants.map((v) => storage.delete(sheetVariantKey(storageKey, v, mime)).catch(() => {}))
  );
}

// ── Reading ───────────────────────────────────────────────────────────────────────────────────

export interface ScanSheetData {
  id: string;
  side: SheetSide;
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
  /** Whether anything has been cut from this sheet yet — what decides between "review the cut" and
   * "re-cut the batch" on screen. */
  cut: boolean;
}

export interface ScanTileData {
  id: string;
  position: number;
  state: ScanTileState;
  frontPhotoId: string | null;
  backPhotoId: string | null;
  frontBox: Box | null;
  backBox: Box | null;
  note: string | null;
  /** The copy a `consumed` tile became (#567). Null on every other tile, and also on a consumed
   * one whose copy was deleted afterwards — the tile stays consumed either way, because its images
   * left with the copy.
   *
   * `frontPhotoId` is that copy's front, which **is** the tile's old front row under its new owner:
   * consuming a tile reassigns `tileId → itemId`, so the picture never went anywhere. The strip
   * follows it there rather than drawing an empty square over a tile that went perfectly well. */
  item: { id: string; itemNo: number; frontPhotoId: string | null } | null;
  /** True when this tile's copy is for a stamp on **none** of the settled auction lot's lines
   * (#567): the parcel holds something its description never announced. Information rather than a
   * problem to hide — always false on a lot that came from no auction. */
  outsideDescription: boolean;
}

export interface ScanBatchData {
  batchNo: number;
  front: ScanSheetData | null;
  back: ScanSheetData | null;
  tiles: ScanTileData[];
  /** When the last tile of this batch left `unidentified` (#567), or null while any is still
   * waiting. Read from the batch's sheets, which is where it is stamped. */
  doneAt: string | null;
}

export interface LotScansData {
  batches: ScanBatchData[];
  /** Whether this lot was transcribed from a won auction lot (ADR-0021) — which is what makes
   * "assign this tile to a copy already on the lot" the ordinary path rather than the exception:
   * settlement created identified copies that need photographs, not identification. */
  fromAuction: boolean;
}

/** Every batch on a lot, newest first — the shape the lot's Scans card renders and the review
 * editor reloads a previous cut from. */
export async function listLotScans(
  ownerId: string,
  lotId: string
): Promise<LotScansData> {
  await assertLotOwner(ownerId, lotId);

  // The auction lines this parcel was described by, when it came from a settled sale. Read as a
  // set of stamp ids, because the only question asked of it is whether a copy identified from a
  // tile appears on it at all.
  const auctionLot = await prisma.auctionLot.findUnique({
    where: { purchaseLotId: lotId },
    select: { lines: { select: { stampId: true } } },
  });
  const describedStampIds = new Set(auctionLot?.lines.map((l) => l.stampId) ?? []);

  const [sheets, tiles] = await Promise.all([
    prisma.scanSheet.findMany({
      where: { lotId },
      select: {
        id: true,
        batchNo: true,
        side: true,
        width: true,
        height: true,
        viewWidth: true,
        viewHeight: true,
        batchDoneAt: true,
        _count: { select: { frontTiles: true, backTiles: true } },
      },
      orderBy: { batchNo: "desc" },
    }),
    prisma.scanTile.findMany({
      where: { lotId },
      select: {
        id: true,
        batchNo: true,
        position: true,
        state: true,
        note: true,
        frontX: true,
        frontY: true,
        frontW: true,
        frontH: true,
        backX: true,
        backY: true,
        backW: true,
        backH: true,
        photos: { select: { id: true, role: true } },
        item: {
          select: {
            id: true,
            itemNo: true,
            stampId: true,
            // The very row this tile handed over, now owned by the copy.
            photos: { where: { role: "front" }, select: { id: true }, take: 1 },
          },
        },
      },
      orderBy: [{ batchNo: "desc" }, { position: "asc" }],
    }),
  ]);

  const batches = new Map<number, ScanBatchData>();
  const batchOf = (batchNo: number): ScanBatchData => {
    let b = batches.get(batchNo);
    if (!b) {
      b = { batchNo, front: null, back: null, tiles: [], doneAt: null };
      batches.set(batchNo, b);
    }
    return b;
  };

  for (const s of sheets) {
    const data: ScanSheetData = {
      id: s.id,
      side: s.side === "back" ? "back" : "front",
      width: s.width,
      height: s.height,
      viewWidth: s.viewWidth,
      viewHeight: s.viewHeight,
      cut: (s.side === "back" ? s._count.backTiles : s._count.frontTiles) > 0,
    };
    const batch = batchOf(s.batchNo);
    if (data.side === "front") batch.front = data;
    else batch.back = data;
    // Both sheets of a batch are stamped together, so either one answers for it.
    if (s.batchDoneAt) batch.doneAt = s.batchDoneAt.toISOString();
  }

  for (const t of tiles) {
    batchOf(t.batchNo).tiles.push({
      id: t.id,
      position: t.position,
      state: (t.state as ScanTileState) ?? "unidentified",
      frontPhotoId: t.photos.find((p) => p.role === "front")?.id ?? null,
      backPhotoId: t.photos.find((p) => p.role === "back")?.id ?? null,
      frontBox: boxOrNull(t.frontX, t.frontY, t.frontW, t.frontH),
      backBox: boxOrNull(t.backX, t.backY, t.backW, t.backH),
      note: t.note,
      item: t.item
        ? {
            id: t.item.id,
            itemNo: t.item.itemNo,
            frontPhotoId: t.item.photos[0]?.id ?? null,
          }
        : null,
      // Only a lot with an auction description can disagree with one. A lot with no lines at all
      // (a hand-entered purchase) says nothing about any tile, rather than saying they are all
      // undescribed.
      outsideDescription:
        describedStampIds.size > 0 && t.item != null && !describedStampIds.has(t.item.stampId),
    });
  }

  return {
    batches: [...batches.values()].sort((a, b) => b.batchNo - a.batchNo),
    fromAuction: auctionLot != null,
  };
}

function boxOrNull(
  x: number | null,
  y: number | null,
  w: number | null,
  h: number | null
): Box | null {
  return x == null || y == null || w == null || h == null ? null : { x, y, w, h };
}

/** How many tiles on a lot are still waiting to become something. What the lot header warns with
 * before closing — a warning, never a block, matching the existing `N to sort`. Discarded tiles are
 * deliberately not counted: a discarded tile is evidence, not a queue item (#567). */
export async function countUnidentifiedTiles(lotId: string): Promise<number> {
  return prisma.scanTile.count({ where: { lotId, state: "unidentified" } });
}

/** Resolve a sheet for the serving route: its owning collection + owner for the auth check, plus
 * the bytes address and the coordinate space a region request is checked against. Mirrors
 * `getPhotoForServing` — a sheet is served by its own route because it is not a `Photo` and its
 * variants are not a photo's. */
export async function getSheetForServing(sheetId: string): Promise<{
  collectionId: string;
  ownerId: string;
  storageBackend: string;
  storageKey: string;
  mime: string;
  width: number;
  height: number;
} | null> {
  const sheet = await prisma.scanSheet.findUnique({
    where: { id: sheetId },
    select: {
      storageBackend: true,
      storageKey: true,
      mime: true,
      width: true,
      height: true,
      lot: {
        select: {
          purchase: {
            select: { collectionId: true, collection: { select: { ownerId: true } } },
          },
        },
      },
    },
  });
  if (!sheet) return null;
  return {
    collectionId: sheet.lot.purchase.collectionId,
    ownerId: sheet.lot.purchase.collection.ownerId,
    storageBackend: sheet.storageBackend,
    storageKey: sheet.storageKey,
    mime: sheet.mime,
    width: sheet.width,
    height: sheet.height,
  };
}

/**
 * Render one region of a retained scan at display size (#579) — what the cut editor asks for once
 * it is zoomed past the `view` derivative's own scale.
 *
 * Nothing is stored and nothing is remembered: the region is derived from the same retained bytes
 * the cut is taken from, through the same `.rotate()`, so a region and the crop that a box will
 * eventually become are the same pixels. That identity is the point — it is what makes zooming a
 * way of checking the cut rather than a second rendering of it.
 *
 * The box is validated against the sheet's own dimensions here rather than trusted from a URL:
 * `sharp.extract` refuses a region outside the image, and a named refusal beats a 500.
 */
export async function renderSheetRegion(
  sheet: {
    storageBackend: string;
    storageKey: string;
    mime: string;
    width: number;
    height: number;
  },
  box: Box,
  renderWidth: number
): Promise<{ buffer: Buffer; mime: string }> {
  assertBoxesInSheet([box], sheet);
  if (!Number.isInteger(renderWidth) || renderWidth < 1) {
    throw new ScanValidationError("A render width must be a positive whole number of pixels.");
  }
  const original = await readSheetOriginal(sheet.storageBackend, sheet.storageKey, sheet.mime);
  const region = await extractSheetRegion(original, box, renderWidth);
  return { buffer: region.buffer, mime: region.mime };
}
