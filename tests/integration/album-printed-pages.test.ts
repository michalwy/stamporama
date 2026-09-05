import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createAlbum, gatherAlbumEntries, getAlbumEntries } from "../../src/lib/albums";
import { albumPlanOverview, planAlbum } from "../../src/lib/album-plan";
import {
  cancelAlbumReprint,
  closeAlbumContinuation,
  describeAlbumUnprint,
  getAlbumPrintedReport,
  markAlbumPagesPrinted,
  openAlbumContinuation,
  reprintAlbumPage,
  unprintAlbumPage,
  AlbumPrintError,
} from "../../src/lib/album-printing";
import { getAlbumPageSnapshots } from "../../src/lib/album-printed-pages";
import { renderAlbumPdf } from "../../src/lib/album-pdf";
import { DEFAULT_ALBUM_PRESET } from "../../src/lib/album-template-rules";

// Printed pages (#778): the snapshot, the divergence report, and the two answers to a divergence.
//
// **The shapes here are constructed deliberately**, per `docs/agents/albums.md`. Every bug this track
// has shipped was a measurement taken against the wrong reference where the wrong reference is the
// common case, so a suite built from realistic pages stays green over all of them. What is pinned:
//
// - marking is a **deliberate act** — generating a PDF marks nothing;
// - a printed page **draws stored values**, so renaming an issue afterwards does not reach the card;
// - a stamp joining a printed checklist appears **nowhere** until a continuation is opened;
// - a **reprint** keeps the old card until the replacement is marked printed in its turn;
// - a checklist across three sheets goes onto paper **whole or not at all**;
// - an album whose every sheet is printed still renders;
// - a **picture arriving after the fact** ranks below the text and structural changes.

const ts = Date.now();

describe("printed album pages (#778)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let albumId: string;
  let bigAlbumId: string;
  let s303: string, s304: string, s305: string, s400: string;
  let issue1938: string;
  let checklist1938: string;

  /** The album's plan, and the fingerprint the screen would send back with a position in it. */
  const listing = async (id = albumId) => {
    const plan = await planAlbum(userId, id);
    assert.ok(plan);
    return { plan: plan!, overview: albumPlanOverview(plan!) };
  };

  const markAll = async (id = albumId) => {
    const { overview } = await listing(id);
    const live = overview.pages
      .map((p, i) => (p.printedPageId ? null : i + 1))
      .filter((n): n is number => n !== null);
    await markAlbumPagesPrinted(userId, id, live, overview.fingerprint);
  };

  before(async () => {
    userId = `test-user-printed-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User printed-${ts}`,
        email: `test-printed-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-printed-${ts}`,
          name: "Printed",
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
      data: [
        { collectionId, heightMm: 29, stockLengthMm: 210, sortOrder: 0 },
        { collectionId, heightMm: 40, stockLengthMm: 210, sortOrder: 1 },
      ],
    });

    const issue = async (year: number, name: string, sortKey: string) =>
      (
        await prisma.issue.create({
          data: {
            collectionId,
            issueNo: Number(`${year}${sortKey.slice(-2)}`),
            collectionAreaId: areaId,
            name,
            year,
            primaryCatalogSortKey: sortKey,
          },
        })
      ).id;
    issue1938 = await issue(1938, "Mościcki", "0000000303");
    const issue1939 = await issue(1939, "Wieliczka", "0000000400");
    const issue1940 = await issue(1940, "Bloki", "0000000500");

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
    s303 = await stamp("303", 26, 25, 1938);
    s304 = await stamp("304", 26, 25, 1938);
    s305 = await stamp("305", 26, 25, 1938);
    s400 = await stamp("400", 50, 30, 1939);

    checklist1938 = (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId: issue1938,
          name: "Mościcki set",
          sortOrder: 0,
          stamps: { create: [s303, s304].map((stampId, i) => ({ stampId, sortOrder: i })) },
        },
      })
    ).id;
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1939,
        name: "Wieliczka",
        sortOrder: 0,
        stamps: { create: [{ stampId: s400, sortOrder: 0 }] },
      },
    });

    albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Polska", collectionAreaId: areaId, language: "en" },
      null
    );
    await gatherAlbumEntries(userId, albumId);

    // A second album for the split-block case: five souvenir sheets 180 × 80, one per row and two to
    // a card, so the checklist is far taller than a page and runs across **three** cards. Three, not
    // two, is the number that matters — #767's splitter was wrong only from the third sheet on.
    const big: string[] = [];
    for (let n = 0; n < 5; n += 1) {
      big.push(await stamp(String(500 + n), 180, 80, 1940));
    }
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1940,
        name: "Bloki okolicznościowe",
        sortOrder: 0,
        stamps: { create: big.map((stampId, i) => ({ stampId, sortOrder: i })) },
      },
    });
    bigAlbumId = await createAlbum(
      userId,
      collectionId,
      { name: "Bloki", collectionAreaId: areaId, language: "en" },
      null
    );
    // Only the 1940 checklist, so this album is exactly the split block. Creating an album gathers
    // the area's whole subtree, so the rest is taken back out.
    await prisma.albumEntry.deleteMany({
      where: { albumId: bigAlbumId, checklist: { issueId: { not: issue1940 } } },
    });
  });

  after(async () => {
    await prisma.album.deleteMany({ where: { collectionId } });
    await prisma.hawidStrip.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.photo.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("generating a PDF marks nothing — a draft is generated to be looked at", async () => {
    const { plan } = await listing();
    const file = await renderAlbumPdf(plan);
    assert.ok(file.bytes.byteLength > 0);
    assert.equal(await prisma.albumPrintedPage.count({ where: { albumId } }), 0);
  });

  it("refuses a position read from a listing that has since moved", async () => {
    const { overview } = await listing();
    await prisma.checklist.update({
      where: { id: checklist1938 },
      data: { stamps: { create: [{ stampId: s305, sortOrder: 2 }] } },
    });
    await assert.rejects(
      () => markAlbumPagesPrinted(userId, albumId, [1], overview.fingerprint),
      (err: unknown) =>
        err instanceof AlbumPrintError && /means something only against the plan/.test(err.message)
    );
    assert.equal(await prisma.albumPrintedPage.count({ where: { albumId } }), 0);
  });

  it("stores everything that went onto the paper, and an index over it", async () => {
    const { overview } = await listing();
    const { ranges } = await markAlbumPagesPrinted(userId, albumId, [1], overview.fingerprint);
    assert.deepEqual(ranges, ["PL 303-305"]);

    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const snapshot = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    assert.ok(snapshot);
    assert.equal(snapshot!.range, "PL 303-305");
    assert.equal(snapshot!.language, "en");
    // The whole render preset, copied — not a pointer at the album's current columns.
    assert.equal(snapshot!.preset.pageWidthMm, DEFAULT_ALBUM_PRESET.pageWidthMm);
    assert.equal(snapshot!.page.boxes.length, 3);
    // The strip each box was cut from, copied out of the drawer rather than referenced.
    assert.equal(snapshot!.page.boxes[0].box.strip?.heightMm, 29);
    assert.deepEqual(
      snapshot!.page.boxes.map((b) => b.box.catalogNumber),
      ["303", "304", "305"]
    );

    const index = await prisma.albumPrintedPageStamp.findMany({
      where: { albumPrintedPageId: row.id },
      orderBy: { sortOrder: "asc" },
    });
    assert.deepEqual(
      index.map((r) => [r.stampId, r.part, r.sortOrder]),
      [
        [s303, 1, 0],
        [s304, 1, 1],
        [s305, 1, 2],
      ]
    );
  });

  it("steps over the printed sheet and keeps its stored name", async () => {
    const { overview } = await listing();
    assert.equal(overview.pages[0].printedPageId !== null, true);
    assert.equal(overview.pages[0].range, "PL 303-305");
    assert.equal(overview.pages[0].boxCount, 0, "what is on the card is in its snapshot");
  });

  it("does not let a rename reach backwards into the card", async () => {
    await prisma.issue.update({ where: { id: issue1938 }, data: { name: "Ignacy Mościcki" } });
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const snapshot = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id);
    // Whatever the album's texts render to now, the card still reads what it read.
    assert.equal(snapshot!.range, "PL 303-305");
    assert.equal(snapshot!.page.boxes.length, 3);

    // And the file drawn for it is drawn from that, not re-planned: it renders even though the
    // live plan has no sheet there at all.
    const { plan } = await listing();
    const file = await renderAlbumPdf(plan, "1");
    assert.equal(file.pageCount, 1);
  });

  it("says nothing about a card that still matches", async () => {
    // The rename above touches the issue's name, which this album's texts do not print — so there is
    // nothing for the report to say, and it says nothing.
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.equal(report.sheets.length, 1);
    assert.deepEqual(report.sheets[0].divergences, []);
  });

  it("leaves a stamp that joins a printed checklist nowhere, and reports it", async () => {
    const s306 = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: "Stamp 306",
          issuedYear: 1938,
          widthMm: 26,
          heightMm: 25,
          primaryCatalogSortKey: "0000000306",
          catalogNumbers: {
            create: [
              {
                catalogVendorId: (await prisma.catalogVendor.findFirstOrThrow({
                  where: { collectionId },
                })).id,
                number: "306",
              },
            ],
          },
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      })
    ).id;
    await prisma.checklist.update({
      where: { id: checklist1938 },
      data: { stamps: { create: [{ stampId: s306, sortOrder: 3 }] } },
    });

    // Nowhere. The block is on paper, so the planner steps over it whole — inventing a home for the
    // new stamp on the next live sheet would hide the thing the collector needs to be told.
    const { plan } = await listing();
    const liveStamps = plan.pages.flatMap((p) =>
      p.layout.kind === "live" ? p.layout.boxes.map((b) => b.box.stampId) : []
    );
    assert.equal(liveStamps.includes(s306), false);

    const report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(
      report.sheets[0].divergences.map((d) => d.kind),
      ["stamps"]
    );
    assert.match(report.sheets[0].divergences[0].detail, /1 stamp the card does not carry/);
    assert.deepEqual(
      report.sheets[0].entries.map((e) => [e.checklistName, e.waiting, e.continuationOpen]),
      [["Mościcki set", 1, false]]
    );
  });

  it("gives the waiting stamps a continuation sheet of their own, filed after the card", async () => {
    const entries = await getAlbumEntries(userId, albumId);
    const entry = entries.find((e) => e.checklistName === "Mościcki set")!;
    const [card] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    await openAlbumContinuation(userId, entry.id, card.id);

    const { plan, overview } = await listing();
    assert.equal(plan.pages[0].layout.kind, "printed");
    const continuation = plan.pages[1];
    assert.equal(continuation.layout.kind, "live");
    assert.equal(continuation.range, "PL 306");
    assert.deepEqual(
      continuation.layout.kind === "live"
        ? continuation.layout.boxes.map((b) => b.box.catalogNumber)
        : [],
      ["306"]
    );

    // Answered, so the report stops repeating it: saying the same divergence on every read is how a
    // report stops being read.
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.deepEqual(report.sheets[0].divergences, []);
    assert.equal(report.sheets[0].entries[0].continuationOpen, true);

    // And marking it printed clears the flag — the choice is per divergence, not a setting.
    await markAlbumPagesPrinted(userId, albumId, [2], overview.fingerprint);
    const after = await getAlbumEntries(userId, albumId);
    assert.equal(after.find((e) => e.id === entry.id)!.continuesPrintedPageId, null);

    // Two cards now, and neither reports the other's stamps as missing from it.
    const settled = await getAlbumPrintedReport(userId, albumId);
    assert.equal(settled.sheets.length, 2);
    assert.deepEqual(settled.sheets.flatMap((s) => s.divergences), []);
    // The continuation is the checklist's second card, not a second first one.
    const rows = await prisma.albumPrintedPageStamp.findMany({
      where: { albumEntryId: entry.id },
      orderBy: [{ part: "asc" }, { sortOrder: "asc" }],
    });
    assert.deepEqual(
      rows.map((r) => r.part),
      [1, 1, 1, 2]
    );
  });

  it("withdrawing a continuation puts its stamps back to appearing nowhere", async () => {
    // Take the second card away first, so there is something waiting again.
    const cards = await prisma.albumPrintedPage.findMany({
      where: { albumId },
      orderBy: { printedAt: "asc" },
    });
    await unprintAlbumPage(userId, cards[1].id);
    const entries = await getAlbumEntries(userId, albumId);
    const entry = entries.find((e) => e.checklistName === "Mościcki set")!;
    await openAlbumContinuation(userId, entry.id, cards[0].id);
    assert.equal((await listing()).plan.pages.length, 3, "card, continuation, 1939");

    await closeAlbumContinuation(userId, entry.id);
    const { plan } = await listing();
    assert.equal(plan.pages.length, 2, "card, 1939 — the waiting stamp has nowhere to go again");
  });

  it("reports a stamp that has left a printed checklist", async () => {
    const link = await prisma.checklistStamp.findFirstOrThrow({
      where: { checklistId: checklist1938, stampId: s305 },
    });
    await prisma.checklistStamp.delete({
      where: { checklistId_stampId: { checklistId: link.checklistId, stampId: link.stampId } },
    });
    const report = await getAlbumPrintedReport(userId, albumId);
    const stamps = report.sheets[0].divergences.filter((d) => d.kind === "stamps");
    assert.equal(stamps.length, 2, "one gone, one with nowhere to go");
    assert.ok(stamps.some((d) => /no longer in the album/.test(d.detail)));

    // Put it back, so the rest of the file reads from the card as printed.
    await prisma.checklistStamp.create({
      data: { checklistId: checklist1938, stampId: s305, sortOrder: 2 },
    });
  });

  it("reports a stamp whose measured size has changed since the card was cut", async () => {
    await prisma.stamp.update({ where: { id: s303 }, data: { heightMm: 36 } });
    const report = await getAlbumPrintedReport(userId, albumId);
    const size = report.sheets[0].divergences.filter((d) => d.kind === "size");
    assert.equal(size.length, 1);
    assert.match(size[0].detail, /1 box would now be cut to a different size/);

    // The card itself is untouched: it is the height it was cut to.
    const [row] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const snapshot = (await getAlbumPageSnapshots(albumId, [row.id])).get(row.id)!;
    assert.equal(snapshot.page.boxes[0].box.strip?.heightMm, 29);
    await prisma.stamp.update({ where: { id: s303 }, data: { heightMm: 25 } });
  });

  it("ranks a picture that arrived after the fact below the text and structural changes", async () => {
    await prisma.album.update({ where: { id: albumId }, data: { name: "Polska (Mi)" } });
    await prisma.photo.create({
      data: {
        stampId: s304,
        role: "main",
        storageBackend: "filesystem",
        storageKey: `test-printed-${ts}/304`,
        mime: "image/jpeg",
        width: 300,
        height: 400,
        sizeBytes: 1024,
      },
    });
    const report = await getAlbumPrintedReport(userId, albumId);
    const kinds = report.sheets[0].divergences.map((d) => d.kind);
    assert.ok(kinds.includes("photo"));
    assert.equal(kinds[kinds.length - 1], "photo", "a picture never crowds out a rename");
    assert.ok(kinds.indexOf("text") < kinds.indexOf("photo"));
    await prisma.album.update({ where: { id: albumId }, data: { name: "Polska" } });
  });

  it("says what un-printing will throw away before it does it", async () => {
    const [card] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    const said = await describeAlbumUnprint(userId, card.id);
    assert.ok(said.some((line) => /cannot be recovered/.test(line)));
    assert.ok(said.some((line) => /re-planned from current data/.test(line)));
  });

  it("keeps the old card until the reprint is marked printed in its turn", async () => {
    const [card] = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    await reprintAlbumPage(userId, card.id);

    // Back in the live plan, in full — including the stamp that had nowhere to go.
    const { plan } = await listing();
    const liveStamps = plan.pages.flatMap((p) =>
      p.layout.kind === "live" ? p.layout.boxes.map((b) => b.box.catalogNumber) : []
    );
    assert.deepEqual(liveStamps.sort(), ["303", "304", "305", "306", "400"]);
    // And the old card is still on the report, saying a superseded sheet is in the binder.
    const report = await getAlbumPrintedReport(userId, albumId);
    assert.equal(report.sheets.length, 1);
    assert.equal(report.sheets[0].reprinting, true);
    assert.equal(await prisma.albumPrintedPage.count({ where: { albumId } }), 1);

    // Changing one's mind costs nothing, because nothing was thrown away.
    await cancelAlbumReprint(userId, card.id);
    assert.equal((await getAlbumPrintedReport(userId, albumId)).sheets[0].reprinting, false);

    await reprintAlbumPage(userId, card.id);
    const again = await listing();
    const positions = again.overview.pages
      .map((p, i) => (p.printedPageId ? null : i + 1))
      .filter((n): n is number => n !== null);
    await markAlbumPagesPrinted(userId, albumId, positions, again.overview.fingerprint);

    // Replaced only now: the superseded row is gone because every stamp it held is on a new card.
    const settled = await prisma.albumPrintedPage.findMany({ where: { albumId } });
    assert.equal(settled.some((row) => row.id === card.id), false);
    assert.equal(settled.every((row) => row.reprintingAt === null), true);
  });

  it("folds an open continuation away when the card it continues is reprinted", async () => {
    // Two cards claiming the same stamps is what this prevents. The reprint re-plans the entry whole,
    // so the continuation's stamps are back in the parent block and the continuation must not survive
    // beside it — and cancelling has to put both back exactly as they were.
    for (const row of await prisma.albumPrintedPage.findMany({ where: { albumId } })) {
      await unprintAlbumPage(userId, row.id);
    }
    const s307 = await prisma.stamp.create({
      data: {
        collectionId,
        name: "Stamp 307",
        issuedYear: 1938,
        widthMm: 26,
        heightMm: 25,
        primaryCatalogSortKey: "0000000307",
        catalogNumbers: {
          create: [
            {
              catalogVendorId: (await prisma.catalogVendor.findFirstOrThrow({ where: { collectionId } })).id,
              number: "307",
            },
          ],
        },
        stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
      },
    });
    await markAll();
    await prisma.checklist.update({
      where: { id: checklist1938 },
      data: { stamps: { create: [{ stampId: s307.id, sortOrder: 9 }] } },
    });

    const entries = await getAlbumEntries(userId, albumId);
    const entry = entries.find((e) => e.checklistName === "Mościcki set")!;
    const cards = await prisma.albumPrintedPage.findMany({ where: { albumId }, orderBy: { printedAt: "asc" } });
    const parent = cards.find((c) => c.range.startsWith("PL 303"))!;
    await openAlbumContinuation(userId, entry.id, parent.id);
    assert.equal(
      (await listing()).plan.pages.filter((p) => p.layout.kind === "live").length,
      1,
      "the continuation is the one live sheet"
    );

    await reprintAlbumPage(userId, parent.id);
    const during = await listing();
    const liveBlocks = during.plan.pages.flatMap((p) =>
      p.layout.kind === "live" ? p.layout.blocks.filter((b) => b.entryId === entry.id) : []
    );
    assert.equal(liveBlocks.length, 1, "one block for the checklist, not a parent and a continuation");
    const liveStamps = during.plan.pages.flatMap((p) =>
      p.layout.kind === "live" ? p.layout.boxes.map((b) => b.box.catalogNumber) : []
    );
    assert.ok(liveStamps.includes("307") && liveStamps.includes("303"));

    // Nothing sweeps a reprint nobody has finished: the card is still reported as being in the binder.
    assert.equal(
      (await getAlbumPrintedReport(userId, albumId)).sheets.find((sh) => sh.id === parent.id)?.reprinting,
      true
    );

    // Cancelling restores exactly what was there, continuation included.
    await cancelAlbumReprint(userId, parent.id);
    const after = await getAlbumEntries(userId, albumId);
    assert.equal(after.find((e) => e.id === entry.id)!.continuesPrintedPageId, parent.id);

    await closeAlbumContinuation(userId, entry.id);
    for (const row of await prisma.albumPrintedPage.findMany({ where: { albumId } })) {
      await unprintAlbumPage(userId, row.id);
    }
    await markAll();
  });

  it("plans an album whose every sheet is printed as no live pages, and still renders it", async () => {
    const { plan } = await listing();
    assert.ok(plan.pages.length > 0);
    assert.equal(
      plan.pages.every((p) => p.layout.kind === "printed"),
      true
    );
    const file = await renderAlbumPdf(plan);
    assert.equal(file.pageCount, plan.pages.length);
  });

  it("un-printing returns the card's checklists to the live plan", async () => {
    for (const row of await prisma.albumPrintedPage.findMany({ where: { albumId } })) {
      await unprintAlbumPage(userId, row.id);
    }
    const { plan } = await listing();
    assert.equal(
      plan.pages.every((p) => p.layout.kind === "live"),
      true
    );
    const numbers = plan.pages.flatMap((p) =>
      p.layout.kind === "live" ? p.layout.boxes.map((b) => b.box.catalogNumber) : []
    );
    assert.deepEqual(numbers.sort(), ["303", "304", "305", "306", "307", "400"]);
  });

  it("marks a checklist that runs across three sheets whole, or not at all", async () => {
    const { overview } = await listing(bigAlbumId);
    const carrying = overview.pages
      .map((p, i) => (p.boxCount > 0 ? i + 1 : null))
      .filter((n): n is number => n !== null);
    assert.equal(carrying.length, 3, "five souvenir sheets, two to a card");
    // The listing says which sheets go onto paper together rather than leaving the collector to work
    // it out from a refusal.
    assert.deepEqual(overview.pages[carrying[0] - 1].runWith, carrying);

    await assert.rejects(
      () => markAlbumPagesPrinted(userId, bigAlbumId, [carrying[0]], overview.fingerprint),
      (err: unknown) =>
        err instanceof AlbumPrintError &&
        new RegExp(`runs across sheets ${carrying.join(", ")}`).test(err.message)
    );

    await markAlbumPagesPrinted(userId, bigAlbumId, carrying, overview.fingerprint);
    const { plan } = await listing(bigAlbumId);
    assert.equal(
      plan.pages.filter((p) => p.layout.kind === "printed").length,
      3
    );
    // One index run, its parts in printing order — not three rows all claiming to be part one.
    const rows = await prisma.albumPrintedPageStamp.findMany({
      where: { printedPage: { albumId: bigAlbumId } },
      orderBy: [{ part: "asc" }, { sortOrder: "asc" }],
    });
    assert.deepEqual(
      [...new Set(rows.map((r) => r.part))],
      [1, 2, 3]
    );
    // Three sheets, one card: they are joined by one block, so they are re-planned together and
    // none of them reports the others' stamps as missing from it.
    const report = await getAlbumPrintedReport(userId, bigAlbumId);
    assert.equal(report.sheets.length, 3);
    assert.deepEqual(report.sheets.flatMap((s) => s.divergences), []);
  });

  it("prints a stamp that is on two checklists of one sheet as two slots, not one", async () => {
    // A stamp can be on a basic checklist and a specialized one (ADR-0031), and an album gathers both
    // from the same area. Two boxes on the card is two rows in the index; keyed by the stamp alone it
    // would refuse to store the sheet at all.
    const album = await createAlbum(
      userId,
      collectionId,
      { name: "Dwa spisy", collectionAreaId: areaId, language: "en" },
      null
    );
    const second = await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue1938,
        name: "Mościcki specialized",
        sortOrder: 1,
        stamps: { create: [{ stampId: s303, sortOrder: 0 }] },
      },
    });
    await gatherAlbumEntries(userId, album);
    await prisma.albumEntry.deleteMany({
      where: { albumId: album, checklist: { issueId: { not: issue1938 } } },
    });

    const { overview } = await listing(album);
    assert.equal(overview.pages.length, 1, "both checklists fit one sheet");
    await markAlbumPagesPrinted(userId, album, [1], overview.fingerprint);

    const rows = await prisma.albumPrintedPageStamp.findMany({
      where: { stampId: s303, printedPage: { albumId: album } },
    });
    assert.equal(rows.length, 2, "one slot per checklist");
    assert.equal(new Set(rows.map((r) => r.albumEntryId)).size, 2);

    await prisma.album.delete({ where: { id: album } });
    await prisma.checklist.delete({ where: { id: second.id } });
  });

  it("marking all of an album is one gesture, and is idempotent afterwards", async () => {
    await markAll();
    const { overview } = await listing();
    assert.equal(
      overview.pages.every((p) => p.printedPageId !== null),
      true
    );
    await assert.rejects(
      () => markAlbumPagesPrinted(userId, albumId, [1], overview.fingerprint),
      (err: unknown) => err instanceof AlbumPrintError && /already printed/.test(err.message)
    );
  });
});
