import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { prisma } from "../../src/lib/db";
import {
  addAlbumTextBlock,
  createAlbum,
  deleteAlbumTextBlock,
  getAlbumEntries,
  getAlbumTextBlocks,
  setAlbumEntryLayout,
  updateAlbumTextBlock,
} from "../../src/lib/albums";
import { albumPlanOverview, planAlbum } from "../../src/lib/album-plan";
import { getAlbumEditorData } from "../../src/lib/album-editor";
import { renderAlbumPdf } from "../../src/lib/album-pdf";
import { albumBoxOutline } from "../../src/lib/album-box-outline";
import { MM_TO_PT } from "../../src/lib/album-metrics";
import { getAlbumPrintedReport, markAlbumPagesPrinted } from "../../src/lib/album-printing";
import { getAlbumPageSnapshots } from "../../src/lib/album-printed-pages";
import { DEFAULT_ALBUM_PRESET } from "../../src/lib/album-template-rules";

// A series set on its own line rather than beside the one before it (#1421), through the rows it is
// stored on: the flag on the entry and on a note, the editor offering it only where it means
// something, the setting surviving a content change, the canvas and the PDF reading one plan, and a
// printed card left exactly as it was.

const ts = Date.now();

describe("a series started on its own line (#1421)", () => {
  let userId: string;
  let collectionId: string;
  let albumId: string;
  let firstChecklistId: string;
  let vendorId: string;
  let areaId: string;

  const livePage = async () => {
    const plan = await planAlbum(userId, albumId);
    assert.ok(plan);
    const page = plan!.pages[0];
    assert.ok(page && page.layout.kind === "live", "a live first sheet");
    return { plan: plan!, layout: page.layout as Extract<typeof page.layout, { kind: "live" }> };
  };
  const headingTops = async () => (await livePage()).layout.headings.map((h) => h.yMm);
  const secondEntry = async () => (await getAlbumEntries(userId, albumId))[1];

  before(async () => {
    userId = `test-user-bandbreak-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User bandbreak-${ts}`,
        email: `test-bandbreak-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-bandbreak-${ts}`,
          name: "Band break",
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "en",
        },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          catalogPrefix: "PL",
          primaryCatalogVendorId: vendorId,
          collectionAreaVendors: { create: [{ catalogVendorId: vendorId }] },
        },
      })
    ).id;
    await prisma.hawidStrip.createMany({
      data: [{ collectionId, heightMm: 29, stockLengthMm: 210, sortOrder: 0 }],
    });

    // Two short series of one year: the default template puts them side by side in one band.
    let n = 0;
    for (const [name, numbers] of [
      ["For business stationery", ["303", "304"]],
      ["Delivery stamps", ["305", "306"]],
    ] as const) {
      n += 1;
      const issue = await prisma.issue.create({
        data: {
          collectionId,
          issueNo: 193900 + n,
          collectionAreaId: areaId,
          name,
          year: 1939,
          primaryCatalogSortKey: numbers[0].padStart(10, "0"),
        },
      });
      const stampIds: string[] = [];
      for (const number of numbers) stampIds.push(await createStamp(number));
      const checklist = await prisma.checklist.create({
        data: {
          collectionId,
          issueId: issue.id,
          name,
          sortOrder: 0,
          stamps: { create: stampIds.map((stampId, i) => ({ stampId, sortOrder: i })) },
        },
      });
      if (n === 1) firstChecklistId = checklist.id;
    }

    albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Polska", collectionAreaId: areaId, language: "en" },
      null
    );
  });

  async function createStamp(number: string): Promise<string> {
    return (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp ${number}`,
          issuedYear: 1939,
          widthMm: 26,
          heightMm: 25,
          primaryCatalogSortKey: number.padStart(10, "0"),
          catalogNumbers: { create: [{ catalogVendorId: vendorId, number }] },
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      })
    ).id;
  }

  after(async () => {
    await prisma.album.deleteMany({ where: { collectionId } });
    await prisma.hawidStrip.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("pairs the two series, and offers the line only on the one beside another", async () => {
    const [a, b] = await headingTops();
    assert.equal(a, b, "side by side");
    const editor = await getAlbumEditorData(userId, albumId, 1);
    const blocks = editor!.sheet!.blocks;
    assert.deepEqual(
      blocks.map((block) => block.bandBreakable),
      [false, true],
      "the first opens its band, so a line of its own would change nothing"
    );
    assert.equal(blocks[1].correction?.bandBreakBefore, false);
  });

  it("puts the second series below the first, on the same sheet, and sets it back", async () => {
    const entry = await secondEntry();
    await setAlbumEntryLayout(userId, entry.id, { bandBreakBefore: true });
    assert.equal((await secondEntry()).bandBreakBefore, true);
    const { plan, layout } = await livePage();
    assert.equal(plan.pages.length, 1, "a line, not a page");
    assert.ok(layout.headings[1].yMm > layout.headings[0].yMm, "below, not beside");

    // Still offered, now set, so it can be taken back from where it was set.
    const editor = await getAlbumEditorData(userId, albumId, 1);
    assert.equal(editor!.sheet!.blocks[1].bandBreakable, true);
    assert.equal(editor!.sheet!.blocks[1].correction?.bandBreakBefore, true);

    // Another correction on the block leaves it alone.
    await setAlbumEntryLayout(userId, entry.id, { spaceBeforeMm: 0 });
    assert.equal((await secondEntry()).bandBreakBefore, true);

    await setAlbumEntryLayout(userId, entry.id, { bandBreakBefore: false });
    const [a, b] = await headingTops();
    assert.equal(a, b, "beside again");
  });

  it("stays with the series when the content around it changes", async () => {
    await setAlbumEntryLayout(userId, (await secondEntry()).id, { bandBreakBefore: true });
    const stampId = await createStamp("304a");
    await prisma.checklistStamp.create({
      data: { checklistId: firstChecklistId, stampId, sortOrder: 2 },
    });
    const { layout } = await livePage();
    assert.equal(layout.boxes.length, 5, "the new stamp is on the sheet");
    assert.ok(layout.headings[1].yMm > layout.headings[0].yMm, "and the second series is still below");
  });

  it("draws the same page on the canvas and in the PDF", async () => {
    const { plan, layout } = await livePage();
    const editor = await getAlbumEditorData(userId, albumId, 1);
    assert.deepEqual(
      editor!.sheet!.boxes.map((b) => [b.xMm, b.yMm]),
      layout.boxes.map((b) => [b.xMm, b.yMm])
    );

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
  });

  it("carries the same setting on a note", async () => {
    const [first] = await getAlbumEntries(userId, albumId);
    const noteId = await addAlbumTextBlock(userId, albumId, {
      anchorAlbumEntryId: first.id,
      side: "after",
      role: "label",
      text: "Perforated 12½",
    });
    await updateAlbumTextBlock(userId, noteId, { bandBreakBefore: true });
    const note = (await getAlbumTextBlocks(userId, albumId)).find((n) => n.id === noteId);
    assert.equal(note?.bandBreakBefore, true);
    const editor = await getAlbumEditorData(userId, albumId, 1);
    assert.equal(
      editor!.sheet!.blocks.find((b) => b.id === noteId)?.correction?.bandBreakBefore,
      true
    );
    await deleteAlbumTextBlock(userId, noteId);
  });

  it("leaves a printed card exactly as it was", async () => {
    const overview = albumPlanOverview((await livePage()).plan);
    await markAlbumPagesPrinted(userId, albumId, [1], overview.fingerprint);
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const before = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);

    await setAlbumEntryLayout(userId, (await secondEntry()).id, { bandBreakBefore: false });

    const after = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.deepEqual(after?.page, before?.page, "the card is a stored result");
    const editor = await getAlbumEditorData(userId, albumId, 1);
    assert.equal(editor!.sheet!.readOnly, true);
    assert.ok(
      editor!.sheet!.blocks.every((b) => !b.bandBreakable),
      "nothing is offered on paper"
    );
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(report.sheets[0].divergences, [], "the same stamps, on the same card");
  });
});
