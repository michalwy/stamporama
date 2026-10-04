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
import { deleteFault } from "../../src/lib/faults";
import { deleteTag } from "../../src/lib/tags";
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
//   - identifying several tiles as one stamp lets the tiles that keep their marks keep them;
//   - faults marked on a tile (#1558) are added and removed one at a time, ride a box and a pairing
//     (both sides' faults kept), reach the identified copies, and go with a fault deleted;
//   - tags marked on a tile (#1599) do the same, and reach the copies **beside** the step's tags.

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
  let crease: string;
  let thinGum: string;
  let foreignFault: string;
  let toCheck: string;
  let fromBox: string;
  let foreignTag: string;

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
    crease = (await prisma.fault.create({ data: { collectionId, name: "Crease", sortOrder: 0 } })).id;
    thinGum = (
      await prisma.fault.create({ data: { collectionId, name: "Thinned gum", sortOrder: 1 } })
    ).id;
    foreignFault = (
      await prisma.fault.create({
        data: { collectionId: otherCollectionId, name: "Crease", sortOrder: 0 },
      })
    ).id;
    toCheck = (await prisma.tag.create({ data: { collectionId, name: "to-check" } })).id;
    fromBox = (await prisma.tag.create({ data: { collectionId, name: "grandfather-box" } })).id;
    foreignTag = (
      await prisma.tag.create({ data: { collectionId: otherCollectionId, name: "to-check" } })
    ).id;
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

  it("marks all unmarked tiles half by half, leaving the marked ones and their times alone (#1556)", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, BOXES);
    const [a, b] = await tilesOf(purchaseId);

    // The exception is marked first: a with MNG, b with a certificate only.
    await setTileMarks(userId, [a.id], { conditionId: mng });
    await setTileMarks(userId, [b.id], { certificateStatusId: cert });
    const before = await tilesOf(purchaseId);

    await setTileMarks(userId, [a.id, b.id], { conditionId: mnh }, { onlyUnmarked: true });
    let [ma, mb] = await tilesOf(purchaseId);
    assert.equal(ma.markConditionId, mng, "a tile with a condition keeps it");
    assert.equal(ma.markedAt?.getTime(), before[0].markedAt?.getTime(), "and the time it was given");
    assert.equal(mb.markConditionId, mnh, "a tile without a condition takes it, whatever its certificate");
    assert.equal(mb.markCertificateStatusId, cert);

    await setTileMarks(userId, [a.id, b.id], { certificateStatusId: cert }, { onlyUnmarked: true });
    [ma, mb] = await tilesOf(purchaseId);
    assert.equal(ma.markCertificateStatusId, cert, "the certificate fills the tile without one");
    assert.equal(ma.markConditionId, mng);

    // A fill never clears.
    await setTileMarks(userId, [a.id, b.id], { conditionId: null }, { onlyUnmarked: true });
    [ma, mb] = await tilesOf(purchaseId);
    assert.equal(ma.markConditionId, mng);
    assert.equal(mb.markConditionId, mnh);

    // Still only over open tiles.
    await discardTile(userId, b.id, "junk");
    await assert.rejects(
      () => setTileMarks(userId, [a.id, b.id], { conditionId: mnh }, { onlyUnmarked: true }),
      ScanValidationError
    );
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
  // ── Faults marked on a tile (#1558) ────────────────────────────────────────────────────────────

  const faultsOf = async (tileId: string) =>
    (await prisma.scanTileFault.findMany({ where: { tileId }, select: { faultId: true } }))
      .map((f) => f.faultId)
      .sort();

  it("marks faults on tiles, adds and removes them one at a time, and clears them with the mark", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, BOXES);
    const [a, b] = await tilesOf(purchaseId);

    await setTileMarks(userId, [a.id, b.id], { addFaultIds: [crease] });
    await setTileMarks(userId, [a.id], { addFaultIds: [thinGum], conditionId: mng });
    assert.deepEqual(await faultsOf(a.id), [crease, thinGum].sort());
    assert.deepEqual(await faultsOf(b.id), [crease]);

    const listed = (await listScans(userId, { purchaseId })).batches[0].tiles;
    assert.deepEqual(
      [...(listed.find((t) => t.id === a.id)!.mark?.faultIds ?? [])].sort(),
      [crease, thinGum].sort(),
      "the strip reads the faults with the mark"
    );

    await setTileMarks(userId, [a.id, b.id], { removeFaultIds: [crease] });
    assert.deepEqual(await faultsOf(a.id), [thinGum]);
    assert.deepEqual(await faultsOf(b.id), []);
    const unmarked = await prisma.scanTile.findUniqueOrThrow({ where: { id: b.id } });
    assert.equal(unmarked.markedAt, null, "a tile left with nothing marked is unmarked");

    await setTileMarks(userId, [a.id], {
      conditionId: null,
      certificateStatusId: null,
      removeFaultIds: [thinGum],
    });
    assert.deepEqual(await faultsOf(a.id), []);

    await assert.rejects(
      () => setTileMarks(userId, [a.id], { addFaultIds: [foreignFault] }),
      ScanValidationError
    );
    assert.deepEqual(await faultsOf(a.id), [], "nothing was written");
  });

  it("writes a box's faults onto its tile, and a paired back and front keep the faults of both", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, [
      { ...BOXES[0], mark: { conditionId: mnh, certificateStatusId: null, faultIds: [crease] } },
      BOXES[1],
    ]);
    const [a] = await tilesOf(purchaseId);
    assert.deepEqual(await faultsOf(a.id), [crease]);

    // The back shows the thinned gum the front could not: both are the piece's.
    const back = await upload(purchaseId, "back", front.batchNo);
    const report = await commitCut(userId, back.id, [
      { ...BOXES[0], mark: { conditionId: null, certificateStatusId: null, faultIds: [thinGum] } },
      BOXES[1],
    ]);
    assert.deepEqual(report.marksReplaced, [], "faults never replace one another");
    assert.deepEqual(await faultsOf(a.id), [crease, thinGum].sort());
    assert.equal((await prisma.scanTile.findUniqueOrThrow({ where: { id: a.id } })).markConditionId, mnh);

    const second = await upload(purchaseId, "front");
    await assert.rejects(
      () =>
        commitCut(userId, second.id, [
          { ...BOXES[0], mark: { conditionId: null, certificateStatusId: null, faultIds: [foreignFault] } },
        ]),
      ScanValidationError
    );
  });

  it("gives the copies the step's faults, a tile keeping its own marked ones, and a typed one born once", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, BOXES);
    const [a, b] = await tilesOf(purchaseId);

    const copies = await identifyTilesAsNewCopies(userId, [a.id, b.id], {
      stampId,
      conditionId: mnh,
      faults: [
        { id: crease, name: "Crease" },
        { id: null, name: "Short perforation" },
      ],
      tileAnswers: [{ tileId: a.id, faultIds: [thinGum] }],
    });
    const faultNames = async (itemId: string) =>
      (
        await prisma.itemFault.findMany({
          where: { itemId },
          select: { fault: { select: { name: true } } },
        })
      )
        .map((f) => f.fault.name)
        .sort();
    assert.deepEqual(await faultNames(copies[0].itemId), ["Thinned gum"], "the tile keeps its own");
    assert.deepEqual(await faultNames(copies[1].itemId), ["Crease", "Short perforation"]);
    assert.equal(
      await prisma.fault.count({ where: { collectionId, name: "Short perforation" } }),
      1,
      "a typed fault is born once"
    );
    const kept = await prisma.item.findUniqueOrThrow({ where: { id: copies[0].itemId } });
    assert.equal(kept.conditionId, mnh, "a tile keeping only its faults takes the shared condition");

    // A plain identification gives no faults at all.
    const c = await newOrder();
    const f2 = await upload(c, "front");
    await commitCut(userId, f2.id, [BOXES[0]]);
    const [only] = await tilesOf(c);
    const [plain] = await identifyTilesAsNewCopies(userId, [only.id], { stampId, conditionId: mnh });
    assert.deepEqual(await faultNames(plain.itemId), []);
  });

  it("refuses a tile's own fault from another collection before creating anything", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, BOXES);
    const [a, b] = await tilesOf(purchaseId);
    await assert.rejects(
      () =>
        identifyTilesAsNewCopies(userId, [a.id, b.id], {
          stampId,
          conditionId: mnh,
          tileAnswers: [{ tileId: a.id, faultIds: [foreignFault] }],
        }),
      ScanValidationError
    );
    assert.equal(await prisma.item.count({ where: { scanTiles: { some: { purchaseId } } } }), 0);
  });

  it("drops a fault's marks when the fault is deleted from the dictionary", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, [BOXES[0]]);
    const [a] = await tilesOf(purchaseId);
    const stain = (await prisma.fault.create({ data: { collectionId, name: "Stain", sortOrder: 9 } })).id;
    await setTileMarks(userId, [a.id], { addFaultIds: [stain, crease] });
    // Not refused: a mark is owed to nobody, unlike a copy's fault.
    await deleteFault(userId, stain);
    assert.deepEqual(await faultsOf(a.id), [crease]);
  });

  // ── Tags marked on a tile (#1599) ──────────────────────────────────────────────────────────────

  const tagsOf = async (tileId: string) =>
    (await prisma.scanTileTag.findMany({ where: { tileId }, select: { tagId: true } }))
      .map((t) => t.tagId)
      .sort();
  const copyTagNames = async (itemId: string) =>
    (
      await prisma.itemTag.findMany({ where: { itemId }, select: { tag: { select: { name: true } } } })
    )
      .map((t) => t.tag.name)
      .sort();

  it("marks tags on tiles, adds and removes them one at a time, and clears them with the mark", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, BOXES);
    const [a, b] = await tilesOf(purchaseId);

    await setTileMarks(userId, [a.id, b.id], { addTagIds: [toCheck] });
    await setTileMarks(userId, [a.id], { addTagIds: [fromBox], addFaultIds: [crease] });
    assert.deepEqual(await tagsOf(a.id), [toCheck, fromBox].sort());
    assert.deepEqual(await tagsOf(b.id), [toCheck]);
    assert.deepEqual(await faultsOf(a.id), [crease], "tags and faults sit side by side");

    const listed = (await listScans(userId, { purchaseId })).batches[0].tiles;
    assert.deepEqual(
      [...(listed.find((t) => t.id === a.id)!.mark?.tagIds ?? [])].sort(),
      [toCheck, fromBox].sort(),
      "the strip reads the tags with the mark"
    );

    await setTileMarks(userId, [a.id, b.id], { removeTagIds: [toCheck] });
    assert.deepEqual(await tagsOf(a.id), [fromBox]);
    assert.deepEqual(await tagsOf(b.id), []);
    assert.equal(
      (await prisma.scanTile.findUniqueOrThrow({ where: { id: b.id } })).markedAt,
      null,
      "a tile left with nothing marked is unmarked"
    );

    await assert.rejects(
      () => setTileMarks(userId, [a.id], { addTagIds: [foreignTag] }),
      ScanValidationError
    );
    assert.deepEqual(await tagsOf(a.id), [fromBox], "nothing was written");
  });

  it("writes a box's tags onto its tile, and a paired back and front keep the tags of both", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, [
      { ...BOXES[0], mark: { conditionId: mnh, certificateStatusId: null, tagIds: [toCheck] } },
      BOXES[1],
    ]);
    const [a] = await tilesOf(purchaseId);
    assert.deepEqual(await tagsOf(a.id), [toCheck]);

    const back = await upload(purchaseId, "back", front.batchNo);
    const report = await commitCut(userId, back.id, [
      { ...BOXES[0], mark: { conditionId: null, certificateStatusId: null, tagIds: [fromBox] } },
      BOXES[1],
    ]);
    assert.deepEqual(report.marksReplaced, [], "tags never replace one another");
    assert.deepEqual(await tagsOf(a.id), [toCheck, fromBox].sort());

    const second = await upload(purchaseId, "front");
    await assert.rejects(
      () =>
        commitCut(userId, second.id, [
          { ...BOXES[0], mark: { conditionId: null, certificateStatusId: null, tagIds: [foreignTag] } },
        ]),
      ScanValidationError
    );
  });

  it("gives every copy the step's tags, a tile's own marked ones beside them, and a typed one born once", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, BOXES);
    const [a, b] = await tilesOf(purchaseId);

    const copies = await identifyTilesAsNewCopies(userId, [a.id, b.id], {
      stampId,
      conditionId: mnh,
      tags: [
        { id: toCheck, name: "to-check", color: null },
        { id: null, name: "expertise", color: "blue" },
      ],
      tileAnswers: [{ tileId: a.id, tagIds: [fromBox] }],
    });
    assert.deepEqual(
      await copyTagNames(copies[0].itemId),
      ["expertise", "grandfather-box", "to-check"],
      "a tile's own tags are added to the step's"
    );
    assert.deepEqual(await copyTagNames(copies[1].itemId), ["expertise", "to-check"]);
    assert.equal(
      await prisma.tag.count({ where: { collectionId, name: "expertise" } }),
      1,
      "a typed tag is born once"
    );

    // A plain identification gives no tags at all — nothing is carried over.
    const c = await newOrder();
    const f2 = await upload(c, "front");
    await commitCut(userId, f2.id, [BOXES[0]]);
    const [only] = await tilesOf(c);
    const [plain] = await identifyTilesAsNewCopies(userId, [only.id], { stampId, conditionId: mnh });
    assert.deepEqual(await copyTagNames(plain.itemId), []);
  });

  it("refuses a tile's own tag from another collection before creating anything", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, BOXES);
    const [a, b] = await tilesOf(purchaseId);
    await assert.rejects(
      () =>
        identifyTilesAsNewCopies(userId, [a.id, b.id], {
          stampId,
          conditionId: mnh,
          tileAnswers: [{ tileId: a.id, tagIds: [foreignTag] }],
        }),
      ScanValidationError
    );
    assert.equal(await prisma.item.count({ where: { scanTiles: { some: { purchaseId } } } }), 0);
  });

  it("drops a tag's marks when the tag is deleted", async () => {
    const purchaseId = await newOrder();
    const front = await upload(purchaseId, "front");
    await commitCut(userId, front.id, [BOXES[0]]);
    const [a] = await tilesOf(purchaseId);
    const gone = (await prisma.tag.create({ data: { collectionId, name: "gone" } })).id;
    await setTileMarks(userId, [a.id], { addTagIds: [gone, toCheck] });
    await deleteTag(userId, gone);
    assert.deepEqual(await tagsOf(a.id), [toCheck]);
  });
});
