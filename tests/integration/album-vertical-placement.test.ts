import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import type { Prisma } from "../../src/generated/prisma/client";
import { prisma } from "../../src/lib/db";
import {
  createAlbum,
  getAlbum,
  getAlbumEntries,
  setAlbumEntryLayout,
  updateAlbumPreset,
} from "../../src/lib/albums";
import { createAlbumTemplate } from "../../src/lib/album-templates";
import { planAlbum } from "../../src/lib/album-plan";
import { getAlbumEditorData } from "../../src/lib/album-editor";
import { renderAlbumPdf } from "../../src/lib/album-pdf";
import { albumBoxOutline } from "../../src/lib/album-box-outline";
import { MM_TO_PT } from "../../src/lib/album-metrics";
import {
  countAlbumPresetDivergence,
  getAlbumPrintedReport,
  markAlbumPagesPrinted,
} from "../../src/lib/album-printing";
import { getAlbumPageSnapshots } from "../../src/lib/album-printed-pages";
import { albumPlanOverview } from "../../src/lib/album-plan";
import {
  albumRenderPreset,
  DEFAULT_ALBUM_PRESET,
  type AlbumVerticalPlacement,
} from "../../src/lib/album-template-rules";

// Where a page's content sits vertically (#1419), through the rows it is stored on: the template's
// value copied onto the album, the album's own copy edited, a page's override kept on the block that
// opens it, the canvas and the PDF reading one plan, and a printed card reporting a placement that
// would now differ — including a card stored before placement existed.

const ts = Date.now();

describe("the vertical placement of an album page (#1419)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let albumId: string;

  const livePage = async (id = albumId, position = 0) => {
    const plan = await planAlbum(userId, id);
    assert.ok(plan);
    const page = plan!.pages[position];
    assert.ok(page && page.layout.kind === "live", "a live sheet at that position");
    return { plan: plan!, layout: page.layout as Extract<typeof page.layout, { kind: "live" }> };
  };
  const boxTops = async (id = albumId) => (await livePage(id)).layout.boxes.map((b) => b.yMm);
  const setPlacement = async (verticalPlacement: AlbumVerticalPlacement, id = albumId) => {
    const album = await getAlbum(userId, id);
    assert.ok(album);
    await updateAlbumPreset(userId, id, { ...albumRenderPreset(album!), verticalPlacement });
  };

  before(async () => {
    userId = `test-user-placement-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User placement-${ts}`,
        email: `test-placement-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-placement-${ts}`,
          name: "Placement",
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

    // Two issues of one year: one chapter, one sheet, two series on it — which is the least a
    // justified page needs to differ from a centred one.
    let n = 0;
    for (const [name, numbers] of [
      ["Mościcki", ["303", "304"]],
      ["Wieliczka", ["305", "306"]],
    ] as const) {
      n += 1;
      const issue = await prisma.issue.create({
        data: {
          collectionId,
          issueNo: 193800 + n,
          collectionAreaId: areaId,
          name,
          year: 1938,
          primaryCatalogSortKey: numbers[0].padStart(10, "0"),
        },
      });
      const stampIds: string[] = [];
      for (const number of numbers) {
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
          name,
          sortOrder: 0,
          stamps: { create: stampIds.map((stampId, i) => ({ stampId, sortOrder: i })) },
        },
      });
    }

    albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Polska", collectionAreaId: areaId, language: "en" },
      null
    );
    // Two narrow series would share a band, and one band has no gap between series to justify
    // into — so this album keeps each series in a band of its own.
    await prisma.album.update({ where: { id: albumId }, data: { blocksPerBand: 1 } });
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

  it("starts an album without a template at the top, as every page before it was", async () => {
    const album = await getAlbum(userId, albumId);
    assert.equal(album?.verticalPlacement, "top");
    const { layout } = await livePage();
    assert.equal(layout.placement, "top");
    assert.equal(layout.blocks.length, 2, "two series on one sheet");
  });

  it("copies a template's placement onto an album made from it", async () => {
    await createAlbumTemplate(userId, collectionId, {
      ...DEFAULT_ALBUM_PRESET,
      name: "Centred",
      verticalPlacement: "center",
    });
    const template = await prisma.albumTemplate.findFirstOrThrow({ where: { collectionId } });
    const copy = await createAlbum(
      userId,
      collectionId,
      { name: "Polska centred", collectionAreaId: areaId, language: "en" },
      template.id
    );
    assert.equal((await getAlbum(userId, copy))?.verticalPlacement, "center");
    assert.equal((await livePage(copy)).layout.placement, "center");
    await prisma.album.delete({ where: { id: copy } });
  });

  it("places the body under each option and leaves the headings and the footer alone", async () => {
    const top = await livePage();
    const tops = await boxTops();
    for (const placement of ["center", "justify", "center-justify"] as const) {
      await setPlacement(placement);
      const { layout } = await livePage();
      assert.equal(layout.placement, placement);
      assert.notDeepEqual(
        layout.boxes.map((b) => b.yMm),
        tops,
        `${placement} moves the series`
      );
      assert.deepEqual(layout.title, top.layout.title, `${placement}: the running head stays`);
      assert.deepEqual(layout.chapter, top.layout.chapter, `${placement}: the year stays`);
      assert.deepEqual(layout.footer, top.layout.footer, `${placement}: the footer stays`);
    }
    // Justified: the last series — its labels under the mounts included — ends at the foot of the
    // body.
    await setPlacement("justify");
    const { layout } = await livePage();
    const last = layout.boxes[layout.boxes.length - 1];
    assert.ok(last.label, "the default template labels its boxes below them");
    assert.equal(
      Math.round((last.label!.yMm + last.label!.heightMm) * 10) / 10,
      Math.round((layout.content.yMm + layout.content.heightMm) * 10) / 10
    );
    await setPlacement("top");
    assert.deepEqual(await boxTops(), tops, "top gives today's page back exactly");
  });

  it("keeps a page's own placement on the block that opens it, and takes it back with null", async () => {
    const [first] = await getAlbumEntries(userId, albumId);
    await setAlbumEntryLayout(userId, first.id, { pagePlacement: "center" });
    assert.equal((await getAlbumEntries(userId, albumId))[0].pagePlacement, "center");
    assert.equal((await livePage()).layout.placement, "center");

    // Setting another correction does not touch it.
    await setAlbumEntryLayout(userId, first.id, { spaceAfterMm: 0 });
    assert.equal((await getAlbumEntries(userId, albumId))[0].pagePlacement, "center");

    await setAlbumEntryLayout(userId, first.id, { pagePlacement: null });
    assert.equal((await getAlbumEntries(userId, albumId))[0].pagePlacement, null);
    assert.equal((await livePage()).layout.placement, "top");
  });

  it("draws the same placed page on the canvas and in the PDF", async () => {
    await setPlacement("center-justify");
    const { plan, layout } = await livePage();

    const editor = await getAlbumEditorData(userId, albumId, 1);
    assert.ok(editor?.sheet);
    assert.deepEqual(
      editor!.sheet!.boxes.map((b) => b.yMm),
      layout.boxes.map((b) => b.yMm)
    );
    assert.equal(editor!.sheet!.placement.acted, "center-justify");
    assert.equal(editor!.sheet!.placement.opener?.override, null);

    // Every translation the PDF applies to a box, read back out of the file. A mount's rectangle is
    // drawn from its bottom-left corner, in points from the foot of the sheet.
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
    const drawnYs = [...ops.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm/g)].map((m) => Number(m[2]));
    // The outline lies inside the box (#1466), so the rectangle stroked is the box inset by half its
    // weight — `albumBoxOutline`'s, the canvas's too.
    for (const box of layout.boxes) {
      const line = albumBoxOutline(DEFAULT_ALBUM_PRESET, box)!.rect;
      const expected = (DEFAULT_ALBUM_PRESET.pageHeightMm - (line.yMm + line.heightMm)) * MM_TO_PT;
      assert.ok(
        drawnYs.some((y) => Math.abs(y - expected) < 0.01),
        `a mount drawn at ${expected.toFixed(2)} pt from the foot`
      );
    }
    await setPlacement("top");
  });

  it("reports a printed card whose placement would now differ, and only then", async () => {
    const overview = albumPlanOverview((await livePage()).plan);
    await markAlbumPagesPrinted(userId, albumId, [1], overview.fingerprint);
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const snapshot = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.equal(snapshot?.page.placement, "top", "the card records how it was placed");

    // The album moves to centred: the card was set at the top, and says so — and #1215's count says
    // so before the save.
    const album = await getAlbum(userId, albumId);
    const centred = { ...albumRenderPreset(album!), verticalPlacement: "center" as const };
    assert.equal(await countAlbumPresetDivergence(userId, albumId, centred), 1);
    await updateAlbumPreset(userId, albumId, centred);
    let report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(
      report.sheets[0].divergences.map((d) => d.detail),
      ["The card's content would now be placed centred; the card's is at the top."]
    );
    // The card itself is untouched.
    const after = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.deepEqual(after?.page.boxes, snapshot?.page.boxes);

    // The block that opens the card asks for the top: the card would be placed as it is, and the
    // report has nothing to say, although the album's own value still differs from the card's.
    const [first] = await getAlbumEntries(userId, albumId);
    await setAlbumEntryLayout(userId, first.id, { pagePlacement: "top" });
    report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(report.sheets[0].divergences, []);
    await setAlbumEntryLayout(userId, first.id, { pagePlacement: null });
  });

  it("reads a card stored before placement existed as placed at the top", async () => {
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const stored = row.snapshot as { preset: Record<string, unknown>; page: Record<string, unknown> };
    const { verticalPlacement: _p, ...olderPreset } = stored.preset;
    const { placement: _q, ...olderPage } = stored.page;
    void _p;
    void _q;
    await prisma.albumPrintedPage.update({
      where: { id: row.id },
      data: {
        snapshot: { ...stored, preset: olderPreset, page: olderPage } as Prisma.InputJsonObject,
      },
    });
    const snapshot = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.equal(snapshot?.page.placement, "top");
    assert.equal(snapshot?.preset.verticalPlacement, "top");

    // The album is centred from the test above: the older card reports exactly what a new one did.
    let report = await getAlbumPrintedReport(userId, albumId);
    assert.equal(report.sheets[0].divergences.length, 1);
    await setPlacement("top");
    report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(report.sheets[0].divergences, [], "and nothing at all once it is back at the top");
  });
});
