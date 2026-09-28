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
import {
  albumFrame,
  albumFrameCentreMm,
  albumFrameInnerEdgeMm,
  albumFrameOuterEdgeMm,
} from "../../src/lib/album-frame";
import { MM_TO_PT } from "../../src/lib/album-metrics";
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

// The page footer placed on its own (#1457), through the rows it is stored on: the template's choice
// copied onto the album, the album's own copy edited, the plan placing the footer from the frame and
// leaving the content area to the margins, the canvas and the PDF breaking the bottom rule around a
// footer in the frame line in the same place, and a printed card reporting the change while keeping
// its own footer and rule — including a card stored before the choice existed.

const ts = Date.now();

/** The page's first sheet as drawn: every straight stroke segment, in points from the foot. */
async function pdfSegments(plan: Parameters<typeof renderAlbumPdf>[0]) {
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
  // A stroke is a move and one or more lines; each consecutive pair of points is one segment.
  const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
  let at: [number, number] | null = null;
  for (const m of ops.matchAll(/(-?[\d.]+) (-?[\d.]+) ([ml])\b/g)) {
    const pt: [number, number] = [Number(m[1]), Number(m[2])];
    if (m[3] === "l" && at) segments.push({ x1: at[0], y1: at[1], x2: pt[0], y2: pt[1] });
    at = pt;
  }
  return segments;
}

describe("the page footer placed on its own (#1457)", () => {
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
  const setPreset = async (values: Partial<AlbumRenderPreset>) => {
    const album = await getAlbum(userId, albumId);
    assert.ok(album);
    await updateAlbumPreset(userId, albumId, { ...albumRenderPreset(album!), ...values });
  };

  before(async () => {
    userId = `test-user-footer-placement-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User footer-placement-${ts}`,
        email: `test-footer-placement-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-footer-placement-${ts}`,
          name: "Footer placement",
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
        issueNo: 192801,
        collectionAreaId: areaId,
        name: "Wystawa",
        year: 1928,
        primaryCatalogSortKey: "234".padStart(10, "0"),
      },
    });
    const stampIds: string[] = [];
    for (const number of ["234", "235"]) {
      stampIds.push(
        (
          await prisma.stamp.create({
            data: {
              collectionId,
              name: `Stamp ${number}`,
              issuedYear: 1928,
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
        name: "Wystawa",
        sortOrder: 0,
        stamps: { create: stampIds.map((stampId, i) => ({ stampId, sortOrder: i })) },
      },
    });

    albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Rzeczpospolita Polska", collectionAreaId: areaId, language: "en" },
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

  it("starts an album with the footer inside the frame, its foot on the bottom margin as before", async () => {
    const album = await getAlbum(userId, albumId);
    assert.equal(album?.footerPlacement, "inside-frame");
    assert.equal(album?.footerOffsetMm, DEFAULT_ALBUM_PRESET.footerOffsetMm);
    assert.equal(album?.footerFrameGapMm, 5);
    const { layout } = await livePage();
    const footer = layout.footer!;
    assert.equal(footer.yMm + footer.heightMm, album!.pageHeightMm - album!.marginBottomMm);
    assert.equal(layout.content.yMm + layout.content.heightMm, footer.yMm, "the content stops on it");
  });

  it("copies a template's choice onto an album made from it", async () => {
    await createAlbumTemplate(userId, collectionId, {
      ...DEFAULT_ALBUM_PRESET,
      name: "Classic",
      footerPlacement: "below-frame",
      footerOffsetMm: 1.5,
      footerFrameGapMm: 3,
    });
    const template = await prisma.albumTemplate.findFirstOrThrow({ where: { collectionId } });
    assert.equal(template.footerPlacement, "below-frame");
    const copy = await createAlbum(
      userId,
      collectionId,
      { name: "Polska classic", collectionAreaId: areaId, language: "en" },
      template.id
    );
    const album = await getAlbum(userId, copy);
    assert.equal(album?.footerPlacement, "below-frame");
    assert.equal(album?.footerOffsetMm, 1.5);
    assert.equal(album?.footerFrameGapMm, 3);
    await prisma.album.delete({ where: { id: copy } });
  });

  it("prints the footer below the frame and leaves the content area to the margins", async () => {
    await setPreset({ footerPlacement: "below-frame", footerOffsetMm: 1 });
    const { plan, layout } = await livePage();
    const album = (await getAlbum(userId, albumId))!;
    const footer = layout.footer!;
    assert.ok(
      Math.abs(footer.yMm - (album.pageHeightMm - albumFrameOuterEdgeMm(album) + 1)) <= 0.05,
      "its head the offset under the frame"
    );
    assert.equal(layout.content.yMm + layout.content.heightMm, album.pageHeightMm - album.marginBottomMm);
    // The rule stays whole: one stroke along each bottom rule.
    const segments = await pdfSegments(plan);
    const y = album.borderInsetMm * MM_TO_PT;
    const along = segments.filter((s) => Math.abs(s.y1 - y) < 0.01 && Math.abs(s.y2 - y) < 0.01);
    assert.equal(along.length, 1);
  });

  it("sets the footer into the bottom line, and breaks the rule alike on the canvas and in the PDF", async () => {
    await setPreset({ footerPlacement: "in-frame" });
    const { plan } = await livePage();
    const album = (await getAlbum(userId, albumId))!;
    const footer = plan.pages[0].footer!;
    assert.ok(
      Math.abs(footer.yMm + footer.heightMm / 2 - (album.pageHeightMm - albumFrameCentreMm(album))) <= 0.05,
      "centred on the bottom rule's centre line"
    );
    assert.ok(Math.abs(footer.xMm + footer.widthMm / 2 - 105) <= 0.1, "and on the sheet");
    assert.ok(footer.widthMm < 40, `as wide as its text, not the content: ${footer.widthMm}`);
    assert.deepEqual(footer.lines, ["PL 234-235"]);

    const editor = await getAlbumEditorData(userId, albumId, 1);
    assert.equal(editor!.sheet!.footer?.xMm, footer.xMm);
    assert.equal(editor!.sheet!.footer?.widthMm, footer.widthMm);

    const frame = albumFrame(album, plan.frameOrnament, null, footer);
    const gapFrom = footer.xMm - album.footerFrameGapMm;
    const gapTo = footer.xMm + footer.widthMm + album.footerFrameGapMm;
    const segments = await pdfSegments(plan);
    const pt = (mm: number) => mm * MM_TO_PT;
    const inner = album.borderInsetMm + album.borderWidthMm + album.borderGapMm;
    for (const r of [album.borderInsetMm, inner]) {
      const y = pt(r);
      const along = segments.filter((s) => Math.abs(s.y1 - y) < 0.01 && Math.abs(s.y2 - y) < 0.01);
      assert.ok(
        along.some((s) => Math.abs(Math.max(s.x1, s.x2) - pt(gapFrom)) < 0.01),
        `the rule at ${r} mm stops the gap short of the footer's left`
      );
      assert.ok(
        along.some((s) => Math.abs(Math.min(s.x1, s.x2) - pt(gapTo)) < 0.01),
        "and starts again the gap past its right"
      );
      assert.ok(
        along.every((s) => Math.max(s.x1, s.x2) <= pt(gapFrom) + 0.01 || Math.min(s.x1, s.x2) >= pt(gapTo) - 0.01),
        "nothing is drawn across the footer"
      );
      const drawn = frame.lines.filter((l) => l.y1Mm === album.pageHeightMm - r && l.y2Mm === album.pageHeightMm - r);
      assert.equal(drawn.length, along.length, "the canvas's frame has the same pieces");
    }
  });

  it("keeps the content clear of a footer inside the frame that reaches above the margin", async () => {
    await setPreset({ footerPlacement: "inside-frame", footerOffsetMm: 8 });
    const { layout } = await livePage();
    const album = (await getAlbum(userId, albumId))!;
    const footer = layout.footer!;
    assert.ok(
      Math.abs(footer.yMm + footer.heightMm - (album.pageHeightMm - albumFrameInnerEdgeMm(album) - 8)) <= 0.05
    );
    assert.equal(layout.content.yMm + layout.content.heightMm, footer.yMm);
  });

  it("reports a printed card set before the change, and leaves the card alone", async () => {
    await setPreset({ footerPlacement: "inside-frame", footerOffsetMm: DEFAULT_ALBUM_PRESET.footerOffsetMm });
    const overview = albumPlanOverview((await livePage()).plan);
    await markAlbumPagesPrinted(userId, albumId, [1], overview.fingerprint);
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const snapshot = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.equal(snapshot?.preset.footerPlacement, "inside-frame", "the card records where its footer was");

    const album = await getAlbum(userId, albumId);
    const inFrame = { ...albumRenderPreset(album!), footerPlacement: "in-frame" as const };
    assert.equal(await countAlbumPresetDivergence(userId, albumId, inFrame), 1);
    await updateAlbumPreset(userId, albumId, inFrame);
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(
      report.sheets[0].divergences.map((d) => d.detail),
      ["The album's Footer placement has changed since this card was set."]
    );
    const after = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.deepEqual(after?.page, snapshot?.page, "the card itself is untouched");
    assert.deepEqual(after?.footer, snapshot?.footer, "and its footer where it was printed");

    // Reprinted, it is drawn from its own preset: the bottom rule whole.
    const plan = (await planAlbum(userId, albumId))!;
    const segments = await pdfSegments(plan);
    const y = DEFAULT_ALBUM_PRESET.borderInsetMm * MM_TO_PT;
    const along = segments.filter((s) => Math.abs(s.y1 - y) < 0.01 && Math.abs(s.y2 - y) < 0.01);
    assert.equal(along.length, 1, "one unbroken bottom rule on the card");
  });

  it("reads a card stored before the choice existed as printed inside the frame, on its margin", async () => {
    await setPreset({ footerPlacement: "inside-frame" });
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const stored = row.snapshot as { preset: Record<string, unknown> };
    const {
      footerPlacement: _p,
      footerOffsetMm: _o,
      footerFrameGapMm: _g,
      ...olderPreset
    } = stored.preset;
    void [_p, _o, _g];
    await prisma.albumPrintedPage.update({
      where: { id: row.id },
      data: { snapshot: { ...stored, preset: olderPreset } as Prisma.InputJsonObject },
    });
    const snapshot = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.equal(snapshot?.preset.footerPlacement, "inside-frame");
    assert.equal(snapshot?.preset.footerOffsetMm, DEFAULT_ALBUM_PRESET.footerOffsetMm);
    assert.equal(snapshot?.preset.footerFrameGapMm, 5);
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(report.sheets[0].divergences, []);
  });
});
