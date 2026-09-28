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
import {
  albumRenderPreset,
  DEFAULT_ALBUM_PRESET,
  type AlbumRenderPreset,
} from "../../src/lib/album-template-rules";

// The space around the album title and the chapter heading (#1426), through the rows it is stored
// on: the template's values copied onto the album, the album's own copy edited, the plan, the canvas
// and the PDF moving both headings and the content under them, and a printed card reporting a space
// that would now differ — including a card stored before the values existed.

const ts = Date.now();

/** Every text position the PDF sets on its first page, in points from the foot of the sheet. */
async function pdfTextYs(plan: Parameters<typeof renderAlbumPdf>[0]): Promise<number[]> {
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
  return [...ops.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g)].map((m) => Number(m[2]));
}

describe("the space around the album title and the chapter heading (#1426)", () => {
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
  const setSpacing = async (values: Partial<AlbumRenderPreset>) => {
    const album = await getAlbum(userId, albumId);
    assert.ok(album);
    await updateAlbumPreset(userId, albumId, { ...albumRenderPreset(album!), ...values });
  };
  const TODAY = {
    titleSpaceAboveMm: 0,
    titleSpaceBelowMm: 0,
    chapterSpaceAboveMm: DEFAULT_ALBUM_PRESET.headingSpaceAboveMm,
    chapterSpaceBelowMm: DEFAULT_ALBUM_PRESET.headingSpaceBelowMm,
  };

  before(async () => {
    userId = `test-user-page-heading-spacing-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User page-heading-spacing-${ts}`,
        email: `test-page-heading-spacing-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-page-heading-spacing-${ts}`,
          name: "Page heading spacing",
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

  it("starts an album without a template with the headings where they always were", async () => {
    const album = await getAlbum(userId, albumId);
    assert.equal(album?.titleSpaceAboveMm, 0);
    assert.equal(album?.titleSpaceBelowMm, 0);
    assert.equal(album?.chapterSpaceAboveMm, album?.headingSpaceAboveMm);
    assert.equal(album?.chapterSpaceBelowMm, album?.headingSpaceBelowMm);
    const { layout } = await livePage();
    assert.equal(layout.title!.yMm, DEFAULT_ALBUM_PRESET.marginTopMm);
    assert.equal(
      layout.chapter!.yMm,
      layout.title!.yMm + layout.title!.heightMm + DEFAULT_ALBUM_PRESET.headingSpaceAboveMm
    );
  });

  it("copies a template's values onto an album made from it", async () => {
    await createAlbumTemplate(userId, collectionId, {
      ...DEFAULT_ALBUM_PRESET,
      name: "Airy",
      titleSpaceAboveMm: 2,
      titleSpaceBelowMm: 3,
      chapterSpaceAboveMm: 4,
      chapterSpaceBelowMm: 6,
    });
    const template = await prisma.albumTemplate.findFirstOrThrow({ where: { collectionId } });
    assert.equal(template.chapterSpaceBelowMm, 6);
    const copy = await createAlbum(
      userId,
      collectionId,
      { name: "Polska airy", collectionAreaId: areaId, language: "en" },
      template.id
    );
    const album = await getAlbum(userId, copy);
    assert.deepEqual(
      [album?.titleSpaceAboveMm, album?.titleSpaceBelowMm, album?.chapterSpaceAboveMm, album?.chapterSpaceBelowMm],
      [2, 3, 4, 6]
    );
    const { layout } = await livePage(copy);
    assert.equal(layout.title!.yMm, DEFAULT_ALBUM_PRESET.marginTopMm + 2);
    assert.equal(layout.chapter!.yMm, layout.title!.yMm + layout.title!.heightMm + 3 + 4);
    assert.equal(layout.content.yMm, layout.chapter!.yMm + layout.chapter!.heightMm + 6);
    await prisma.album.delete({ where: { id: copy } });
  });

  it("moves both headings and the content by the album's own values, on the canvas and in the PDF alike", async () => {
    const before = (await livePage()).layout;
    await setSpacing({ titleSpaceAboveMm: 3, titleSpaceBelowMm: 2, chapterSpaceAboveMm: 1, chapterSpaceBelowMm: 9 });
    const { plan, layout } = await livePage();
    assert.equal(layout.title!.yMm, before.title!.yMm + 3);
    assert.equal(layout.chapter!.yMm, layout.title!.yMm + layout.title!.heightMm + 2 + 1);
    assert.equal(layout.content.yMm, layout.chapter!.yMm + layout.chapter!.heightMm + 9);
    const shift = layout.content.yMm - before.content.yMm;
    assert.deepEqual(
      layout.boxes.map((b) => b.yMm),
      before.boxes.map((b) => b.yMm + shift),
      "the series move with the content"
    );

    const editor = await getAlbumEditorData(userId, albumId, 1);
    assert.ok(editor?.sheet);
    assert.equal(editor!.sheet!.title?.yMm, layout.title!.yMm);
    assert.equal(editor!.sheet!.chapter?.yMm, layout.chapter!.yMm);
    assert.deepEqual(editor!.sheet!.content, layout.content);

    const drawnYs = await pdfTextYs(plan);
    for (const [text, role] of [
      [layout.title!, "title"],
      [layout.chapter!, "chapter"],
    ] as const) {
      const face = role === "title" ? DEFAULT_ALBUM_PRESET.titleFace : DEFAULT_ALBUM_PRESET.chapterFace;
      const size = role === "title" ? DEFAULT_ALBUM_PRESET.titleSizePt : DEFAULT_ALBUM_PRESET.chapterSizePt;
      const expected =
        (DEFAULT_ALBUM_PRESET.pageHeightMm - (text.yMm + albumBaselineOffsetMm(face, size))) * MM_TO_PT;
      assert.ok(
        drawnYs.some((y) => Math.abs(y - expected) < 0.01),
        `the ${role} set at ${expected.toFixed(2)} pt from the foot`
      );
    }
    await setSpacing(TODAY);
  });

  it("reports a printed card whose heading space would now differ, and leaves the card alone", async () => {
    const overview = albumPlanOverview((await livePage()).plan);
    await markAlbumPagesPrinted(userId, albumId, [1], overview.fingerprint);
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const snapshot = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.equal(snapshot?.preset.titleSpaceBelowMm, 0, "the card records the space it was set with");

    const album = await getAlbum(userId, albumId);
    const airier = { ...albumRenderPreset(album!), titleSpaceBelowMm: 4 };
    assert.equal(await countAlbumPresetDivergence(userId, albumId, airier), 1);
    await updateAlbumPreset(userId, albumId, airier);
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(
      report.sheets[0].divergences.map((d) => d.detail),
      ["The album's Title space below (mm) has changed since this card was set."]
    );
    const after = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.deepEqual(after?.page, snapshot?.page, "the card itself is untouched");
  });

  it("reads a card stored before the values existed as set the way pages then were", async () => {
    await setSpacing({ ...TODAY, headingSpaceAboveMm: 7, headingSpaceBelowMm: 4, chapterSpaceAboveMm: 7, chapterSpaceBelowMm: 4 });
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const stored = row.snapshot as { preset: Record<string, unknown> };
    const {
      titleSpaceAboveMm: _a,
      titleSpaceBelowMm: _b,
      chapterSpaceAboveMm: _c,
      chapterSpaceBelowMm: _d,
      ...olderPreset
    } = stored.preset;
    void [_a, _b, _c, _d];
    await prisma.albumPrintedPage.update({
      where: { id: row.id },
      data: {
        snapshot: {
          ...stored,
          preset: { ...olderPreset, headingSpaceAboveMm: 7, headingSpaceBelowMm: 4 },
        } as Prisma.InputJsonObject,
      },
    });
    const snapshot = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.equal(snapshot?.preset.titleSpaceAboveMm, 0);
    assert.equal(snapshot?.preset.titleSpaceBelowMm, 0);
    assert.equal(snapshot?.preset.chapterSpaceAboveMm, 7, "the chapter heading had the checklist heading's");
    assert.equal(snapshot?.preset.chapterSpaceBelowMm, 4);

    // The album is set the way that card now reads — the chapter heading at its checklist heading's
    // space — so nothing is reported. Filling the chapter's values from anywhere else would.
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(report.sheets[0].divergences, []);
  });
});
