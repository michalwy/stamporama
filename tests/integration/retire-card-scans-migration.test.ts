import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { listScans } from "../../src/lib/scan-sheets";
import { identifyTilesAsNewCopies } from "../../src/lib/scan-tiles";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-retire-card-scans-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// `20260916160000_retire_card_scans` (#1326) moves every card scanned outside an order onto one
// opening balance per collection, then makes `purchaseId` NOT NULL. The application can no longer
// write a purchase-less card, and `prisma migrate deploy` runs against a fresh database where none
// exists, so the ordinary suite never meets the rows this migration is for.
//
// So the pre-migration state is built by hand — the three columns nullable again, the collection's
// batch counter and the partial index restored, the rows inserted raw — and then the migration file
// itself runs, bytes off disk, in the same transaction. Unlike `subtypes-domain.test.ts`'s forgery
// case this one **commits**: the file ends by putting the schema back exactly as it found it, and what
// the Done-when asks for is that a moved tile then identifies through the ordinary code, which runs
// on its own connection and so has to see committed rows. Should the file fail part-way, the
// transaction rolls the scaffolding back with it.
//
// The `LOCK` is taken first and in one statement because the scaffolding's DDL needs ACCESS EXCLUSIVE
// on each of these tables anyway, and acquiring them one `ALTER` at a time while other suites write
// to the same tables is how a deadlock would be assembled.
const MIGRATION = fileURLToPath(
  new URL("../../prisma/migrations/20260916160000_retire_card_scans/migration.sql", import.meta.url)
);

describe("20260916160000_retire_card_scans (#1326)", () => {
  const ts = Date.now();
  const userId = `test-user-retire-scans-${ts}`;
  let collectionId: string;
  /** A collection whose only card came in a parcel — it must not gain a document. */
  let orderOnlyCollectionId: string;
  let conditionId: string;
  let stampId: string;
  let orderId: string;
  let orderSheetId: string;
  /** The copy a tile became on Card scans before the migration: delivered, on no lot. */
  let earlierCopyId: string;

  const id = (name: string) => `retire-${name}-${ts}`;

  before(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User retire-scans-${ts}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-retire-${ts}`, name: "Retire", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    orderOnlyCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-retire-o-${ts}`, name: "Orders", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Shelf stamp" } })).id;
    earlierCopyId = (await createItem(userId, collectionId, { stampId, conditionId })).id;

    // An ordinary order with a card of its own, taking purchase number 1. Written with the Prisma
    // client before the scaffolding exists, since a card on an order is valid on both sides of it.
    const order = await createPurchase(userId, collectionId, {
      currency: "PLN",
      purchasedAt: "2026-05-01",
    });
    orderId = order.id;
    await createLot(userId, orderId, 100);
    orderSheetId = (
      await prisma.scanSheet.create({
        data: {
          collectionId,
          purchaseId: orderId,
          batchNo: 1,
          side: "front",
          storageKey: `${collectionId}/sheets/order`,
          mime: "image/png",
          width: 100,
          height: 100,
          viewWidth: 100,
          viewHeight: 100,
          sizeBytes: 1,
        },
        select: { id: true },
      })
    ).id;
    await prisma.purchase.update({ where: { id: orderId }, data: { nextScanBatchNo: 2 } });

    const otherOrder = await createPurchase(userId, orderOnlyCollectionId, {
      currency: "PLN",
      purchasedAt: "2026-05-01",
    });
    await prisma.scanSheet.create({
      data: {
        collectionId: orderOnlyCollectionId,
        purchaseId: otherOrder.id,
        batchNo: 1,
        side: "front",
        storageKey: `${orderOnlyCollectionId}/sheets/order`,
        mime: "image/png",
        width: 100,
        height: 100,
        viewWidth: 100,
        viewHeight: 100,
        sizeBytes: 1,
      },
    });

    const sql = await readFile(MIGRATION, "utf8");
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          'LOCK TABLE "collection", "purchase", "purchase_lot", "scan_sheet", "scan_tile", "scan_upload" IN ACCESS EXCLUSIVE MODE'
        );
        // ── The schema as it stood before the migration ──
        await tx.$executeRawUnsafe('ALTER TABLE "scan_sheet" ALTER COLUMN "purchaseId" DROP NOT NULL');
        await tx.$executeRawUnsafe('ALTER TABLE "scan_tile" ALTER COLUMN "purchaseId" DROP NOT NULL');
        await tx.$executeRawUnsafe('ALTER TABLE "scan_upload" ALTER COLUMN "purchaseId" DROP NOT NULL');
        await tx.$executeRawUnsafe(
          'ALTER TABLE "collection" ADD COLUMN "nextScanBatchNo" INTEGER NOT NULL DEFAULT 1'
        );
        await tx.$executeRawUnsafe(
          'CREATE UNIQUE INDEX "scan_sheet_collection_batch_side_key" ON "scan_sheet"("collectionId", "batchNo", "side") WHERE "purchaseId" IS NULL'
        );

        // ── Card scans as a collector left it ──
        // Two cards numbered off the collection's counter, which stands past them at 3. Batch 1 has
        // a front and a back and a tile in every state; batch 2 is named and still waiting.
        await tx.$executeRaw`UPDATE "collection" SET "nextScanBatchNo" = 3 WHERE "id" = ${collectionId}`;
        const sheet = async (
          sheetId: string,
          batchNo: number,
          side: string,
          label: string | null,
          createdAt: Date
        ) =>
          tx.$executeRaw`INSERT INTO "scan_sheet" ("id", "collectionId", "purchaseId", "batchNo", "label", "side", "storageKey", "mime", "width", "height", "viewWidth", "viewHeight", "sizeBytes", "createdAt")
            VALUES (${sheetId}, ${collectionId}, NULL, ${batchNo}, ${label}, ${side}, ${`${collectionId}/sheets/${sheetId}`}, 'image/png', 100, 100, 100, 100, 1, ${createdAt})`;
        await sheet(id("b1-front"), 1, "front", null, new Date("2026-03-10T09:00:00Z"));
        await sheet(id("b1-back"), 1, "back", null, new Date("2026-03-10T09:05:00Z"));
        await sheet(id("b2-front"), 2, "front", "Klaser Polska 1", new Date("2026-04-01T09:00:00Z"));

        const tile = async (
          tileId: string,
          batchNo: number,
          position: number,
          state: string,
          note: string | null,
          itemId: string | null,
          frontSheetId: string
        ) =>
          tx.$executeRaw`INSERT INTO "scan_tile" ("id", "collectionId", "purchaseId", "batchNo", "position", "state", "note", "itemId", "frontSheetId", "frontX", "frontY", "frontW", "frontH")
            VALUES (${tileId}, ${collectionId}, NULL, ${batchNo}, ${position}, ${state}, ${note}, ${itemId}, ${frontSheetId}, 0, 0, 10, 10)`;
        await tile(id("b1-t0"), 1, 0, "unidentified", null, null, id("b1-front"));
        await tile(id("b1-t1"), 1, 1, "parked", "watermark?", null, id("b1-front"));
        await tile(id("b1-t2"), 1, 2, "discarded", "damaged", null, id("b1-front"));
        await tile(id("b1-t3"), 1, 3, "consumed", null, earlierCopyId, id("b1-front"));
        await tile(id("b2-t0"), 2, 0, "unidentified", null, null, id("b2-front"));

        // A third card still arriving in chunks when the migration ran.
        await tx.$executeRaw`INSERT INTO "scan_upload" ("id", "collectionId", "purchaseId", "side", "mime", "totalBytes", "chunkBytes", "updatedAt")
          VALUES (${id("upload")}, ${collectionId}, NULL, 'front', 'image/png', 10, 10, now())`;

        // ── The migration itself ──
        await tx.$executeRawUnsafe(sql);
      },
      // The lock may have to wait behind a concurrent writer, so this is not the 5 s default.
      { timeout: 60_000, maxWait: 60_000 }
    );
  });

  after(async () => {
    const collections = [collectionId, orderOnlyCollectionId];
    await prisma.scanTile.deleteMany({ where: { collectionId: { in: collections } } });
    await prisma.scanSheet.deleteMany({ where: { collectionId: { in: collections } } });
    await prisma.item.deleteMany({ where: { collectionId: { in: collections } } });
    await prisma.collection.deleteMany({ where: { id: { in: collections } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  async function openingBalance() {
    return prisma.purchase.findFirstOrThrow({
      where: { collectionId, kind: "opening_balance" },
      include: { lots: true },
    });
  }

  it("creates one opening balance titled Card scans, dated by the oldest card", async () => {
    const documents = await prisma.purchase.findMany({
      where: { collectionId, kind: "opening_balance" },
    });
    assert.equal(documents.length, 1, "one document per collection, however many cards");
    const [doc] = documents;
    assert.equal(doc.title, "Card scans");
    assert.equal(doc.purchasedAt.toISOString().slice(0, 10), "2026-03-10");
    assert.equal(doc.currency, "PLN", "the collection's base currency");
    assert.equal(doc.fxRateToBase, null);
    assert.equal(doc.status, "arrived");
    assert.equal(doc.contactId, null);
    assert.equal(doc.shippingCost, null);
    // The order took number 1 off the counter; the document takes the next and moves it on.
    assert.equal(doc.purchaseNo, 2);
    const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } });
    assert.equal(collection.nextPurchaseNo, 3);
    // Past the highest batch it received, so the next card cannot reuse a number on a card.
    assert.equal(doc.nextScanBatchNo, 3);
  });

  it("gives it one open lot with no title and no opening value", async () => {
    const { lots } = await openingBalance();
    assert.equal(lots.length, 1);
    assert.equal(lots[0].title, null);
    assert.equal(lots[0].price, null, "no value is NULL, never 0 (#1184)");
    assert.equal(lots[0].status, "open");
  });

  it("moves every card with its tiles, names and notes as they were", async () => {
    const doc = await openingBalance();
    const sheets = await prisma.scanSheet.findMany({
      where: { collectionId, purchaseId: doc.id },
      orderBy: [{ batchNo: "asc" }, { side: "desc" }],
      select: { id: true, batchNo: true, side: true, label: true },
    });
    assert.deepEqual(sheets, [
      { id: id("b1-front"), batchNo: 1, side: "front", label: null },
      { id: id("b1-back"), batchNo: 1, side: "back", label: null },
      { id: id("b2-front"), batchNo: 2, side: "front", label: "Klaser Polska 1" },
    ]);
    const tiles = await prisma.scanTile.findMany({
      where: { collectionId, purchaseId: doc.id },
      orderBy: [{ batchNo: "asc" }, { position: "asc" }],
      select: { id: true, batchNo: true, state: true, note: true, itemId: true },
    });
    assert.deepEqual(tiles, [
      { id: id("b1-t0"), batchNo: 1, state: "unidentified", note: null, itemId: null },
      { id: id("b1-t1"), batchNo: 1, state: "parked", note: "watermark?", itemId: null },
      { id: id("b1-t2"), batchNo: 1, state: "discarded", note: "damaged", itemId: null },
      { id: id("b1-t3"), batchNo: 1, state: "consumed", note: null, itemId: earlierCopyId },
      { id: id("b2-t0"), batchNo: 2, state: "unidentified", note: null, itemId: null },
    ]);
    const upload = await prisma.scanUpload.findUniqueOrThrow({ where: { id: id("upload") } });
    assert.equal(upload.purchaseId, doc.id, "an upload in flight lands on the same document");

    // …and the order screen reads them like any document's.
    const listed = await listScans(userId, { purchaseId: doc.id });
    assert.deepEqual(
      listed.batches.map((b) => [b.batchNo, b.label, b.tiles.length]),
      [
        [2, "Klaser Polska 1", 1],
        [1, null, 4],
      ]
    );
  });

  it("leaves an order's cards, and a collection with no purchase-less card, alone", async () => {
    const orderSheet = await prisma.scanSheet.findUniqueOrThrow({ where: { id: orderSheetId } });
    assert.equal(orderSheet.purchaseId, orderId);
    assert.equal(orderSheet.batchNo, 1);
    const order = await prisma.purchase.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(order.nextScanBatchNo, 2);
    assert.equal(
      await prisma.purchase.count({
        where: { collectionId: orderOnlyCollectionId, kind: "opening_balance" },
      }),
      0
    );
  });

  it("does not touch a copy Card scans had already created", async () => {
    const copy = await prisma.item.findUniqueOrThrow({ where: { id: earlierCopyId } });
    assert.equal(copy.lotId, null, "not attached to the opening balance");
    assert.equal(copy.deliveryState, "delivered");
    assert.equal(copy.costBasis, null);
  });

  it("identifies a moved tile into a copy that lands to sort on the document's lot", async () => {
    const { lots } = await openingBalance();
    const [copy] = await identifyTilesAsNewCopies(userId, [id("b2-t0")], {
      stampId,
      conditionId,
    });
    const item = await prisma.item.findUniqueOrThrow({ where: { id: copy.itemId } });
    assert.equal(item.lotId, lots[0].id, "the one lot is used without asking");
    assert.equal(item.deliveryState, "to_sort");
    const tile = await prisma.scanTile.findUniqueOrThrow({ where: { id: id("b2-t0") } });
    assert.equal(tile.state, "consumed");
    assert.equal(tile.itemId, item.id);
  });

  it("puts the schema back with a card always on a document", async () => {
    const columns = await prisma.$queryRaw<{ table_name: string; is_nullable: string }[]>`
      SELECT table_name, is_nullable FROM information_schema.columns
       WHERE table_schema = current_schema() AND column_name = 'purchaseId'
         AND table_name IN ('scan_sheet', 'scan_tile', 'scan_upload')
       ORDER BY table_name`;
    assert.deepEqual(
      columns.map((c) => [c.table_name, c.is_nullable]),
      [
        ["scan_sheet", "NO"],
        ["scan_tile", "NO"],
        ["scan_upload", "NO"],
      ]
    );
    const counter = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'collection'
         AND column_name = 'nextScanBatchNo'`;
    assert.equal(Number(counter[0].n), 0, "the collection's batch counter is gone");
  });
});
