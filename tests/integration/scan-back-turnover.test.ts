// How a card's backs were made (#1555): each stamp turned over in place, or the whole card turned
// over left to right or top to bottom — which mirrors where every back lies, and for a card turned
// top to bottom stands every back on its head.
//
// The card is 2 × 2 so both axes are in play, and laid off-centre on the glass and moved between the
// two scans, so a mirror taken about the scan's edges instead of the card would pair the wrong
// backs. Each stamp is its own colour on both sides — the back crop's centre says whose back it is —
// and carries a white corner at its top left, which on a back turned top to bottom lies at the
// bottom right of the scan and has to come out top left once the back stands the right way up.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { deletePurchase } from "../../src/lib/purchases";
import {
  ScanValidationError,
  commitCut,
  listScans,
  pairTilesManually,
  setBackTurnover,
  unpairTileBack,
  uploadSheet,
} from "../../src/lib/scan-sheets";
import type { Box } from "../../src/lib/scan-boxes";
import { getStorage, variantKey } from "../../src/lib/storage";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-scan-turnover-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

type Rgb = [number, number, number];
const RED: Rgb = [220, 30, 30];
const GREEN: Rgb = [30, 200, 30];
const BLUE: Rgb = [30, 30, 220];
const YELLOW: Rgb = [220, 200, 30];
const WHITE: Rgb = [255, 255, 255];
const COLOURS = [RED, GREEN, BLUE, YELLOW];
const MARK = 60;

const SHEET = 1200;
const W = 300;
const H = 400;
/** Top-left, top-right, bottom-left, bottom-right — the reading order the cut gives them. The card's
 * stamps span x 100–900 and y 100–1000 of a 1200 × 1200 scan: not centred on it. */
const FRONT: Box[] = [
  { x: 100, y: 100, w: W, h: H },
  { x: 600, y: 100, w: W, h: H },
  { x: 100, y: 600, w: W, h: H },
  { x: 600, y: 600, w: W, h: H },
];

/** Where each stamp's back lies once the card is turned over and moved by `dx, dy` — index `i` is
 * stamp `i`'s back. Mirrored about the card's own extent, which is what turning a card over does. */
function turnedBoxes(axis: "left_right" | "top_bottom", dx: number, dy: number): Box[] {
  return FRONT.map((b) =>
    axis === "left_right"
      ? { x: 100 + 900 - (b.x + b.w) + dx, y: b.y + dy, w: W, h: H }
      : { x: b.x + dx, y: 100 + 1000 - (b.y + b.h) + dy, w: W, h: H }
  );
}

/** A black card with the given stamps on it; each one's white corner where `corner` says. */
async function card(
  stamps: { box: Box; colour: Rgb; corner: "top_left" | "bottom_right" | "none" }[]
): Promise<Buffer> {
  const rect = async (w: number, h: number, c: Rgb) =>
    sharp({ create: { width: w, height: h, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } })
      .png()
      .toBuffer();
  const layers = [];
  for (const s of stamps) {
    layers.push({ input: await rect(s.box.w, s.box.h, s.colour), left: s.box.x, top: s.box.y });
    if (s.corner !== "none") {
      layers.push({
        input: await rect(MARK, MARK, WHITE),
        left: s.corner === "top_left" ? s.box.x : s.box.x + s.box.w - MARK,
        top: s.corner === "top_left" ? s.box.y : s.box.y + s.box.h - MARK,
      });
    }
  }
  return sharp({ create: { width: SHEET, height: SHEET, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(layers)
    .png()
    .toBuffer();
}

async function storedPixels(photo: { storageBackend: string; storageKey: string; mime: string }) {
  const object = await getStorage(photo.storageBackend).get(
    variantKey(photo.storageKey, "full", photo.mime),
    photo.mime,
    "delivery"
  );
  const chunks: Buffer[] = [];
  for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
  return sharp(Buffer.concat(chunks)).raw().toBuffer({ resolveWithObject: true });
}

function colourAt(
  px: { data: Buffer; info: { width: number; channels: number } },
  x: number,
  y: number
): Rgb {
  const at = (y * px.info.width + x) * px.info.channels;
  return [px.data[at], px.data[at + 1], px.data[at + 2]];
}

/** Whether two colours are the same to within what a re-encode can move them. */
function near(a: Rgb, b: Rgb): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) <= 12);
}

describe("how a card's backs were made (#1555)", () => {
  let userId: string;
  let collectionId: string;
  let nextPurchaseNo = 1;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-turnover-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User turnover-${ts}`,
        email: `test-turnover-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-turnover-${ts}`,
        name: `Collection turnover-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
  });

  after(async () => {
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  async function newOrder(): Promise<string> {
    const purchase = await prisma.purchase.create({
      data: {
        collectionId,
        purchaseNo: nextPurchaseNo++,
        purchasedAt: new Date("2026-10-03"),
        currency: "EUR",
        lots: { create: { price: 100 } },
      },
    });
    return purchase.id;
  }

  /** The front scanned and cut: four tiles, positions 0–3 in the order of {@link FRONT}. */
  async function cutFront(purchaseId: string) {
    const bytes = await card(
      FRONT.map((box, i) => ({ box, colour: COLOURS[i], corner: "top_left" as const }))
    );
    const front = await uploadSheet(userId, { purchaseId }, { source: bytes, mime: "image/png", side: "front" });
    await commitCut(userId, front.id, FRONT);
    return front;
  }

  /** The back of a card turned over along `axis`, added the way `turnover` says — or, absent, the
   * collection's last. Back boxes are handed to the cut in an order of their own. */
  async function addBack(
    purchaseId: string,
    batchNo: number,
    axis: "left_right" | "top_bottom",
    boxes: Box[],
    turnover?: string
  ) {
    const bytes = await card(
      boxes.map((box, i) => ({
        box,
        colour: COLOURS[i],
        // A card turned top to bottom stands every back on its head: the corner the stamp has at
        // its top left lies at the bottom right of the scan.
        corner: axis === "top_bottom" ? ("bottom_right" as const) : ("none" as const),
      }))
    );
    return uploadSheet(userId, { purchaseId }, {
      source: bytes,
      mime: "image/png",
      side: "back",
      batchNo,
      turnover,
    });
  }

  /** Each front tile's back, by the colour of its centre — `null` for a tile with none. */
  async function backColours(purchaseId: string): Promise<(Rgb | null)[]> {
    const tiles = await prisma.scanTile.findMany({
      where: { purchaseId, frontSheetId: { not: null } },
      orderBy: { position: "asc" },
      include: { photos: { where: { role: "back" } } },
    });
    const out: (Rgb | null)[] = [];
    for (const t of tiles) {
      const photo = t.photos[0];
      if (!photo) {
        out.push(null);
        continue;
      }
      const px = await storedPixels(photo);
      out.push(colourAt(px, px.info.width >> 1, px.info.height >> 1));
    }
    return out;
  }

  function assertOwnBacks(colours: (Rgb | null)[]) {
    assert.equal(colours.length, 4);
    colours.forEach((c, i) => {
      assert.ok(c && near(c, COLOURS[i]), `tile ${i} has its own back, got ${JSON.stringify(c)}`);
    });
  }

  it("pairs a card turned left to right by its mirrored positions, moved between the scans", async () => {
    const purchaseId = await newOrder();
    const front = await cutFront(purchaseId);
    const boxes = turnedBoxes("left_right", 120, -50);
    const back = await addBack(purchaseId, front.batchNo, "left_right", boxes, "card_left_right");

    const report = await commitCut(userId, back.id, [...boxes].reverse());
    assert.equal(report.pairingMode, "positional");
    assert.equal(report.paired, 4);
    assert.equal(report.backOnly, 0);
    assertOwnBacks(await backColours(purchaseId));

    const tiles = await prisma.scanTile.findMany({ where: { purchaseId } });
    assert.ok(tiles.every((t) => t.backTurn === 0), "a card turned left to right needs no turn");
    assert.ok(tiles.every((t) => !t.backPairedByHand));

    // The choice is the sheet's, and the collection's last.
    const sheet = await prisma.scanSheet.findUniqueOrThrow({ where: { id: back.id } });
    assert.equal(sheet.turnover, "card_left_right");
    const scans = await listScans(userId, { purchaseId });
    assert.equal(scans.backTurnover, "card_left_right");
    assert.equal(scans.batches[0].back?.turnover, "card_left_right");

    await deletePurchase(userId, purchaseId);
  });

  it("pairs a card turned top to bottom, and stands its backs the right way up", async () => {
    const purchaseId = await newOrder();
    const front = await cutFront(purchaseId);
    const boxes = turnedBoxes("top_bottom", -60, 80);
    const back = await addBack(purchaseId, front.batchNo, "top_bottom", boxes, "card_top_bottom");

    const report = await commitCut(userId, back.id, boxes);
    assert.equal(report.paired, 4);
    assertOwnBacks(await backColours(purchaseId));

    const tiles = await prisma.scanTile.findMany({
      where: { purchaseId },
      include: { photos: { where: { role: "back" } } },
    });
    for (const t of tiles) {
      assert.equal(t.backTurn, 180, "every back of a card turned top to bottom is turned a half");
      const px = await storedPixels(t.photos[0]);
      assert.ok(near(colourAt(px, 20, 20), WHITE), "the stamp's top-left corner is top left");
    }
    // The scan itself is left as it is: the box still addresses the sheet where the back lies.
    const sheet = await prisma.scanSheet.findUniqueOrThrow({ where: { id: back.id } });
    assert.equal(sheet.width, SHEET);

    await deletePurchase(userId, purchaseId);
  });

  it("still sends every back to the strip on a turned card whose counts differ", async () => {
    const purchaseId = await newOrder();
    const front = await cutFront(purchaseId);
    const boxes = turnedBoxes("top_bottom", 0, 0).slice(0, 3);
    const back = await addBack(purchaseId, front.batchNo, "top_bottom", boxes, "card_top_bottom");

    const report = await commitCut(userId, back.id, boxes);
    assert.equal(report.pairingMode, "manual");
    assert.equal(report.paired, 0);
    assert.equal(report.backOnly, 3);
    assert.deepEqual(await backColours(purchaseId), [null, null, null, null]);

    await deletePurchase(userId, purchaseId);
  });

  it("offers the collection's last way, and refuses a way it does not know", async () => {
    await prisma.collection.update({
      where: { id: collectionId },
      data: { lastBackTurnover: "card_left_right" },
    });
    const purchaseId = await newOrder();
    const front = await cutFront(purchaseId);
    const boxes = turnedBoxes("left_right", 0, 0);

    await assert.rejects(
      () => addBack(purchaseId, front.batchNo, "left_right", boxes, "card_diagonally"),
      ScanValidationError
    );

    // No way given: the collection's last.
    const back = await addBack(purchaseId, front.batchNo, "left_right", boxes);
    const sheet = await prisma.scanSheet.findUniqueOrThrow({ where: { id: back.id } });
    assert.equal(sheet.turnover, "card_left_right");

    // Changed before the cut, it is only stored — and the cut reads it.
    const before = await setBackTurnover(userId, { purchaseId }, front.batchNo, "card_top_bottom");
    assert.equal(before.cut, false);
    await setBackTurnover(userId, { purchaseId }, front.batchNo, "card_left_right");
    const report = await commitCut(userId, back.id, boxes);
    assert.equal(report.paired, 4);
    assertOwnBacks(await backColours(purchaseId));

    await deletePurchase(userId, purchaseId);
  });

  it("pairs the backs again when the way is changed after the cut, and turns them", async () => {
    const purchaseId = await newOrder();
    const front = await cutFront(purchaseId);
    const boxes = turnedBoxes("top_bottom", 30, -20);
    // Added as if each stamp had been turned in place: every back lands on the wrong stamp.
    const back = await addBack(purchaseId, front.batchNo, "top_bottom", boxes, "in_place");
    await commitCut(userId, back.id, boxes);
    const wrong = await backColours(purchaseId);
    assert.ok(!near(wrong[0]!, COLOURS[0]), "turned in place, the top-left stamp takes another's back");

    const report = await setBackTurnover(userId, { purchaseId }, front.batchNo, "card_top_bottom");
    assert.equal(report.cut, true);
    assert.equal(report.pairingMode, "positional");
    assert.equal(report.paired, 4);
    assert.equal(report.kept, 0);
    assertOwnBacks(await backColours(purchaseId));

    const tiles = await prisma.scanTile.findMany({
      where: { purchaseId },
      orderBy: { position: "asc" },
      include: { photos: { where: { role: "back" } } },
    });
    assert.deepEqual(
      tiles.map((t) => t.position),
      [0, 1, 2, 3],
      "no tile is added, and none moves on the strip"
    );
    for (const t of tiles) {
      assert.equal(t.backTurn, 180);
      const px = await storedPixels(t.photos[0]);
      assert.ok(near(colourAt(px, 20, 20), WHITE), "the back now stands the right way up");
    }
    const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } });
    assert.equal(collection.lastBackTurnover, "card_top_bottom");

    // And back again: the half-turn comes off with the answer.
    await setBackTurnover(userId, { purchaseId }, front.batchNo, "card_left_right");
    const again = await prisma.scanTile.findMany({ where: { purchaseId } });
    assert.ok(again.every((t) => t.backTurn === 0));

    await deletePurchase(userId, purchaseId);
  });

  it("keeps a pair made by hand when the backs are paired again", async () => {
    const purchaseId = await newOrder();
    const front = await cutFront(purchaseId);
    const boxes = turnedBoxes("left_right", 0, 0);
    // A card turned left to right, added as turned in place: each front takes the back lying where
    // it lies — top-left green, top-right red, bottom-left yellow, bottom-right blue.
    const back = await addBack(purchaseId, front.batchNo, "left_right", boxes, "in_place");
    await commitCut(userId, back.id, boxes);

    // The collector takes the backs off top-left and bottom-left — green becomes back-only tile 4,
    // yellow tile 5 — and drags yellow onto top-left by hand. Whatever the reason, it is theirs.
    const byPosition = () =>
      prisma.scanTile.findMany({ where: { purchaseId }, orderBy: { position: "asc" } });
    let tiles = await byPosition();
    await unpairTileBack(userId, tiles[0].id);
    await unpairTileBack(userId, tiles[2].id);
    tiles = await byPosition();
    await pairTilesManually(userId, tiles[5].id, tiles[0].id);
    tiles = await byPosition();
    assert.equal(tiles[0].backPairedByHand, true);

    const report = await setBackTurnover(userId, { purchaseId }, front.batchNo, "card_left_right");

    // Top-left is out of it, so the three backs left meet the three fronts left: green and blue
    // mirror onto their own stamps; red mirrors onto top-left, which is taken, and goes to the strip.
    assert.equal(report.kept, 1);
    assert.equal(report.pairingMode, "positional");
    assert.equal(report.paired, 2);
    assert.equal(report.backOnly, 1);
    const colours = await backColours(purchaseId);
    assert.ok(near(colours[0]!, YELLOW), "the pair made by hand stays");
    assert.ok(near(colours[1]!, GREEN), "top-right takes its own back");
    assert.ok(near(colours[2]!, BLUE), "bottom-left takes its own back");
    assert.equal(colours[3], null, "bottom-right's own back is the one put on top-left by hand");

    const after = await prisma.scanTile.findMany({
      where: { purchaseId },
      orderBy: { position: "asc" },
      include: { photos: true },
    });
    assert.equal(after[0].backPairedByHand, true, "still marked as made by hand");
    const strip = after.filter((t) => t.frontSheetId == null);
    assert.equal(strip.length, 1);
    const px = await storedPixels(strip[0].photos[0]);
    assert.ok(near(colourAt(px, px.info.width >> 1, px.info.height >> 1), RED));

    await deletePurchase(userId, purchaseId);
  });
});
