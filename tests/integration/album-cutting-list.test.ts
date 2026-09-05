import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createAlbum, gatherAlbumEntries } from "../../src/lib/albums";
import { albumPlanOverview, planAlbum } from "../../src/lib/album-plan";
import { markAlbumPagesPrinted } from "../../src/lib/album-printing";
import { getAlbumCuttingList } from "../../src/lib/album-cutting";

// The hawid cutting list (#770), end to end.
//
// `tests/unit/album-cutting-list.test.ts` pins the arithmetic on plain values. What needs a database
// is the half that reads: that a live sheet's boxes come out of the drawer as it stands, that a
// **printed** card's come out of its stored snapshot and stay put when the drawer changes, and that
// two checklists claiming one stamp really do reach this list as two boxes.
//
// The shapes are constructed deliberately, per `docs/agents/albums.md`: every bug this track has
// shipped needed an input ordinary material does not produce.

const ts = Date.now();

describe("the hawid cutting list (#770)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let albumId: string;
  let twoListsAlbumId: string;
  let strip29: string;

  before(async () => {
    userId = `test-user-cutting-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User cutting-${ts}`,
        email: `test-cutting-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-cutting-${ts}`,
          name: "Cutting",
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
    // Two heights and nothing taller than 40 mm, so a souvenir sheet has nowhere to go and is a
    // pocket — the oversize case is an answer, not an error (#765).
    strip29 = (
      await prisma.hawidStrip.create({
        data: { collectionId, heightMm: 29, stockLengthMm: 210, label: "Hawid 264", sortOrder: 0 },
      })
    ).id;
    await prisma.hawidStrip.create({
      data: { collectionId, heightMm: 40, stockLengthMm: 210, sortOrder: 1 },
    });

    const issue = async (year: number, name: string, sortKey: string) =>
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

    const stamp = async (number: string, w: number | null, h: number | null, year: number) =>
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

    // ── The main album: three ordinary stamps, one souvenir sheet, one nobody has measured.
    const issue1938 = await issue(1938, "Mościcki", "0000000303");
    const s303 = await stamp("303", 26, 25, 1938);
    const s304 = await stamp("304", 26, 25, 1938);
    const s305 = await stamp("305", 40, 25, 1938);
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1938,
        name: "Mościcki set",
        sortOrder: 0,
        stamps: {
          create: [s303, s304, s305].map((stampId, i) => ({ stampId, sortOrder: i })),
        },
      },
    });

    // A souvenir sheet: 100 × 90 needs 94 mm of strip and the drawer's tallest is 40.
    const issue1939 = await issue(1939, "Blok", "0000000400");
    const s400 = await stamp("400", 100, 90, 1939);
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1939,
        name: "Blok",
        sortOrder: 0,
        stamps: { create: [{ stampId: s400, sortOrder: 0 }] },
      },
    });

    // A checklist nothing on which has ever been measured. Its box is the clearances and nothing
    // else, and the rule finds that box a strip — which is exactly why it must not read as a cut.
    const issue1940 = await issue(1940, "Nieznane", "0000000500");
    const s500 = await stamp("500", null, null, 1940);
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1940,
        name: "Nieznane",
        sortOrder: 0,
        stamps: { create: [{ stampId: s500, sortOrder: 0 }] },
      },
    });

    albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Polska", collectionAreaId: areaId, language: "en" },
      null
    );
    await gatherAlbumEntries(userId, albumId);

    // ── A second album for the rule this list turns on: **one stamp on two checklists of one
    // issue** — basic and specialized (ADR-0031) — which an album gathers both of from the same
    // area. Two boxes on the card, two hawids, two cuts.
    const issue1945 = await issue(1945, "Dwie listy", "0000000600");
    const s600 = await stamp("600", 26, 25, 1945);
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1945,
        name: "Basic",
        sortOrder: 0,
        stamps: { create: [{ stampId: s600, sortOrder: 0 }] },
      },
    });
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1945,
        name: "Specialized",
        sortOrder: 1,
        stamps: { create: [{ stampId: s600, sortOrder: 0 }] },
      },
    });
    twoListsAlbumId = await createAlbum(
      userId,
      collectionId,
      { name: "Dwie listy", collectionAreaId: areaId, language: "en" },
      null
    );
    await prisma.albumEntry.deleteMany({
      where: { albumId: twoListsAlbumId, checklist: { issueId: { not: issue1945 } } },
    });
  });

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

  const cuttingList = async (id: string) => {
    const result = await getAlbumCuttingList(userId, id);
    assert.ok(result);
    return result!;
  };

  it("states the cut a box is, from the strip the box rule chose", async () => {
    const { list } = await cuttingList(albumId);
    // The 1938 chapter: 26 × 25 twice and 40 × 25 once, plus the template's 4 mm each way — so
    // 30 mm twice and 44 mm once, all off the 29 mm strip. The pair collapses to one line.
    const sheet = list.sheets[0];
    assert.deepEqual(
      sheet.cuts.map((c) => [c.strip.heightMm, c.widthMm, c.count]),
      [
        [29, 30, 2],
        [29, 44, 1],
      ]
    );
    assert.equal(sheet.cuts[0].strip.label, "Hawid 264");
  });

  it("puts a souvenir sheet in a pocket and an unmeasured stamp beside it, for different reasons", async () => {
    const { list } = await cuttingList(albumId);
    const uncut = list.sheets.flatMap((s) => s.uncut);
    assert.deepEqual(
      uncut.map((b) => b.reason).sort(),
      ["oversize", "unmeasured"]
    );

    const pocket = uncut.find((b) => b.reason === "oversize")!;
    assert.deepEqual([pocket.widthMm, pocket.heightMm], [104, 94]);

    // The one that could pass for an ordinary instruction. The rule really does find the degenerate
    // box the 29 mm strip; nothing in the album's cuts asks for it.
    assert.ok(
      list.sheets.every((s) => s.cuts.every((c) => c.widthMm > 10)),
      "an unmeasured stamp must not reach the cuts as a 4 mm piece"
    );
  });

  it("counts slots, never stamps: one stamp on two checklists is two cuts", async () => {
    // The fact ADR-0047 §2 generalises past the printed-page index specifically for this list. A
    // list that counted stamps would say one hawid, and the collector would find out at the desk
    // with the card already in front of him.
    const { list } = await cuttingList(twoListsAlbumId);
    const sheet = list.sheets[0];
    // Two blocks on one card, headed by the album's own checklist template.
    assert.deepEqual(sheet.headings, ["1945. Basic", "1945. Specialized"]);
    assert.equal(sheet.boxCount, 2);
    assert.deepEqual(
      sheet.cuts.map((c) => [c.widthMm, c.count]),
      [[30, 2]]
    );
    assert.deepEqual(
      list.toCut.byStrip.map((d) => [d.strip.heightMm, d.pieces, d.totalWidthMm, d.strips]),
      [[29, 2, 60, 1]]
    );
  });

  it("asks for nothing once every sheet is on paper, and still lists each card's own cuts", async () => {
    // ADR-0047 §4's family arriving through this door: an album with every page printed has its
    // hawid cut and stuck down, so a shopping list totalling those cards would be asking for
    // material already spent. The cards are still described — marking printed and mounting are two
    // moments — but their demand is never summed into the shopping list.
    const before = await cuttingList(twoListsAlbumId);
    assert.equal(before.list.toCut.byStrip.length, 1);

    const plan = await planAlbum(userId, twoListsAlbumId);
    assert.ok(plan);
    const overview = albumPlanOverview(plan!);
    await markAlbumPagesPrinted(
      userId,
      twoListsAlbumId,
      overview.pages.map((_, i) => i + 1),
      overview.fingerprint
    );

    const { list } = await cuttingList(twoListsAlbumId);
    assert.deepEqual(list.toCut.byStrip, []);
    assert.equal(list.toCut.sheetCount, 0);
    assert.equal(list.toCut.boxCount, 0);
    assert.deepEqual(
      list.onPaper.byStrip.map((d) => [d.strip.heightMm, d.pieces, d.strips]),
      [[29, 2, 1]]
    );
    assert.equal(list.sheets.length, 1);
    assert.equal(list.sheets[0].printedPageId !== null, true);
    assert.deepEqual(
      list.sheets[0].cuts.map((c) => [c.widthMm, c.count]),
      [[30, 2]]
    );
  });

  it("reads a printed card's cuts from its snapshot, so the drawer changing does not move them", async () => {
    // The strip is **copied** into the snapshot, not referenced (ADR-0047 §1): the stock is the one
    // part of an album read live, and a drawer changes. The box on the paper is 29 mm tall whatever
    // the drawer holds now — including nothing.
    await prisma.hawidStrip.delete({ where: { id: strip29 } });
    try {
      const { list, emptyStock } = await cuttingList(twoListsAlbumId);
      assert.equal(emptyStock, false, "the 40 mm strip is still in the drawer");
      assert.deepEqual(
        list.onPaper.byStrip.map((d) => [d.strip.heightMm, d.strip.stockLengthMm, d.pieces]),
        [[29, 210, 2]]
      );
      assert.equal(list.sheets[0].cuts[0].strip.label, "Hawid 264");
      // Still 29 mm, not remapped up to the 40 mm strip that would also fit — and flagged, because
      // it is a line the collector can no longer act on.
      assert.equal(list.onPaper.byStrip[0].inStock, false);
    } finally {
      await prisma.hawidStrip.create({
        data: {
          id: strip29,
          collectionId,
          heightMm: 29,
          stockLengthMm: 210,
          label: "Hawid 264",
          sortOrder: 0,
        },
      });
    }
  });
});
