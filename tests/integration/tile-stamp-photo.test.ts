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
import { ScanValidationError, commitCut, uploadSheet } from "../../src/lib/scan-sheets";
import {
  identifyTileAsNewCopy,
  identifyTilesAsNewCopies,
  reidentifyTileCopy,
} from "../../src/lib/scan-tiles";
import { getStorage, variantKey } from "../../src/lib/storage";
import type { Box } from "../../src/lib/scan-boxes";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-tile-stamp-photo-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Making a tile's photo the stamp's photo while identifying it (#1340), even when the stamp already
// has one. What is pinned is the three rules the collector settled on 2026-09-18:
//
//   - the stamp's main is **replaced**, and nothing more is kept of the old one;
//   - an ancestor follows only where its main is **the same picture** as the one replaced — which is
//     what #347's propagation put there — is filled where it has none, and is otherwise left alone;
//   - absent, the answer is #149's auto-seed, unchanged; null gives the stamp nothing at all.
//
// "The same picture" is decided on the bytes, so every card here is drawn in its own colours: two
// cards drawn alike would cut byte-identical tiles, which is exactly what the rule treats as one
// picture.

describe("the tile's photo as the stamp's photo (#1340)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let formatId: string;
  let subtypeId: string;
  let cardNo = 0;

  const BOXES: Box[] = [
    { x: 50, y: 50, w: 200, h: 300 },
    { x: 500, y: 50, w: 200, h: 300 },
  ];

  /** A card whose two pieces are coloured by `n`, so no two cards cut the same picture. */
  async function card(n: number): Promise<Buffer> {
    return sharp({
      create: { width: 1200, height: 600, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite(
        await Promise.all(
          BOXES.map(async (box, i) => ({
            input: await sharp({
              create: {
                width: box.w,
                height: box.h,
                channels: 3,
                background: { r: (40 + n * 23) % 256, g: (60 + i * 90) % 256, b: (n * 57) % 256 },
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

  /** A fresh order with one cut card of two tiles, in reading order. */
  async function tiles(): Promise<string[]> {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-02-01",
    });
    await createLot(userId, purchase.id, 100);
    const sheet = await uploadSheet(userId, { purchaseId: purchase.id }, {
      source: await card(cardNo++),
      mime: "image/png",
      side: "front",
    });
    await commitCut(userId, sheet.id, BOXES);
    const rows = await prisma.scanTile.findMany({
      where: { purchaseId: purchase.id },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    return rows.map((t) => t.id);
  }

  /** An umbrella with variants under it that act as variants (#368). */
  async function tree(...variants: string[]): Promise<{ umbrella: string; variants: string[] }> {
    const umbrella = (await prisma.stamp.create({ data: { collectionId, name: "Umbrella" } })).id;
    const ids: string[] = [];
    for (const name of variants) {
      ids.push(
        (
          await prisma.stamp.create({
            data: { collectionId, name, parentId: umbrella, subtypeId },
          })
        ).id
      );
    }
    return { umbrella, variants: ids };
  }

  async function frontOf(tileId: string): Promise<string> {
    const photo = await prisma.photo.findFirstOrThrow({
      where: { tileId, role: "front" },
      select: { id: true },
    });
    return photo.id;
  }

  async function thumbBytes(photoId: string): Promise<Buffer> {
    const p = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    const obj = await getStorage(p.storageBackend).get(
      variantKey(p.storageKey, "thumb", p.mime),
      p.mime,
      "delivery"
    );
    const chunks: Buffer[] = [];
    for await (const chunk of obj.stream) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }

  /** The stamp's photos, and whether its one main shows the given photo's picture. */
  async function mainShows(stampId: string, photoId: string): Promise<boolean> {
    const main = await prisma.photo.findFirst({ where: { stampId, role: "main" } });
    if (!main) return false;
    return (await thumbBytes(main.id)).equals(await thumbBytes(photoId));
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-tile-stamp-photo-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User tile-stamp-photo-${ts}`,
        email: `test-tile-stamp-photo-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-tile-stamp-photo-${ts}`,
          name: "Tile stamp photo",
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
    formatId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Pair", abbreviation: "pair", sortOrder: 0 },
      })
    ).id;
    subtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Shade", actsAsVariant: true, sortOrder: 0 },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("replaces the variant's poor picture, and the umbrella's that was propagated from it", async () => {
    const { umbrella, variants } = await tree("3a");
    const [variant] = variants;

    // The first copy: its picture seeds 3a and is propagated up to 3 (#149, #347).
    const [poor] = await tiles();
    const poorFront = await frontOf(poor);
    await identifyTileAsNewCopy(userId, poor, { stampId: variant, conditionId });
    assert.ok(await mainShows(variant, poorFront));
    assert.ok(await mainShows(umbrella, poorFront));

    // A better copy, identified the ordinary way: the stamp has a picture, so nothing changes.
    const [, better] = await tiles();
    const betterFront = await frontOf(better);
    const [, untouched] = await tiles();
    await identifyTileAsNewCopy(userId, untouched, { stampId: variant, conditionId });
    assert.ok(await mainShows(variant, poorFront), "absent is the auto-seed, which never replaces");

    // …and with the option on, it replaces both.
    await identifyTileAsNewCopy(userId, better, {
      stampId: variant,
      conditionId,
      stampPhotoTileId: better,
    });
    assert.ok(await mainShows(variant, betterFront));
    assert.ok(await mainShows(umbrella, betterFront), "the umbrella showed the replaced picture");
    // Replaced, not kept: one photo on each, and the copy's own is where it was.
    assert.equal(await prisma.photo.count({ where: { stampId: variant } }), 1);
    assert.equal(await prisma.photo.count({ where: { stampId: umbrella } }), 1);
    assert.equal(
      (await prisma.photo.findUniqueOrThrow({ where: { id: poorFront } })).stampId,
      null,
      "the poor picture still belongs to its own copy"
    );
    assert.equal(await prisma.photo.count({ where: { id: poorFront } }), 1);
  });

  it("leaves an umbrella whose picture is another one, and fills one with none", async () => {
    const { umbrella, variants } = await tree("3a", "3b");
    const [a, b] = variants;

    // 3b is identified first, so the umbrella shows 3b's picture…
    const [sibling, poor] = await tiles();
    const siblingFront = await frontOf(sibling);
    await identifyTileAsNewCopy(userId, sibling, { stampId: b, conditionId });
    // …and 3a's own poor picture stays on 3a alone.
    await identifyTileAsNewCopy(userId, poor, { stampId: a, conditionId });
    assert.ok(await mainShows(umbrella, siblingFront));

    const [better] = await tiles();
    const betterFront = await frontOf(better);
    await identifyTileAsNewCopy(userId, better, { stampId: a, conditionId, stampPhotoTileId: better });
    assert.ok(await mainShows(a, betterFront));
    assert.ok(await mainShows(umbrella, siblingFront), "not the picture replaced, so not replaced");

    // An umbrella with no photo at all is filled, as #347 always filled it.
    const bare = await tree("7a");
    await prisma.photo.create({
      data: {
        stampId: bare.variants[0],
        role: "main",
        storageKey: "reference/none",
        mime: "image/jpeg",
        width: 10,
        height: 10,
        sizeBytes: 1,
      },
    });
    const [reference] = await tiles();
    const referenceFront = await frontOf(reference);
    await identifyTileAsNewCopy(userId, reference, {
      stampId: bare.variants[0],
      conditionId,
      stampPhotoTileId: reference,
    });
    assert.ok(await mainShows(bare.variants[0], referenceFront));
    assert.ok(await mainShows(bare.umbrella, referenceFront));
  });

  it("takes the tile picked from several, and gives nothing when the option is off (#596)", async () => {
    const stamp = (await prisma.stamp.create({ data: { collectionId, name: "Run" } })).id;
    const run = await tiles();
    const pickedFront = await frontOf(run[1]);
    await identifyTilesAsNewCopies(userId, run, { stampId: stamp, conditionId, stampPhotoTileId: run[1] });
    assert.ok(await mainShows(stamp, pickedFront));
    assert.equal(await prisma.photo.count({ where: { stampId: stamp } }), 1);

    // Off, on a stamp with no photo: the collector said no, so the seed does not run either.
    const bare = (await prisma.stamp.create({ data: { collectionId, name: "Bare" } })).id;
    const [off] = await tiles();
    await identifyTileAsNewCopy(userId, off, { stampId: bare, conditionId, stampPhotoTileId: null });
    assert.equal(await prisma.photo.count({ where: { stampId: bare } }), 0);
  });

  it("refuses a pair's picture or another tile's, before anything is created", async () => {
    const stamp = (await prisma.stamp.create({ data: { collectionId, name: "Refused" } })).id;
    const [first, second] = await tiles();
    await assert.rejects(
      () =>
        identifyTileAsNewCopy(userId, first, {
          stampId: stamp,
          conditionId,
          formatId,
          stampPhotoTileId: first,
        }),
      (e) => e instanceof ScanValidationError && /single/.test(e.message)
    );
    await assert.rejects(
      () => identifyTileAsNewCopy(userId, first, { stampId: stamp, conditionId, stampPhotoTileId: second }),
      (e) => e instanceof ScanValidationError && /tile being identified/.test(e.message)
    );
    assert.equal(await prisma.item.count({ where: { stampId: stamp } }), 0);
    assert.equal(
      (await prisma.scanTile.findUniqueOrThrow({ where: { id: first } })).state,
      "unidentified"
    );
  });

  it("offers the same choice when an identification is corrected", async () => {
    const { variants } = await tree("5a", "5b");
    const [a, b] = variants;
    const [held, corrected] = await tiles();
    const heldFront = await frontOf(held);
    const correctedFront = await frontOf(corrected);
    await identifyTileAsNewCopy(userId, held, { stampId: b, conditionId });
    await identifyTileAsNewCopy(userId, corrected, { stampId: a, conditionId });

    // It was 5b after all, and a better picture of it than the one 5b has.
    await assert.rejects(
      () => reidentifyTileCopy(userId, corrected, { stampId: b, conditionId, stampPhotoTileId: held }),
      ScanValidationError
    );
    assert.ok(await mainShows(b, heldFront));
    await reidentifyTileCopy(userId, corrected, { stampId: b, conditionId, stampPhotoTileId: corrected });
    assert.ok(await mainShows(b, correctedFront));
  });
});
