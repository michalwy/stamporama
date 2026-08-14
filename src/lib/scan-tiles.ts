import "server-only";
import { prisma } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { formatItemNo } from "./item-number";
import { intakeStamps } from "./lots";
import { autoSeedStampMainFromFront } from "./photos";
import { ScanAuthError, ScanValidationError, assertScanPurchaseOwner } from "./scan-sheets";
import { conflictingPhotoRoles, photoRolesPresent } from "./tile-photo-roles";

/**
 * Turning a scan tile into something (#567, ADR-0033) — the second half of the scan-first intake.
 *
 * #566 leaves an order holding tiles: images of stamps nobody has identified yet. Each one has
 * exactly **three ends**, and this module is all three of them.
 *
 * - **A new copy** — the stockbook path. The stamp is identified from the catalogue and the tile's
 *   images move onto the created copy. Ordinary intake, entered from a tile instead of from a
 *   stamp picker, so it goes through `intakeStamps` rather than around it: the arrived-order rule
 *   (#121), the internal copy number (#268), the format (#573) and the dispositions (#160) are
 *   that function's, and a second implementation of them here would be a second set to keep right.
 *
 * - **An existing copy on the order** — the auction path. A purchase settled from a won auction
 *   sale already holds identified copies, because the contents were described in order to bid;
 *   those copies need **photographs, not identification**, and picking from named lines is less
 *   desk work than identifying from scratch. Settlement is deliberately not changed to produce tiles
 *   instead (see the issue): a tile has no stamp, so it can be counted against no want (ADR-0032),
 *   carries no catalogue price, so lot closing before arrival would be blocked, and the order's
 *   own catalogue-value bar would read zero until delivery.
 *
 * - **A discard, leaving a trace** — junk, damaged beyond interest, unidentifiable. The tile keeps
 *   its image, carries a note, drops out of the unidentified count so it stops nagging before lot
 *   close, and survives the close. For a stockbook bought sight-unseen it is the only record of
 *   what was actually inside: **a discarded tile is evidence, not a queue item.**
 *
 * Two rules run through all three:
 *
 * - **Images move, they are never copied.** A tile's crops are `Photo` rows under the fourth owner
 *   (ADR-0033 §2), so handing them to a copy is `tileId → itemId` on the same row. No second row,
 *   no second bytes, and nothing for a cleanup to disagree about later.
 * - **The batch is stamped when its last tile leaves `unidentified`.** From that moment it can
 *   never be re-cut, so its retained original has no remaining function. Nothing here reads the
 *   stamp; #578's retention sweep does.
 *
 * Since #586 a tile belongs to the **purchase**, so this module carries the one question that move
 * left behind: **a copy still belongs to a lot**, and it is identification — not scanning — that
 * can answer which. `assignTileToCopy` asks nothing, the copy having a lot already; only
 * `identifyTileAsNewCopy` needs one, and a purchase with a single lot answers it without asking.
 */

/** What a tile became, for the caller to say so on screen. */
export interface TileOutcome {
  itemId: string;
  itemNo: number;
}

// ── Creating a copy from a tile ───────────────────────────────────────────────────────────────

/**
 * Identify a tile into a **new copy** and hand that copy the tile's images.
 *
 * Everything about the copy itself is `intakeStamps`' — including the refusal to identify into a
 * closed lot, and the rule that an already-arrived order produces `to_sort` rather than `ordered`.
 * What is added here is the two writes that make it a *tile's* copy: the `Photo` rows change owner,
 * and the tile records what it became.
 *
 * No photo change-set is accepted, deliberately. The tile's crops **are** this copy's front and
 * back; a second front arriving from an upload would collide with the partial unique on
 * `(itemId, role)`, and the collector reaching for a file picker at the exact moment a photograph
 * of the stamp is already on screen is not a flow worth building a merge for.
 *
 * **Which lot** is the one thing #586 left to be asked here. A copy takes its cost basis from a
 * lot, and a card of a settled auction holds pieces belonging to a dozen of them, so the lot cannot
 * come from the sheet any more. `lotId` is therefore the caller's to supply — and optional, because
 * a purchase with **one** lot answers it on its own: the stockbook case must not grow a question it
 * never had. Several with none named is a refusal rather than a guess, since guessing here files a
 * stamp against the wrong money.
 */
export async function identifyTileAsNewCopy(
  ownerId: string,
  tileId: string,
  input: {
    /** The lot the created copy belongs to. Omitted when the purchase has exactly one, which is
     * then used silently. */
    lotId?: string | null;
    stampId: string;
    conditionId: string;
    certificateStatusId?: string | null;
    locationId?: string | null;
    locationRef?: string | null;
    formatId?: string | null;
    inCollection?: boolean;
    forSale?: boolean;
    forTrade?: boolean;
  }
): Promise<TileOutcome> {
  const tile = await loadUnidentifiedTile(ownerId, tileId);
  if (!input.stampId) throw new ScanValidationError("Pick a stamp to identify this tile as.");
  const lotId = await resolveTileLot(tile.purchaseId, input.lotId);

  const copies = await intakeStamps(ownerId, lotId, {
    stampId: input.stampId,
    conditionId: input.conditionId,
    certificateStatusId: input.certificateStatusId,
    locationId: input.locationId,
    locationRef: input.locationRef,
    formatId: input.formatId,
    inCollection: input.inCollection,
    forSale: input.forSale,
    forTrade: input.forTrade,
  });
  const copy = copies[0];
  if (!copy) throw new ScanValidationError("The copy could not be created.");

  // No role clash is possible: the copy was created a moment ago and this path refuses a photo
  // change-set, so both slots are free. That is why the check lives on the assign path, which is
  // the one that can meet an occupied slot.
  await consumeTile(tile.id, copy.itemId);
  await seedStampImage(ownerId, copy.itemId);
  return { itemId: copy.itemId, itemNo: copy.itemNo };
}

/**
 * The lot a tile's new copy goes onto (#586).
 *
 * Three answers, and the middle one is the whole reason this is a function rather than a required
 * argument: a purchase with **one** lot is the stockbook case, which had no such question before
 * this move and must not gain one. Several lots and no answer is a refusal — a default lot on the
 * batch was considered and rejected because a parcel of many small lots puts a dozen of them on one
 * card, and a pointer from the card to a lot would then be *false* rather than merely unhelpful.
 *
 * A named lot is checked against the tile's own purchase, so a stale remembered answer — the
 * previous parcel's lot, still in the browser — is refused rather than filing a stamp against
 * another order's money.
 */
async function resolveTileLot(
  purchaseId: string,
  lotId: string | null | undefined
): Promise<string> {
  if (lotId) {
    const lot = await prisma.purchaseLot.findFirst({
      where: { id: lotId, purchaseId },
      select: { id: true },
    });
    if (!lot) throw new ScanValidationError("That lot is not on this order.");
    return lot.id;
  }
  const lots = await prisma.purchaseLot.findMany({
    where: { purchaseId },
    select: { id: true },
    take: 2,
  });
  if (lots.length === 0) {
    throw new ScanValidationError("This order has no lots yet. Add one to identify tiles into.");
  }
  if (lots.length > 1) {
    throw new ScanValidationError("Choose which lot this copy belongs to.");
  }
  return lots[0].id;
}

// ── Assigning a tile to a copy that already exists ────────────────────────────────────────────

/**
 * Give the tile's images to a copy **already on this order** — the auction path.
 *
 * Allowed on a **closed** lot, unlike creating a copy. Closing freezes the money (ADR-0009 §3),
 * and a photograph is not money: it changes no catalogue price, no weight and no cost basis. What
 * a closed lot refuses is a *new* copy, because that would change the set the pool was split
 * across — and that refusal is `intakeStamps`', where it belongs.
 *
 * The target must be on the same **purchase** (#586), which is the improvement rather than the
 * concession: at a settlement the copies that need photographs are every line of every won lot,
 * arriving in one envelope and scanned on one card, and the old same-lot rule made most of them
 * unreachable from the tile in front of the collector. This path asks nothing about lots because
 * the copy already has one — it is only *creating* a copy that has to name one.
 */
export async function assignTileToCopy(
  ownerId: string,
  tileId: string,
  itemId: string
): Promise<TileOutcome> {
  const tile = await loadUnidentifiedTile(ownerId, tileId);

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      itemNo: true,
      lot: { select: { purchaseId: true } },
      photos: { select: { role: true } },
    },
  });
  if (!item) throw new ScanAuthError("Copy not found or access denied.");
  if (item.lot?.purchaseId !== tile.purchaseId) {
    throw new ScanValidationError("That copy is not on this order.");
  }

  // Front and back are singleton slots per owner. A copy that already holds one of the roles this
  // tile carries is refused rather than resolved by demoting the crop to an extra — an image quietly
  // filed where the copy's front is looked for is worse than a sentence saying which slot is taken.
  //
  // `tile-photo-roles.ts` owns this comparison, and the **candidate list reads the same rule** so it
  // cannot offer what this refuses.
  const clash = conflictingPhotoRoles(
    photoRolesPresent(tile.photos),
    photoRolesPresent(item.photos)
  );
  if (clash.length > 0) {
    throw new ScanValidationError(
      `Copy ${formatItemNo(item.itemNo)} already has ${clash.length === 2 ? "front and back images" : `a ${clash[0]} image`}. Remove ${clash.length === 2 ? "them" : "it"} first, or pick another copy.`
    );
  }

  await consumeTile(tile.id, item.id);
  await seedStampImage(ownerId, item.id);
  return { itemId: item.id, itemNo: item.itemNo };
}

// ── Discarding ────────────────────────────────────────────────────────────────────────────────

/**
 * Record that a tile became **nothing**, and why.
 *
 * The images stay on the tile: a discard is not a delete. It leaves the unidentified count — it
 * has been dealt with, and a count that kept nagging about junk would be a count nobody reads —
 * and it survives the lot closing, because for a stockbook bought sight-unseen the discarded tiles
 * are the only record of what the parcel actually held.
 *
 * The note is optional and the screen does not stop to ask for one: *junk* is a complete answer,
 * and demanding a sentence for it would make the cheap outcome the expensive one, which is how a
 * queue stops being worked through. `noteDiscardedTile` is where a note is added afterwards, on
 * the rare tile that deserves one.
 */
export async function discardTile(
  ownerId: string,
  tileId: string,
  note?: string | null
): Promise<void> {
  const tile = await loadUnidentifiedTile(ownerId, tileId);
  await prisma.scanTile.update({
    where: { id: tile.id },
    data: { state: "discarded", note: note?.trim() || null },
  });
  await stampBatchIfFinished(tile.purchaseId, tile.batchNo);
}

/**
 * Write (or clear) a discarded tile's note.
 *
 * Discarding takes **one click** and asks for nothing, because on a parcel full of junk it is the
 * frequent answer and a note form in front of it would make the cheap outcome the expensive one.
 * That is only safe because the note is reachable afterwards — here — and because the discard
 * itself can be undone. What a note is *for* is the sight-unseen stockbook: months later, "thinned"
 * against a picture is the difference between a record and a blank.
 */
export async function noteDiscardedTile(
  ownerId: string,
  tileId: string,
  note: string | null
): Promise<void> {
  const tile = await loadTileForOwner(ownerId, tileId);
  if (tile.state !== "discarded") {
    throw new ScanValidationError("Only a discarded tile carries a note.");
  }
  await prisma.scanTile.update({
    where: { id: tile.id },
    data: { note: note?.trim() || null },
  });
}

/** Put a discarded tile back in the queue. The mirror of a discard and nothing more: its images
 * never left, so there is nothing to restore, and a mis-clicked discard on a card of forty should
 * not need a re-cut to undo. A **consumed** tile has no such door — its images belong to a copy
 * now, and the way back is to delete that copy. */
export async function undiscardTile(ownerId: string, tileId: string): Promise<void> {
  const tile = await loadTileForOwner(ownerId, tileId);
  if (tile.state !== "discarded") {
    throw new ScanValidationError("Only a discarded tile can be put back.");
  }
  await prisma.scanTile.update({
    where: { id: tile.id },
    data: { state: "unidentified", note: null },
  });
  // The batch has something waiting again, so it is no longer finished with. Clearing this is what
  // keeps #578 from sweeping the original out from under a batch still being worked.
  await prisma.scanSheet.updateMany({
    where: { purchaseId: tile.purchaseId, batchNo: tile.batchNo, batchDoneAt: { not: null } },
    data: { batchDoneAt: null },
  });
}

// ── The two writes every outcome shares ───────────────────────────────────────────────────────

/** Hand the tile's `Photo` rows to the copy, mark the tile consumed, and stamp the batch if that
 * was the last one waiting — one transaction, because a tile whose images moved but whose state
 * did not would be a tile the re-cut guard no longer protects. */
async function consumeTile(tileId: string, itemId: string): Promise<void> {
  const tile = await prisma.$transaction(async (tx) => {
    await movePhotosToItem(tx, tileId, itemId);
    return tx.scanTile.update({
      where: { id: tileId },
      data: { state: "consumed", itemId },
      select: { purchaseId: true, batchNo: true },
    });
  });
  await stampBatchIfFinished(tile.purchaseId, tile.batchNo);
}

/**
 * Reassign a tile's crops to a copy — **one column on the row that already exists**.
 *
 * This is what ADR-0033 §2 bought by making a tile's images `Photo` rows under a fourth owner
 * rather than something of their own: no bytes are copied, no second row is created, and the
 * storage total, the serving route and every cleanup keep working because nothing about the photo
 * changed except who owns it.
 *
 * `sortOrder` is set to the copy's own convention (front before back), since a tile's rows were
 * written in cut order and a copy reads them in role order.
 */
async function movePhotosToItem(
  tx: Prisma.TransactionClient,
  tileId: string,
  itemId: string
): Promise<void> {
  const photos = await tx.photo.findMany({
    where: { tileId },
    select: { id: true, role: true },
  });
  for (const photo of photos) {
    await tx.photo.update({
      where: { id: photo.id },
      data: { tileId: null, itemId, sortOrder: photo.role === "back" ? 1 : 0 },
    });
  }
}

/** #149's auto-seed, reached from the scan path: the first photograph of a stamp identifies the
 * catalogue entry too. Best-effort — the copy and its images are already committed, and a stamp
 * that stays imageless is a smaller thing to go wrong than a failed identification. */
async function seedStampImage(ownerId: string, itemId: string): Promise<void> {
  const front = await prisma.photo.findFirst({
    where: { itemId, role: "front" },
    select: { id: true },
  });
  if (!front) return;
  await autoSeedStampMainFromFront(ownerId, itemId, front.id).catch((err) => {
    console.error("Auto-promote tile front → stamp main failed", err);
  });
}

/**
 * Stamp the batch when its **last** tile leaves `unidentified`.
 *
 * From that moment the batch can never be re-cut — a consumed tile refuses it (#566), because
 * re-cutting would delete `Photo` rows a copy now owns — so the retained original, the largest
 * object the app stores, has no remaining function. Nothing in #567 reads this; #578's retention
 * sweep does, on the closed-offer photos' TTL-after-a-terminal-state pattern (#512).
 *
 * Written on the batch's **sheets** because that is what the sweep will delete, and only where it
 * is not already set, so a batch finished with twice keeps the first moment.
 */
async function stampBatchIfFinished(purchaseId: string, batchNo: number): Promise<void> {
  const waiting = await prisma.scanTile.count({
    where: { purchaseId, batchNo, state: "unidentified" },
  });
  if (waiting > 0) return;
  await prisma.scanSheet.updateMany({
    where: { purchaseId, batchNo, batchDoneAt: null },
    data: { batchDoneAt: new Date() },
  });
}

// ── Loading ───────────────────────────────────────────────────────────────────────────────────

async function loadTileForOwner(ownerId: string, tileId: string) {
  const tile = await prisma.scanTile.findUnique({
    where: { id: tileId },
    select: {
      id: true,
      purchaseId: true,
      batchNo: true,
      state: true,
      photos: { select: { id: true, role: true } },
    },
  });
  if (!tile) throw new ScanAuthError("Tile not found or access denied.");
  await assertScanPurchaseOwner(ownerId, tile.purchaseId);
  return tile;
}

/** A tile can only be worked on while it is still waiting. Consumed twice would give two copies
 * the same images — except that the second move would find none, so the second copy would simply
 * get nothing and nobody would be told. */
async function loadUnidentifiedTile(ownerId: string, tileId: string) {
  const tile = await loadTileForOwner(ownerId, tileId);
  if (tile.state !== "unidentified") {
    throw new ScanValidationError(
      tile.state === "consumed"
        ? "That tile has already become a copy."
        : "That tile was discarded. Put it back first if you want to identify it."
    );
  }
  return tile;
}
