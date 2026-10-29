import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  countAttachableAmong,
  listAttachableCopies,
  type AttachableCopiesQuery,
  type AttachableCopy,
} from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { areaRailOrder, sortAttachableCopies } from "../../src/lib/attach-picker-sort";
import { copyMatchesSearch } from "../../src/lib/copy-search";
import { NO_LOCATION } from "../../src/lib/location-groups";

// The Attach existing copies picker reads its list a page at a time, with every filter, the year,
// the search and the sort applied where the copies are read (#2179). The rows and their order must
// be what the dialog produced when it held every copy and narrowed them itself.

describe("listAttachableCopies — filtered, ordered and paged where it reads (#2179)", () => {
  let userId: string;
  let collectionId: string;
  let lotId: string;
  let otherLotId: string;
  let mintId: string;
  let usedId: string;
  let certId: string;
  let pairId: string;
  let areaIds: { europe: string; poland: string; germany: string };
  let locationIds: { box: string; stockbook: string };
  const COUNT = 120;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-attach-paging-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User attach-paging-${ts}`,
        email: `test-attach-paging-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-attach-paging-${ts}`,
          name: `Collection attach-paging-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    const europe = await prisma.collectionArea.create({
      data: { collectionId, name: "Europe", sortOrder: 0 },
    });
    const germany = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany", parentId: europe.id, sortOrder: 0 },
    });
    const poland = await prisma.collectionArea.create({
      data: { collectionId, name: "Poland", parentId: europe.id, sortOrder: 1 },
    });
    areaIds = { europe: europe.id, poland: poland.id, germany: germany.id };
    mintId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint", abbreviation: "M", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;
    certId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Attest", abbreviation: "A", sortOrder: 0 },
      })
    ).id;
    pairId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Pair", abbreviation: "P", sortOrder: 0 },
      })
    ).id;

    // A box holding copies of its own, with a stockbook nested inside it (#2209).
    const box = await prisma.location.create({ data: { collectionId, name: "Box", code: "BOX" } });
    const stockbook = await prisma.location.create({
      data: { collectionId, name: "Stockbook", code: "SB", parentId: box.id },
    });
    locationIds = { box: box.id, stockbook: stockbook.id };

    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    lotId = (
      await prisma.purchaseLot.create({
        data: { purchaseId: purchase.id, title: "Target", price: "10.00", status: "open" },
      })
    ).id;
    otherLotId = (
      await prisma.purchaseLot.create({
        data: { purchaseId: purchase.id, title: "Other", price: "5.00", status: "open" },
      })
    ).id;

    const issue = await prisma.issue.create({
      data: {
        collectionId,
        issueNo: 1,
        collectionAreaId: poland.id,
        name: "Definitives",
        year: 1950,
        primaryCatalogSortKey: "0000000100",
      },
    });

    // Copies spread over every axis the picker narrows by, created in an order unrelated to any
    // sort, so a page cut in the wrong place shows.
    for (let i = 0; i < COUNT; i++) {
      const area = [poland, germany, europe][i % 3];
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp ${(i * 37) % COUNT}`,
          issuedYear: i % 7 === 0 ? null : 1950 + (i % 4),
        },
      });
      await prisma.stampCollectionArea.create({
        data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
      });
      if (i % 5 === 0) {
        await prisma.issueMember.create({
          data: { issueId: issue.id, stampId: stamp.id, sortOrder: (i * 13) % 11 },
        });
      }
      await prisma.item.create({
        data: {
          collectionId,
          itemNo: 1000 + ((i * 53) % COUNT),
          stampId: stamp.id,
          conditionId: i % 2 === 0 ? mintId : usedId,
          certificateStatusId: i % 4 === 0 ? certId : null,
          formatId: i % 6 === 0 ? pairId : null,
          lotId: i % 3 === 0 ? otherLotId : null,
          inCollection: i % 3 !== 1,
          forSale: i % 4 === 1 || i % 4 === 2,
          forTrade: i % 5 === 2,
          deliveryState: "delivered",
          locationId: [null, box.id, stockbook.id][i % 3 === 0 ? 0 : i % 5 === 0 ? 1 : 2],
          locationRef: i === 7 ? "Shelf Q9" : null,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, (i * 29) % COUNT)),
        },
      });
    }
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const everything = async (query: AttachableCopiesQuery) =>
    (await listAttachableCopies(userId, lotId, query, { pageSize: 100_000 })).items;

  /** Every page in turn, as the dialog scrolls through them. */
  async function scrolled(query: AttachableCopiesQuery) {
    const rows: AttachableCopy[] = [];
    let offset = 0;
    for (;;) {
      const page = await listAttachableCopies(userId, lotId, query, { offset });
      rows.push(...page.items);
      if (page.nextCursor === null) return { rows, total: page.total };
      assert.equal(page.items.length, 50, "a page is full until the last");
      offset = Number(page.nextCursor);
    }
  }

  it("loads a page at a time, and the pages together are the whole list in order", async () => {
    const first = await listAttachableCopies(userId, lotId, {});
    assert.equal(first.items.length, 50);
    assert.equal(first.nextCursor, "50");
    assert.equal(first.total, COUNT);
    const { rows, total } = await scrolled({});
    assert.equal(total, COUNT);
    assert.deepEqual(
      rows.map((r) => r.id),
      (await everything({})).map((r) => r.id)
    );
  });

  it("orders every key both ways as the dialog's sort did over the whole list", async () => {
    const all = await everything({});
    // The rail as the dialog drew it: the tree `getCollectionAreas` hands the page.
    const areas = await prisma.collectionArea.findMany({
      where: { collectionId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, parentId: true },
    });
    const rail = areaRailOrder(areas);
    for (const sortBy of ["catalogue", "copyNo", "added", "value"] as const) {
      for (const sortDir of ["asc", "desc"] as const) {
        const expected = sortAttachableCopies(all, sortBy, sortDir, rail).map((r) => r.id);
        const { rows } = await scrolled({ sortBy, sortDir });
        assert.deepEqual(
          rows.map((r) => r.id),
          expected,
          `${sortBy} ${sortDir}`
        );
      }
    }
  });

  it("narrows by condition, certificate, format, purchase and disposition as the dialog's filters did", async () => {
    const all = await everything({});
    const ids = (rows: AttachableCopy[]) => rows.map((r) => r.id).sort();
    const cases: [AttachableCopiesQuery, (c: AttachableCopy) => boolean][] = [
      [{ conditionIds: [usedId] }, (c) => c.conditionId === usedId],
      [{ certificateStatusIds: ["none"] }, (c) => c.certificateStatusId === null],
      [{ certificateStatusIds: ["none", certId] }, () => true],
      [{ formatIds: ["single"] }, (c) => c.formatId === null],
      [{ formatIds: [pairId] }, (c) => c.formatId === pairId],
      [{ purchase: ["on"] }, (c) => c.purchase !== null],
      [{ purchase: ["none"] }, (c) => c.purchase === null],
      [{ purchase: ["none", "on"] }, () => true],
      // Disposition (#2180): each ticked mark must be carried, as on the Copies list (#846).
      [{ dispositions: ["forSale"] }, (c) => c.forSale],
      [{ dispositions: ["inCollection"] }, (c) => c.inCollection],
      [{ dispositions: ["forSale", "forTrade"] }, (c) => c.forSale && c.forTrade],
      [
        { dispositions: ["forTrade"], conditionIds: [mintId] },
        (c) => c.forTrade && c.conditionId === mintId,
      ],
    ];
    for (const [query, keep] of cases) {
      const narrowed = await everything(query);
      assert.ok(narrowed.length > 0, JSON.stringify(query));
      assert.deepEqual(ids(narrowed), ids(all.filter(keep)), JSON.stringify(query));
    }
  });

  it("searches as the picker always has, and counts the year facet over the search", async () => {
    const all = await everything({});
    const target = all[17];
    const byNumber = await everything({ search: `#${target.itemNo}` });
    assert.deepEqual(
      byNumber.map((r) => r.id),
      [target.id]
    );

    const shelf = await everything({ search: "q9" });
    assert.deepEqual(
      shelf.map((r) => r.locationRef),
      ["Shelf Q9"]
    );

    const text = "stamp 1";
    const page = await listAttachableCopies(userId, lotId, { search: text });
    const matching = all.filter((c) => copyMatchesSearch(c, text, () => []));
    assert.equal(page.total, matching.length);
    const facetTotal = page.yearFacets.reduce((sum, f) => sum + f.count, 0);
    assert.equal(facetTotal, matching.length, "the facet counts what the search holds");

    const in1951 = await listAttachableCopies(userId, lotId, { search: text, year: "1951" });
    assert.equal(in1951.total, matching.filter((c) => c.issuedYear === 1951).length);
    assert.deepEqual(in1951.yearFacets, page.yearFacets, "choosing a year leaves the others counted");
    const noYear = await listAttachableCopies(userId, lotId, { year: "none" });
    assert.equal(noYear.total, all.filter((c) => c.issuedYear === null).length);
  });

  it("narrows by location, the nested ones included unless this location only is set (#2209)", async () => {
    const all = await everything({});
    const ids = (rows: AttachableCopy[]) => rows.map((r) => r.id).sort();
    const { box, stockbook } = locationIds;
    const cases: [AttachableCopiesQuery, (c: AttachableCopy) => boolean][] = [
      [{ locationId: box }, (c) => c.locationId === box || c.locationId === stockbook],
      [{ locationId: box, locationExact: true }, (c) => c.locationId === box],
      [{ locationId: stockbook }, (c) => c.locationId === stockbook],
      [{ locationId: NO_LOCATION }, (c) => c.locationId === null],
      [
        { locationId: box, conditionIds: [usedId], search: "stamp 1" },
        (c) =>
          (c.locationId === box || c.locationId === stockbook) &&
          c.conditionId === usedId &&
          copyMatchesSearch(c, "stamp 1", () => []),
      ],
    ];
    for (const [query, keep] of cases) {
      const narrowed = await everything(query);
      assert.ok(narrowed.length > 0, JSON.stringify(query));
      assert.deepEqual(ids(narrowed), ids(all.filter(keep)), JSON.stringify(query));
    }
    // The page's total and the hidden-ticks count follow it as they follow the other filters.
    const inBox = all.filter((c) => c.locationId === box);
    assert.equal(
      (await listAttachableCopies(userId, lotId, { locationId: box, locationExact: true })).total,
      inBox.length
    );
    const ticked = [all.find((c) => c.locationId === box)!, all.find((c) => c.locationId === null)!];
    assert.equal(
      await countAttachableAmong(userId, lotId, { locationId: box }, ticked.map((c) => c.id)),
      1
    );
  });

  it("narrows by the area rail", async () => {
    const all = await everything({});
    const poland = await everything({ areaIds: [areaIds.poland] });
    assert.deepEqual(
      poland.map((r) => r.id).sort(),
      all.filter((c) => c.areaId === areaIds.poland).map((r) => r.id).sort()
    );
  });

  it("counts which ticks the filters hold, whether or not a page has loaded them", async () => {
    const all = await everything({});
    const used = all.filter((c) => c.conditionId === usedId).slice(0, 3);
    const mint = all.filter((c) => c.conditionId === mintId).slice(0, 2);
    const ticked = [...used, ...mint].map((c) => c.id);
    assert.equal(await countAttachableAmong(userId, lotId, { conditionIds: [usedId] }, ticked), 3);
    assert.equal(await countAttachableAmong(userId, lotId, {}, ticked), 5);
    // A disposition hides ticks as every other filter does (#2180).
    const forSale = all.filter((c) => ticked.includes(c.id) && c.forSale).length;
    assert.equal(
      await countAttachableAmong(userId, lotId, { dispositions: ["forSale"] }, ticked),
      forSale
    );
    assert.equal(
      await countAttachableAmong(userId, lotId, { search: `#${used[0].itemNo}` }, ticked),
      1
    );
    assert.equal(await countAttachableAmong(userId, lotId, {}, []), 0);
  });
});
