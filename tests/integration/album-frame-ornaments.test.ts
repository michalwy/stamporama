import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { prisma } from "../../src/lib/db";
import { createAlbum, getAlbum, updateAlbumPreset } from "../../src/lib/albums";
import { createAlbumTemplate } from "../../src/lib/album-templates";
import { albumPlanOverview, planAlbum } from "../../src/lib/album-plan";
import { getAlbumEditorData } from "../../src/lib/album-editor";
import { AlbumPdfError, renderAlbumPdf } from "../../src/lib/album-pdf";
import { MM_TO_PT } from "../../src/lib/album-metrics";
import {
  countAlbumPresetDivergence,
  getAlbumPrintedReport,
  markAlbumPagesPrinted,
} from "../../src/lib/album-printing";
import { getAlbumPageSnapshots } from "../../src/lib/album-printed-pages";
import { albumRenderPreset, DEFAULT_ALBUM_PRESET } from "../../src/lib/album-template-rules";
import { albumBuiltinOrnament } from "../../src/lib/album-ornaments";
import {
  AlbumOrnamentError,
  deleteAlbumOrnament,
  getAlbumOrnaments,
  uploadAlbumOrnament,
} from "../../src/lib/album-ornament-store";
import { albumFrameCentreMm } from "../../src/lib/album-frame";
import { getStorage } from "../../src/lib/storage";

// Bytes go through the filesystem backend, so point it at a throwaway directory rather than the
// repo's `.data` — `scan-sheet-ingest.test.ts`'s arrangement.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-ornaments-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Ornamental page frames (#1427), through the rows and the file they are stored in: an uploaded
// corner ornament read into a drawing and kept, named on a template and an album, resolved for the
// live plan and the page editor alike, drawn into the PDF as vectors at true millimetres and
// mirrored at each corner, copied into a printed card — which then reports a change of ornament and
// goes on printing its own — and refused a deletion while anything still uses it.

const ts = Date.now();

/** A plain square: its frame is 10 units, so at 20 mm every unit is 2 mm. */
const SQUARE_SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#336699"/></svg>`;

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

/** Every `cm` the page sets, as numbers. */
function transforms(ops: string): number[][] {
  return [...ops.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g)].map((m) =>
    m.slice(1, 7).map(Number)
  );
}

describe("ornamental page frames (#1427)", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let areaId: string;
  let albumId: string;
  let ornamentId: string;

  const setFrame = async (values: Partial<typeof DEFAULT_ALBUM_PRESET>) => {
    const album = await getAlbum(userId, albumId);
    assert.ok(album);
    await updateAlbumPreset(userId, albumId, { ...albumRenderPreset(album!), ...values });
  };

  before(async () => {
    userId = `test-user-ornaments-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User ornaments-${ts}`,
        email: `test-ornaments-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const collection = (slug: string) =>
      prisma.collection.create({
        data: { slug, name: slug, baseCurrency: "EUR", ownerId: userId, defaultLanguage: "en" },
      });
    collectionId = (await collection(`col-ornaments-${ts}`)).id;
    otherCollectionId = (await collection(`col-ornaments-other-${ts}`)).id;
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
    await prisma.albumOrnament.deleteMany({ where: { collectionId: { in: [collectionId, otherCollectionId] } } });
    await prisma.hawidStrip.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.delete({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("starts a new album framed like his own pages: a double rule and the rosette", async () => {
    const album = await getAlbum(userId, albumId);
    assert.equal(album?.frameOrnament, "rosette");
    assert.equal(album?.borderGapMm, 1.2);
    const plan = await planAlbum(userId, albumId);
    assert.deepEqual(plan?.frameOrnament, albumBuiltinOrnament("rosette"));
    const editor = await getAlbumEditorData(userId, albumId, 1);
    assert.deepEqual(editor?.sheet?.frameOrnament, albumBuiltinOrnament("rosette"));
  });

  it("reads an uploaded SVG into a drawing, keeps the file, and names it after the file", async () => {
    const ornament = await uploadAlbumOrnament(userId, collectionId, "Corner square.svg", Buffer.from(SQUARE_SVG));
    ornamentId = ornament.id;
    assert.equal(ornament.name, "Corner square");
    assert.equal(ornament.drawing.paths[0].fill, "#336699");
    const row = await prisma.albumOrnament.findUniqueOrThrow({ where: { id: ornamentId } });
    assert.equal(row.storageKey, `${collectionId}/ornaments/${ornamentId}/original.svg`);
    const stored = await getStorage(row.storageBackend).get(row.storageKey, "image/svg+xml", "work");
    const chunks: Buffer[] = [];
    for await (const chunk of stored.stream) chunks.push(chunk as Buffer);
    assert.equal(Buffer.concat(chunks).toString("utf8"), SQUARE_SVG);

    const second = await uploadAlbumOrnament(userId, collectionId, "Corner square.svg", Buffer.from(SQUARE_SVG));
    assert.equal(second.name, "Corner square (2)");
    await deleteAlbumOrnament(userId, second.id);
    assert.deepEqual(
      (await getAlbumOrnaments(userId, collectionId)).map((o) => o.name),
      ["Corner square"]
    );
  });

  it("refuses a file it cannot print, with the reason, and keeps nothing", async () => {
    await assert.rejects(
      uploadAlbumOrnament(userId, collectionId, "words.svg", Buffer.from('<svg viewBox="0 0 1 1"><text>PL</text></svg>')),
      (err: unknown) => err instanceof AlbumOrnamentError && /contains text/.test((err as Error).message)
    );
    assert.equal(await prisma.albumOrnament.count({ where: { collectionId, name: "words" } }), 0);
  });

  it("refuses to save an ornament the collection does not have, on a template and an album", async () => {
    const foreign = await uploadAlbumOrnament(userId, otherCollectionId, "theirs.svg", Buffer.from(SQUARE_SVG));
    await assert.rejects(
      createAlbumTemplate(userId, collectionId, { ...DEFAULT_ALBUM_PRESET, name: "Borrowed", frameOrnament: foreign.id }),
      AlbumOrnamentError
    );
    await assert.rejects(setFrame({ frameOrnament: foreign.id }), AlbumOrnamentError);
    assert.equal((await getAlbum(userId, albumId))?.frameOrnament, "rosette");
  });

  it("draws the uploaded ornament at all four corners of the PDF, mirrored, as vectors at true millimetres", async () => {
    await setFrame({ frameOrnament: ornamentId, frameOrnamentSizeMm: 20 });
    const plan = await planAlbum(userId, albumId);
    assert.ok(plan);
    const ops = await pageOperators((await renderAlbumPdf(plan!, "1")).bytes);

    const k = MM_TO_PT;
    const s = 2; // 20 mm over a 10-unit frame
    const c = albumFrameCentreMm(albumRenderPreset(plan!.album));
    const h = plan!.album.pageHeightMm * k;
    const w = plan!.album.pageWidthMm;
    const expected = [
      [k * s, 0, 0, -k * s, k * c, h - k * c], // top-left: y flipped into PDF space only
      [-k * s, 0, 0, -k * s, k * (w - c), h - k * c], // top-right: mirrored across
      [k * s, 0, 0, k * s, k * c, k * c], // bottom-left: mirrored down
      [-k * s, 0, 0, k * s, k * (w - c), k * c], // bottom-right: both
    ];
    const drawn = transforms(ops);
    for (const m of expected) {
      assert.ok(
        drawn.some((d) => d.every((v, i) => Math.abs(v - m[i]) < 0.01)),
        `a corner placed by [${m.map((v) => v.toFixed(2)).join(" ")}]`
      );
    }
    // Filled as a path in its own colour, not placed as a picture.
    assert.match(ops, /0\.2 0\.4 0\.6 rg/);
    assert.doesNotMatch(ops, /\/Image/);
    // The rules stop at the ornament: the top one starts at the centre line plus the ornament.
    const reach = (c + 20) * k;
    const starts = [...ops.matchAll(/(-?[\d.]+) (-?[\d.]+) m\n/g)].map((m) => Number(m[1]));
    assert.ok(
      starts.some((x) => Math.abs(x - reach) < 0.01),
      `a rule starting at ${reach.toFixed(2)} pt`
    );
  });

  it("draws the same ornament on the page editor's canvas as the PDF prints", async () => {
    const editor = await getAlbumEditorData(userId, albumId, 1);
    const [ornament] = await getAlbumOrnaments(userId, collectionId);
    assert.deepEqual(editor?.sheet?.frameOrnament, ornament.drawing);
  });

  it("refuses to delete an ornament an album or a template still uses, naming them", async () => {
    await createAlbumTemplate(userId, collectionId, {
      ...DEFAULT_ALBUM_PRESET,
      name: "Squares",
      frameOrnament: ornamentId,
    });
    await assert.rejects(
      deleteAlbumOrnament(userId, ornamentId),
      (err: unknown) =>
        err instanceof AlbumOrnamentError &&
        /the template "Squares", the album "Polska"/.test((err as Error).message)
    );
    await prisma.albumTemplate.deleteMany({ where: { collectionId, name: "Squares" } });
  });

  it("copies the drawing into a printed card, which reports a change of ornament and keeps printing its own", async () => {
    const overview = albumPlanOverview((await planAlbum(userId, albumId))!);
    await markAlbumPagesPrinted(userId, albumId, [1], overview.fingerprint);
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const card = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    const [ornament] = await getAlbumOrnaments(userId, collectionId);
    assert.deepEqual(card?.frameOrnament, ornament.drawing);

    const album = await getAlbum(userId, albumId);
    const vine = { ...albumRenderPreset(album!), frameOrnament: "vine" };
    assert.equal(await countAlbumPresetDivergence(userId, albumId, vine), 1);
    await updateAlbumPreset(userId, albumId, vine);
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(
      report.sheets[0].divergences.map((d) => d.detail),
      ["The album's Frame ornament has changed since this card was set."]
    );

    // Nothing uses the upload now but the card, which holds its own copy — so it can go, and the
    // card still prints its corners.
    await deleteAlbumOrnament(userId, ornamentId);
    assert.equal(await prisma.albumOrnament.count({ where: { id: ornamentId } }), 0);
    const after = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.deepEqual(after, card, "the card itself is untouched");
    const plan = await planAlbum(userId, albumId);
    const ops = await pageOperators((await renderAlbumPdf(plan!, "1")).bytes);
    assert.match(ops, /0\.2 0\.4 0\.6 rg/, "the printed card still draws the uploaded corners");
  });

  it("refuses to print a live sheet whose frame names an ornament that is gone", async () => {
    await prisma.albumPrintedPage.deleteMany({ where: { albumId } });
    await prisma.album.update({ where: { id: albumId }, data: { frameOrnament: ornamentId } });
    const plan = await planAlbum(userId, albumId);
    assert.equal(plan?.frameOrnament, null);
    await assert.rejects(renderAlbumPdf(plan!, "1"), AlbumPdfError);
    // The screen draws the frame without it rather than failing.
    const editor = await getAlbumEditorData(userId, albumId, 1);
    assert.equal(editor?.sheet?.frameOrnament, null);
  });
});
