import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import {
  ScanValidationError,
  commitCut,
  listScans,
  recutBatch,
  uploadSheet,
} from "../../src/lib/scan-sheets";
import { identifyTileAsNewCopy } from "../../src/lib/scan-tiles";
import type { Box } from "../../src/lib/scan-boxes";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-recut-copies-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Re-cutting a card some of whose tiles have already become copies (#2055). The copies' tiles are
// kept exactly as they are — images, number, copy — and everything else on the card is cut again
// around them, front and back. As in `scan-sheet-ingest.test.ts`, every box is supplied by the test:
// nothing here detects anything.

describe("re-cutting around copies (#2055)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;

  const SHEET_W = 1200;
  const SHEET_H = 600;
  const A: Box = { x: 50, y: 100, w: 250, h: 350 };
  const B: Box = { x: 450, y: 100, w: 250, h: 350 };
  const C: Box = { x: 850, y: 100, w: 250, h: 350 };
  /** The cutting mistake: B and C drawn as one box. */
  const BC: Box = { x: 450, y: 100, w: 650, h: 350 };

  async function card(): Promise<Buffer> {
    return sharp({
      create: { width: SHEET_W, height: SHEET_H, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite(
        await Promise.all(
          [A, B, C].map(async (box, i) => ({
            input: await sharp({
              create: {
                width: box.w,
                height: box.h,
                channels: 3,
                background: { r: 60 + i * 80, g: 200 - i * 60, b: 40 + i * 70 },
              },
            })
              .png()
              .toBuffer(),
            left: box.x,
            top: box.y,
          }))
        )
      )
      .png()
      .toBuffer();
  }

  async function newOrder(): Promise<string> {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-10-01",
    });
    await createLot(userId, purchase.id, 100);
    return purchase.id;
  }

  async function upload(purchaseId: string, side: "front" | "back") {
    return uploadSheet(userId, { purchaseId }, {
      source: await card(),
      mime: "image/png",
      side,
      ...(side === "back" ? { batchNo: 1, turnover: "in_place" } : {}),
    });
  }

  function tilesOf(purchaseId: string) {
    return prisma.scanTile.findMany({ where: { purchaseId }, orderBy: { position: "asc" } });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-recut-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User recut-${ts}`,
        email: `test-recut-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-recut-${ts}`,
          name: `Collection recut-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Recut stamp" } })).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("keeps the copy, cuts the rest of the card again around it, front and back", async () => {
    const purchaseId = await newOrder();
    // The cutting mistake: B and C drawn as one box, found only once A had become a copy.
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, [A, BC]);
    const back = await upload(purchaseId, "back");
    await commitCut(userId, back.id, [A, BC]);
    const [tileA, tileBC] = await tilesOf(purchaseId);
    assert.equal(tileA.position, 0);
    assert.equal(tileBC.position, 1);

    // The first stamp identified: its copy now holds the tile's front and back.
    const copy = await identifyTileAsNewCopy(userId, tileA.id, { stampId, conditionId });
    const copyPhotos = await prisma.photo.findMany({
      where: { itemId: copy.itemId },
      orderBy: { role: "asc" },
    });
    assert.deepEqual(
      copyPhotos.map((p) => p.role),
      ["back", "front"]
    );

    // Re-cut: the other tile goes, the copy's stays, and both sheets wait to be cut around it.
    const { discarded } = await recutBatch(userId, { purchaseId }, 1);
    assert.equal(discarded, 1);
    const kept = await tilesOf(purchaseId);
    assert.deepEqual(
      kept.map((t) => t.id),
      [tileA.id]
    );
    assert.equal(kept[0].state, "consumed");
    assert.equal(kept[0].position, 0);
    let scans = await listScans(userId, { purchaseId });
    assert.equal(scans.batches[0].front?.cut, false, "the front offers its cut again");
    assert.equal(scans.batches[0].back?.cut, false, "and so does the back");
    assert.equal(scans.batches[0].doneAt, null);

    // The front cut again, the mistake corrected: B and C apart. The new tiles take the numbers
    // the copy does not hold.
    const frontReport = await commitCut(userId, front.id, [C, B]);
    assert.equal(frontReport.created, 2);
    let tiles = await tilesOf(purchaseId);
    assert.deepEqual(
      tiles.map((t) => [t.position, t.frontX]),
      [
        [0, A.x],
        [1, B.x],
        [2, C.x],
      ]
    );
    scans = await listScans(userId, { purchaseId });
    assert.equal(scans.batches[0].front?.cut, true);
    assert.equal(scans.batches[0].back?.cut, false, "the back still waits");
    // A front committed twice is still refused once it is cut.
    await assert.rejects(() => commitCut(userId, front.id, [B]), ScanValidationError);

    // The back cut again: it pairs with the two new tiles, and the copy keeps its own back.
    const backReport = await commitCut(userId, back.id, [B, C]);
    assert.equal(backReport.paired, 2);
    assert.equal(backReport.backOnly, 0);
    assert.equal(backReport.toCopies, 0);
    tiles = await tilesOf(purchaseId);
    assert.deepEqual(
      tiles.map((t) => [t.position, t.backX]),
      [
        [0, A.x],
        [1, B.x],
        [2, C.x],
      ]
    );
    scans = await listScans(userId, { purchaseId });
    assert.equal(scans.batches[0].back?.cut, true);

    // The copy is exactly as it was: the same photo rows, the same bytes' keys, the same tile.
    const after = await prisma.photo.findMany({
      where: { itemId: copy.itemId },
      orderBy: { role: "asc" },
    });
    assert.deepEqual(
      after.map((p) => [p.id, p.storageKey]),
      copyPhotos.map((p) => [p.id, p.storageKey])
    );
    const copyTile = await prisma.scanTile.findUniqueOrThrow({ where: { id: tileA.id } });
    assert.equal(copyTile.itemId, copy.itemId);
    assert.equal(copyTile.position, 0);
  });

  it("cuts a card with nothing new on it, and finishes it with that", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    // A shadow taken for a stamp: the second box is the mistake, and the fix is to delete it.
    await commitCut(userId, front.id, [A, B]);
    const [tileA] = await tilesOf(purchaseId);
    await identifyTileAsNewCopy(userId, tileA.id, { stampId, conditionId });

    await recutBatch(userId, { purchaseId }, 1);
    // Waiting to be cut again, the card is not finished with — the sweep must not take its scan.
    const pending = await prisma.scanSheet.findUniqueOrThrow({ where: { id: front.id } });
    assert.equal(pending.recutPending, true);
    assert.equal(pending.batchDoneAt, null);

    const report = await commitCut(userId, front.id, []);
    assert.equal(report.created, 0);
    const cut = await prisma.scanSheet.findUniqueOrThrow({ where: { id: front.id } });
    assert.equal(cut.recutPending, false);
    assert.ok(cut.batchDoneAt, "every tile is a copy and nothing is waiting: finished with");
  });

  it("does not finish a card whose last tile becomes a copy while a sheet is still to be cut", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, [A, B]);
    const back = await upload(purchaseId, "back");
    await commitCut(userId, back.id, [A, B]);
    const [tileA] = await tilesOf(purchaseId);
    await identifyTileAsNewCopy(userId, tileA.id, { stampId, conditionId });

    await recutBatch(userId, { purchaseId }, 1);
    await commitCut(userId, front.id, [B]);
    const [, tileB] = await tilesOf(purchaseId);
    // The back has not been cut again yet, so identifying the last waiting tile must not stamp it.
    await identifyTileAsNewCopy(userId, tileB.id, { stampId, conditionId });
    const sheet = await prisma.scanSheet.findUniqueOrThrow({ where: { id: back.id } });
    assert.equal(sheet.batchDoneAt, null);
  });

  it("refuses a re-cut on a card where every tile is a copy, and destroys nothing", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, [A, B]);
    for (const tile of await tilesOf(purchaseId)) {
      await identifyTileAsNewCopy(userId, tile.id, { stampId, conditionId });
    }

    await assert.rejects(
      () => recutBatch(userId, { purchaseId }, 1),
      (err: unknown) => err instanceof ScanValidationError && /nothing left to re-cut/.test(err.message)
    );
    assert.equal((await tilesOf(purchaseId)).length, 2);
    const sheet = await prisma.scanSheet.findUniqueOrThrow({ where: { id: front.id } });
    assert.equal(sheet.recutPending, false);
  });

  it("takes discarded and parked tiles with the re-cut, as any tile not yet a copy", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, [A, B, C]);
    const [tileA, tileB, tileC] = await tilesOf(purchaseId);
    await identifyTileAsNewCopy(userId, tileA.id, { stampId, conditionId });
    await prisma.scanTile.update({ where: { id: tileB.id }, data: { state: "discarded", note: "junk" } });
    await prisma.scanTile.update({ where: { id: tileC.id }, data: { state: "parked" } });

    const { discarded } = await recutBatch(userId, { purchaseId }, 1);
    assert.equal(discarded, 2);
    assert.deepEqual(
      (await tilesOf(purchaseId)).map((t) => t.id),
      [tileA.id]
    );
  });
});
