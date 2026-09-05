import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createAlbum, gatherAlbumEntries } from "../../src/lib/albums";
import { planAlbum } from "../../src/lib/album-plan";
import { DEFAULT_ALBUM_PRESET } from "../../src/lib/album-template-rules";
import { getActiveStorage, permanentPrefix, variantKey } from "../../src/lib/storage";
import { renderAlbumPdf, AlbumPdfError } from "../../src/lib/album-pdf";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

// The album as a PDF (#768), rendered from real rows.
//
// What is pinned here is what only a whole document can show, and it is the same list the spike
// measured on paper: **the sheet is A4 in points** (595.276 × 841.890 = 210 × 297 mm, and
// `72 / 25.4` is the only arithmetic between them); a **box drawn at 30 mm is 30 mm**; a **photo is
// fitted and never cropped**, so it keeps its own aspect inside a mount of a different one; and a
// **page range renders on its own**, which is the reprint case.
//
// It also writes the document to `STAMPORAMA_ALBUM_PDF_OUT` when that is set, which is how the
// sample handed over for the ruler check was produced. Measuring on a screen proves nothing — a
// viewer applies its own zoom — so the only verification that counts is a printed sheet at 100%.

const ts = Date.now();

describe("album PDF (#768)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let albumId: string;

  before(async () => {
    // Bytes go to a scratch directory rather than the developer's `.data`, and through the storage
    // interface's own layout so the renderer reads them exactly as it would in the app.
    process.env.STAMPORAMA_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "album-pdf-"));

    userId = `test-user-albumpdf-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User albumpdf-${ts}`,
        email: `test-albumpdf-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-albumpdf-${ts}`,
          name: "Album PDF",
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "pl",
        },
      })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Fischer", abbreviation: "Fi" },
    });
    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Polska",
          catalogPrefix: "PL",
          primaryCatalogVendorId: vendor.id,
          collectionAreaVendors: { create: [{ catalogVendorId: vendor.id }] },
        },
      })
    ).id;

    // A drawer that can supply an ordinary definitive and nothing near a souvenir sheet, so the
    // fixture carries a real oversize box (#765) as well as ordinary ones.
    await prisma.hawidStrip.createMany({
      data: [
        { collectionId, heightMm: 24, stockLengthMm: 210, sortOrder: 0 },
        { collectionId, heightMm: 41, stockLengthMm: 210, sortOrder: 1 },
      ],
    });

    const template = await prisma.albumTemplate.create({
      data: { collectionId, name: "Polska A4", ...DEFAULT_ALBUM_PRESET },
    });

    const makeIssue = async (year: number, name: string, sortKey: string) =>
      (
        await prisma.issue.create({
          data: {
            collectionId,
            issueNo: Number(`${year}${sortKey.slice(-3)}`),
            collectionAreaId: areaId,
            name,
            year,
            primaryCatalogSortKey: sortKey,
          },
        })
      ).id;
    const issue1938 = await makeIssue(1938, "Mościcki", "0000000303");
    const issue1939 = await makeIssue(1939, "Wieliczka", "0000000400");
    const issue1940 = await makeIssue(1940, "Generalna Gubernia", "0000000500");

    const makeStamp = async (number: string, w: number | null, h: number | null, year: number) =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Znaczek ${number}`,
            // A full date, so the heading's `{issueDate}` renders the Roman month the collector's
            // own pages carry — `1938, 1 II.` — and the faces are asked for those glyphs.
            issuedYear: year,
            issuedMonth: 2,
            issuedDay: 1,
            widthMm: w,
            heightMm: h,
            primaryCatalogSortKey: number.padStart(10, "0"),
            catalogNumbers: { create: [{ catalogVendorId: vendor.id, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
    const s303 = await makeStamp("303", 26, 32, 1938);
    const s304 = await makeStamp("304", 26, 32, 1938);
    // A block: no strip is tall enough, so it is a pocket and drawn at its own size.
    const s305 = await makeStamp("305", 130, 102, 1938);
    const s400 = await makeStamp("400", 50, 30, 1939);

    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1938,
        // Polish diacritics in the heading, which is what the embedded faces are here for.
        name: "Wydanie obiegowe – prezydent RP Ignacy Mościcki",
        sortOrder: 0,
        stamps: { create: [s303, s304, s305].map((stampId, i) => ({ stampId, sortOrder: i })) },
      },
    });
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1939,
        name: "Żupy solne w Wieliczce",
        sortOrder: 0,
        stamps: { create: [{ stampId: s400, sortOrder: 0 }] },
      },
    });
    // A checklist of souvenir sheets, too tall for one sheet by a long way: this is the block that
    // gets split, and its continuation sheets are what the `[2]`, `[3]` markers are for.
    const sheets: string[] = [];
    for (let n = 0; n < 5; n += 1) {
      sheets.push(await makeStamp(`Blok ${n + 1} (50${n})`, 130, 102, 1940));
    }
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1940,
        name: "Bloki okolicznościowe",
        sortOrder: 0,
        stamps: { create: sheets.map((stampId, i) => ({ stampId, sortOrder: i })) },
      },
    });

    // A picture for one slot, written through the storage interface exactly as an upload would.
    // Deliberately a different aspect (2:1) from its 26 × 32 mm mount, so "fits, never crops" is
    // something the geometry below can actually catch.
    await addPhoto(collectionId, s303, 240, 120);

    albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Polska", collectionAreaId: areaId, language: "pl" },
      template.id
    );
    await gatherAlbumEntries(userId, albumId);
  });

  after(async () => {
    await prisma.album.deleteMany({ where: { collectionId } });
    await prisma.albumTemplate.deleteMany({ where: { collectionId } });
    await prisma.hawidStrip.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.photo.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("renders every live sheet of the album at true A4", async () => {
    const plan = await planAlbum(userId, albumId);
    assert.ok(plan);
    const file = await renderAlbumPdf(plan!);

    assert.equal(file.pageCount, plan!.pages.length);
    assert.equal(file.fileName, "Polska.pdf");

    const doc = await loadBack(file.bytes);
    assert.equal(doc.getPageCount(), plan!.pages.length);
    for (const page of doc.getPages()) {
      // 210 × 297 mm in points. The spike printed a 150 mm rule and a 200 mm one and measured both:
      // if this pair is right and nothing rescales the file, the millimetres are millimetres.
      assert.ok(Math.abs(page.getWidth() - 595.2755905511812) < 1e-6, `${page.getWidth()}`);
      assert.ok(Math.abs(page.getHeight() - 841.8897637795277) < 1e-6, `${page.getHeight()}`);
    }

    if (process.env.STAMPORAMA_ALBUM_PDF_OUT) {
      const out = process.env.STAMPORAMA_ALBUM_PDF_OUT;
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, file.bytes);
      // What to put the ruler on, printed beside the file so the check does not depend on
      // remembering which box was which.
      for (const [n, page] of plan!.pages.entries()) {
        if (page.layout.kind !== "live") continue;
        for (const b of page.layout.boxes) {
          console.log(`sheet ${n + 1} · ${b.box.label || "(no label)"} · ${b.widthMm} × ${b.heightMm} mm`);
        }
      }
    }
  });

  it("draws a mount at the millimetres the plan gave it", async () => {
    const plan = await planAlbum(userId, albumId);
    const page = plan!.pages.find((p) => p.layout.kind === "live" && p.layout.boxes.length > 0)!;
    assert.ok(page.layout.kind === "live");
    const box = page.layout.boxes[0];
    // 26 mm wide plus the template's 4 mm horizontal margin; 32 mm high needs more than the 24 mm
    // strip, so the box takes the 41 mm one.
    assert.equal(box.widthMm, 30);
    assert.equal(box.heightMm, 41);
    // And the drawn rectangle is that, in points, to the micrometre.
    const drawn = box.widthMm * (72 / 25.4);
    assert.ok(Math.abs(drawn - 85.0393700787402) < 1e-6, `${drawn}`);
  });

  it("fits a photo inside its mount without cropping it", async () => {
    const plan = await planAlbum(userId, albumId);
    const file = await renderAlbumPdf(plan!);
    // A 2:1 image in a 30 × 41 mm mount can only be 30 mm wide and 15 mm high. What is checked here
    // is that the document carries the image at all and that nothing was resampled to the mount:
    // pdf-lib embeds the stored bytes, so the XObject is still 240 × 120 pixels.
    const doc = await loadBack(file.bytes);
    const images = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => obj)
      .filter((obj) => String(obj).includes("/Subtype /Image"));
    assert.ok(images.length >= 1, "the page carries its photo");
    assert.ok(
      images.some((obj) => /\/Width 240\b/.test(String(obj)) && /\/Height 120\b/.test(String(obj))),
      "and carries it at its own pixel size, uncropped and unresampled"
    );
  });

  it("embeds the faces it draws in rather than naming them", async () => {
    const plan = await planAlbum(userId, albumId);
    const doc = await loadBack((await renderAlbumPdf(plan!)).bytes);

    const baseFonts: string[] = [];
    let withGlyphBytes = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const base = obj.get(PDFName.of("BaseFont"));
      if (base) baseFonts.push(String(base));
      if (obj.get(PDFName.of("FontFile2"))) withGlyphBytes += 1;
    }
    // The template sets four distinct faces across its five roles.
    assert.ok(
      baseFonts.some((n) => n.includes("LiberationSerif")),
      `the faces the album is set in: ${baseFonts.join(", ")}`
    );
    assert.ok(
      baseFonts.some((n) => n.includes("LiberationSans-BoldItalic")),
      `checklist headings are set in Arial Bold Italic's metric twin: ${baseFonts.join(", ")}`
    );
    // The whole point: the glyphs travel with the file, so the sheet is the same everywhere.
    assert.equal(withGlyphBytes, 4, "every face carries its own glyph bytes");
  });

  it("renders one sheet on its own, and names the file after it", async () => {
    const plan = await planAlbum(userId, albumId);
    assert.ok(plan!.pages.length >= 2, "the fixture has more than one sheet to choose from");
    const file = await renderAlbumPdf(plan!, "2");
    assert.equal(file.pageCount, 1);
    assert.equal(file.fileName, "Polska sheet 2.pdf");
    assert.equal((await loadBack(file.bytes)).getPageCount(), 1);
  });

  /** The collector's own convention, one step on: he repeats a continued heading with `(cd.)`, and
   *  the album numbers it instead so a checklist running to four cards can be put in order on a
   *  desk. What the plan owes the renderer is the ordinal, and this is where the two meet. */
  it("numbers the sheets of a checklist too tall for one", async () => {
    const plan = await planAlbum(userId, albumId);
    const parts = plan!.pages
      .filter((p) => p.layout.kind === "live")
      .flatMap((p) => (p.layout.kind === "live" ? p.layout.blocks : []))
      .filter((b) => b.part > 1)
      .map((b) => b.part);
    // Two souvenir sheets to a card: the block takes three, so two of them are continuations.
    assert.deepEqual(parts, [2, 3]);

    // And the mark is in the heading the plan measured, so the PDF draws it without adding a
    // character of its own.
    const headings = plan!.pages
      .filter((p) => p.layout.kind === "live")
      .flatMap((p) => (p.layout.kind === "live" ? p.layout.headings : []))
      .map((h) => h.lines.join(" "));
    assert.ok(headings.includes("1940, 1 II. Bloki okolicznościowe"));
    assert.ok(headings.includes("1940, 1 II. Bloki okolicznościowe [2]"));
    assert.ok(headings.includes("1940, 1 II. Bloki okolicznościowe [3]"));
    // And the whole thing renders.
    assert.equal((await renderAlbumPdf(plan!)).pageCount, plan!.pages.length);
  });

  it("refuses a sheet the album does not have rather than printing nothing", async () => {
    const plan = await planAlbum(userId, albumId);
    await assert.rejects(() => renderAlbumPdf(plan!, "99"), AlbumPdfError);
  });
});

/** Read a rendered document back, so the assertions are about the file rather than about the code
 *  that wrote it. */
async function loadBack(bytes: Uint8Array) {
  return PDFDocument.load(bytes);
}

/** A stamp photo, written through the storage interface at the key layout the app uses. */
async function addPhoto(collectionId: string, stampId: string, width: number, height: number) {
  const bytes = await sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 160, b: 120 } },
  })
    .jpeg()
    .toBuffer();
  const photo = await prisma.photo.create({
    data: {
      stampId,
      role: "main",
      storageBackend: "filesystem",
      storageKey: "pending",
      mime: "image/jpeg",
      width,
      height,
      sizeBytes: bytes.byteLength,
    },
  });
  const prefix = permanentPrefix(collectionId, photo.id);
  await getActiveStorage().put(variantKey(prefix, "full", "image/jpeg"), bytes, "image/jpeg", "work");
  await prisma.photo.update({ where: { id: photo.id }, data: { storageKey: prefix } });
}
