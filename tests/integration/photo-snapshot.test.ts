import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  PhotoAuthError,
  applyPhotoChangeSet,
  listStampCopyPhotos,
  stageUpload,
} from "../../src/lib/photos";
import { saveAnnotatedSnapshot } from "../../src/lib/photo-snapshot";
import { DEFAULT_ANNOTATION_STYLE } from "../../src/lib/annotations";
import {
  getStampSizeSources,
  writeMeasuredStampSize,
  StampMeasuredSizeError,
} from "../../src/lib/stamp-measured-size";
import { getStorage, sheetVariantKey, variantKey } from "../../src/lib/storage";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-photo-snapshot-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// A marked-up detail kept as a photo (#674), and a size measured on a photo written onto its stamp
// (#1290).
//
// The upload is deliberately larger than `FULL_MAX_EDGE`, so the stored picture is a downscale of it:
// a region asked for in the upload's own pixels has to land on the same part of the derivative, and a
// snapshot that mapped it one-to-one would cut the wrong piece and still look like a photograph. The
// picture is red on its left half and green on its right, so which half came back is a colour.

const W = 3000;
const H = 1500;
/** Thick enough that a stroke survives the JPEG as a readable colour. Snapshots here are taken as if
 * at half zoom, so one screen pixel is 1250 / 1500 / 0.5 ≈ 1.67 snapshot pixels. */
const STYLE = { ...DEFAULT_ANNOTATION_STYLE, thickness: 3 };

async function halvedPicture(): Promise<Buffer> {
  const green = await sharp({
    create: { width: W / 2, height: H, channels: 3, background: { r: 30, g: 200, b: 30 } },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: 220, g: 30, b: 30 } } })
    .composite([{ input: green, left: W / 2, top: 0 }])
    .png()
    .toBuffer();
}

async function pixels(photo: { storageBackend: string; storageKey: string; mime: string }) {
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
): [number, number, number] {
  const at = (y * px.info.width + x) * px.info.channels;
  return [px.data[at], px.data[at + 1], px.data[at + 2]];
}

describe("annotated snapshots and measured sizes (#674, #1290)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let stampId: string;
  let itemId: string;
  let frontPhotoId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-photo-snapshot-${ts}`;
    otherUserId = `test-user-photo-snapshot-other-${ts}`;
    await prisma.user.createMany({
      data: [userId, otherUserId].map((id) => ({
        id,
        name: `Test User ${id}`,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-snapshot-${ts}`, name: "Snapshots", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-snapshot-other-${ts}`,
          name: "Someone else's",
          baseCurrency: "EUR",
          ownerId: otherUserId,
        },
      })
    ).id;
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    stampId = (
      await prisma.stamp.create({
        data: { collectionId, name: "Flawed", primaryCatalogSortKey: catalogSortKeyOf("1") },
      })
    ).id;
    itemId = (await createItem(userId, collectionId, { stampId, conditionId: condition.id })).id;

    const upload = await stageUpload(userId, collectionId, {
      bytes: await halvedPicture(),
      mime: "image/png",
    });
    await applyPhotoChangeSet(userId, itemId, {
      add: [{ uploadId: upload.id, role: "front", title: null, sortOrder: 0 }],
      update: [],
      remove: [],
    });
    const front = await prisma.photo.findFirstOrThrow({ where: { itemId, role: "front" } });
    frontPhotoId = front.id;
    // The premise: the stored picture is a downscale of the upload, and the upload's size is known.
    assert.deepEqual([front.width, front.height], [2500, 1250]);
    assert.deepEqual([front.originalWidth, front.originalHeight], [W, H]);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("cuts the region asked for in the upload's pixels and keeps it beside the photo", async () => {
    const { photoId, owner } = await saveAnnotatedSnapshot(userId, collectionId, {
      photoId: frontPhotoId,
      // The right half of the upload — green — in the upload's own frame.
      region: { x: W / 2, y: 0, w: W / 2, h: H },
      marks: [{ kind: "ellipse", a: { x: 1600, y: 100 }, b: { x: 2000, y: 500 } }],
      title: "Plate flaw",
      style: STYLE,
      viewScale: 0.5,
    });
    assert.equal(owner, "item");

    const row = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    assert.equal(row.itemId, itemId);
    // An extra, never a slot: a detail must not displace the front it was taken on.
    assert.equal(row.role, null);
    assert.equal(row.title, "Plate flaw");
    assert.ok(row.sortOrder > 0);
    assert.equal(row.width, row.height, "a square region comes back square");

    const px = await pixels(row);
    const [r, g] = colourAt(px, px.info.width - 20, px.info.height - 20);
    assert.ok(g > 150 && r < 90, `the green half came back, not the red one (got r=${r} g=${g})`);

    // The ring is drawn where it was placed: around (1800, 300) of the upload with a radius of 200,
    // which is (300, 300) of a 1500-px region — so its right-hand rim is at (500, 300), scaled.
    // The stroke is a couple of pixels of white through a JPEG over green, so it is read as the red
    // and blue channels lifting off the green — and checked against the ring's own centre, where the
    // picture must still be plain green, so a snapshot washed out everywhere cannot pass.
    const scale = px.info.width / (W / 2);
    const rim = colourAt(px, Math.round(500 * scale), Math.round(300 * scale));
    assert.ok(rim[0] > 120 && rim[2] > 120, `the ring's white stroke is on the rim (got ${rim})`);
    const centre = colourAt(px, Math.round(300 * scale), Math.round(300 * scale));
    assert.ok(centre[0] < 90 && centre[1] > 150, `inside the ring is the picture (got ${centre})`);

    // The original is untouched.
    const front = await prisma.photo.findUniqueOrThrow({ where: { id: frontPhotoId } });
    assert.equal(front.role, "front");
    assert.deepEqual([front.width, front.height], [2500, 1250]);
  });

  it("draws the marks in the chosen colour and thickness, ruler graduations and notes included (#1300)", async () => {
    // The red half, blue marks: a ruler mark along y = 1200 and a note near the top-left corner.
    const { photoId } = await saveAnnotatedSnapshot(userId, collectionId, {
      photoId: frontPhotoId,
      region: { x: 0, y: 0, w: W / 2, h: H },
      marks: [
        { kind: "rulerMark", a: { x: 100, y: 1200 }, b: { x: 1400, y: 1200 }, dpi: 1200 },
        { kind: "text", at: { x: 200, y: 200 }, text: "Flaw" },
      ],
      title: "Ruler",
      style: { colour: "blue", thickness: 5, fontSize: 32 },
      viewScale: 0.5,
    });
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    const px = await pixels(row);
    const scale = px.info.width / (W / 2);
    const blue = ([r, , b]: [number, number, number]) => b > 150 && r < 120;

    // The line itself.
    const onLine = colourAt(px, Math.round(750 * scale), Math.round(1200 * scale));
    assert.ok(blue(onLine), `the line is blue (got ${onLine})`);

    // At half zoom 1200 dpi is ~23.6 screen px per mm, so the graduations are every 0.5 mm with a long
    // tick on every millimetre. 15 screen-ish pixels off the line, a long tick is there and a short one
    // is not — at 1 mm from the end there is blue, at 1.25 mm the picture.
    const pxPerMm = 1200 / 25.4;
    const off = Math.round(1200 * scale) - 15;
    const major = colourAt(px, Math.round((100 + pxPerMm) * scale), off);
    assert.ok(blue(major), `a long graduation at 1 mm (got ${major})`);
    const between = colourAt(px, Math.round((100 + 1.25 * pxPerMm) * scale), off);
    assert.ok(between[0] > 150 && between[2] < 120, `no graduation at 1.25 mm (got ${between})`);

    // The note is set in the same colour, from its top-left corner.
    let noteBlue = 0;
    for (let y = Math.round(200 * scale); y < Math.round(200 * scale) + 60; y++) {
      for (let x = Math.round(200 * scale); x < Math.round(200 * scale) + 140; x++) {
        if (blue(colourAt(px, x, y))) noteBlue++;
      }
    }
    assert.ok(noteBlue > 100, `the note is drawn in blue (got ${noteBlue} blue pixels)`);
  });

  it("maps a region across the downscale rather than onto the derivative's own pixels", async () => {
    // A region straddling the red/green boundary at x = 1500 of the upload, which sits at the
    // snapshot's midpoint. Read one-to-one on the 2500-px derivative instead, the same numbers put the
    // boundary a quarter of the way in — so 40% across is red only when the mapping is right.
    const { photoId } = await saveAnnotatedSnapshot(userId, collectionId, {
      photoId: frontPhotoId,
      region: { x: 1000, y: 0, w: 1000, h: 1000 },
      marks: [],
      title: "Straddle",
      style: STYLE,
      viewScale: 0.5,
    });
    const px = await pixels(await prisma.photo.findUniqueOrThrow({ where: { id: photoId } }));
    const [r40, g40] = colourAt(px, Math.round(px.info.width * 0.4), 50);
    assert.ok(r40 > 150 && g40 < 90, `40% across is still the red half (got r=${r40} g=${g40})`);
    const [r60, g60] = colourAt(px, Math.round(px.info.width * 0.6), 50);
    assert.ok(g60 > 150 && r60 < 90, `60% across is the green half (got r=${r60} g=${g60})`);
  });

  /**
   * A tile whose front is the item's stored picture, cut from a card. The card's own bytes are the
   * same layout **in blue and green** rather than red and green, so a snapshot that came off the card
   * is told from one that came off the stored derivative by its colour alone.
   */
  async function tileOnCard(batchNo: number, card: "retained" | "swept") {
    const front = await prisma.photo.findUniqueOrThrow({ where: { id: frontPhotoId } });
    const storageKey = `${collectionId}/sheets/test-${batchNo}`;
    if (card === "retained") {
      const blue = await sharp({
        create: { width: W / 2, height: H, channels: 3, background: { r: 30, g: 30, b: 220 } },
      })
        .png()
        .toBuffer();
      const original = await sharp({
        create: { width: W, height: H, channels: 3, background: { r: 30, g: 200, b: 30 } },
      })
        .composite([{ input: blue, left: 0, top: 0 }])
        .png()
        .toBuffer();
      await getStorage(front.storageBackend).put(
        sheetVariantKey(storageKey, "original", "image/png"),
        original,
        "image/png",
        "work"
      );
    }
    const sheet = await prisma.scanSheet.create({
      data: {
        collectionId,
        batchNo,
        side: "front",
        storageBackend: front.storageBackend,
        storageKey,
        mime: "image/png",
        width: W,
        height: H,
        viewWidth: 2500,
        viewHeight: 1250,
        sizeBytes: 1,
        purgedAt: card === "swept" ? new Date() : null,
      },
    });
    const tile = await prisma.scanTile.create({
      data: {
        collectionId,
        batchNo,
        position: 0,
        frontSheetId: sheet.id,
        frontX: 0,
        frontY: 0,
        frontW: W,
        frontH: H,
      },
    });
    const photo = await prisma.photo.create({
      data: {
        tileId: tile.id,
        role: "front",
        storageBackend: front.storageBackend,
        storageKey: front.storageKey,
        mime: front.mime,
        width: front.width,
        height: front.height,
        originalWidth: W,
        originalHeight: H,
        sizeBytes: front.sizeBytes,
      },
    });
    return { tileId: tile.id, photoId: photo.id };
  }

  it("keeps a tile's snapshot with the tile, cut from the card while it is retained", async () => {
    const { tileId, photoId: tilePhotoId } = await tileOnCard(1, "retained");
    const { photoId, owner } = await saveAnnotatedSnapshot(userId, collectionId, {
      photoId: tilePhotoId,
      region: { x: 0, y: 0, w: W / 2, h: H },
      marks: [],
      title: "Detail",
      style: STYLE,
      viewScale: 0.5,
    });
    assert.equal(owner, "tile");
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    assert.equal(row.tileId, tileId);
    assert.equal(row.role, null);
    const [r, g, b] = colourAt(await pixels(row), 20, 20);
    assert.ok(b > 150 && r < 90 && g < 90, `the card's own left half came back (got ${[r, g, b]})`);
    // The tile's front is still the one front it has.
    assert.equal(await prisma.photo.count({ where: { tileId, role: "front" } }), 1);
  });

  it("falls back to the stored picture once the card has been swept", async () => {
    const { tileId, photoId: tilePhotoId } = await tileOnCard(2, "swept");
    const { photoId } = await saveAnnotatedSnapshot(userId, collectionId, {
      photoId: tilePhotoId,
      region: { x: 0, y: 0, w: W / 2, h: H },
      marks: [],
      title: "Detail",
      style: STYLE,
      viewScale: 0.5,
    });
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    assert.equal(row.tileId, tileId);
    const [r, g, b] = colourAt(await pixels(row), 20, 20);
    assert.ok(r > 150 && g < 90 && b < 90, `the stored picture's red half came back (got ${[r, g, b]})`);
  });

  it("refuses a photo in someone else's collection, and a region off the picture", async () => {
    await assert.rejects(
      saveAnnotatedSnapshot(otherUserId, otherCollectionId, {
        photoId: frontPhotoId,
        region: { x: 0, y: 0, w: 100, h: 100 },
        marks: [],
        title: "Detail",
        style: STYLE,
        viewScale: 0.5,
      }),
      PhotoAuthError
    );
    await assert.rejects(
      saveAnnotatedSnapshot(userId, collectionId, {
        photoId: frontPhotoId,
        region: { x: W + 10, y: 0, w: 100, h: 100 },
        marks: [],
        title: "Detail",
        style: STYLE,
        viewScale: 0.5,
      })
    );
  });

  it("lists a stamp's copies' photos with the copy named, and the frame they are measured in", async () => {
    const { photos, total } = await listStampCopyPhotos(userId, stampId);
    assert.equal(total, photos.length);
    const front = photos.find((p) => p.id === frontPhotoId);
    assert.ok(front);
    assert.match(front.title ?? "", /^Copy .+ · Front$/);
    assert.deepEqual(front.measureFrame, { width: W, height: H });
    assert.ok(photos.some((p) => /· Plate flaw$/.test(p.title ?? "")), "the snapshot is among them");
    // Front before the detail taken on it.
    assert.equal(photos[0].id, frontPhotoId);
  });

  it("writes a measured size, and replaces a stated one only when told to", async () => {
    const sizeOf = async () => {
      const row = await prisma.stamp.findUniqueOrThrow({
        where: { id: stampId },
        select: { widthMm: true, heightMm: true },
      });
      return [row.widthMm?.toNumber() ?? null, row.heightMm?.toNumber() ?? null];
    };

    assert.equal((await writeMeasuredStampSize(userId, stampId, { widthMm: 21.54, heightMm: 25 }, false)).status, "saved");
    assert.deepEqual(await sizeOf(), [21.5, 25]);

    const asked = await writeMeasuredStampSize(userId, stampId, { widthMm: 22, heightMm: 26 }, false);
    assert.equal(asked.status, "confirm");
    assert.ok(asked.status === "confirm");
    assert.deepEqual(asked.current, { widthMm: 21.5, heightMm: 25 });
    assert.deepEqual(await sizeOf(), [21.5, 25], "nothing is written before the collector says so");

    assert.equal((await writeMeasuredStampSize(userId, stampId, { widthMm: 22, heightMm: 26 }, true)).status, "saved");
    assert.deepEqual(await sizeOf(), [22, 26]);

    assert.equal((await writeMeasuredStampSize(userId, stampId, { widthMm: 22, heightMm: 26 }, false)).status, "same");

    await assert.rejects(
      writeMeasuredStampSize(otherUserId, stampId, { widthMm: 30, heightMm: 30 }, true),
      StampMeasuredSizeError
    );
    await assert.rejects(
      writeMeasuredStampSize(userId, stampId, { widthMm: 0.2, heightMm: 30 }, true),
      StampMeasuredSizeError
    );
    assert.deepEqual(await sizeOf(), [22, 26]);
  });

  it("gives the page editor's box the stated size, the scale and the photos a size can be measured on (#1309)", async () => {
    const sources = await getStampSizeSources(userId, stampId);
    assert.deepEqual(sources.size, { widthMm: 22, heightMm: 26 });
    assert.equal(sources.scanDpi, 1200);
    const front = sources.photos.find((p) => p.id === frontPhotoId);
    assert.ok(front, "a copy's photo is offered, as the stamp's own screen offers it");
    assert.deepEqual(front.measureFrame, { width: W, height: H });
    assert.ok(
      sources.photos.every((p) => p.measureFrame),
      "nothing is offered for measuring whose scale cannot be known"
    );
    // The stamp's own photos (a snapshot taken on the stamp above is one) and its copies'.
    const { total: copyTotal } = await listStampCopyPhotos(userId, stampId);
    const ownTotal = await prisma.photo.count({ where: { stampId } });
    assert.equal(sources.photos.length + sources.unmeasurable, ownTotal + copyTotal);

    // A stamp with no photo at all offers none, and says there is nothing unmeasurable either — the
    // panel's two reasons are told apart by that count.
    const bare = await prisma.stamp.create({
      data: { collectionId, name: "Bare", primaryCatalogSortKey: catalogSortKeyOf("2") },
    });
    const none = await getStampSizeSources(userId, bare.id);
    assert.deepEqual(none.photos, []);
    assert.equal(none.unmeasurable, 0);
    assert.deepEqual(none.size, { widthMm: null, heightMm: null });

    await assert.rejects(getStampSizeSources(otherUserId, stampId), StampMeasuredSizeError);
  });
});
