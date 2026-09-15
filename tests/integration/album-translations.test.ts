import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createAlbum,
  dismissAlbumNameSuggestion,
  getAlbum,
  renameAlbum,
  updateAlbumPreset,
} from "../../src/lib/albums";
import { albumPlanOverview, planAlbum } from "../../src/lib/album-plan";
import { getAlbumEditorData, type AlbumEditorSheet } from "../../src/lib/album-editor";
import {
  countAlbumRenameDivergence,
  getAlbumPrintedReport,
  markAlbumPagesPrinted,
} from "../../src/lib/album-printing";
import { getChecklistsForIssue, renameChecklist } from "../../src/lib/checklists";
import { saveEntityTranslation } from "../../src/lib/entity-translations";
import { DEFAULT_ALBUM_PRESET } from "../../src/lib/album-template-rules";

// An album printed in a language of its own (#1308, #1311).
//
// #1308 — the page editor flags every text that would print in the collection's default language,
// names the row a translation would be written on, and the flag goes once the translation exists:
//
// - a **checklist heading** through `{checklistName}`, against the issue while the checklist is still
//   named after it and against the checklist once it is named by hand;
// - a **box label** and a **footer** through entity tokens;
// - the **running head**, when the album is still called by its area's default-language name;
// - and the count across the whole album, not only the sheet in view.
//
// #1311 — once the area has a name in the album's language, an album still carrying the default one
// is offered it: renamed only on acceptance, told first how many printed cards will diverge, and a
// turned-down offer stays away until the translation changes.

const ts = Date.now();

describe("an album in its own language (#1308, #1311)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let albumId: string;
  let issue1938: string;
  let issue1939: string;
  let stampIds: string[];
  let handNamedChecklistId: string;

  /** Every live sheet of the album, as the page editor draws each. */
  const liveSheets = async (id = albumId): Promise<AlbumEditorSheet[]> => {
    const first = await getAlbumEditorData(userId, id, 1);
    assert.ok(first);
    const out: AlbumEditorSheet[] = [];
    for (const row of first!.sheets) {
      const data = await getAlbumEditorData(userId, id, row.position);
      if (data?.sheet && !data.sheet.readOnly) out.push(data.sheet);
    }
    return out;
  };
  const headingWith = (sheets: AlbumEditorSheet[], text: string) =>
    sheets.flatMap((s) => s.headings).find((h) => h.lines.join(" ").includes(text));

  before(async () => {
    userId = `test-user-album-lang-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User album-lang-${ts}`,
        email: `test-album-lang-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-album-lang-${ts}`,
          name: "Album language",
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
      data: [{ collectionId, heightMm: 40, stockLengthMm: 210, sortOrder: 0 }],
    });

    const issue = async (year: number, name: string, sortKey: string) =>
      (
        await prisma.issue.create({
          data: {
            collectionId,
            issueNo: year,
            collectionAreaId: areaId,
            name,
            year,
            primaryCatalogSortKey: sortKey,
          },
        })
      ).id;
    const stamp = async (number: string, name: string, year: number) =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name,
            issuedYear: year,
            widthMm: 26,
            heightMm: 30,
            primaryCatalogSortKey: number.padStart(10, "0"),
            catalogNumbers: { create: [{ catalogVendorId: vendor.id, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;

    issue1938 = await issue(1938, "Constitution", "0000000300");
    issue1939 = await issue(1939, "Harbour", "0000000400");
    stampIds = [
      await stamp("300", "Mercury", 1938),
      await stamp("301", "Mercury", 1938),
      await stamp("400", "Harbour view", 1939),
    ];
    // Named after its issue, as `ensureIssueChecklist` names one.
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1938,
        name: "Constitution",
        stamps: { create: stampIds.slice(0, 2).map((stampId, i) => ({ stampId, sortOrder: i })) },
      },
    });
    // Named by hand: nothing to borrow from the issue.
    handNamedChecklistId = (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId: issue1939,
          name: "Imperforate",
          stamps: { create: [{ stampId: stampIds[2], sortOrder: 0 }] },
        },
      })
    ).id;

    const templateId = (
      await prisma.albumTemplate.create({
        data: {
          collectionId,
          name: "Language",
          ...DEFAULT_ALBUM_PRESET,
          checklistTemplate: "{year}. {checklistName}",
          boxLabelTemplate: "{name}",
          footerTemplate: "{pageRange} {area}",
        },
      })
    ).id;
    // Named after the area in the default language, which is what #797 suggests while the area has
    // no Polish name.
    albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Poland", collectionAreaId: areaId, language: "pl" },
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

  it("flags a heading, a box label, the footer and the running head, each against the row that fixes it", async () => {
    const sheets = await liveSheets();
    assert.ok(sheets.length > 0);

    const constitution = headingWith(sheets, "Constitution");
    assert.ok(constitution, "the issue-named checklist's heading is drawn");
    assert.deepEqual(
      constitution!.gaps.map((g) => [g.entityType, g.entityId, g.entityField]),
      [["issue", issue1938, "name"]],
      "a checklist still named after its issue reports against the issue"
    );

    const imperforate = headingWith(sheets, "Imperforate");
    assert.deepEqual(
      imperforate!.gaps.map((g) => [g.entityType, g.entityId]),
      [["checklist", handNamedChecklistId]],
      "a checklist named by hand reports against itself"
    );

    const label = sheets.flatMap((s) => s.boxes).find((b) => b.stampId === stampIds[0])!.label;
    assert.deepEqual(
      label!.gaps.map((g) => [g.entityType, g.entityId]),
      [["stamp", stampIds[0]]]
    );

    for (const sheet of sheets) {
      assert.deepEqual(
        sheet.footer!.gaps.map((g) => [g.entityType, g.entityId, g.entityField]),
        [["area", areaId, "titleName"]],
        "the footer's {area} falls back"
      );
      assert.deepEqual(
        sheet.title!.gaps.map((g) => [g.entityType, g.entityId, g.entityField]),
        [["area", areaId, "titleName"]],
        "the running head is the area's default-language name"
      );
    }
  });

  it("counts the untranslated texts across every sheet, not only the one in view", async () => {
    const sheets = await liveSheets();
    const expected = sheets.map(
      (s) =>
        [s.title, s.chapter, s.footer, ...s.headings, ...s.boxes.map((b) => b.label)].filter(
          (t) => t && t.gaps.length > 0
        ).length
    );
    const data = await getAlbumEditorData(userId, albumId, 1);
    assert.equal(
      data!.untranslated.texts,
      expected.reduce((a, b) => a + b, 0)
    );
    assert.deepEqual(
      data!.untranslated.sheets,
      sheets.map((s) => s.position),
      "every sheet carries something untranslated here, and each is listed"
    );
    // Running head, two headings, three labels and a footer per sheet at the least.
    assert.ok(data!.untranslated.texts >= 6 + sheets.length);
  });

  it("an issue-named checklist prints the issue's translation, and the flag goes", async () => {
    await saveEntityTranslation(userId, collectionId, {
      entityType: "issue",
      entityId: issue1938,
      entityField: "name",
      language: "pl",
      value: "Konstytucja",
    });
    const sheets = await liveSheets();
    const heading = headingWith(sheets, "Konstytucja");
    assert.ok(heading, "the heading is drawn in the album's language");
    assert.deepEqual(heading!.gaps, []);
    assert.equal(headingWith(sheets, "Constitution"), undefined);
  });

  it("a checklist named by hand is translated on itself, in place or from its own dialog", async () => {
    await saveEntityTranslation(userId, collectionId, {
      entityType: "checklist",
      entityId: handNamedChecklistId,
      entityField: "name",
      language: "pl",
      value: "Nieząbkowane",
    });
    let heading = headingWith(await liveSheets(), "Nieząbkowane");
    assert.ok(heading);
    assert.deepEqual(heading!.gaps, []);

    // The Rename dialog writes the languages it carries and leaves the others.
    await renameChecklist(userId, handNamedChecklistId, "Imperforate", {
      de: { name: "Ungezähnt" },
    });
    const [row] = await getChecklistsForIssue(userId, collectionId, issue1939);
    assert.deepEqual(row.nameByLanguage, { pl: "Nieząbkowane", de: "Ungezähnt" });

    // A blank clears the language back to the default, and the flag returns.
    await renameChecklist(userId, handNamedChecklistId, "Imperforate", { pl: { name: "" } });
    heading = headingWith(await liveSheets(), "Imperforate");
    assert.equal(heading!.gaps[0]?.entityType, "checklist");
    await renameChecklist(userId, handNamedChecklistId, "Imperforate", {
      pl: { name: "Nieząbkowane" },
    });
  });

  it("offers the area's Polish name once it exists, renames only on acceptance, and counts the cards first", async () => {
    // The footer stops naming the area, so that what a printed card reports below is the name alone.
    const album = await getAlbum(userId, albumId);
    await updateAlbumPreset(userId, albumId, { ...album!, footerTemplate: "{pageRange}" });
    for (const stampId of stampIds.slice(0, 2)) {
      await saveEntityTranslation(userId, collectionId, {
        entityType: "stamp",
        entityId: stampId,
        entityField: "name",
        language: "pl",
        value: "Merkury",
      });
    }
    assert.equal((await planAlbum(userId, albumId))!.nameSuggestion, null, "nothing to offer yet");

    const plan = await planAlbum(userId, albumId);
    const overview = albumPlanOverview(plan!);
    await markAlbumPagesPrinted(
      userId,
      albumId,
      overview.pages.map((_, i) => i + 1),
      overview.fingerprint
    );
    const printedCount = (await getAlbumPrintedReport(userId, albumId)).sheets.length;
    assert.ok(printedCount > 0);

    await saveEntityTranslation(userId, collectionId, {
      entityType: "area",
      entityId: areaId,
      entityField: "titleName",
      language: "pl",
      value: "Polska",
    });
    const offered = await planAlbum(userId, albumId);
    assert.equal(offered!.nameSuggestion, "Polska");
    assert.equal(offered!.album.name, "Poland", "a translation does not rename the album");
    assert.deepEqual(
      (await getAlbumPrintedReport(userId, albumId)).sheets.flatMap((s) => s.divergences),
      [],
      "the cards still match: the running head is the album's name, which has not moved"
    );

    assert.equal(await countAlbumRenameDivergence(userId, albumId, "Polska"), printedCount);
    assert.equal((await getAlbum(userId, albumId))!.name, "Poland", "counting writes nothing");

    await renameAlbum(userId, albumId, "Polska");
    const renamed = await planAlbum(userId, albumId);
    assert.equal(renamed!.nameSuggestion, null);
    const report = await getAlbumPrintedReport(userId, albumId);
    for (const sheet of report.sheets) {
      assert.ok(
        sheet.divergences.some((d) => d.kind === "text" && d.detail.includes("Polska")),
        "each card stays as printed and reports the new running head"
      );
    }
  });

  it("offers nothing to a name the collector wrote, or in the collection's own language", async () => {
    const own = await createAlbum(
      userId,
      collectionId,
      { name: "My binder", collectionAreaId: areaId, language: "pl" },
      null
    );
    assert.equal((await planAlbum(userId, own))!.nameSuggestion, null);
    const english = await createAlbum(
      userId,
      collectionId,
      { name: "Poland", collectionAreaId: areaId, language: "en" },
      null
    );
    assert.equal((await planAlbum(userId, english))!.nameSuggestion, null);
    const data = await getAlbumEditorData(userId, english, 1);
    assert.equal(data!.untranslated.texts, 0, "nothing falls back in the default language");
    await prisma.album.deleteMany({ where: { id: { in: [own, english] } } });
  });

  it("keeps a turned-down offer away until the area's Polish name changes", async () => {
    const other = await createAlbum(
      userId,
      collectionId,
      { name: "Poland", collectionAreaId: areaId, language: "pl" },
      null
    );
    assert.equal((await planAlbum(userId, other))!.nameSuggestion, "Polska");

    await dismissAlbumNameSuggestion(userId, other, "Polska");
    assert.equal((await planAlbum(userId, other))!.nameSuggestion, null);
    assert.equal((await getAlbum(userId, other))!.name, "Poland");

    await saveEntityTranslation(userId, collectionId, {
      entityType: "area",
      entityId: areaId,
      entityField: "titleName",
      language: "pl",
      value: "Rzeczpospolita Polska",
    });
    assert.equal((await planAlbum(userId, other))!.nameSuggestion, "Rzeczpospolita Polska");
  });
});
