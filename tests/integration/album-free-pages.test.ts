import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { prisma } from "../../src/lib/db";
import {
  addAlbumFreePage,
  addAlbumFreePageElement,
  createAlbum,
  deleteAlbumFreePage,
  deleteAlbumFreePageElement,
  getAlbumEntries,
  reorderAlbumEntries,
  updateAlbumFreePage,
  updateAlbumFreePageElement,
  AlbumFreePageError,
} from "../../src/lib/albums";
import { albumPlanOverview, planAlbum, type AlbumPlanPage } from "../../src/lib/album-plan";
import { getAlbumEditorData } from "../../src/lib/album-editor";
import { renderAlbumPdf } from "../../src/lib/album-pdf";
import { MM_TO_PT } from "../../src/lib/album-metrics";
import {
  getAlbumPrintedReport,
  markAlbumPagesPrinted,
  reprintAlbumPage,
  unprintAlbumPage,
} from "../../src/lib/album-printing";
import { getAlbumPageSnapshots, getAlbumPrintedIndex } from "../../src/lib/album-printed-pages";
import {
  AlbumPictureError,
  deleteAlbumPicture,
  getAlbumPictures,
  uploadAlbumPicture,
} from "../../src/lib/album-pictures";
import { getAlbumCuttingList } from "../../src/lib/album-cutting";

// Bytes go through the filesystem backend, so point it at a throwaway directory rather than the
// repo's `.data` — `scan-sheet-ingest.test.ts`'s arrangement.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-free-pages-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Pages without stamps (#1429), through the rows, the library and the file: a page filed before an
// entry and one at the end of the album, moving with its entry; pictures uploaded as PNG, as an SVG
// that prints as lines and as one that has to print as a picture; elements placed and sized in
// millimetres; the frame's heads switched on per page; the canvas and the PDF agreeing; and the card
// — marked printed, never orphaned, reporting an edit, refusing its page's deletion and its pictures',
// and discarded once its reprint is on paper.

const ts = Date.now();

const SQUARE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#336699"/></svg>`;
const GRADIENT_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><defs><linearGradient id="g">` +
  `<stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>` +
  `<rect width="20" height="10" fill="url(#g)"/></svg>`;

/** Every drawing operator a page's content stream holds, as text. */
async function pageOperators(bytes: Uint8Array, index = 0): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPages()[index].node.Contents();
  const streams: PDFRawStream[] =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref) as PDFRawStream)
      : contents instanceof PDFRawStream
        ? [contents]
        : [];
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join("\n");
}

/** What each sheet of a plan is: `free:<id>`, `printed:<id>`, or the chapter of a stamp sheet. */
function shape(pages: AlbumPlanPage[]): string[] {
  return pages.map((p) =>
    p.layout.kind === "printed"
      ? `printed:${p.layout.printedPageId}`
      : p.layout.free
        ? `free:${p.layout.free.id}`
        : `stamps:${p.layout.chapterKey}`
  );
}

describe("pages without stamps (#1429)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let albumId: string;
  let entry1938: string;
  let entry1939: string;
  let opening: string;
  let closing: string;
  let pngId: string;
  let vectorId: string;
  let rasterisedId: string;
  let headingId: string;
  let armsId: string;

  const plan = async () => (await planAlbum(userId, albumId))!;
  const positionOf = async (freePageId: string) =>
    shape((await plan()).pages).indexOf(`free:${freePageId}`) + 1;

  before(async () => {
    userId = `test-user-free-pages-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User free-pages-${ts}`,
        email: `test-free-pages-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-free-pages-${ts}`, name: "free pages", baseCurrency: "EUR", ownerId: userId, defaultLanguage: "en" },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Danzig",
          catalogPrefix: "DA",
          primaryCatalogVendorId: vendor.id,
          collectionAreaVendors: { create: [{ catalogVendorId: vendor.id }] },
        },
      })
    ).id;
    await prisma.hawidStrip.createMany({
      data: [{ collectionId, heightMm: 29, stockLengthMm: 210, sortOrder: 0 }],
    });
    for (const [year, numbers] of [
      [1938, ["1", "2"]],
      [1939, ["3"]],
    ] as const) {
      const issue = await prisma.issue.create({
        data: {
          collectionId,
          issueNo: year * 100,
          collectionAreaId: areaId,
          name: `Issue ${year}`,
          year,
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
                issuedYear: year,
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
          name: `Issue ${year}`,
          sortOrder: 0,
          stamps: { create: stampIds.map((stampId, i) => ({ stampId, sortOrder: i })) },
        },
      });
    }
    albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Wolne Miasto Gdańsk", collectionAreaId: areaId, language: "en" },
      null
    );
    const entries = await getAlbumEntries(userId, albumId);
    entry1938 = entries.find((e) => e.year === 1938)!.id;
    entry1939 = entries.find((e) => e.year === 1939)!.id;
  });

  after(async () => {
    await prisma.album.deleteMany({ where: { collectionId } });
    await prisma.albumPicture.deleteMany({ where: { collectionId } });
    await prisma.hawidStrip.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("files a page before an entry and one at the end, and moves the first with its entry", async () => {
    opening = await addAlbumFreePage(userId, albumId, { anchorAlbumEntryId: entry1938, side: "before" });
    closing = await addAlbumFreePage(userId, albumId, { anchorAlbumEntryId: null, side: "after" });
    assert.deepEqual(shape((await plan()).pages), [
      `free:${opening}`,
      "stamps:1938",
      "stamps:1939",
      `free:${closing}`,
    ]);
    // The year's heading waits for its first checklist rather than sitting alone behind the page.
    const stampSheet = (await plan()).pages[1].layout;
    assert.ok(stampSheet.kind === "live" && stampSheet.chapter?.lines.join(" ") === "1938");

    await reorderAlbumEntries(userId, albumId, [entry1939, entry1938]);
    assert.deepEqual(shape((await plan()).pages), [
      "stamps:1939",
      `free:${opening}`,
      "stamps:1938",
      `free:${closing}`,
    ]);
    await reorderAlbumEntries(userId, albumId, [entry1938, entry1939]);
  });

  it("takes a PNG, an SVG that prints as lines, and one that has to print as a picture — and nothing else", async () => {
    const png = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .png()
      .toBuffer();
    const raster = await uploadAlbumPicture(userId, collectionId, "arms.png", png);
    pngId = raster.id;
    assert.deepEqual(
      { kind: raster.kind, w: raster.widthPx, h: raster.heightPx, aspect: raster.aspect, name: raster.name },
      { kind: "raster", w: 400, h: 200, aspect: 0.5, name: "arms" }
    );

    const vector = await uploadAlbumPicture(userId, collectionId, "square.svg", Buffer.from(SQUARE_SVG));
    vectorId = vector.id;
    assert.deepEqual({ kind: vector.kind, px: vector.widthPx, reason: vector.rasterReason }, { kind: "vector", px: null, reason: null });

    const rasterised = await uploadAlbumPicture(userId, collectionId, "gradient.svg", Buffer.from(GRADIENT_SVG));
    rasterisedId = rasterised.id;
    assert.equal(rasterised.kind, "raster");
    assert.equal(rasterised.rasterReason, "is painted with a gradient or a pattern");
    assert.equal(Math.max(rasterised.widthPx!, rasterised.heightPx!), 4000);
    assert.equal(rasterised.aspect, 0.5);
    const row = await prisma.albumPicture.findUniqueOrThrow({ where: { id: rasterisedId } });
    assert.equal(row.storageKey, `${collectionId}/album-pictures/${rasterisedId}/original.svg`);
    assert.equal(row.rasterKey, `${collectionId}/album-pictures/${rasterisedId}/raster.png`);

    await assert.rejects(
      uploadAlbumPicture(userId, collectionId, "notes.txt", Buffer.from("just some words")),
      (err: unknown) => err instanceof AlbumPictureError && /SVG, PNG or JPEG/.test((err as Error).message)
    );
    assert.deepEqual(
      (await getAlbumPictures(userId, collectionId)).map((p) => p.name),
      ["arms", "gradient", "square"]
    );
  });

  it("places pictures and texts in millimetres, sized by width, and flags a picture too coarse to print", async () => {
    headingId = await addAlbumFreePageElement(userId, opening, {
      kind: "text",
      xMm: 20,
      yMm: 150,
      widthMm: 170,
      text: "Wolne Miasto Gdańsk\nFreie Stadt Danzig",
      role: "chapter",
      sizePt: 30,
      align: "left",
      pictureId: null,
    });
    armsId = await addAlbumFreePageElement(userId, opening, {
      kind: "picture",
      xMm: 75,
      yMm: 40,
      widthMm: 60,
      text: "",
      role: "heading",
      sizePt: 12,
      align: "center",
      pictureId: pngId,
    });
    await addAlbumFreePageElement(userId, opening, {
      kind: "picture",
      xMm: 10,
      yMm: 250,
      widthMm: 20,
      text: "",
      role: "heading",
      sizePt: 12,
      align: "center",
      pictureId: vectorId,
    });

    const editor = await getAlbumEditorData(userId, albumId, { freePageId: opening });
    const free = editor?.sheet?.free;
    assert.ok(free);
    assert.equal(editor?.sheet?.position, 1);
    const [heading, arms, square] = free!.elements;
    assert.equal(heading.kind, "text");
    if (heading.kind === "text") {
      assert.deepEqual(heading.placed.lines, ["Wolne Miasto Gdańsk", "Freie Stadt Danzig"]);
      assert.equal(heading.placed.face.sizePt, 30);
      assert.equal(heading.placed.align, "left");
    }
    assert.ok(arms.kind === "picture");
    if (arms.kind === "picture") {
      // 400 px across 60 mm is 169 dpi — flagged; 30 mm tall at its own proportions.
      assert.equal(arms.heightMm, 30);
      assert.equal(arms.dpi, 169);
      assert.equal(arms.tooCoarse, true);
    }
    assert.ok(square.kind === "picture" && square.vector && !square.tooCoarse && square.heightMm === 20);

    // Narrower, it is sharp enough: 400 px across 33 mm is 308 dpi.
    await updateAlbumFreePageElement(userId, armsId, { widthMm: 33 });
    const narrower = (await getAlbumEditorData(userId, albumId, 1))?.sheet?.free?.elements[1];
    assert.ok(narrower?.kind === "picture" && !narrower.tooCoarse && narrower.dpi === 308);
    await updateAlbumFreePageElement(userId, armsId, { widthMm: 60 });

    // A picture that is not the collection's is refused.
    await assert.rejects(
      updateAlbumFreePageElement(userId, armsId, { pictureId: "not-a-picture" }),
      AlbumFreePageError
    );
  });

  it("prints the frame on a free page, and each head only when switched on", async () => {
    const sheet = () => (async () => (await plan()).pages[0])();
    const before = await sheet();
    assert.ok(before.layout.kind === "live");
    assert.equal(before.layout.kind === "live" && before.layout.title, null);
    assert.equal(before.footer, null);

    await updateAlbumFreePage(userId, opening, { printTitle: true, printChapter: true, printFooter: true });
    const after = await sheet();
    assert.ok(after.layout.kind === "live");
    if (after.layout.kind === "live") {
      assert.deepEqual(after.layout.title?.lines, ["Wolne Miasto Gdańsk"]);
      assert.deepEqual(after.layout.chapter?.lines, ["1938"]);
    }
    // The footer names a range, and a page without stamps has none — so it prints nothing there.
    assert.equal(after.footer, null);
    await updateAlbumFreePage(userId, opening, { printTitle: false, printChapter: false, printFooter: false });
  });

  it("draws in the PDF what the canvas shows: vectors as paths, a raster as a picture, a text at its size and alignment", async () => {
    const pages = (await plan()).pages;
    const layout = pages[0].layout;
    assert.ok(layout.kind === "live" && layout.free);
    const ops = await pageOperators((await renderAlbumPdf((await plan())!, "1")).bytes);

    // The vector square is filled in its own colour; the PNG is placed as an image.
    assert.match(ops, /0\.2 0\.4 0\.6 rg/);
    assert.match(ops, /\/Image-?\w* Do|Do\n/);
    // The heading is set at 30 pt.
    assert.match(ops, / 30 Tf/);

    // Left-aligned, the heading's lines start at its own left edge — where the canvas anchors them.
    const editor = await getAlbumEditorData(userId, albumId, 1);
    const heading = editor!.sheet!.free!.elements[0];
    assert.ok(heading.kind === "text");
    const x = (heading.xMm * MM_TO_PT).toFixed(2);
    const starts = [...ops.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g)].map((m) => Number(m[1]).toFixed(2));
    assert.ok(starts.includes(x), `a line starting at ${x} pt, among ${starts.join(", ")}`);

    // And every element the canvas draws is where the plan put it.
    const plannedRects = layout.kind === "live"
      ? layout.free!.elements.map((el) => [el.id, el.xMm, el.yMm, el.widthMm, el.heightMm])
      : [];
    assert.deepEqual(
      editor!.sheet!.free!.elements.map((el) => [el.id, el.xMm, el.yMm, el.widthMm, el.heightMm]),
      plannedRects
    );
  });

  it("names a free page on the album screen, and leaves it off the cutting list", async () => {
    const overview = albumPlanOverview(await plan());
    assert.equal(overview.pages[0].free, true);
    assert.deepEqual(overview.pages[0].headings, ["Wolne Miasto Gdańsk Freie Stadt Danzig"]);
    const cutting = await getAlbumCuttingList(userId, albumId);
    assert.equal(cutting?.list.sheets.some((s) => s.range === ""), false);
  });

  it("goes onto paper as a card of its own, never orphaned, and reports what is changed on the page", async () => {
    const overview = albumPlanOverview(await plan());
    const position = await positionOf(opening);
    await markAlbumPagesPrinted(userId, albumId, [position], overview.fingerprint);

    const row = await prisma.albumFreePage.findUniqueOrThrow({ where: { id: opening } });
    assert.ok(row.printedPageId);
    const index = await getAlbumPrintedIndex(albumId);
    assert.equal(index.byFreePage.get(opening), row.printedPageId);
    assert.deepEqual(index.orphanedPageIds, []);
    assert.deepEqual(
      (await prisma.albumPrintedPagePicture.findMany({ where: { albumPrintedPageId: row.printedPageId! } }))
        .map((r) => r.pictureId)
        .sort(),
      [pngId, vectorId].sort()
    );
    const card = (await getAlbumPageSnapshots(albumId, [row.printedPageId!])).get(row.printedPageId!);
    assert.equal(card?.page.free?.id, opening);
    assert.equal(card?.range, "");
    assert.deepEqual(shape((await plan()).pages)[0], `printed:${row.printedPageId}`);

    let report = await getAlbumPrintedReport(userId, albumId);
    const sheet = () => report.sheets.find((s) => s.id === row.printedPageId)!;
    assert.equal(sheet().free, true);
    assert.deepEqual(sheet().divergences, []);

    // Moved: the page. Retyped: the words.
    await updateAlbumFreePageElement(userId, armsId, { yMm: 45 });
    await updateAlbumFreePageElement(userId, headingId, { text: "Wolne Miasto Gdańsk\nFreie Stadt Danzig\n1920 – 1939" });
    report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(
      sheet().divergences.map((d) => d.kind),
      ["text", "page"]
    );
    assert.match(sheet().divergences[1].detail, /1 element has moved or changed size/);

    // The page cannot leave the album while a card of it is in the binder, and its pictures cannot
    // leave the library.
    await assert.rejects(deleteAlbumFreePage(userId, opening), AlbumFreePageError);
    await deleteAlbumFreePageElement(userId, armsId);
    await assert.rejects(
      deleteAlbumPicture(userId, pngId),
      (err: unknown) =>
        err instanceof AlbumPictureError && /a printed card of "Wolne Miasto Gdańsk"/.test((err as Error).message)
    );
    report = await getAlbumPrintedReport(userId, albumId);
    assert.ok(sheet().divergences.some((d) => d.detail === "1 picture on the card is no longer on the page."));
  });

  it("is discarded once its reprint has gone onto paper, though it holds no stamps", async () => {
    const old = (await prisma.albumFreePage.findUniqueOrThrow({ where: { id: opening } })).printedPageId!;
    await reprintAlbumPage(userId, old);
    // Back in the live plan, as it reads today.
    assert.equal(shape((await plan()).pages).includes(`free:${opening}`), true);
    const overview = albumPlanOverview(await plan());
    await markAlbumPagesPrinted(userId, albumId, [await positionOf(opening)], overview.fingerprint);
    assert.equal(await prisma.albumPrintedPage.count({ where: { id: old } }), 0, "the superseded card is gone");
    const fresh = (await prisma.albumFreePage.findUniqueOrThrow({ where: { id: opening } })).printedPageId!;
    assert.notEqual(fresh, old);
    assert.deepEqual((await getAlbumPrintedReport(userId, albumId)).sheets.find((s) => s.id === fresh)?.divergences, []);

    // Un-printed, it can go — and then so can a picture nothing prints any more.
    await unprintAlbumPage(userId, fresh);
    await deleteAlbumFreePage(userId, opening);
    await deleteAlbumPicture(userId, pngId);
    assert.equal(await prisma.albumPicture.count({ where: { id: pngId } }), 0);
  });

  it("refuses to delete a picture a live page still places, naming the album", async () => {
    await addAlbumFreePageElement(userId, closing, {
      kind: "picture",
      xMm: 10,
      yMm: 10,
      widthMm: 40,
      text: "",
      role: "heading",
      sizePt: 12,
      align: "center",
      pictureId: rasterisedId,
    });
    await assert.rejects(
      deleteAlbumPicture(userId, rasterisedId),
      (err: unknown) => err instanceof AlbumPictureError && /a page of "Wolne Miasto Gdańsk"/.test((err as Error).message)
    );
    // The PDF prints a rasterised SVG as a picture.
    const position = await positionOf(closing);
    const ops = await pageOperators((await renderAlbumPdf((await plan())!, String(position))).bytes);
    assert.match(ops, /Do/);
  });
});
