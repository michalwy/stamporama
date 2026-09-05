import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  addAlbumEntry,
  clearAlbumEntryStampOrder,
  createAlbum,
  gatherAlbumEntries,
  getAlbum,
  getAlbumEntries,
  reorderAlbumEntries,
  setAlbumEntryStampOrder,
  AlbumNameTakenError,
} from "../../src/lib/albums";
import { planAlbum } from "../../src/lib/album-plan";
import { DEFAULT_ALBUM_PRESET } from "../../src/lib/album-template-rules";

// The album, its entries and the page plan (#767).
//
// What is pinned here is everything that only shows up once real rows are involved: that a template
// is **copied** rather than referenced (#308) — the rule the whole model rests on, and the one a
// later "tidy-up" would break silently; that entries are gathered from the area's **subtree** in
// catalog order and that gathering is additive; that a page is named by its **catalog range** and
// never by a number; and that the album's own stamp order overrides the checklist's (#764) without
// dropping a stamp that joined afterwards.

const ts = Date.now();

describe("album plan (#767)", () => {
  let userId: string;
  let collectionId: string;
  let rootAreaId: string;
  let childAreaId: string;
  let templateId: string;
  let albumId: string;
  let checklist1938: string;
  let checklist1939: string;
  let spanningChecklist: string;
  let s303: string, s304: string, s309: string, s400: string;

  before(async () => {
    userId = `test-user-album-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User album-${ts}`,
        email: `test-album-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-album-${ts}`,
          name: "Album",
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "en",
        },
      })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    rootAreaId = (
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
    // A child area, so "gathered from the subtree" is actually exercised rather than assumed.
    childAreaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Second Republic", parentId: rootAreaId },
      })
    ).id;

    // Hawid stock: one 29 mm strip. A 32 mm stamp plus the 4 mm clearance needs 36, so it will not
    // fit — that is the oversize case, deliberately kept in the fixture.
    await prisma.hawidStrip.createMany({
      data: [
        { collectionId, heightMm: 29, stockLengthMm: 210, sortOrder: 0 },
        { collectionId, heightMm: 40, stockLengthMm: 210, sortOrder: 1 },
      ],
    });

    templateId = (
      await prisma.albumTemplate.create({
        data: { collectionId, name: "Polska A4", ...DEFAULT_ALBUM_PRESET },
      })
    ).id;

    const issue = async (year: number, name: string, sortKey: string) =>
      (
        await prisma.issue.create({
          data: {
            collectionId,
            issueNo: Number(`${year}${sortKey.length}`),
            collectionAreaId: childAreaId,
            name,
            year,
            primaryCatalogSortKey: sortKey,
          },
        })
      ).id;
    const issue1938 = await issue(1938, "Mościcki", "0000000303");
    const issue1939 = await issue(1939, "Wieliczka", "0000000400");

    const stamp = async (
      number: string,
      w: number | null,
      h: number | null,
      year: number
    ): Promise<string> =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Stamp ${number}`,
            // `{year}` — the chapter heading's default (#766) — resolves from the **stamp's** own
            // issued year, while the chapter is *grouped* by `Issue.year`. Real stamps carry it, so
            // the fixture does too.
            issuedYear: year,
            widthMm: w,
            heightMm: h,
            primaryCatalogSortKey: number.padStart(10, "0"),
            catalogNumbers: { create: [{ catalogVendorId: vendor.id, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: childAreaId, isPrimary: true }] },
          },
        })
      ).id;
    s303 = await stamp("303", 26, 32, 1938);
    // No size of its own — it must inherit 26 × 32 from its checklist neighbour (#763).
    s304 = await stamp("304", null, null, 1938);
    s309 = await stamp("309", 26, 32, 1938);
    s400 = await stamp("400", 50, 30, 1939);

    checklist1938 = (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId: issue1938,
          name: "Mościcki set",
          sortOrder: 0,
          stamps: { create: [s303, s304, s309].map((stampId, i) => ({ stampId, sortOrder: i })) },
        },
      })
    ).id;
    checklist1939 = (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId: issue1939,
          name: "Wieliczka",
          sortOrder: 0,
          stamps: { create: [{ stampId: s400, sortOrder: 0 }] },
        },
      })
    ).id;
    // A checklist that spans issues: no issue, so no area, so it cannot be gathered (#767).
    spanningChecklist = (
      await prisma.checklist.create({
        data: { collectionId, name: "Across the years", sortOrder: 0 },
      })
    ).id;

    albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Polska", collectionAreaId: rootAreaId, language: "en" },
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

  it("copies the template's values onto the album and links back to nothing", async () => {
    const album = await getAlbum(userId, albumId);
    assert.ok(album);
    assert.equal(album!.pageWidthMm, DEFAULT_ALBUM_PRESET.pageWidthMm);
    assert.equal(album!.checklistTemplate, DEFAULT_ALBUM_PRESET.checklistTemplate);
    // The rule this whole model rests on: no column points at the template it was seeded from.
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'album'`
    );
    assert.ok(
      !columns.some((c) => c.column_name.toLowerCase().includes("template" + "id")),
      "an album must hold a copy of a template, never a reference to one"
    );
  });

  it("editing the template afterwards does not reach the album", async () => {
    await prisma.albumTemplate.update({
      where: { id: templateId },
      data: { pageWidthMm: 148, checklistTemplate: "{checklistName}" },
    });
    const album = await getAlbum(userId, albumId);
    assert.equal(album!.pageWidthMm, DEFAULT_ALBUM_PRESET.pageWidthMm);
    assert.equal(album!.checklistTemplate, DEFAULT_ALBUM_PRESET.checklistTemplate);
  });

  it("gathers the area's subtree in catalog order, and only issue-anchored checklists", async () => {
    const entries = await getAlbumEntries(userId, albumId);
    assert.deepEqual(
      entries.map((e) => e.checklistId),
      [checklist1938, checklist1939],
      "1938 before 1939; the spanning checklist has no area and cannot be gathered"
    );
    assert.deepEqual(
      entries.map((e) => e.year),
      [1938, 1939]
    );
  });

  it("gathers additively and reports how many it added", async () => {
    assert.equal(await gatherAlbumEntries(userId, albumId), 0, "nothing new to find");
    await addAlbumEntry(userId, albumId, spanningChecklist);
    const entries = await getAlbumEntries(userId, albumId);
    assert.equal(entries.length, 3);
    // A hand-added entry survives a gather: an entry is a decision about a card, not a stale row.
    assert.equal(await gatherAlbumEntries(userId, albumId), 0);
    assert.equal((await getAlbumEntries(userId, albumId)).length, 3);
  });

  it("refuses a second album of the same name in its own words", async () => {
    await assert.rejects(
      () =>
        createAlbum(
          userId,
          collectionId,
          { name: "Polska", collectionAreaId: rootAreaId, language: "en" },
          null
        ),
      AlbumNameTakenError
    );
  });

  it("names a page by its catalog range, prefixed by the area", async () => {
    const plan = await planAlbum(userId, albumId);
    assert.ok(plan);
    const first = plan!.pages[0];
    // Both endpoints in full. The one place the album does not use `formatCatalogRange`'s
    // shortening: this range is printed onto a card filed beside ~140 hand-written ones that all
    // write the span out, and a sheet reading `PL 303-09` would announce itself as a stranger.
    assert.equal(first.range, "PL 303-309");
    // The footer is the template's `{pageRange}` — the identity, rendered into the reserved band.
    assert.deepEqual(first.footer?.lines, ["PL 303-309"]);
  });

  it("starts a page per chapter, headed by the year", async () => {
    const plan = await planAlbum(userId, albumId);
    const live = plan!.pages.filter((p) => p.layout.kind === "live");
    assert.ok(live.length >= 2, "1938 and 1939 are two chapters, so two pages at least");
    const chapters = live.map((p) =>
      p.layout.kind === "live" ? (p.layout.chapter?.lines.join(" ") ?? null) : null
    );
    assert.ok(chapters.includes("1938"));
    assert.ok(chapters.includes("1939"));
  });

  it("inherits a size from a checklist neighbour, and says it did", async () => {
    const plan = await planAlbum(userId, albumId);
    const boxes = plan!.pages.flatMap((p) =>
      p.layout.kind === "live" ? p.layout.boxes.map((b) => b.box) : []
    );
    const borrowed = boxes.find((b) => b.stampId === s304);
    assert.ok(borrowed);
    assert.equal(borrowed!.sizeSource, "inherited");
    assert.equal(borrowed!.sizeFromStampId, s303);
    // 26 mm wide plus the template's 4 mm horizontal margin.
    assert.equal(borrowed!.widthMm, 30);
  });

  it("boxes a 32 mm stamp out of the 40 mm strip, not the 29 mm one", async () => {
    const plan = await planAlbum(userId, albumId);
    const boxes = plan!.pages.flatMap((p) =>
      p.layout.kind === "live" ? p.layout.boxes.map((b) => b.box) : []
    );
    const box = boxes.find((b) => b.stampId === s303);
    assert.ok(box);
    // 32 + 4 = 36 mm of strip needed; the shortest in stock that holds it is 40.
    assert.equal(box!.heightMm, 40);
    assert.equal(box!.strip?.heightMm, 40);
  });

  it("prints the entries in the album's own order once it has one", async () => {
    const before = await getAlbumEntries(userId, albumId);
    const reversed = [...before].reverse().map((e) => e.id);
    await reorderAlbumEntries(userId, albumId, reversed);
    const after = await getAlbumEntries(userId, albumId);
    assert.deepEqual(
      after.map((e) => e.id),
      reversed
    );
    assert.deepEqual(
      after.map((e) => e.sortOrder),
      [0, 1, 2],
      "densely renumbered"
    );
    // Put it back so the later cases read against the catalog order.
    await reorderAlbumEntries(userId, albumId, before.map((e) => e.id));
  });

  it("overrides the checklist's stamp order for this album only", async () => {
    const entries = await getAlbumEntries(userId, albumId);
    const entry = entries.find((e) => e.checklistId === checklist1938)!;
    assert.equal(entry.ordersItsOwn, false);
    assert.deepEqual(entry.stampIds, [s303, s304, s309]);

    await setAlbumEntryStampOrder(userId, entry.id, [s309, s303, s304]);
    const overridden = (await getAlbumEntries(userId, albumId)).find(
      (e) => e.checklistId === checklist1938
    )!;
    assert.equal(overridden.ordersItsOwn, true);
    assert.deepEqual(overridden.stampIds, [s309, s303, s304]);

    // The checklist itself is untouched — the override is this album's opinion, not the
    // collection's (#764).
    const rows = await prisma.checklistStamp.findMany({
      where: { checklistId: checklist1938 },
      orderBy: { sortOrder: "asc" },
      select: { stampId: true },
    });
    assert.deepEqual(rows.map((r) => r.stampId), [s303, s304, s309]);

    await clearAlbumEntryStampOrder(userId, entry.id);
    const reset = (await getAlbumEntries(userId, albumId)).find(
      (e) => e.checklistId === checklist1938
    )!;
    assert.equal(reset.ordersItsOwn, false);
    assert.deepEqual(reset.stampIds, [s303, s304, s309]);
  });

  it("re-plans from current data, so a stamp joining a checklist lands on its page", async () => {
    // A live page is a derivation, never stored, so the same read twice is the same plan twice.
    const first = await planAlbum(userId, albumId);
    const again = await planAlbum(userId, albumId);
    assert.deepEqual(
      first!.pages.map((p) => p.range),
      again!.pages.map((p) => p.range)
    );

    const vendor = await prisma.catalogVendor.findFirstOrThrow({ where: { collectionId } });
    const s305 = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: "Stamp 305",
          issuedYear: 1938,
          widthMm: 50,
          heightMm: 30,
          primaryCatalogSortKey: "0000000305",
          catalogNumbers: { create: [{ catalogVendorId: vendor.id, number: "305" }] },
          stampAreaLinks: { create: [{ collectionAreaId: childAreaId, isPrimary: true }] },
        },
      })
    ).id;
    await prisma.checklistStamp.create({
      data: { checklistId: checklist1938, stampId: s305, sortOrder: 3 },
    });

    // Nothing was refreshed and nothing was stored: the next read simply plans the new stamp in.
    const after = await planAlbum(userId, albumId);
    const boxes = after!.pages.flatMap((p) =>
      p.layout.kind === "live" ? p.layout.boxes.map((b) => b.box.stampId) : []
    );
    assert.ok(boxes.includes(s305), "the new stamp has a box");
    // The page's identity is derived from its contents, so it moved with them — 303-309 covers 305
    // already, which is exactly why an insertion disturbs one card and not the whole binder.
    assert.equal(after!.pages[0].range, "PL 303-309");
  });
});
