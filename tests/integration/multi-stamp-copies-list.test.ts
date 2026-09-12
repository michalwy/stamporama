import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  countItems,
  createItem,
  listIssueGroupCompleteness,
  listItemDuplicateGroups,
  listItemIssueGroups,
  listItemLocationGroups,
  listItemsPaginated,
  listItemYearFacets,
} from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import { createWant } from "../../src/lib/wants";
import { MULTI_STAMP_GROUP_KEY } from "../../src/lib/multi-stamp";

// Multi-stamp copies on the Copies list (#748; ADR-0044 §7) — the one inventory list, so the carriers
// have to be findable there, filterable for and against, named on their rows, and grouped as
// multi-stamp material rather than under the stamp that happens to lead.
//
// One collection, one series of three stamps (Mi 200, 201, 205) on one checklist, one box, and three
// pieces:
//
//   - **a loose single** of Mi 200;
//   - **a one-stamp cover** of Mi 201 — the control: as indivisible as the carrier, and still a copy
//     of its stamp, so it must stay in every group and count the carrier leaves;
//   - **a carrier** franked with Mi 205, Mi 200 twice and Mi 201, **in that order**. Its leading stamp
//     is one the collection holds no ordinary copy of, which is what makes the grouping assertions
//     discriminate: filed under its leading stamp it would conjure a Mi 205 duplicate group and a
//     third owned stamp on the checklist out of nothing.

const ts = Date.now();

describe("multi-stamp copies on the Copies list (#748)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let vendorId: string;
  let conditionId: string;
  let coverId: string;
  let issueId: string;
  let boxId: string;
  let mi200: string, mi201: string, mi205: string;
  let singleId: string, oneStampCoverId: string, carrierId: string;

  before(async () => {
    userId = `test-user-multistamplist-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User multistamplist-${ts}`,
        email: `test-multistamplist-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-multistamplist-${ts}`,
          name: "Covers",
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    const catalog = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Europa", currency: "EUR" },
    });
    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          primaryCatalogNameId: catalog.id,
          collectionAreaCatalogs: { create: [{ catalogNameId: catalog.id }] },
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    coverId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Cover", abbreviation: "cov", sortOrder: 0 },
      })
    ).id;
    boxId = (
      await prisma.location.create({ data: { collectionId, name: "Box", assignable: true } })
    ).id;
    issueId = (
      await prisma.issue.create({
        // Past the collection's counter: this row bypasses `allocateEntityNumber` (#432).
        data: { collectionId, issueNo: 9401, collectionAreaId: areaId, name: "Chopin", year: 1949 },
      })
    ).id;

    const ids: string[] = [];
    for (const [n, year] of [["200", 1949], ["201", 1950], ["205", 1951]] as const) {
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name: `Chopin ${n}`,
          issuedYear: year,
          catalogNumbers: { create: [{ catalogVendorId: vendorId, number: n }] },
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      });
      ids.push(stamp.id);
    }
    [mi200, mi201, mi205] = ids;
    await prisma.issueMember.createMany({
      data: ids.map((stampId, i) => ({ issueId, stampId, sortOrder: i })),
    });
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId,
        name: "Basic",
        sortOrder: 0,
        stamps: { create: ids.map((stampId) => ({ stampId })) },
      },
    });

    const common = { conditionId, locationId: boxId } as const;
    singleId = (await createItem(userId, collectionId, { stampId: mi200, ...common })).id;
    oneStampCoverId = (
      await createItem(userId, collectionId, { stampId: mi201, formatId: coverId, ...common })
    ).id;
    carrierId = (
      await createItem(userId, collectionId, { stampId: mi205, formatId: coverId, ...common })
    ).id;
    await setItemStamps(userId, carrierId, [
      { stampId: mi205 },
      { stampId: mi200, quantity: 2 },
      { stampId: mi201 },
    ]);

    // Wants for the leading stamp and for the single's stamp, so the row's want marker has something
    // to say about both — and is seen to say it about the single alone.
    for (const stampId of [mi205, mi200]) {
      await createWant(userId, collectionId, {
        stampId,
        conditionIds: [],
        certificateStatusIds: [],
        formatIds: [],
        priority: "normal",
        notes: null,
      });
    }
  });

  after(async () => {
    await prisma.want.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.location.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampFormat.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const idsOf = (items: { id: string }[]) => items.map((i) => i.id).sort();

  // -------------------------------------------------------------------------
  // The filter
  // -------------------------------------------------------------------------

  it("shows both kinds of copy by default, and narrows to either on request", async () => {
    const both = await listItemsPaginated(userId, collectionId, {});
    assert.deepEqual(idsOf(both.items), [singleId, oneStampCoverId, carrierId].sort());

    const only = await listItemsPaginated(userId, collectionId, { multiStamp: "only" });
    assert.deepEqual(idsOf(only.items), [carrierId]);

    const exclude = await listItemsPaginated(userId, collectionId, { multiStamp: "exclude" });
    assert.deepEqual(
      idsOf(exclude.items),
      [singleId, oneStampCoverId].sort(),
      "the one-stamp cover is not a carrier, whatever its format says"
    );
  });

  it("narrows the count and the year rail exactly as it narrows the rows", async () => {
    assert.equal(await countItems(userId, collectionId, {}), 3);
    assert.equal(await countItems(userId, collectionId, { multiStamp: "only" }), 1);
    assert.equal(await countItems(userId, collectionId, { multiStamp: "exclude" }), 2);

    const years = await listItemYearFacets(userId, collectionId, { multiStamp: "only" });
    assert.deepEqual(years, [{ year: 1951, count: 1 }]);
  });

  // -------------------------------------------------------------------------
  // Findable by every stamp it carries
  // -------------------------------------------------------------------------

  it("finds the carrier by a stamp it carries that is not its leading one", async () => {
    // Mi 201 is third on the cover. Before #748 the search read the leading stamp alone.
    const byNumber = await listItemsPaginated(userId, collectionId, { search: "201" });
    assert.deepEqual(idsOf(byNumber.items), [oneStampCoverId, carrierId].sort());

    const byParsedNumber = await listItemsPaginated(userId, collectionId, {
      search: "Mi 200",
      catalogVendorId: vendorId,
      catalogNumber: "200",
    });
    assert.deepEqual(idsOf(byParsedNumber.items), [singleId, carrierId].sort());
  });

  // -------------------------------------------------------------------------
  // The row
  // -------------------------------------------------------------------------

  it("names every stamp on the carrier in the collector's order, and nothing on an ordinary copy", async () => {
    const { items } = await listItemsPaginated(userId, collectionId, {});
    const carrier = items.find((i) => i.id === carrierId)!;
    assert.equal(carrier.multiStamp, true);
    assert.deepEqual(
      carrier.carriedStamps.map((s) => [s.catalogNumbers[0]?.number, s.quantity, s.areaId, s.issueId]),
      [
        ["205", 1, areaId, issueId],
        ["200", 2, areaId, issueId],
        ["201", 1, areaId, issueId],
      ]
    );

    for (const id of [singleId, oneStampCoverId]) {
      const copy = items.find((i) => i.id === id)!;
      assert.equal(copy.multiStamp, false);
      assert.deepEqual(copy.carriedStamps, []);
    }
  });

  it("draws no want marker on a carrier, which satisfies no want (#745)", async () => {
    const { items } = await listItemsPaginated(userId, collectionId, {});
    assert.equal(items.find((i) => i.id === carrierId)!.wants, null, "Mi 205 is wanted all the same");
    assert.equal(items.find((i) => i.id === singleId)!.wants?.openCount, 1, "the control");
  });

  // -------------------------------------------------------------------------
  // Grouping
  // -------------------------------------------------------------------------

  it("keeps the carrier out of every duplicate group and counts it into the bucket instead", async () => {
    const { groups, nextCursor, multiStampGroup } = await listItemDuplicateGroups(
      userId,
      collectionId,
      {}
    );
    assert.equal(nextCursor, null);
    assert.deepEqual(
      groups.map((g) => [g.stampId, g.count]).sort(),
      [
        [mi200, 1],
        [mi201, 1],
      ].sort(),
      "no Mi 205 group, and Mi 200 counts only its own single"
    );
    assert.deepEqual(multiStampGroup, { key: MULTI_STAMP_GROUP_KEY, count: 1 });
  });

  it("puts the bucket on the last page of duplicate groups only", async () => {
    const first = await listItemDuplicateGroups(userId, collectionId, { pageSize: 1 });
    assert.equal(first.groups.length, 1);
    assert.equal(first.multiStampGroup, null, "a page with more after it carries no bucket");
    const last = await listItemDuplicateGroups(userId, collectionId, {
      pageSize: 1,
      offset: Number(first.nextCursor),
    });
    assert.equal(last.nextCursor, null);
    assert.equal(last.multiStampGroup?.count, 1);
  });

  it("files the carrier under no issue, in a bucket after the issue groups", async () => {
    const { groups, multiStampGroup } = await listItemIssueGroups(userId, collectionId, {});
    assert.deepEqual(
      groups.map((g) => [g.issueId, g.count]),
      [[issueId, 2]]
    );
    assert.deepEqual(multiStampGroup, { key: MULTI_STAMP_GROUP_KEY, count: 1 });

    // The group counts and the bucket partition the list, as the issue grouping promises.
    const total = groups.reduce((sum, g) => sum + g.count, 0) + (multiStampGroup?.count ?? 0);
    assert.equal(total, await countItems(userId, collectionId, {}));
  });

  it("follows the filter: no bucket without carriers, nothing but the bucket with only them", async () => {
    const excluded = await listItemIssueGroups(userId, collectionId, { multiStamp: "exclude" });
    assert.equal(excluded.multiStampGroup, null);
    assert.equal(excluded.groups.length, 1);

    const only = await listItemDuplicateGroups(userId, collectionId, { multiStamp: "only" });
    assert.deepEqual(only.groups, []);
    assert.equal(only.multiStampGroup?.count, 1);
  });

  it("addresses the members of each group with exactly the copies it counted", async () => {
    // What `issueGroupMemberFilters` / `groupMemberFilters` send for an ordinary group…
    const issueMembers = await listItemsPaginated(userId, collectionId, {
      issueId,
      multiStamp: "exclude",
    });
    assert.deepEqual(idsOf(issueMembers.items), [singleId, oneStampCoverId].sort());
    const duplicateMembers = await listItemsPaginated(userId, collectionId, {
      stampId: mi205,
      conditionIds: [conditionId],
      multiStamp: "exclude",
    });
    assert.deepEqual(duplicateMembers.items, []);

    // …and what `multiStampGroupMemberFilters` sends for the bucket.
    const bucketMembers = await listItemsPaginated(userId, collectionId, { multiStamp: "only" });
    assert.deepEqual(idsOf(bucketMembers.items), [carrierId]);
  });

  it("does not let the carrier tick a stamp off the issue group's completeness chips", async () => {
    const byIssue = await listIssueGroupCompleteness(userId, collectionId, [issueId], {});
    const [basic] = byIssue[issueId];
    assert.equal(basic.requiredCount, 3);
    assert.equal(basic.owned, 2, "Mi 200 and Mi 201 — Mi 205 is held only on the carrier");
  });

  it("files the carrier by location like any other copy, where it is kept being a fact about the piece", async () => {
    const { groups } = await listItemLocationGroups(userId, collectionId, {});
    assert.deepEqual(
      groups.map((g) => [g.locationId, g.count]),
      [[boxId, 3]]
    );
  });
});
