import "server-only";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
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
import { cutSheet, extractSheetRegion, prepareSheet, type SheetSource } from "./photos/sheet";
import {
  MAX_BATCH_LABEL_LENGTH,
  isBatchLabelTooLong,
  normalizeBatchLabel,
} from "./scan-batch-label";
import {
  normalizeBox,
  pairByPosition,
  readingOrder,
  type Box,
  type PairingMode,
} from "./scan-boxes";
import { detectSheetBoxes } from "./scan-detect";
import { scanSheetCutoff } from "./scan-sheet-cleanup-rules";
import { resolveScanSheetTtlMs } from "./scan-sheet-retention";
import { toTileCandidate, type TileCandidate } from "./tile-candidates";
import { VARIANT_FLAG_SELECT } from "./variant-classification";

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
 *   re-scanning, so the original stays and a batch can be re-cut from it after the fact. A
 *   collection that asks for it can have that retention end (#578) — see `purgeFinishedScanSheets`,
 *   which takes the bytes and leaves the row, so everything that would have read them refuses in
 *   words instead of failing on a missing file.
 * - **A tile is not an `Item`.** `Item.stampId` is NOT NULL and stays that way; see the ADR and the
 *   migration. #567 is what turns a tile into a copy.
 * - **A card belongs to the purchase, not to one of its lots** (#586). A parcel of twenty won lots
 *   arrives as one shipment and is scanned on one or two cards, so nothing below this line names a
 *   lot: which lot a piece belongs to is not answerable until it has been identified, and
 *   `scan-tiles.ts` is where that answer lands.
 * - **…and a card need not belong to a purchase at all** (#725). A stockbook already owned is
 *   scanned the same way, so the owner of a sheet, a tile and an upload is the **collection**, with
 *   the purchase an optional extra. Every scope below is a {@link ScanOwner} rather than a purchase
 *   id; `{ purchaseId: null }` is not "any card in the collection" but exactly the purchase-less
 *   ones, which is what makes one `where` serve both screens.
 */

export class ScanAuthError extends Error {}
export class ScanValidationError extends Error {}

/**
 * Where a tile can be. `scan-tiles.ts` is what moves it (#567).
 *
 * Two of them are **ends** — `consumed` became a copy, `discarded` deliberately became nothing —
 * and two are **outstanding**: `unidentified` is waiting to be worked, and `parked` (#597) is
 * waiting on something that is not at the desk. A parked piece is still to be identified, so it
 * keeps every door a waiting one has; what it does not keep is a place in the sweep, since being
 * re-offered a piece that cannot be settled now is the interruption parking exists to stop.
 */
export type ScanTileState = "unidentified" | "consumed" | "discarded" | "parked";

/** The states a tile can still be worked from — what the identify, assign, discard, park and
 * pairing paths all accept, and what keeps a batch from being finished with. One list, because a
 * second reading of "still outstanding" is how the strip and the retention sweep come to disagree
 * about whether a card is done. */
export const OPEN_TILE_STATES = ["unidentified", "parked"] as const satisfies ScanTileState[];

export function isOpenTileState(state: string): boolean {
  return (OPEN_TILE_STATES as readonly string[]).includes(state);
}

export type SheetSide = "front" | "back";

// ── What a card hangs off ─────────────────────────────────────────────────────────────────────

/**
 * The owner a caller **names** (#725): an order, or the collection itself.
 *
 * Two shapes rather than one nullable field, so a caller cannot pass a collection and a purchase
 * together and cannot forget which of the two it meant. {@link assertScanOwner} resolves it into
 * the {@link ScanOwner} everything below scopes by.
 */
export type ScanOwnerRef = { purchaseId: string } | { collectionId: string };

/** The **resolved** owner. The collection is always known; the purchase only when the card came in
 * one. Written onto every sheet, tile and upload, and used as the `where` for every read. */
export interface ScanOwner {
  collectionId: string;
  purchaseId: string | null;
}

/**
 * The scope fragment, and the reason a null purchase is spelled out rather than omitted:
 * `{ collectionId, purchaseId: null }` selects the collection's **purchase-less** cards, while
 * leaving the key out would select every card it has, an order's included. The two screens are
 * different lists of the same table, so the difference has to be in the `where`.
 */
export function scanOwnerWhere(owner: ScanOwner): { collectionId: string; purchaseId: string | null } {
  return { collectionId: owner.collectionId, purchaseId: owner.purchaseId };
}

// ── Authorization ─────────────────────────────────────────────────────────────────────────────

/** Resolve and check whichever owner the caller named. */
export async function assertScanOwner(ownerId: string, ref: ScanOwnerRef): Promise<ScanOwner> {
  if ("purchaseId" in ref) {
    const { collectionId } = await assertPurchaseOwner(ownerId, ref.purchaseId);
    return { collectionId, purchaseId: ref.purchaseId };
  }
  await assertScanCollectionOwner(ownerId, ref.collectionId);
  return { collectionId: ref.collectionId, purchaseId: null };
}

/** Shared with `scan-tiles.ts` (#567), which works on the same collections through the same check
 * rather than growing a second one that could drift from this. A row carries its `collectionId`
 * since #725, so this is the check every scan path passes — purchase or no purchase.
 *
 * Written here rather than imported from `collections.ts`, which imports enough of the app that a
 * cycle would be one edit away; the query is two columns. */
export async function assertScanCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<void> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new ScanAuthError("Collection not found or access denied.");
  }
}

async function assertPurchaseOwner(
  ownerId: string,
  purchaseId: string
): Promise<{ collectionId: string }> {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!purchase || purchase.collection.ownerId !== ownerId) {
    throw new ScanAuthError("Purchase not found or access denied.");
  }
  return { collectionId: purchase.collectionId };
}

async function assertSheetOwner(ownerId: string, sheetId: string): Promise<ScanOwner> {
  const sheet = await prisma.scanSheet.findUnique({
    where: { id: sheetId },
    select: { collectionId: true, purchaseId: true },
  });
  if (!sheet) throw new ScanAuthError("Scan sheet not found or access denied.");
  await assertScanCollectionOwner(ownerId, sheet.collectionId);
  return { collectionId: sheet.collectionId, purchaseId: sheet.purchaseId };
}

// ── Uploading a sheet ─────────────────────────────────────────────────────────────────────────

export interface UploadedSheet {
  id: string;
  batchNo: number;
  side: SheetSide;
  /** The batch's name (#587), or null. Echoed back because a back scan inherits the batch's, and
   * the screen draws it beside the number the moment the upload lands. */
  label: string | null;
  width: number;
  height: number;
  viewWidth: number;
  viewHeight: number;
}

/**
 * Store a card scan against a **purchase** (#586), or against the collection alone (#725).
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
  ref: ScanOwnerRef,
  input: {
    /** The scan's bytes, or the local file the chunked upload assembled them into (#590). A card
     * arriving in parts is assembled on disk and handed over as a **path**, so nothing between the
     * first chunk and `sharp` ever holds a 200 MB scan whole. */
    source: SheetSource;
    mime: string;
    side: SheetSide;
    batchNo?: number;
    /** An optional name for the card (#587), given as it is added. A back scan carries none of its
     * own — it joins a batch that is already named or not — and one can be given or changed later
     * through {@link setBatchLabel}, because a card often turns out to need naming only once it
     * has been left for a week. */
    label?: string | null;
  }
): Promise<UploadedSheet> {
  const owner = await assertScanOwner(ownerId, ref);
  const { collectionId } = owner;

  if ((await sourceSize(input.source)) > MAX_UPLOAD_BYTES) {
    throw new ScanValidationError("Scan is too large (max 200 MB).");
  }

  let prepared;
  try {
    prepared = await prepareSheet(input.source, input.mime);
  } catch (err) {
    if (err instanceof UnsupportedImageError) throw new ScanValidationError(err.message);
    throw err;
  }

  const batchNo =
    input.side === "front" && input.batchNo == null
      ? await allocateBatchNo(owner)
      : requireBatchNo(input);

  // `findFirst` and not `findUnique`: the uniqueness of a purchase-less batch is a **partial**
  // index (see the migration), which Prisma has no compound key for. The database still refuses a
  // duplicate; this read just cannot address it by name.
  const existing = await prisma.scanSheet.findFirst({
    where: { ...scanOwnerWhere(owner), batchNo, side: input.side },
    select: { id: true, storageBackend: true, storageKey: true, mime: true, label: true, _count: { select: { frontTiles: true, backTiles: true } } },
  });
  if (existing && existing._count.frontTiles + existing._count.backTiles > 0) {
    throw new ScanValidationError(
      "This side has already been cut. Re-cut the batch first to replace the scan."
    );
  }
  if (input.side === "back") await assertBatchHasFront(owner, batchNo);

  // The batch's name belongs to the batch, so a sheet joining one takes the name already there and
  // a sheet replacing one keeps it: naming a card and then re-scanning its front must not quietly
  // leave it nameless. A name given with this upload wins, which is the only way to give one at
  // upload at all.
  const label =
    normalizeLabel(input.label) ??
    existing?.label ??
    (await readBatchLabel(owner, batchNo));

  const id = randomUUID();
  const prefix = sheetPrefix(collectionId, id);
  const storage = getActiveStorage();
  const mime = prepared.mime;

  try {
    // The one write in the app that is unambiguously **work** (#591): the retained original is
    // written and the very next thing that happens is detection reading it back to propose the
    // cut, then the cut itself reading it again. On a remote backend that was 200 MB up and 200 MB
    // straight back down, seconds apart. The `view` is the editor's picture and goes up
    // `delivery` — it is served to a browser and never operated on.
    await storage.put(
      sheetVariantKey(prefix, "original", mime),
      prepared.openOriginal(),
      mime,
      "work"
    );
    await storage.put(
      sheetVariantKey(prefix, "view", mime),
      prepared.view.buffer,
      mime,
      "delivery"
    );
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
          collectionId,
          purchaseId: owner.purchaseId,
          batchNo,
          side: input.side,
          label,
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
    label,
    width: prepared.width,
    height: prepared.height,
    viewWidth: prepared.view.width,
    viewHeight: prepared.view.height,
  };
}

/** How large the scan is, before anything decodes it. A path is `stat`ed rather than read: the cap
 * is a policy question and answering it must not be the thing that pulls 200 MB into memory. */
async function sourceSize(source: SheetSource): Promise<number> {
  return Buffer.isBuffer(source) ? source.byteLength : (await stat(source.path)).size;
}

function requireBatchNo(input: { side: SheetSide; batchNo?: number }): number {
  if (input.batchNo == null) {
    throw new ScanValidationError("A back scan must name the batch its front belongs to.");
  }
  return input.batchNo;
}

async function assertBatchHasFront(owner: ScanOwner, batchNo: number): Promise<void> {
  const front = await prisma.scanSheet.findFirst({
    where: { ...scanOwnerWhere(owner), batchNo, side: "front" },
    select: { id: true },
  });
  if (!front) throw new ScanValidationError("That batch has no front scan.");
}

/** Next batch number for a purchase, taken from the purchase's own counter under a row lock so two
 * uploads racing cannot both take the same one (`allocateEntityNumber`'s rule, applied per
 * purchase). Per purchase rather than per lot (#586): the number names the card on the desk, and a
 * parcel of twenty small lots is scanned on one or two cards, not twenty. */
/** The next batch number, off whichever counter owns the card (#725): the order's for a parcel,
 * the collection's for a card scanned outside one. Two counters and not one shared sequence —
 * merging them would renumber batches a collector has already written on physical cards, which is
 * exactly what these counters exist to prevent (#268/#432). */
async function allocateBatchNo(owner: ScanOwner): Promise<number> {
  if (owner.purchaseId) {
    const updated = await prisma.purchase.update({
      where: { id: owner.purchaseId },
      data: { nextScanBatchNo: { increment: 1 } },
      select: { nextScanBatchNo: true },
    });
    return updated.nextScanBatchNo - 1;
  }
  const updated = await prisma.collection.update({
    where: { id: owner.collectionId },
    data: { nextScanBatchNo: { increment: 1 } },
    select: { nextScanBatchNo: true },
  });
  return updated.nextScanBatchNo - 1;
}

// ── The batch's name (#587) ───────────────────────────────────────────────────────────────────

/** Trim to a name or to nothing, refusing one too long. The rule itself lives in the pure
 * `scan-batch-label.ts`, because the input the collector types into needs the same ceiling and a
 * `server-only` module cannot be where a client component reads a constant from. */
function normalizeLabel(label: string | null | undefined): string | null {
  const value = normalizeBatchLabel(label);
  if (isBatchLabelTooLong(value)) {
    throw new ScanValidationError(
      `A card's name can be at most ${MAX_BATCH_LABEL_LENGTH} characters.`
    );
  }
  return value;
}

/** The name already on a batch, from whichever of its sheets still carries it. */
async function readBatchLabel(owner: ScanOwner, batchNo: number): Promise<string | null> {
  const sheet = await prisma.scanSheet.findFirst({
    where: { ...scanOwnerWhere(owner), batchNo, label: { not: null } },
    select: { label: true },
  });
  return sheet?.label ?? null;
}

/**
 * Name a card, or clear its name (#587).
 *
 * Editable **afterwards** and not only at upload, which is the half that matters: a card is often
 * worth naming only once a parcel has been left half-worked for a week and the strip of thumbnails
 * is the only thing telling one from another.
 *
 * Written to every sheet of the batch, exactly as `batchDoneAt` is, so either side answers for it
 * and replacing one scan cannot leave a named card nameless.
 */
export async function setBatchLabel(
  ownerId: string,
  ref: ScanOwnerRef,
  batchNo: number,
  label: string | null
): Promise<{ label: string | null }> {
  const owner = await assertScanOwner(ownerId, ref);
  const value = normalizeLabel(label);
  const { count } = await prisma.scanSheet.updateMany({
    where: { ...scanOwnerWhere(owner), batchNo },
    data: { label: value },
  });
  if (count === 0) throw new ScanValidationError("That batch has no scans to name.");
  return { label: value };
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
  /** Which path the back cut took (#647): `positional` when the two sides held the same number of
   * boxes and the card was paired by position, `manual` when they did not and every back was left
   * to be dropped onto its tile by hand. `positional` on a front commit, which pairs nothing. */
  pairingMode: PairingMode;
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
 * mirroring, nothing forced (`scan-boxes.ts` carries the reasoning), and **only when the two sides
 * hold the same number of boxes** (#647): a back sheet covering a subset pairs by hand instead,
 * because mutual-nearest goes on matching across the gaps and lands the backs one square off. A
 * back that finds no front — or every back, on a mismatch — becomes a **back-only tile**, which is
 * what the collector drags onto a front tile; a front that finds no back simply keeps having none.
 */
export async function commitCut(
  ownerId: string,
  sheetId: string,
  boxes: readonly Box[]
): Promise<CutReport> {
  const owner = await assertSheetOwner(ownerId, sheetId);

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
      purgedAt: true,
    },
  });
  assertSheetNotPurged(sheet);

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
    ? commitFrontCut({ owner, sheetId, batchNo: sheet.batchNo, ordered, crops })
    : commitBackCut({ owner, sheetId, batchNo: sheet.batchNo, sheet, ordered, crops });
}

type Crops = Awaited<ReturnType<typeof cutSheet>>;

async function commitFrontCut(args: {
  owner: ScanOwner;
  sheetId: string;
  batchNo: number;
  ordered: Box[];
  crops: Crops;
}): Promise<CutReport> {
  const { owner, sheetId, batchNo, ordered, crops } = args;
  const { collectionId } = owner;

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
            collectionId,
            purchaseId: owner.purchaseId,
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
    pairingMode: "positional",
    paired: 0,
    frontWithoutBack: rows.map((r) => r.position),
    backOnly: 0,
  };
}

async function commitBackCut(args: {
  owner: ScanOwner;
  sheetId: string;
  batchNo: number;
  sheet: { width: number; height: number };
  ordered: Box[];
  crops: Crops;
}): Promise<CutReport> {
  const { owner, sheetId, batchNo, sheet, ordered, crops } = args;
  const { collectionId } = owner;
  const scope = scanOwnerWhere(owner);

  const frontSheet = await prisma.scanSheet.findFirstOrThrow({
    where: { ...scope, batchNo, side: "front" },
    select: { width: true, height: true },
  });

  // Only front tiles that still have no back take part: a batch's back scan can be cut more than
  // once across re-cuts, and a tile already carrying a back is not looking for one.
  const frontTiles = await prisma.scanTile.findMany({
    where: { ...scope, batchNo, frontSheetId: { not: null }, backSheetId: null },
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
    where: { ...scope, batchNo },
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
              collectionId,
              purchaseId: owner.purchaseId,
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
    where: { ...scope, batchNo, frontSheetId: { not: null } },
  });

  return {
    batchNo,
    side: "back",
    created: rows.filter((r) => r.isNewTile).length,
    frontCount,
    backCount: ordered.length,
    pairingMode: pairing.mode,
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
      // `delivery` (#591): a cut tile is a copy photo like any other — shown, never read back by
      // the server.
      await storage.put(variantKey(prefix, "full", mime), r.crop.full.buffer, mime, "delivery");
      await storage.put(variantKey(prefix, "thumb", mime), r.crop.thumb.buffer, mime, "delivery");
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
  // `work` (#591): every caller of this is an operation over the card — proposing the cut, or
  // taking it. It is also the read the cache's write-through half is aimed at, so on a remote
  // backend this normally never leaves the machine.
  const object = await getStorage(backend).get(
    sheetVariantKey(storageKey, "original", mime),
    mime,
    "work"
  );
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
    select: {
      storageBackend: true,
      storageKey: true,
      mime: true,
      width: true,
      height: true,
      purgedAt: true,
    },
  });
  assertSheetNotPurged(sheet);

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
  if (
    backTile.collectionId !== frontTile.collectionId ||
    backTile.purchaseId !== frontTile.purchaseId
  ) {
    // Both halves of the check, because since #725 "the same owner" is a pair: two tiles of one
    // collection can still belong to different orders, and a purchase-less tile must not be
    // dragged onto a parcel's card or the other way about.
    throw new ScanValidationError("Both tiles must be on the same card.");
  }
  await assertScanCollectionOwner(ownerId, backTile.collectionId);

  if (backTile.frontSheetId != null) {
    throw new ScanValidationError("Only a tile with no front image can be paired onto another.");
  }
  if (frontTile.frontSheetId == null) {
    throw new ScanValidationError("A back can only be paired onto a tile that has a front.");
  }
  if (frontTile.backSheetId != null) {
    throw new ScanValidationError("That tile already has a back image.");
  }
  // A **parked** tile takes a back like any other waiting one (#597), and is one of the tiles most
  // likely to want it: the doubt that parked it is often a watermark or a cancel that the other
  // side settles.
  if (!isOpenTileState(frontTile.state)) {
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

/**
 * Take a back off the tile it is paired to, and stand it back up as a **back-only tile** (#648).
 *
 * The inverse of {@link pairTilesManually} and deliberately its exact shape in reverse: the back
 * lands where an unpaired back lands — the strip under the batch — so reassigning it is the drag
 * that was already there rather than a second vocabulary for the same move. Nothing is deleted and
 * nothing is re-cut; one `Photo` row changes owner and the box columns move with it.
 *
 * **Why this has to exist at all**: before it, a back on the wrong tile could only be undone by
 * deleting the batch, which throws away every correctly identified tile beside it — a whole card's
 * work for one mis-pairing. Re-cutting is no better: it is refused the moment a tile has become a
 * copy, which on a card being worked through is most of them.
 *
 * **Only from a tile still being worked.** A `consumed` tile's images belong to the copy it became
 * (#567 re-owned the rows), so there is nothing here to take back — the copy's own screens are
 * where its photographs are changed. A `discarded` tile is refused for the same reason the pairing
 * path refuses it: *Put back in the queue* is one press away in the same dialog, and one rule about
 * which tiles are still workable is better than two that can drift.
 */
export async function unpairTileBack(ownerId: string, tileId: string): Promise<void> {
  const tile = await loadTile(tileId);
  await assertScanCollectionOwner(ownerId, tile.collectionId);
  const scope = scanOwnerWhere(tile);

  if (tile.backSheetId == null) {
    throw new ScanValidationError("That tile has no back image to unpair.");
  }
  if (tile.frontSheetId == null) {
    throw new ScanValidationError("That back is not paired to anything.");
  }
  if (!isOpenTileState(tile.state)) {
    throw new ScanValidationError("That tile has already been dealt with.");
  }

  // Appended after everything in the batch, exactly as an unmatched back is at commit: a position
  // is what the collector reads off the strip to find a piece in the tray, so nothing already on
  // screen may shift because a back was taken off one square.
  const maxPosition = await prisma.scanTile.aggregate({
    where: { ...scope, batchNo: tile.batchNo },
    _max: { position: true },
  });

  await prisma.$transaction(async (tx) => {
    const freed = await tx.scanTile.create({
      data: {
        collectionId: tile.collectionId,
        purchaseId: tile.purchaseId,
        batchNo: tile.batchNo,
        position: (maxPosition._max.position ?? -1) + 1,
        backSheetId: tile.backSheetId,
        backX: tile.backX,
        backY: tile.backY,
        backW: tile.backW,
        backH: tile.backH,
      },
      select: { id: true },
    });
    const moved = await tx.photo.updateMany({
      where: { tileId, role: "back" },
      data: { tileId: freed.id },
    });
    // A tile carrying back columns and no back picture is a state nothing here can produce, and
    // standing an empty square up on the strip would be worse than refusing: the collector would
    // be dragging a blank onto a stamp.
    if (moved.count === 0) {
      throw new ScanValidationError("That tile's back image is no longer there.");
    }
    await tx.scanTile.update({
      where: { id: tileId },
      data: { backSheetId: null, backX: null, backY: null, backW: null, backH: null },
    });
  });

  // The batch has an unpaired back waiting to be placed, so it is not finished with — and #578
  // sweeps the retained scan of a batch that is. Same clearing `returnTilesToQueue` does, for the
  // same reason: the card must still be there for the piece the collector is coming back to.
  await prisma.scanSheet.updateMany({
    where: { ...scope, batchNo: tile.batchNo, batchDoneAt: { not: null } },
    data: { batchDoneAt: null },
  });
}

async function loadTile(tileId: string) {
  const tile = await prisma.scanTile.findUnique({
    where: { id: tileId },
    select: {
      id: true,
      collectionId: true,
      purchaseId: true,
      batchNo: true,
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
 *
 * **Refused once the scan has been swept** (#578), and this is the refusal that sweep exists to make
 * possible: the row survives the purge precisely so this can say *the scan has been deleted* instead
 * of the cut failing later on a file that is not there. It matters most for the batch whose tiles
 * were all **discarded** — the one case that would otherwise still be re-cuttable after the sweep.
 */
export async function recutBatch(
  ownerId: string,
  ref: ScanOwnerRef,
  batchNo: number
): Promise<{ discarded: number }> {
  const owner = await assertScanOwner(ownerId, ref);

  const purged = await prisma.scanSheet.count({
    where: { ...scanOwnerWhere(owner), batchNo, purgedAt: { not: null } },
  });
  if (purged > 0) {
    throw new ScanValidationError(PURGED_SCAN_MESSAGE);
  }

  return { discarded: await clearBatchTiles(owner, batchNo) };
}

/** The tile side of a re-cut, without the purged-scan guard — shared with `deleteBatch`, which is
 * still allowed on a batch whose scan has been swept: what it is deleting is the record, and a
 * record whose bytes are gone is no harder to throw away than one whose bytes are there. */
async function clearBatchTiles(owner: ScanOwner, batchNo: number): Promise<number> {
  const scope = scanOwnerWhere(owner);
  const consumed = await prisma.scanTile.count({
    where: { ...scope, batchNo, state: "consumed" },
  });
  if (consumed > 0) {
    throw new ScanValidationError(
      `${consumed} ${consumed === 1 ? "tile has" : "tiles have"} already become copies. Re-cutting would delete their images.`
    );
  }

  const discarded = await deleteTiles({ ...scope, batchNo });
  // The batch is being drawn again, so it is no longer finished with (#567) — clearing the stamp
  // is what keeps #578 from sweeping away the original a re-cut is about to be taken from. A batch
  // whose tiles were all *discarded* is exactly the one that reaches here already stamped.
  await prisma.scanSheet.updateMany({
    where: { ...scope, batchNo, batchDoneAt: { not: null } },
    data: { batchDoneAt: null },
  });
  return discarded;
}

/**
 * Delete a whole batch: its tiles first, then its sheets. That order is the only one the tiles'
 * `Restrict` reference to their sheet allows, and it is also the honest one — a sheet with tiles
 * still hanging off it is not a batch anyone has finished with.
 */
export async function deleteBatch(
  ownerId: string,
  ref: ScanOwnerRef,
  batchNo: number
): Promise<void> {
  const owner = await assertScanOwner(ownerId, ref);
  const scope = scanOwnerWhere(owner);
  await clearBatchTiles(owner, batchNo);
  const sheets = await prisma.scanSheet.findMany({
    where: { ...scope, batchNo },
    select: { id: true, storageBackend: true, storageKey: true, mime: true },
  });
  await prisma.scanSheet.deleteMany({ where: { ...scope, batchNo } });
  await Promise.all(
    sheets.map((s) => deleteSheetVariants(s.storageBackend, s.storageKey, s.mime))
  );
}

/** Delete tiles matching a scope, taking their photo bytes with them. Prisma's cascade drops the
 * `Photo` rows but never the files — the same split `deletePhotoBytesForItem` exists for. */
async function deleteTiles(where: {
  collectionId: string;
  purchaseId: string | null;
  batchNo?: number;
}): Promise<number> {
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
 * Every scan byte belonging to some purchases — the tiles' crops and the retained sheets.
 *
 * Collected **before** the rows go and deleted only **after** they are gone, in two calls rather
 * than one, because the delete they accompany can be refused: a purchase whose lots still hold
 * copies is blocked by the DB, and a single "delete the bytes then delete the rows" helper would
 * have destroyed the collector's scans on the way to an error message. Once the rows are gone
 * there is no way back to the keys, hence collecting first; once the delete has succeeded there is
 * nothing left pointing at the files, hence deleting after.
 *
 * **Deleting a lot no longer reaches here** (#586): scans belong to the parcel, and a lot line
 * being removed is not the card being thrown away. Only deleting the purchase takes them.
 */
export async function collectScanStorageRefs(
  purchaseIds: readonly string[]
): Promise<ScanStorageRef[]> {
  if (purchaseIds.length === 0) return [];
  const where = { purchaseId: { in: [...purchaseIds] } };
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

// ── Retention (#578) ──────────────────────────────────────────────────────────────────────────

/** What everything that would have read a swept scan says instead. One sentence in one place: a
 * re-cut, a commit and a proposal all reach the same dead end, and they should not describe it
 * three ways. */
export const PURGED_SCAN_MESSAGE =
  "The scan has been deleted. This batch was finished with, so its retained original was swept " +
  "under the collection's scan retention setting.";

function assertSheetNotPurged(sheet: { purgedAt: Date | null }): void {
  if (sheet.purgedAt) throw new ScanValidationError(PURGED_SCAN_MESSAGE);
}

/** What one pass of {@link purgeFinishedScanSheets} freed. */
export interface ScanSheetPurge {
  /** Sheets whose bytes were deleted. Both sides of a batch are stamped together, so a two-sided
   * batch counts as two. */
  sheets: number;
  /** `sizeBytes` those sheets were carrying — what the collection's storage total (#144) drops by. */
  bytes: number;
}

/**
 * Delete the retained originals of batches that have been **finished with** longer than the
 * collection's scan retention period (#578). An hourly sweep started from `instrumentation.ts`
 * `register()`, beside the closed-offer photo purge (#512) it is modelled on: idempotent,
 * best-effort, and never anything but a delete.
 *
 * What makes a batch eligible is `batchDoneAt` (#567) — the moment its **last** tile left
 * `unidentified`. From there a consumed tile refuses a re-cut, so the scan can never become anything
 * again; and if a discard is put back or the batch is re-cut, that stamp is cleared, so the clock
 * never counts down on a batch still being worked.
 *
 * **The bytes go and the row stays.** The sheet is marked `purgedAt` and its `sizeBytes` drops to 0
 * — so the storage total moves without any reader having to learn about the flag — while the batch
 * keeps listing what it held and a re-cut refuses with {@link PURGED_SCAN_MESSAGE} rather than
 * failing on a file that is not there. That is the whole reason to keep the row.
 *
 * Both variants go, `original` and `view` alike: the derivative exists only to be drawn on in the
 * cut editor, and a batch that can never be cut again has no use for it either.
 *
 * The period is resolved **per collection**, so a pass per collection rather than one query across
 * all of them — the cutoff is different for each, and a collection that keeps for ever has no cutoff
 * at all. On an instance where nobody has configured anything that is every collection, and this
 * function does nothing: the default is keep for ever, because a card scan is a source (see
 * `DEFAULT_SCAN_SHEET_TTL_MS`).
 *
 * `only` narrows the sweep to one purchase, for the same test-isolation reason
 * `purgeClosedOfferPhotos` takes one offer; the boot path passes nothing.
 */
export async function purgeFinishedScanSheets(
  now: Date = new Date(),
  only?: { purchaseId: string }
): Promise<ScanSheetPurge> {
  const result: ScanSheetPurge = { sheets: 0, bytes: 0 };

  const collections = await prisma.collection.findMany({
    select: { id: true, scanSheetTtlDays: true },
  });

  for (const collection of collections) {
    const cutoff = scanSheetCutoff(now, resolveScanSheetTtlMs(collection.scanSheetTtlDays));
    if (!cutoff) continue;

    const sheets = await prisma.scanSheet.findMany({
      where: {
        ...(only ? { purchaseId: only.purchaseId } : {}),
        collectionId: collection.id,
        purgedAt: null,
        batchDoneAt: { lt: cutoff },
      },
      select: {
        id: true,
        storageBackend: true,
        storageKey: true,
        mime: true,
        sizeBytes: true,
      },
    });

    for (const sheet of sheets) {
      // The row first, exactly as the closed-offer purge writes its rows before touching storage: a
      // failure on the way to the files leaves at worst an unreferenced object, while the reverse
      // would leave a sheet the app still believes it can cut from.
      await prisma.scanSheet.update({
        where: { id: sheet.id },
        data: { purgedAt: now, sizeBytes: 0 },
      });
      await deleteSheetVariants(sheet.storageBackend, sheet.storageKey, sheet.mime);
      result.sheets += 1;
      result.bytes += sheet.sizeBytes;
    }
  }

  return result;
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
  /** Whether the retention sweep has taken this scan's bytes (#578). The row is still here and the
   * batch still lists its tiles; what is gone is the ability to cut it again, which is why the
   * screen stops offering a re-cut rather than letting one fail. */
  purged: boolean;
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
   * `frontPhotoId`/`backPhotoId` are that copy's photos, which **are** the tile's old rows under
   * their new owner: consuming a tile reassigns `tileId → itemId`, so the pictures never went
   * anywhere. The strip follows them there rather than drawing an empty square over a tile that went
   * perfectly well, and the tile's own dialog shows them at full size (#584).
   *
   * The rest is **enough of the copy to recognise it** (#584), which is what a consumed tile's
   * dialog exists to say now that the click no longer leaves for it — and, since #757, enough to
   * **name the stamp the way the rest of the app does**: the numbers travel with their vendor, and
   * the issue and its area come along, so the client resolves the prefix through the same
   * `useAreaVendorMaps` every catalogue chip goes through. The formatting stays on the client on
   * purpose; what this read gained is the two ids it could not derive, not a label. */
  item: {
    id: string;
    itemNo: number;
    /**
     * **What the copy currently answers to the identification's questions** — the prefill a
     * re-identification opens on (`reidentifyTileCopy`), so correcting a tile starts from what the
     * copy *is* rather than from the remembered defaults of a card worked an hour ago.
     *
     * Read here rather than fetched when the correction starts: the identification chain crosses
     * three dialogs, and a copy fetched at the far end of it is a second answer to a question this
     * row already holds. `stampId` was already being read for `outsideDescription`, and the rest are
     * scalars on the same row.
     *
     * A **correction** never reads `lotId` — which lot the copy's money comes from is not a question
     * the identification asks, and correcting one leaves it exactly where it is. It is read all the
     * same, for the identification *history* (#757): repeating an identification onto the next tile
     * carries the lot with it, the way #595's *Same as the last* did while the answers lived in
     * screen state, and a lot that has since closed falls back to the first one offered like every
     * other prefilled id the condition step is handed.
     */
    stampId: string;
    conditionId: string;
    certificateStatusId: string | null;
    formatId: string | null;
    locationId: string | null;
    locationRef: string | null;
    lotId: string | null;
    inCollection: boolean;
    forSale: boolean;
    forTrade: boolean;
    /** When the copy was created (#757) — the identification's own time, and what orders the
     * history: the tile carries no `consumedAt`, and consuming one *is* creating this row.
     *
     * An **assigned** tile is the exception the ordering absorbs rather than excludes: its copy
     * existed before the card was scanned, so it sorts back with its own age and drops off the end
     * of a ten-row list by itself. */
    createdAt: string;
    frontPhotoId: string | null;
    backPhotoId: string | null;
    stampName: string | null;
    catalogNumbers: { catalogVendorId: string; number: string }[];
    /** The issue this copy's stamp is reported under, and that issue's area — the **first**
     * membership, the one-issue-per-stamp rule every other read follows, and the same pair
     * `TileCandidate` carries for the same reason. They are what `vendorMapFor` is keyed by, so
     * without them a number can only be printed bare. Null for a stamp on no issue. */
    issueId: string | null;
    collectionAreaId: string | null;
    conditionAbbreviation: string;
  } | null;
  /** What this piece **could be** (#607) — the shortlist a parked tile carries, in the order it was
   * built. Empty on every other tile: a shortlist is the working state of a piece still to be
   * identified, and nothing survives the identification (see `tile-candidates.ts`).
   *
   * Read for every tile rather than only the parked ones, because the strip and the dialog draw the
   * same `ScanTileData` and a second, narrower read would be a second answer to one question. */
  candidates: TileCandidate[];
  /** True when this tile's copy is for a stamp on **none** of the settled auction lot's lines
   * (#567): the parcel holds something its description never announced. Information rather than a
   * problem to hide — always false on a lot that came from no auction. */
  outsideDescription: boolean;
}

export interface ScanBatchData {
  batchNo: number;
  /** The card's own name (#587), or null. A gloss on the number, never a replacement for it: the
   * number is assigned rather than chosen and is what makes a batch findable, so both are drawn
   * wherever the batch is named, including on a collapsed batch's one summary line (#583). */
  label: string | null;
  front: ScanSheetData | null;
  back: ScanSheetData | null;
  tiles: ScanTileData[];
  /** When the last tile of this batch left `unidentified` (#567), or null while any is still
   * waiting. Read from the batch's sheets, which is where it is stamped. */
  doneAt: string | null;
}

export interface ScansData {
  batches: ScanBatchData[];
  /** Whether this purchase was settled from a won auction sale (ADR-0021) — which is what makes
   * "assign this tile to a copy the order already holds" the ordinary path rather than the
   * exception: settlement created identified copies that need photographs, not identification.
   * Always false for cards scanned outside an order (#725), which came from no sale at all. */
  fromAuction: boolean;
}

/**
 * Every batch of one owner, newest first — the shape the Card scans section renders and the review
 * editor reloads a previous cut from.
 *
 * One function for both screens (#725). The order's version reads its auction description; the
 * collection's has none to read, and asks for nothing an order-less card cannot answer.
 */
export async function listScans(ownerId: string, ref: ScanOwnerRef): Promise<ScansData> {
  const owner = await assertScanOwner(ownerId, ref);
  const scope = scanOwnerWhere(owner);
  const purchaseId = owner.purchaseId;

  // The auction lines this parcel was described by, when it came from a settled sale. Read as a
  // set of stamp ids across **every** lot of the purchase, because the question asked of it is
  // whether the parcel held something its description never listed — and the parcel is the order,
  // which is also the only level a card exists at. A card with no order was described by nobody,
  // so both reads are skipped rather than answered with an empty parcel's answers.
  const auctionLots = purchaseId
    ? await prisma.auctionLot.findMany({
        where: { purchaseLot: { purchaseId } },
        select: { lines: { select: { stampId: true } } },
      })
    : [];
  const describedStampIds = new Set(
    auctionLots.flatMap((l) => l.lines.map((line) => line.stampId))
  );
  const auctionSale = purchaseId
    ? await prisma.auctionSale.findUnique({
        where: { purchaseId },
        select: { id: true },
      })
    : null;

  const [sheets, tiles] = await Promise.all([
    prisma.scanSheet.findMany({
      where: scope,
      select: {
        id: true,
        batchNo: true,
        side: true,
        label: true,
        width: true,
        height: true,
        viewWidth: true,
        viewHeight: true,
        batchDoneAt: true,
        purgedAt: true,
        _count: { select: { frontTiles: true, backTiles: true } },
      },
      orderBy: { batchNo: "desc" },
    }),
    prisma.scanTile.findMany({
      where: scope,
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
        // The shortlist a parked tile carries (#607), with everything the *use the parent instead*
        // correction needs to decide itself and then name the parent: the variant flags
        // (`VARIANT_FLAG_SELECT`) and the parent node. Resolved into `TileCandidate` by the pure
        // module, so the effective-flag order is stated once.
        candidates: {
          select: {
            stamp: {
              select: {
                id: true,
                name: true,
                catalogNumbers: { select: { number: true } },
                // What a measured perforation and a picked watermark are compared against (#740).
                // Read with the shortlist rather than fetched when a reading is taken: the answer
                // is wanted the moment the drag is released, and a card of forty tiles has already
                // paid for this row.
                perforation: true,
                watermarkId: true,
                watermark: { select: { name: true } },
                ...VARIANT_FLAG_SELECT,
                parent: {
                  select: { id: true, name: true, catalogNumbers: { select: { number: true } } },
                },
                // The issue the candidate is reported under — the **first** membership, the same
                // one-issue-per-stamp rule the copies list and the issue groups follow, ordered so
                // it is one answer rather than whatever the database hands back. The screen draws a
                // candidate as the picker's own row, and that row is fetched per issue and
                // formatted per area.
                issueMemberships: {
                  orderBy: { issueId: "asc" },
                  take: 1,
                  select: { issue: { select: { id: true, collectionAreaId: true } } },
                },
                // Whether the candidate is itself an umbrella — picking it would mean *this stamp,
                // variant unknown*, which the row says exactly as the picker's does.
                variants: { select: VARIANT_FLAG_SELECT },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        item: {
          select: {
            id: true,
            itemNo: true,
            stampId: true,
            // What the correction's condition step opens on — see `ScanTileData.item`.
            conditionId: true,
            certificateStatusId: true,
            formatId: true,
            locationId: true,
            locationRef: true,
            // The lot and the copy's age, for the identification history (#757) — see
            // `ScanTileData.item`. Scalars on a row this read already has in hand.
            lotId: true,
            createdAt: true,
            inCollection: true,
            forSale: true,
            forTrade: true,
            // The very rows this tile handed over, now owned by the copy. Both sides, since the
            // tile's own dialog shows them at full size (#584) — the strip only ever wanted the
            // front.
            photos: { where: { role: { in: ["front", "back"] } }, select: { id: true, role: true } },
            condition: { select: { abbreviation: true } },
            stamp: {
              select: {
                name: true,
                // With the vendor, so the client can prefix them (#757) — the same shape the
                // shortlist's numbers would have needed had they ever been formatted.
                catalogNumbers: { select: { catalogVendorId: true, number: true } },
                issueMemberships: {
                  orderBy: { issueId: "asc" },
                  take: 1,
                  select: { issue: { select: { id: true, collectionAreaId: true } } },
                },
              },
            },
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
      b = { batchNo, label: null, front: null, back: null, tiles: [], doneAt: null };
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
      purged: s.purgedAt != null,
    };
    const batch = batchOf(s.batchNo);
    if (data.side === "front") batch.front = data;
    else batch.back = data;
    // Both sheets of a batch are stamped together, so either one answers for it. The card's name
    // (#587) is written the same way and read the same way.
    if (s.batchDoneAt) batch.doneAt = s.batchDoneAt.toISOString();
    if (s.label) batch.label = s.label;
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
      candidates: t.candidates.map((c) => toTileCandidate(c.stamp)),
      item: t.item
        ? {
            id: t.item.id,
            itemNo: t.item.itemNo,
            stampId: t.item.stampId,
            conditionId: t.item.conditionId,
            certificateStatusId: t.item.certificateStatusId,
            formatId: t.item.formatId,
            locationId: t.item.locationId,
            locationRef: t.item.locationRef,
            lotId: t.item.lotId,
            createdAt: t.item.createdAt.toISOString(),
            inCollection: t.item.inCollection,
            forSale: t.item.forSale,
            forTrade: t.item.forTrade,
            frontPhotoId: t.item.photos.find((p) => p.role === "front")?.id ?? null,
            backPhotoId: t.item.photos.find((p) => p.role === "back")?.id ?? null,
            stampName: t.item.stamp.name,
            catalogNumbers: t.item.stamp.catalogNumbers.map((c) => ({
              catalogVendorId: c.catalogVendorId,
              number: c.number,
            })),
            issueId: t.item.stamp.issueMemberships[0]?.issue.id ?? null,
            collectionAreaId: t.item.stamp.issueMemberships[0]?.issue.collectionAreaId ?? null,
            conditionAbbreviation: t.item.condition.abbreviation,
          }
        : null,
      // Only an order with an auction description can disagree with one. An order with no lines at
      // all (a hand-entered purchase) says nothing about any tile, rather than saying they are all
      // undescribed. The lines are the whole parcel's, since the card is the whole parcel's too.
      outsideDescription:
        describedStampIds.size > 0 && t.item != null && !describedStampIds.has(t.item.stampId),
    });
  }

  return {
    batches: [...batches.values()].sort((a, b) => b.batchNo - a.batchNo),
    fromAuction: auctionSale != null,
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

/** How many tiles on an **order** are still waiting to become something (#586). What the order
 * header counts and what a lot close still warns about — a warning, never a block, matching the
 * existing `N to sort`: a tile has no stamp, so no catalogue price, so no weight in any lot's cost
 * split. Discarded tiles are deliberately not counted: a discarded tile is evidence, not a queue
 * item (#567). */
export async function countUnidentifiedTiles(owner: ScanOwner): Promise<number> {
  return prisma.scanTile.count({ where: { ...scanOwnerWhere(owner), state: "unidentified" } });
}

/** How many tiles on an order are **parked** (#597) — set aside because the piece cannot be told
 * apart on screen, and waiting for the colour key, the UV lamp or the reference album. Counted
 * apart from the waiting ones on purpose: both are outstanding work, but only one of them is work
 * that can be done now, and folding them together would put the parked pieces back into the sweep
 * they were parked to leave. */
export async function countParkedTiles(owner: ScanOwner): Promise<number> {
  return prisma.scanTile.count({ where: { ...scanOwnerWhere(owner), state: "parked" } });
}

/** What the Card scans header says before the batches are fetched (#725) — the three figures the
 * order's own screen gets from `getPurchaseDetail`, for an owner that has no detail page to get
 * them from. Server-rendered with the screen, so the section can say what is inside while still
 * collapsed. */
export async function getScanCounts(
  ownerId: string,
  ref: ScanOwnerRef
): Promise<{ unidentifiedTileCount: number; parkedTileCount: number; scanSheetCount: number }> {
  const owner = await assertScanOwner(ownerId, ref);
  const scope = scanOwnerWhere(owner);
  const [unidentifiedTileCount, parkedTileCount, scanSheetCount] = await Promise.all([
    prisma.scanTile.count({ where: { ...scope, state: "unidentified" } }),
    prisma.scanTile.count({ where: { ...scope, state: "parked" } }),
    prisma.scanSheet.count({ where: scope }),
  ]);
  return { unidentifiedTileCount, parkedTileCount, scanSheetCount };
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
  /** True once the retention sweep has taken the bytes (#578). The row still resolves — the route
   * needs the owning collection to answer safely — so the check belongs to the caller, which turns
   * it into a plain *not found* rather than a storage error out of the backend. */
  purged: boolean;
} | null> {
  const sheet = await prisma.scanSheet.findUnique({
    where: { id: sheetId },
    select: {
      storageBackend: true,
      storageKey: true,
      mime: true,
      width: true,
      height: true,
      purgedAt: true,
      collectionId: true,
      collection: { select: { ownerId: true } },
    },
  });
  if (!sheet) return null;
  return {
    collectionId: sheet.collectionId,
    ownerId: sheet.collection.ownerId,
    storageBackend: sheet.storageBackend,
    storageKey: sheet.storageKey,
    mime: sheet.mime,
    width: sheet.width,
    height: sheet.height,
    purged: sheet.purgedAt != null,
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
