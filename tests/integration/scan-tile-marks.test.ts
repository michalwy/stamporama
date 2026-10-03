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
  ScanAuthError,
  ScanValidationError,
  commitCut,
  listScans,
  pairTilesManually,
  recutBatch,
  setTileMarks,
  uploadSheet,
} from "../../src/lib/scan-sheets";
import { discardTile, identifyTilesAsNewCopies } from "../../src/lib/scan-tiles";
import type { Box } from "../../src/lib/scan-boxes";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-tile-marks-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Marking tiles' condition and certificate before they are identified (#1550). The rules that need no
// database — merging, pairing, the keyboard, seeding the step — are `tile-marks.test.ts`'. What is
// pinned here is where a mark lives and how it travels:
//
//   - a mark is written on the tile from the strip, for one tile or several, and cleared again; it
//     is refused on a tile already dealt with, and for a dictionary entry of another collection;
//   - a box's mark is its tile's: it is written at the commit, and survives a re-cut that carries it;
//   - a back paired with its front is the same tile — by position at the back commit, or by hand —
//     and where the two were marked differently the mark given last wins and the replacement is said;
//   - identifying several tiles as one stamp lets the tiles that keep their marks keep them.

describe("tile marks (#1550)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let mnh: string;
  let mng: string;
  let cert: string;
  let foreignCondition: string;
  let stampId: string;

  const SHEET_W = 800;
  const SHEET_H = 600;
  const BOXES: Box[] = [
    { x: 50, y: 50, w: 200, h: 300 },
    { x: 500, y: 50, w: 200, h: 300 },
  ];

  async function card(): Promise<Buffer> {
    return sharp({
      create: { width: SHEET_W, height: SHEET_H, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite(
        await Promise.all(
          BOXES.map(async (box, i) => ({
            input: await sharp({
              create: {
                width: box.w,
                height: box.h,
                channels: 3,
                background: { r: 200 - i * 100, g: 40, b: 40 + i * 100 },
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

  async function upload(purchaseId: string, side: "front" | "back", batchNo?: number) {
    return uploadSheet(userId, { purchaseId }, {
      source: await card(),
      mime: "image/png",
      side,
      batchNo,
    });
  }

  async function tilesOf(purchaseId: string) {
    return prisma.scanTile.findMany({
      where: { purchaseId },
      orderBy: { position: "asc" },
    });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-marks-${ts}`;
    otherUserId = `test-user-marks-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-marks-${ts}`, name: "Marks", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-marks-other-${ts}`,
          name: "Other",
          baseCurrency: "EUR",
          ownerId: otherUserId,
        },
      })
    ).id;
    mnh = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    mng = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint No Gum", abbreviation: "MNG", sortOrder: 1 },
      })
    ).id;
    cert = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Certified", abbreviation: "Cert", sortOrder: 0 },
      })
    ).id;
    foreignCondition = (
      await prisma.stampCondition.create({
        data: { collectionId: otherCollectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Marked stamp" } })).id;
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("marks one tile or several, changes one half at a time, and clears them", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, BOXES);
    const [a, b] = await tilesOf(purchaseId);
    assert.equal(a.markConditionId, null, "a tile is cut unmarked");

    await setTileMarks(userId, [a.id, b.id], { conditionId: mng });
    await setTileMarks(userId, [a.id], { certificateStatusId: cert });
    let [ma, mb] = await tilesOf(purchaseId);
    assert.equal(ma.markConditionId, mng);
    assert.equal(ma.markCertificateStatusId, cert, "a certificate joins the condition already there");
    assert.equal(mb.markConditionId, mng);
    assert.equal(mb.markCertificateStatusId, null);
    assert.ok(ma.markedAt, "a mark records when it was given");

    // The strip reads them back, so they survive a reload.
    const scans = await listScans(userId, { purchaseId });
    const listed = scans.batches[0].tiles.find((t) => t.id === a.id)!;
    assert.deepEqual(listed.mark, { conditionId: mng, certificateStatusId: cert });
    assert.ok(listed.markedAt);

    await setTileMarks(userId, [a.id], { conditionId: null, certificateStatusId: null });
    await setTileMarks(userId, [b.id], { conditionId: null });
    [ma, mb] = await tilesOf(purchaseId);
    assert.equal(ma.markConditionId, null);
    assert.equal(ma.markCertificateStatusId, null);
    assert.equal(ma.markedAt, null, "a cleared mark has no time either");
    assert.equal(mb.markConditionId, null);
    assert.equal((await listScans(userId, { purchaseId })).batches[0].tiles[0].mark, null);
  });

  it("refuses a tile already dealt with, another collection's condition, and someone else's tile", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, BOXES);
    const [a, b] = await tilesOf(purchaseId);

    await discardTile(userId, b.id, "junk");
    await assert.rejects(() => setTileMarks(userId, [b.id], { conditionId: mng }), ScanValidationError);
    await assert.rejects(
      () => setTileMarks(userId, [a.id], { conditionId: foreignCondition }),
      ScanValidationError
    );
    await assert.rejects(() => setTileMarks(otherUserId, [a.id], { conditionId: mng }), ScanAuthError);
    assert.equal((await tilesOf(purchaseId))[0].markConditionId, null, "nothing was written");
  });

  it("writes a box's mark onto its tile, and keeps it through a re-cut that carries it", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, [
      { ...BOXES[0], mark: { conditionId: mng, certificateStatusId: null } },
      BOXES[1],
    ]);
    const [a, b] = await tilesOf(purchaseId);
    assert.equal(a.markConditionId, mng);
    assert.ok(a.markedAt);
    assert.equal(b.markConditionId, null);

    // A re-cut reopens on the tiles' boxes with their marks — read off the strip, as the screen does.
    const listed = (await listScans(userId, { purchaseId })).batches[0].tiles;
    const reopened = listed.map((t) => ({ ...t.frontBox!, mark: t.mark, markedAt: t.markedAt }));
    await recutBatch(userId, { purchaseId }, front.batchNo);
    await commitCut(userId, front.id, reopened);
    const [ra, rb] = await tilesOf(purchaseId);
    assert.equal(ra.markConditionId, mng, "a box kept through the re-cut keeps its mark");
    assert.equal(ra.markedAt?.getTime(), a.markedAt?.getTime(), "…and the time it was given");
    assert.equal(rb.markConditionId, null);

    await assert.rejects(
      () => commitCut(userId, front.id, [{ ...BOXES[0], mark: { conditionId: foreignCondition, certificateStatusId: null } }]),
      ScanValidationError
    );
  });

  it("pairs a back by position into one mark, the mark given last winning and the replacement said", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, [
      { ...BOXES[0], mark: { conditionId: mnh, certificateStatusId: null } },
      { ...BOXES[1], mark: { conditionId: mng, certificateStatusId: null } },
    ]);

    const back = await upload(purchaseId, "back", front.batchNo);
    // The back of the first piece shows no gum: marked MNG on the back, after the front's MNH. The
    // second back is unmarked, so its front's mark stands.
    const report = await commitCut(userId, back.id, [
      { ...BOXES[0], mark: { conditionId: mng, certificateStatusId: null } },
      BOXES[1],
    ]);
    assert.equal(report.paired, 2);
    assert.deepEqual(report.marksReplaced, [
      {
        position: 0,
        mark: { conditionId: mng, certificateStatusId: null },
        replaced: { conditionId: mnh, certificateStatusId: null },
      },
    ]);
    const [a, b] = await tilesOf(purchaseId);
    assert.equal(a.markConditionId, mng);
    assert.equal(b.markConditionId, mng);
  });

  it("keeps a front's mark over an older one a back box carried in", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, [
      { ...BOXES[0], mark: { conditionId: mnh, certificateStatusId: null } },
      BOXES[1],
    ]);
    const back = await upload(purchaseId, "back", front.batchNo);
    // A back box whose mark came with it from an earlier tile, given long before the front's.
    const report = await commitCut(userId, back.id, [
      {
        ...BOXES[0],
        mark: { conditionId: mng, certificateStatusId: null },
        markedAt: "2020-01-01T00:00:00.000Z",
      },
      BOXES[1],
    ]);
    const [a] = await tilesOf(purchaseId);
    assert.equal(a.markConditionId, mnh, "the front's mark was given last, so it stands");
    assert.deepEqual(report.marksReplaced, [
      {
        position: 0,
        mark: { conditionId: mnh, certificateStatusId: null },
        replaced: { conditionId: mng, certificateStatusId: null },
      },
    ]);
  });

  it("carries an unpaired back's mark onto its tile on pairing, and says what it replaced", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, BOXES);
    const [first, second] = await tilesOf(purchaseId);

    // One back only, so nothing pairs by position (#647) and the back waits on the strip.
    const back = await upload(purchaseId, "back", front.batchNo);
    await commitCut(userId, back.id, [BOXES[0]]);
    const backOnly = (await tilesOf(purchaseId)).find((t) => t.frontSheetId == null)!;

    // Marked on the unpaired back, then dropped on a front with no mark: the tile takes it.
    await setTileMarks(userId, [backOnly.id], { conditionId: mng, certificateStatusId: cert });
    const quiet = await pairTilesManually(userId, backOnly.id, first.id);
    assert.equal(quiet.replaced, null);
    const paired = await prisma.scanTile.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(paired.markConditionId, mng);
    assert.equal(paired.markCertificateStatusId, cert);

    // A front marked MNH, and a back marked MNG afterwards: the back's is the later and wins.
    await setTileMarks(userId, [second.id], { conditionId: mnh });
    const back2 = await prisma.scanTile.create({
      data: {
        collectionId,
        purchaseId,
        batchNo: front.batchNo,
        position: 9,
        backSheetId: back.id,
        backX: BOXES[1].x,
        backY: BOXES[1].y,
        backW: BOXES[1].w,
        backH: BOXES[1].h,
      },
    });
    await setTileMarks(userId, [back2.id], { conditionId: mng });
    const loud = await pairTilesManually(userId, back2.id, second.id);
    assert.deepEqual(loud.mark, { conditionId: mng, certificateStatusId: null });
    assert.deepEqual(loud.replaced, { conditionId: mnh, certificateStatusId: null });
    assert.equal(
      (await prisma.scanTile.findUniqueOrThrow({ where: { id: second.id } })).markConditionId,
      mng
    );
  });

  it("lets the tiles keeping their marks keep them when several are identified as one stamp", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, BOXES);
    const [a, b] = await tilesOf(purchaseId);

    const copies = await identifyTilesAsNewCopies(userId, [a.id, b.id], {
      stampId,
      conditionId: mnh,
      tileAnswers: [{ tileId: a.id, conditionId: mng, certificateStatusId: cert }],
    });
    assert.equal(copies.length, 2);
    const items = await prisma.item.findMany({
      where: { id: { in: copies.map((c) => c.itemId) } },
      select: { id: true, conditionId: true, certificateStatusId: true, itemNo: true },
    });
    const of = (itemId: string) => items.find((i) => i.id === itemId)!;
    assert.equal(of(copies[0].itemId).conditionId, mng, "the marked tile keeps its own condition");
    assert.equal(of(copies[0].itemId).certificateStatusId, cert);
    assert.equal(of(copies[1].itemId).conditionId, mnh, "the rest take the shared answer");
    assert.equal(of(copies[1].itemId).certificateStatusId, null);
    assert.ok(
      of(copies[1].itemId).itemNo > of(copies[0].itemId).itemNo,
      "the copies are still numbered in card order"
    );
    const consumed = await tilesOf(purchaseId);
    assert.deepEqual(
      consumed.map((t) => t.itemId),
      copies.map((c) => c.itemId),
      "each tile became its own copy"
    );
  });

  it("refuses an own answer for a tile not being identified, or from another collection", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, BOXES);
    const [a, b] = await tilesOf(purchaseId);

    await assert.rejects(
      () =>
        identifyTilesAsNewCopies(userId, [a.id], {
          stampId,
          conditionId: mnh,
          tileAnswers: [{ tileId: b.id, conditionId: mng }],
        }),
      ScanValidationError
    );
    await assert.rejects(
      () =>
        identifyTilesAsNewCopies(userId, [a.id, b.id], {
          stampId,
          conditionId: mnh,
          tileAnswers: [{ tileId: a.id, conditionId: foreignCondition }],
        }),
      ScanValidationError
    );
    assert.equal(
      await prisma.item.count({ where: { scanTiles: { some: { purchaseId } } } }),
      0,
      "nothing was created"
    );
  });
});
