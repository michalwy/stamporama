import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { prisma } from "../../src/lib/db";
import type { Prisma } from "../../src/generated/prisma/client";
import {
  AlbumPrintModeError,
  addAlbumEntry,
  createAlbum,
  getAlbumEntries,
  reorderAlbumEntries,
  setAlbumEntryLayout,
} from "../../src/lib/albums";
import { albumPlanOverview, planAlbum } from "../../src/lib/album-plan";
import { getAlbumEditorData } from "../../src/lib/album-editor";
import { renderAlbumPdf } from "../../src/lib/album-pdf";
import { albumBoxOutline } from "../../src/lib/album-box-outline";
import { MM_TO_PT } from "../../src/lib/album-metrics";
import {
  getAlbumPrintedReport,
  markAlbumPagesPrinted,
  unprintAlbumPage,
} from "../../src/lib/album-printing";
import { getAlbumPageSnapshots } from "../../src/lib/album-printed-pages";
import { DEFAULT_ALBUM_PRESET } from "../../src/lib/album-template-rules";
import { saveEntityTranslation } from "../../src/lib/entity-translations";
import type { AlbumPrintMode } from "../../src/lib/album-print-mode";

// Checklists of one issue printed as subsets of it (#1509), through the rows they are stored on: the
// default rule over a real album, the mode set on an entry and taken back, neighbours only, a
// checklist spanning issues refused anything but its own, the issue's title in the album's language,
// the editor and the PDF drawing one plan, and printed cards — neither changed nor reported as diverged
// by the defaults, and reported once the collector changes a mode.
//
// The album, as `PL-1945.txt` sets it: `1945, 14 VII. Grunwald` on its own, then `1945, 1 IX.
// Westerplatte` with its imperforate under a `STAMP_H2` sub-heading.

const ts = Date.now();

describe("checklists printed within their issue (#1509)", () => {
  let userId: string;
  let collectionId: string;
  let albumId: string;
  let vendorId: string;
  let areaId: string;
  let westerplatteId: string;

  const entryNamed = async (name: string) =>
    (await getAlbumEntries(userId, albumId)).find((e) => e.checklistName === name)!;
  const setMode = async (name: string, printMode: AlbumPrintMode | null) =>
    setAlbumEntryLayout(userId, (await entryNamed(name)).id, { printMode });
  const livePage = async () => {
    const plan = await planAlbum(userId, albumId);
    assert.ok(plan);
    const page = plan!.pages.find((p) => p.layout.kind === "live");
    assert.ok(page && page.layout.kind === "live", "a live sheet");
    return { plan: plan!, layout: page.layout as Extract<typeof page.layout, { kind: "live" }> };
  };
  const headings = async () =>
    (await livePage()).layout.headings.map((h) => `${h.role}: ${h.lines.join(" ")}`);

  before(async () => {
    userId = `test-user-printmode-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User printmode-${ts}`,
        email: `test-printmode-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-printmode-${ts}`,
          name: "Print modes",
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "en",
        },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Fischer", abbreviation: "Fi" },
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
      data: [{ collectionId, heightMm: 38, stockLengthMm: 210, sortOrder: 0 }],
    });

    const issue = async (no: number, name: string, sortKey: string) =>
      (
        await prisma.issue.create({
          data: {
            collectionId,
            issueNo: no,
            collectionAreaId: areaId,
            name,
            year: 1945,
            primaryCatalogSortKey: sortKey.padStart(10, "0"),
          },
        })
      ).id;
    const grunwaldId = await issue(1, "Grunwald", "372");
    westerplatteId = await issue(2, "Westerplatte", "374");

    const checklist = async (issueId: string | null, name: string, sortOrder: number, numbers: string[]) => {
      const stampIds: string[] = [];
      for (const number of numbers) stampIds.push(await createStamp(number));
      return (
        await prisma.checklist.create({
          data: {
            collectionId,
            issueId,
            name,
            sortOrder,
            stamps: { create: stampIds.map((stampId, i) => ({ stampId, sortOrder: i })) },
          },
        })
      ).id;
    };
    await checklist(grunwaldId, "Grunwald", 0, ["372"]);
    // Named after its issue — its main checklist — and two 51 mm mounts, too wide to share a band.
    await checklist(westerplatteId, "Westerplatte", 0, ["374a", "374b"]);
    await checklist(westerplatteId, "Imperforate", 1, ["XXII"]);

    const templateId = (
      await prisma.albumTemplate.create({
        data: {
          collectionId,
          name: "Print modes",
          ...DEFAULT_ALBUM_PRESET,
          checklistTemplate: "{year}. {checklistName}",
        },
      })
    ).id;
    albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Polska", collectionAreaId: areaId, language: "pl" },
      templateId
    );
  });

  async function createStamp(number: string): Promise<string> {
    return (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp ${number}`,
          issuedYear: 1945,
          widthMm: 51,
          heightMm: 34,
          primaryCatalogSortKey: number.padStart(10, "0"),
          catalogNumbers: { create: [{ catalogVendorId: vendorId, number }] },
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      })
    ).id;
  }

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

  it("prints an issue's title once over its checklists, and an issue with one as before", async () => {
    assert.deepEqual(await headings(), [
      "heading: 1945. Grunwald",
      "heading: 1945. Westerplatte",
      "subheading: Imperforate",
    ]);
    const { layout } = await livePage();
    assert.deepEqual(
      layout.blocks.map((b) => [b.printMode, b.groupHeading ?? null]),
      [
        ["own", null],
        ["within", "1945. Westerplatte"],
        ["within-subheading", null],
      ]
    );
  });

  it("shows the defaulted mode as such in the editor, and offers the choice", async () => {
    const sheet = (await getAlbumEditorData(userId, albumId, 1))!.sheet!;
    assert.deepEqual(
      sheet.blocks.map((b) => b.printMode),
      [
        { chosen: null, defaultMode: "own", offered: true },
        { chosen: null, defaultMode: "within", offered: true },
        { chosen: null, defaultMode: "within-subheading", offered: true },
      ]
    );
    // The issue heading is its own text on the sheet, owned by the block it stands over.
    assert.deepEqual(
      sheet.blocks.map((b) => [b.issueHeadingIndex, b.headingIndex]),
      [
        [null, 0],
        [1, null],
        [null, 2],
      ]
    );
  });

  it("keeps a mode set on the entry per album, and takes it back to the default", async () => {
    await setMode("Imperforate", "own");
    assert.equal((await entryNamed("Imperforate")).printMode, "own");
    assert.deepEqual(await headings(), [
      "heading: 1945. Grunwald",
      "heading: 1945. Westerplatte",
      "heading: 1945. Imperforate",
    ]);
    const sheet = (await getAlbumEditorData(userId, albumId, 1))!.sheet!;
    assert.deepEqual(sheet.blocks[2].printMode, {
      chosen: "own",
      defaultMode: "within-subheading",
      offered: true,
    });

    // Another correction on the entry leaves the mode alone.
    await setAlbumEntryLayout(userId, (await entryNamed("Imperforate")).id, { spaceBeforeMm: 0 });
    assert.equal((await entryNamed("Imperforate")).printMode, "own");

    await setMode("Westerplatte", "within-subheading");
    await setMode("Imperforate", null);
    assert.deepEqual(await headings(), [
      "heading: 1945. Grunwald",
      "heading: 1945. Westerplatte",
      "subheading: Westerplatte",
      "subheading: Imperforate",
    ]);
    await setMode("Westerplatte", null);
  });

  it("prints the title again when another issue stands between two of its checklists", async () => {
    const entries = await getAlbumEntries(userId, albumId);
    const byName = (name: string) => entries.find((e) => e.checklistName === name)!.id;
    await reorderAlbumEntries(userId, albumId, [
      byName("Westerplatte"),
      byName("Grunwald"),
      byName("Imperforate"),
    ]);
    assert.deepEqual(await headings(), [
      "heading: 1945. Westerplatte",
      "heading: 1945. Grunwald",
      "heading: 1945. Westerplatte",
      "subheading: Imperforate",
    ]);
    await reorderAlbumEntries(userId, albumId, [
      byName("Grunwald"),
      byName("Westerplatte"),
      byName("Imperforate"),
    ]);
  });

  it("prints the issue's title in the album's language, and flags a sub-heading that falls back", async () => {
    await saveEntityTranslation(userId, collectionId, {
      entityType: "issue",
      entityId: westerplatteId,
      entityField: "name",
      language: "pl",
      value: "Westerplatte (pl)",
    });
    const sheet = (await getAlbumEditorData(userId, albumId, 1))!.sheet!;
    const issue = sheet.headings[sheet.blocks[1].issueHeadingIndex!];
    assert.deepEqual(issue.lines, ["1945. Westerplatte (pl)"]);
    assert.deepEqual(issue.gaps, []);
    const sub = sheet.headings[sheet.blocks[2].headingIndex!];
    assert.deepEqual(
      sub.gaps.map((g) => [g.entityType, g.entityField]),
      [["checklist", "name"]],
      "a checklist named by hand is translated on itself"
    );
  });

  it("offers a checklist spanning issues nothing but its own issue, and refuses the rest", async () => {
    const spanningId = (
      await prisma.checklist.create({
        data: { collectionId, issueId: null, name: "Across issues", sortOrder: 0 },
      })
    ).id;
    await addAlbumEntry(userId, albumId, spanningId);
    const entry = await entryNamed("Across issues");
    await assert.rejects(
      setAlbumEntryLayout(userId, entry.id, { printMode: "within" }),
      AlbumPrintModeError
    );
    await setAlbumEntryLayout(userId, entry.id, { printMode: "own" });
    await setAlbumEntryLayout(userId, entry.id, { printMode: null });
    assert.equal((await entryNamed("Across issues")).printMode, null);
    await prisma.albumEntry.delete({ where: { id: entry.id } });
    await prisma.checklist.delete({ where: { id: spanningId } });
  });

  it("draws the same headings and boxes in the editor and in the PDF", async () => {
    const { plan, layout } = await livePage();
    const sheet = (await getAlbumEditorData(userId, albumId, 1))!.sheet!;
    assert.deepEqual(
      sheet.headings.map((h) => [h.role, h.yMm, h.lines]),
      layout.headings.map((h) => [h.role, h.yMm, h.lines])
    );
    assert.equal(sheet.headings[2].face.italic, true, "the sub-heading is set in its own face");
    assert.equal(sheet.headings[2].face.sizePt, 10);

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
    for (const box of layout.boxes) {
      const line = albumBoxOutline(DEFAULT_ALBUM_PRESET, box)!.rect;
      const expected = (DEFAULT_ALBUM_PRESET.pageHeightMm - (line.yMm + line.heightMm)) * MM_TO_PT;
      assert.ok(
        drawnYs.some((y) => Math.abs(y - expected) < 0.01),
        `a mount drawn at ${expected.toFixed(2)} pt from the foot`
      );
    }
  });

  it("leaves a card printed with the defaults matching, and its snapshot records the modes", async () => {
    const overview = albumPlanOverview((await livePage()).plan);
    await markAlbumPagesPrinted(userId, albumId, [1], overview.fingerprint);
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const snapshot = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id)!;
    assert.deepEqual(
      snapshot.page.blocks.map((b) => [b.printMode, b.groupHeading ?? null, b.groupPart ?? null]),
      [
        ["own", null, null],
        ["within", "1945. Westerplatte (pl)", 1],
        ["within-subheading", null, 1],
      ]
    );
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(report.sheets[0].divergences, []);
  });

  it("reports a mode the collector changes on a printed card, and leaves the card as it was", async () => {
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const before = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    await setMode("Imperforate", "own");
    const report = await getAlbumPrintedReport(userId, albumId);
    const said = report.sheets[0].divergences.map((d) => d.detail).join(" ");
    assert.match(said, /would now read "1945\. Imperforate"; the card reads "Imperforate"/);
    const after = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.deepEqual(after?.page, before?.page, "the card is a stored result");
    await setMode("Imperforate", null);
    assert.deepEqual((await getAlbumPrintedReport(userId, albumId)).sheets[0].divergences, []);
    await unprintAlbumPage(userId, row.id);
  });

  it("marks a run's next sheet [2], and compares a card of it against a reference marked the same", async () => {
    // A forced break puts the imperforate on a sheet of its own, the run's second.
    const imperforate = await entryNamed("Imperforate");
    await setAlbumEntryLayout(userId, imperforate.id, { breakBefore: "always" });
    const plan = (await planAlbum(userId, albumId))!;
    const second = plan.pages[1].layout;
    assert.ok(second.kind === "live");
    assert.deepEqual(
      second.headings.map((h) => h.lines.join(" ")),
      ["1945. Westerplatte (pl) [2]", "Imperforate"]
    );

    // Printed alone, the card's reference starts the run where the card did — or it would read the
    // card's `[2]` as a heading that is no longer there.
    const overview = albumPlanOverview(plan);
    await markAlbumPagesPrinted(userId, albumId, [2], overview.fingerprint);
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.equal(report.sheets.length, 1);
    assert.deepEqual(report.sheets[0].divergences, []);

    // The live sheet before it still heads the run, unmarked.
    const [first] = (await planAlbum(userId, albumId))!.pages;
    assert.ok(first.layout.kind === "live");
    assert.ok(
      first.layout.headings.some((h) => h.lines.join(" ") === "1945. Westerplatte (pl)")
    );
    await unprintAlbumPage(userId, report.sheets[0].id);
    await setAlbumEntryLayout(userId, imperforate.id, { breakBefore: "auto" });
  });

  it("reports nothing on a card printed before #1509, whose checklists all printed as their own", async () => {
    // A card printed as the album stood before the modes existed: every checklist under its own
    // heading, and no mode recorded on the snapshot.
    for (const name of ["Grunwald", "Westerplatte", "Imperforate"]) await setMode(name, "own");
    const overview = albumPlanOverview((await livePage()).plan);
    await markAlbumPagesPrinted(userId, albumId, [1], overview.fingerprint);
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const stored = row.snapshot as { page: { blocks: Record<string, unknown>[] } };
    for (const block of stored.page.blocks) {
      delete block.printMode;
      delete block.groupHeading;
      delete block.groupPart;
    }
    await prisma.albumPrintedPage.update({
      where: { id: row.id },
      data: { snapshot: stored as unknown as Prisma.InputJsonValue },
    });

    // Back to the defaults — which would now group Westerplatte's two checklists.
    for (const name of ["Grunwald", "Westerplatte", "Imperforate"]) await setMode(name, null);
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(report.sheets[0].divergences, [], "the defaults alone change no card");
  });
});
