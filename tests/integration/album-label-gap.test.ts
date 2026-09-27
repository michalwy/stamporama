import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import type { Prisma } from "../../src/generated/prisma/client";
import { prisma } from "../../src/lib/db";
import { createAlbum, getAlbum, updateAlbumPreset } from "../../src/lib/albums";
import { createAlbumTemplate } from "../../src/lib/album-templates";
import { albumPlanOverview, planAlbum } from "../../src/lib/album-plan";
import { getAlbumEditorData } from "../../src/lib/album-editor";
import { renderAlbumPdf } from "../../src/lib/album-pdf";
import { albumBaselineOffsetMm, MM_TO_PT } from "../../src/lib/album-metrics";
import {
  countAlbumPresetDivergence,
  getAlbumPrintedReport,
  markAlbumPagesPrinted,
} from "../../src/lib/album-printing";
import { getAlbumPageSnapshots } from "../../src/lib/album-printed-pages";
import { albumRenderPreset, DEFAULT_ALBUM_PRESET } from "../../src/lib/album-template-rules";

// The space between a box and its label (#1420), through the rows it is stored on: the template's
// value copied onto the album, the album's own copy edited, the plan, the canvas and the PDF moving
// every label by it, and a printed card reporting a gap that would now differ — including a card
// stored before the gap existed.

const ts = Date.now();

describe("the gap between a box and its label (#1420)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let albumId: string;

  const livePage = async (id = albumId) => {
    const plan = await planAlbum(userId, id);
    assert.ok(plan);
    const page = plan!.pages[0];
    assert.ok(page && page.layout.kind === "live", "a live sheet first");
    return { plan: plan!, layout: page.layout as Extract<typeof page.layout, { kind: "live" }> };
  };
  const setGap = async (labelGapMm: number) => {
    const album = await getAlbum(userId, albumId);
    assert.ok(album);
    await updateAlbumPreset(userId, albumId, { ...albumRenderPreset(album!), labelGapMm });
  };

  before(async () => {
    userId = `test-user-label-gap-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User label-gap-${ts}`,
        email: `test-label-gap-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-label-gap-${ts}`,
          name: "Label gap",
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "en",
        },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          catalogPrefix: "PL",
          primaryCatalogVendorId: vendor.id,
          collectionAreaVendors: { create: [{ catalogVendorId: vendor.id }] },
        },
      })
    ).id;
    await prisma.hawidStrip.createMany({
      data: [{ collectionId, heightMm: 29, stockLengthMm: 210, sortOrder: 0 }],
    });

    const issue = await prisma.issue.create({
      data: {
        collectionId,
        issueNo: 193801,
        collectionAreaId: areaId,
        name: "Mościcki",
        year: 1938,
        primaryCatalogSortKey: "303".padStart(10, "0"),
      },
    });
    const stampIds: string[] = [];
    for (const number of ["303", "304"]) {
      stampIds.push(
        (
          await prisma.stamp.create({
            data: {
              collectionId,
              name: `Stamp ${number}`,
              issuedYear: 1938,
              widthMm: 26,
              heightMm: 25,
              primaryCatalogSortKey: number.padStart(10, "0"),
              catalogNumbers: { create: [{ catalogVendorId: vendor.id, number }] },
              stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
            },
          })
        ).id
      );
    }
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue.id,
        name: "Mościcki",
        sortOrder: 0,
        stamps: { create: stampIds.map((stampId, i) => ({ stampId, sortOrder: i })) },
      },
    });

    albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Polska", collectionAreaId: areaId, language: "en" },
      null
    );
  });

  after(async () => {
    await prisma.album.deleteMany({ where: { collectionId } });
    await prisma.albumTemplate.deleteMany({ where: { collectionId } });
    await prisma.hawidStrip.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("starts an album without a template with its labels on the box's edge", async () => {
    assert.equal((await getAlbum(userId, albumId))?.labelGapMm, 0);
    const { layout } = await livePage();
    for (const box of layout.boxes) {
      assert.ok(box.label, "the default template labels its boxes below them");
      assert.equal(box.label!.yMm, box.yMm + box.heightMm);
    }
  });

  it("copies a template's gap onto an album made from it", async () => {
    await createAlbumTemplate(userId, collectionId, {
      ...DEFAULT_ALBUM_PRESET,
      name: "Airy",
      labelGapMm: 2.5,
    });
    const template = await prisma.albumTemplate.findFirstOrThrow({ where: { collectionId } });
    assert.equal(template.labelGapMm, 2.5);
    const copy = await createAlbum(
      userId,
      collectionId,
      { name: "Polska airy", collectionAreaId: areaId, language: "en" },
      template.id
    );
    assert.equal((await getAlbum(userId, copy))?.labelGapMm, 2.5);
    const { layout } = await livePage(copy);
    for (const box of layout.boxes) assert.equal(box.label!.yMm, box.yMm + box.heightMm + 2.5);
    await prisma.album.delete({ where: { id: copy } });
  });

  it("moves every label by the album's own gap, on the canvas and in the PDF alike", async () => {
    const before = (await livePage()).layout;
    await setGap(3);
    const { plan, layout } = await livePage();
    assert.deepEqual(
      layout.boxes.map((b) => b.yMm),
      before.boxes.map((b) => b.yMm),
      "the mounts stay"
    );
    for (const [i, box] of layout.boxes.entries()) {
      assert.equal(box.label!.yMm, before.boxes[i].label!.yMm + 3);
    }

    const editor = await getAlbumEditorData(userId, albumId, 1);
    assert.ok(editor?.sheet);
    assert.deepEqual(
      editor!.sheet!.boxes.map((b) => b.label?.yMm),
      layout.boxes.map((b) => b.label?.yMm)
    );

    // Every text position the PDF sets, read back out of the file: a label's baseline, in points
    // from the foot of the sheet.
    const file = await renderAlbumPdf(plan, "1");
    const doc = await PDFDocument.load(file.bytes);
    const contents = doc.getPages()[0].node.Contents();
    const streams: PDFRawStream[] =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref) as PDFRawStream)
        : contents instanceof PDFRawStream
          ? [contents]
          : [];
    const ops = streams
      .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
      .join("\n");
    const drawnYs = [...ops.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g)].map((m) => Number(m[2]));
    const baseline = albumBaselineOffsetMm(DEFAULT_ALBUM_PRESET.labelFace, DEFAULT_ALBUM_PRESET.labelSizePt);
    for (const box of layout.boxes) {
      const expected = (DEFAULT_ALBUM_PRESET.pageHeightMm - (box.label!.yMm + baseline)) * MM_TO_PT;
      assert.ok(
        drawnYs.some((y) => Math.abs(y - expected) < 0.01),
        `a label set at ${expected.toFixed(2)} pt from the foot`
      );
    }
    await setGap(0);
  });

  it("reports a printed card whose gap would now differ, and leaves the card alone", async () => {
    const overview = albumPlanOverview((await livePage()).plan);
    await markAlbumPagesPrinted(userId, albumId, [1], overview.fingerprint);
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const snapshot = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.equal(snapshot?.preset.labelGapMm, 0, "the card records the gap it was set with");

    const album = await getAlbum(userId, albumId);
    const wider = { ...albumRenderPreset(album!), labelGapMm: 2 };
    assert.equal(await countAlbumPresetDivergence(userId, albumId, wider), 1);
    await updateAlbumPreset(userId, albumId, wider);
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(
      report.sheets[0].divergences.map((d) => d.detail),
      ["The album's Label gap (mm) has changed since this card was set."]
    );
    const after = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.deepEqual(after?.page.boxes, snapshot?.page.boxes, "the card itself is untouched");
  });

  it("reads a card stored before the gap existed as set on the box's edge", async () => {
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const stored = row.snapshot as { preset: Record<string, unknown> };
    const { labelGapMm: _g, ...olderPreset } = stored.preset;
    void _g;
    await prisma.albumPrintedPage.update({
      where: { id: row.id },
      data: { snapshot: { ...stored, preset: olderPreset } as Prisma.InputJsonObject },
    });
    const snapshot = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.equal(snapshot?.preset.labelGapMm, 0);

    // The album is at 2 mm from the test above: the older card reports what a new one did, and
    // nothing at all once the album is back at 0.
    let report = await getAlbumPrintedReport(userId, albumId);
    assert.equal(report.sheets[0].divergences.length, 1);
    await setGap(0);
    report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(report.sheets[0].divergences, []);
  });
});
