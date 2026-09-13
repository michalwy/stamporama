import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createAlbum, getAlbum, updateAlbumPreset } from "../../src/lib/albums";
import { albumPlanOverview, planAlbum } from "../../src/lib/album-plan";
import {
  countAlbumPresetDivergence,
  getAlbumPrintedReport,
  markAlbumPagesPrinted,
} from "../../src/lib/album-printing";
import { getAlbumPageSnapshots } from "../../src/lib/album-printed-pages";
import {
  DEFAULT_ALBUM_PRESET,
  albumRenderPreset,
  type AlbumRenderPreset,
} from "../../src/lib/album-template-rules";

// An album's own template values, edited after it was created (#1215).
//
// What is pinned, each against the reference that separates it from its easy wrong version:
//
// - the write lands on **this album's copy** — the template it was seeded from, and a second album
//   seeded from the same template, are untouched (#766's copy-not-reference rule, both ways);
// - the live pages **re-plan**: a changed value changes the page count, not only a drawing setting;
// - the count said before a save covers **only printed sheets that match today** — so it is zero for
//   an album whose cards already report the change, and zero for a change back to the printed values;
// - a printed card **keeps the preset it was set under** and reports the difference.

const ts = Date.now();

describe("an album's own template values (#1215)", () => {
  let userId: string;
  let collectionId: string;
  let templateId: string;
  let albumId: string;
  let siblingId: string;

  const withValues = (over: Partial<AlbumRenderPreset>): AlbumRenderPreset => ({
    ...DEFAULT_ALBUM_PRESET,
    ...over,
  });

  const livePages = async () => {
    const plan = await planAlbum(userId, albumId);
    assert.ok(plan);
    return albumPlanOverview(plan!);
  };

  before(async () => {
    userId = `test-user-own-values-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User own-values-${ts}`,
        email: `test-own-values-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-own-values-${ts}`,
          name: "Own values",
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "en",
        },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const areaId = (
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
      data: [
        { collectionId, heightMm: 29, stockLengthMm: 210, sortOrder: 0 },
        { collectionId, heightMm: 40, stockLengthMm: 210, sortOrder: 1 },
      ],
    });

    const issue = async (year: number, sortKey: string) =>
      (
        await prisma.issue.create({
          data: {
            collectionId,
            issueNo: year,
            collectionAreaId: areaId,
            name: `Issue ${year}`,
            year,
            primaryCatalogSortKey: sortKey,
          },
        })
      ).id;
    const stamp = async (number: string, w: number, h: number, year: number) =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Stamp ${number}`,
            issuedYear: year,
            widthMm: w,
            heightMm: h,
            primaryCatalogSortKey: number.padStart(10, "0"),
            catalogNumbers: { create: [{ catalogVendorId: vendor.id, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;

    // Twelve mounts in two rows of six: comfortably one block on A4, and far taller than what a
    // short page leaves under its running head and year — which is what lets a page-height change
    // be seen as a change in the number of sheets rather than inferred.
    const issue1938 = await issue(1938, "0000000300");
    const set1938: string[] = [];
    for (let n = 0; n < 12; n += 1) set1938.push(await stamp(String(300 + n), 26, 25, 1938));
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1938,
        name: "Mościcki",
        sortOrder: 0,
        stamps: { create: set1938.map((stampId, i) => ({ stampId, sortOrder: i })) },
      },
    });
    const issue1939 = await issue(1939, "0000000400");
    const s400 = await stamp("400", 50, 30, 1939);
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1939,
        name: "Wieliczka",
        sortOrder: 0,
        stamps: { create: [{ stampId: s400, sortOrder: 0 }] },
      },
    });

    templateId = (
      await prisma.albumTemplate.create({
        data: { collectionId, name: "Polska A4", ...DEFAULT_ALBUM_PRESET },
      })
    ).id;
    albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Polska", collectionAreaId: areaId, language: "en" },
      templateId
    );
    siblingId = await createAlbum(
      userId,
      collectionId,
      { name: "Polska — duplicate", collectionAreaId: areaId, language: "en" },
      templateId
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

  it("writes this album's own copy, and neither the template nor its other album moves", async () => {
    await updateAlbumPreset(userId, albumId, withValues({ boxGapXMm: 3, labelPosition: "above" }));

    const album = await getAlbum(userId, albumId);
    assert.equal(album?.boxGapXMm, 3);
    assert.equal(album?.labelPosition, "above");

    const template = await prisma.albumTemplate.findUniqueOrThrow({ where: { id: templateId } });
    assert.deepEqual(
      albumRenderPreset(template as unknown as AlbumRenderPreset),
      DEFAULT_ALBUM_PRESET
    );
    const sibling = await getAlbum(userId, siblingId);
    assert.deepEqual(albumRenderPreset(sibling!), DEFAULT_ALBUM_PRESET);

    // Its identity is not a template value, and a whole album row handed in cannot write it.
    assert.equal(album?.name, "Polska");

    await updateAlbumPreset(userId, albumId, DEFAULT_ALBUM_PRESET);
  });

  it("re-plans the live pages under the new values — a layout input, not a drawing setting", async () => {
    const before = (await livePages()).pages.length;
    assert.equal(before, 2, "one sheet per chapter on A4");

    await updateAlbumPreset(userId, albumId, withValues({ pageHeightMm: 110 }));
    const after = (await livePages()).pages.length;
    assert.ok(after > before, `a short page needs more sheets (was ${before}, now ${after})`);

    await updateAlbumPreset(userId, albumId, DEFAULT_ALBUM_PRESET);
    assert.equal((await livePages()).pages.length, before);
  });

  it("counts only the printed sheets that match today, and a card keeps what it was set under", async () => {
    const overview = await livePages();
    const positions = overview.pages.map((_, i) => i + 1);
    await markAlbumPagesPrinted(userId, albumId, positions, overview.fingerprint);
    const printed = (await getAlbumPrintedReport(userId, albumId)).sheets;
    assert.equal(printed.length, 2);
    assert.deepEqual(printed.flatMap((s) => s.divergences), [], "freshly printed cards match");

    // Nothing changes, nothing is counted.
    assert.equal(await countAlbumPresetDivergence(userId, albumId, DEFAULT_ALBUM_PRESET), 0);

    const wider = withValues({ marginLeftMm: 15 });
    assert.equal(await countAlbumPresetDivergence(userId, albumId, wider), 2);
    // Counting writes nothing.
    assert.equal((await getAlbum(userId, albumId))?.marginLeftMm, DEFAULT_ALBUM_PRESET.marginLeftMm);

    await updateAlbumPreset(userId, albumId, wider);
    const report = (await getAlbumPrintedReport(userId, albumId)).sheets;
    assert.equal(report.length, 2);
    for (const sheet of report) {
      assert.ok(
        sheet.divergences.some((d) => d.kind === "template"),
        `every card reports the change: ${JSON.stringify(sheet.divergences)}`
      );
    }
    const snapshots = await getAlbumPageSnapshots(albumId, report.map((s) => s.id));
    for (const snapshot of snapshots.values()) {
      assert.equal(snapshot.preset.marginLeftMm, DEFAULT_ALBUM_PRESET.marginLeftMm);
    }

    // Already out of date, so a further change marks nothing out of date for the first time …
    assert.equal(
      await countAlbumPresetDivergence(userId, albumId, withValues({ marginLeftMm: 20 })),
      0
    );
    // … and a change back to the printed values brings the cards into line rather than out of it.
    assert.equal(await countAlbumPresetDivergence(userId, albumId, DEFAULT_ALBUM_PRESET), 0);
    await updateAlbumPreset(userId, albumId, DEFAULT_ALBUM_PRESET);
    assert.deepEqual(
      (await getAlbumPrintedReport(userId, albumId)).sheets.flatMap((s) => s.divergences),
      []
    );
  });
});
