import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createCollection, getCollectionBySlug } from "../../src/lib/collections";
import { createPurchase } from "../../src/lib/purchases";
import { ScanValidationError, uploadSheet } from "../../src/lib/scan-sheets";
import {
  calibrateScanningProfile,
  createScanningProfile,
  deleteScanningProfile,
  listScanningProfiles,
  ScanningProfileError,
  setDefaultScanningProfile,
  updateScanningProfile,
} from "../../src/lib/scanning-profiles";
import {
  StampMeasuredSizeError,
  writeMeasuredStampSize,
} from "../../src/lib/stamp-measured-size";
import { updateStampWithCatalog } from "../../src/lib/stamps";
import { applyStampSize } from "../../src/lib/stamp-size-presets";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";
import { MM_PER_INCH } from "../../src/lib/scan-measure";
import { type CalibrationStretches } from "../../src/lib/scanning-profile";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-scanning-profiles-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Scanning profiles (#1443). The arithmetic is unit-tested; what needs a database is what a profile
// is attached to and what that attachment forbids:
//
//   - a new collection starts with one uncalibrated default profile, so nothing measures differently;
//   - a scan records the profile it was uploaded with, or the default;
//   - a stamp's size records the profile it was measured with, keeps it through a save that leaves
//     the size alone, and loses it when the size changes without a measurement;
//   - a profile in use — the default, a scan's, a size's — cannot be deleted, while a whole
//     collection still can.

const px = (mm: number, dpi: number) => (mm / MM_PER_INCH) * dpi;

/** A stretch across and one along, as marked on ruler scans taken at an effective `x` × `y` dpi —
 * placed where two separate scans would put them, since the server cannot tell and need not. */
function stretches(x: number, y: number, acrossMm = 150, alongMm = 150): CalibrationStretches {
  return {
    across: { a: { x: 120, y: 40 }, b: { x: 120 + px(acrossMm, x), y: 40 }, mm: acrossMm },
    along: { a: { x: 60, y: 90 }, b: { x: 60, y: 90 + px(alongMm, y) }, mm: alongMm },
  };
}

async function card(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 10, b: 10 } } })
    .png()
    .toBuffer();
}

describe("scanning profiles (#1443)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let defaultId: string;
  let epsonId: string;
  let foreignId: string;
  let stampId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-scan-profiles-${ts}`;
    otherUserId = `test-user-scan-profiles-other-${ts}`;
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
    collectionId = (await createCollection(userId, `Profiles ${ts}`, "EUR")).id;
    otherCollectionId = (await createCollection(otherUserId, `Other ${ts}`, "EUR")).id;
    foreignId = (await listScanningProfiles(otherUserId, otherCollectionId))[0].id;
    stampId = (
      await prisma.stamp.create({
        data: { collectionId, name: "Measured", primaryCatalogSortKey: catalogSortKeyOf("1") },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("gives a new collection one uncalibrated default profile at 1200 dpi", async () => {
    const rows = await listScanningProfiles(userId, collectionId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Scanner");
    assert.equal(rows[0].nominalDpi, 1200);
    assert.equal(rows[0].calibration, null);
    assert.equal(rows[0].isDefault, true);
    defaultId = rows[0].id;

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } });
    const read = await getCollectionBySlug(userId, collection.slug);
    assert.equal(read?.scanning.defaultProfileId, defaultId);
    assert.deepEqual(read?.scanning.profiles.map((p) => p.id), [defaultId]);
  });

  it("adds a profile, refuses a second of the same name, and refuses another owner", async () => {
    epsonId = (await createScanningProfile(userId, collectionId, { name: " Epson  V600 ", nominalDpi: 1200 })).id;
    const epson = await prisma.scanningProfile.findUniqueOrThrow({ where: { id: epsonId } });
    assert.equal(epson.name, "Epson V600");
    await assert.rejects(
      createScanningProfile(userId, collectionId, { name: "Epson V600", nominalDpi: 600 }),
      ScanningProfileError
    );
    await assert.rejects(
      createScanningProfile(userId, collectionId, { name: "Typo", nominalDpi: 12000 }),
      ScanningProfileError
    );
    await assert.rejects(
      createScanningProfile(otherUserId, collectionId, { name: "Intruder", nominalDpi: 1200 }),
      ScanningProfileError
    );
  });

  it("solves the marked stretches itself, stores the result, and refuses one past the band", async () => {
    const view = await calibrateScanningProfile(userId, epsonId, stretches(1195.37, 1198.02));
    assert.deepEqual(view.calibration, { x: 1195.37, y: 1198.02 });
    await assert.rejects(
      calibrateScanningProfile(userId, epsonId, stretches(1100, 1198)),
      ScanningProfileError
    );
    await assert.rejects(
      calibrateScanningProfile(otherUserId, epsonId, stretches(1195, 1198)),
      ScanningProfileError
    );
  });

  it("refuses a stretch shorter than the minimum, whoever sent it (#1486)", async () => {
    await assert.rejects(
      calibrateScanningProfile(userId, epsonId, stretches(1195.37, 1198.02, 150, 99)),
      /at least 100 mm/
    );
    const [epson] = (await listScanningProfiles(userId, collectionId)).filter((p) => p.id === epsonId);
    assert.deepEqual(epson.calibration, { x: 1195.37, y: 1198.02 });
  });

  it("drops the calibration when the nominal resolution changes, and keeps it on a rename", async () => {
    const renamed = await updateScanningProfile(userId, epsonId, { name: "Epson V600 Photo" });
    assert.notEqual(renamed.calibration, null);
    const halved = await updateScanningProfile(userId, epsonId, { nominalDpi: 600 });
    assert.equal(halved.calibration, null);
    await updateScanningProfile(userId, epsonId, { name: "Epson V600", nominalDpi: 1200 });
    await calibrateScanningProfile(userId, epsonId, stretches(1195.37, 1198.02));
  });

  it("records the default on a scan uploaded without a choice, and the chosen one otherwise", async () => {
    const purchase = await createPurchase(userId, collectionId, { currency: "EUR", purchasedAt: "2026-09-28" });
    const plain = await uploadSheet(userId, { purchaseId: purchase.id }, {
      source: await card(),
      mime: "image/png",
      side: "front",
    });
    const chosen = await uploadSheet(userId, { purchaseId: purchase.id }, {
      source: await card(),
      mime: "image/png",
      side: "front",
      scanningProfileId: epsonId,
    });
    const sheets = await prisma.scanSheet.findMany({
      where: { id: { in: [plain.id, chosen.id] } },
      select: { id: true, scanningProfileId: true },
    });
    const profileOf = new Map(sheets.map((s) => [s.id, s.scanningProfileId]));
    assert.equal(profileOf.get(plain.id), defaultId);
    assert.equal(profileOf.get(chosen.id), epsonId);

    await assert.rejects(
      uploadSheet(userId, { purchaseId: purchase.id }, {
        source: await card(),
        mime: "image/png",
        side: "front",
        scanningProfileId: foreignId,
      }),
      ScanValidationError
    );
  });

  it("records what a size was measured with, and refuses another collection's profile", async () => {
    const saved = await writeMeasuredStampSize(userId, stampId, { widthMm: 21.5, heightMm: 25 }, false, epsonId);
    assert.equal(saved.status, "saved");
    assert.equal(await sizeProfile(stampId), epsonId);

    await assert.rejects(
      writeMeasuredStampSize(userId, stampId, { widthMm: 22, heightMm: 25 }, true, foreignId),
      StampMeasuredSizeError
    );
    assert.equal(await sizeProfile(stampId), epsonId);
  });

  it("keeps the record through a form save that leaves the size alone, and drops it when the size is typed over", async () => {
    await updateStampWithCatalog(userId, stampId, {
      name: "Measured, renamed",
      catalogNumbers: [],
      widthMm: 21.5,
      heightMm: 25,
    });
    assert.equal(await sizeProfile(stampId), epsonId);

    await updateStampWithCatalog(userId, stampId, {
      name: "Measured, renamed",
      catalogNumbers: [],
      widthMm: 21.6,
      heightMm: 25,
    });
    assert.equal(await sizeProfile(stampId), null);

    // A measurement accepted into the form records its profile.
    await updateStampWithCatalog(userId, stampId, {
      name: "Measured, renamed",
      catalogNumbers: [],
      widthMm: 21.5,
      heightMm: 25,
      sizeMeasuredWith: epsonId,
    });
    assert.equal(await sizeProfile(stampId), epsonId);
  });

  it("drops the record when a size is written over by an apply", async () => {
    await applyStampSize(userId, {
      collectionId,
      widthMm: 20,
      heightMm: 24,
      subject: { kind: "stamps", stampIds: [stampId] },
      overwriteStated: true,
    });
    assert.equal(await sizeProfile(stampId), null);
    await writeMeasuredStampSize(userId, stampId, { widthMm: 21.5, heightMm: 25 }, true, epsonId);
    assert.equal(await sizeProfile(stampId), epsonId);
  });

  it("drops the record when a measured size is replaced by one with no profile", async () => {
    const other = (
      await prisma.stamp.create({
        data: { collectionId, name: "Typed", primaryCatalogSortKey: catalogSortKeyOf("2") },
      })
    ).id;
    await writeMeasuredStampSize(userId, other, { widthMm: 30, heightMm: 40 }, false, epsonId);
    await writeMeasuredStampSize(userId, other, { widthMm: 31, heightMm: 40 }, true, null);
    assert.equal(await sizeProfile(other), null);
  });

  it("refuses to delete a profile in use, says what uses it, and deletes one that is not", async () => {
    await assert.rejects(deleteScanningProfile(userId, defaultId), /default profile/);
    await assert.rejects(deleteScanningProfile(userId, epsonId), /1 scan was taken with it, and 1 stamp size was measured with it/);

    const rows = await listScanningProfiles(userId, collectionId);
    const epson = rows.find((r) => r.id === epsonId);
    assert.equal(epson?.scanCount, 1);
    assert.equal(epson?.stampSizeCount, 1);

    const spare = await createScanningProfile(userId, collectionId, { name: "Spare", nominalDpi: 600 });
    await deleteScanningProfile(userId, spare.id);
    assert.equal(await prisma.scanningProfile.count({ where: { id: spare.id } }), 0);
  });

  it("moves the default, after which the old one is deletable once nothing else uses it", async () => {
    await setDefaultScanningProfile(userId, epsonId);
    const rows = await listScanningProfiles(userId, collectionId);
    assert.deepEqual(
      rows.filter((r) => r.isDefault).map((r) => r.id),
      [epsonId]
    );
    // The first profile still has the scan uploaded without a choice.
    await assert.rejects(deleteScanningProfile(userId, defaultId), /1 scan was taken with it/);
    await assert.rejects(setDefaultScanningProfile(otherUserId, defaultId), ScanningProfileError);
  });

  it("still lets a whole collection go, profiles in use and all", async () => {
    const ts = Date.now();
    const doomed = (await createCollection(userId, `Doomed ${ts}`, "EUR")).id;
    const [profile] = await listScanningProfiles(userId, doomed);
    await prisma.stamp.create({
      data: {
        collectionId: doomed,
        name: "Sized",
        widthMm: 20,
        heightMm: 24,
        sizeScanningProfileId: profile.id,
        primaryCatalogSortKey: catalogSortKeyOf("1"),
      },
    });
    await prisma.collection.delete({ where: { id: doomed } });
    assert.equal(await prisma.scanningProfile.count({ where: { collectionId: doomed } }), 0);
  });
});

async function sizeProfile(stampId: string): Promise<string | null> {
  const stamp = await prisma.stamp.findUniqueOrThrow({
    where: { id: stampId },
    select: { sizeScanningProfileId: true },
  });
  return stamp.sizeScanningProfileId;
}
