import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { getOverviewProgress, getOverviewValueHistory } from "../../src/lib/overview";
import { getOverviewAreaIds, saveOverviewAreaIds } from "../../src/lib/overview-areas";
import { recordValueSnapshots } from "../../src/lib/value-snapshots";

// The areas the Overview breaks down by (#1330). How a choice resolves against the tree and how the
// coverage roll-up treats a nested pair are unit-tested in `overview-rules.test.ts`; what needs a
// database is:
//
//   - the choice is saved for the collection, replaced whole, refused for a foreign area, and an
//     area deleted drops out of it;
//   - Value over time splits by the chosen areas from their stored subtree rows, marks where an
//     area's history begins, and values *Other* live — a stamp filed both inside and outside the
//     chosen areas is not Other's, a stamp in no area is;
//   - Coverage by area rolls a nested pair up each over its own subtree, with *Other* for the rest;
//   - with nothing chosen, both behave as before.
//
// Base PLN, catalogue prices in EUR at 4.25, a fresh rate table seeded so nothing is fetched.

const ts = Date.now();
const DAY_ONE = new Date("2026-03-01T08:00:00.000Z");
const DAY_TWO = new Date("2026-03-02T08:00:00.000Z");

describe("overview chosen areas (#1330)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let strangerCollectionId: string;
  let conditionId: string;
  let editionId: string;
  let catalogNameId: string;
  let issueNo = 13300;
  const area: Record<string, string> = {};
  const stamp: Record<string, string> = {};

  async function pricedStamp(name: string, amount: string, areaIds: string[]): Promise<string> {
    const s = await prisma.stamp.create({ data: { collectionId, name } });
    for (const [i, collectionAreaId] of areaIds.entries()) {
      await prisma.stampCollectionArea.create({
        data: { stampId: s.id, collectionAreaId, isPrimary: i === 0 },
      });
    }
    await prisma.stampCatalogPrice.create({
      data: {
        stampId: s.id,
        catalogEditionId: editionId,
        conditionId,
        certificateStatusId: null,
        formatId: null,
        price: amount,
        currency: "EUR",
      },
    });
    return s.id;
  }

  /** An issue in `areaId` whose one checklist requires `stampIds`. */
  async function checklistIssue(areaId: string, stampIds: string[]) {
    const issue = await prisma.issue.create({
      // Past the collection's counter: these rows bypass `allocateEntityNumber` (#432).
      data: { collectionId, issueNo: issueNo++, collectionAreaId: areaId, name: `Issue ${issueNo}` },
    });
    await prisma.issueMember.createMany({
      data: stampIds.map((stampId, i) => ({ issueId: issue.id, stampId, sortOrder: i })),
    });
    await prisma.checklist.create({
      data: {
        collectionId,
        issueId: issue.id,
        name: "Basic",
        stamps: { create: stampIds.map((stampId, i) => ({ stampId, sortOrder: i })) },
      },
    });
  }

  before(async () => {
    userId = `test-user-overview-areas-${ts}`;
    strangerId = `test-user-overview-areas-stranger-${ts}`;
    for (const id of [userId, strangerId]) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-overview-areas-${ts}`,
          name: `Collection overview-areas-${ts}`,
          baseCurrency: "PLN",
          ownerId: userId,
        },
      })
    ).id;
    strangerCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-overview-areas-stranger-${ts}`,
          name: `Collection overview-areas-stranger-${ts}`,
          baseCurrency: "PLN",
          ownerId: strangerId,
        },
      })
    ).id;

    await prisma.exchangeRate.createMany({
      data: [
        ["EUR", "1"],
        ["PLN", "4.25"],
      ].map(([toCurrency, rate]) => ({
        collectionId,
        fromCurrency: "EUR",
        toCurrency,
        rate,
        fetchedAt: new Date(),
      })),
    });

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    catalogNameId = (
      await prisma.catalogName.create({
        data: { vendorId: vendor.id, name: "Michel Welt", currency: "EUR" },
      })
    ).id;
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId, year: 2024 } })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;

    const createArea = async (name: string, parentId: string | null, sortOrder: number) =>
      (
        await prisma.collectionArea.create({
          data: { collectionId, name, parentId, sortOrder, primaryCatalogNameId: catalogNameId },
        })
      ).id;
    area.europe = await createArea("Europe", null, 0);
    area.poland = await createArea("Poland", area.europe, 0);
    area.germany = await createArea("Germany", area.europe, 1);
    area.asia = await createArea("Asia", null, 1);

    stamp.polish = await pricedStamp("Polish", "10.00", [area.poland]);
    stamp.polishMissing = await pricedStamp("Polish missing", "1.00", [area.poland]);
    stamp.german = await pricedStamp("German", "20.00", [area.germany]);
    // Filed in both countries: inside Poland's subtree and Germany's at once.
    stamp.shared = await pricedStamp("Shared", "5.00", [area.poland, area.germany]);
    stamp.asian = await pricedStamp("Asian", "7.00", [area.asia]);
    stamp.asianMissing = await pricedStamp("Asian missing", "1.00", [area.asia]);
    // In no area at all — and so with no catalogue to price it from: held, but unpriced.
    stamp.unfiled = await pricedStamp("Unfiled", "3.00", []);

    for (const stampId of [stamp.polish, stamp.german, stamp.shared, stamp.asian, stamp.unfiled]) {
      await createItem(userId, collectionId, { stampId, conditionId });
    }

    // Poland 1/2, Germany 1/1, Asia 0/1.
    await checklistIssue(area.poland, [stamp.polish, stamp.polishMissing]);
    await checklistIssue(area.germany, [stamp.german]);
    await checklistIssue(area.asia, [stamp.asianMissing]);

    await recordValueSnapshots({ now: DAY_ONE, collectionIds: [collectionId] });
    // Created between the two passes: its history begins on day two.
    area.japan = await createArea("Japan", area.asia, 0);
    await recordValueSnapshots({ now: DAY_TWO, collectionIds: [collectionId] });
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({
      where: { id: { in: [collectionId, strangerCollectionId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  describe("with nothing chosen", () => {
    it("splits by the top-level areas that held value, with no Other line", async () => {
      await saveOverviewAreaIds(userId, collectionId, []);
      const history = await getOverviewValueHistory(userId, collectionId);
      assert.equal(history.chosen, false);
      assert.deepEqual(
        history.areas.map((a) => a.name),
        ["Europe", "Asia"]
      );
      assert.equal(history.other, null);
    });

    it("rolls coverage up to the top-level areas, with no Other line", async () => {
      const { coverage } = await getOverviewProgress(userId, collectionId);
      assert.equal(coverage.chosen, false);
      assert.deepEqual(
        coverage.tracked.map((t) => [t.name, t.owned, t.required]),
        [
          ["Asia", 0, 1],
          ["Europe", 2, 3],
        ]
      );
      assert.equal(coverage.other, null);
    });
  });

  describe("with a nested pair chosen", () => {
    before(async () => {
      await saveOverviewAreaIds(userId, collectionId, [area.poland, area.europe]);
    });

    it("saves the choice for the collection", async () => {
      assert.deepEqual(
        (await getOverviewAreaIds(userId, collectionId)).sort(),
        [area.europe, area.poland].sort()
      );
    });

    it("splits Value over time by both, parent first, each from its own subtree rows", async () => {
      const history = await getOverviewValueHistory(userId, collectionId);
      assert.equal(history.chosen, true);
      assert.deepEqual(
        history.areas.map((a) => [a.name, a.historyFrom]),
        [
          ["Europe", "2026-03-01"],
          ["Poland", "2026-03-01"],
        ]
      );
      const last = history.points[history.points.length - 1];
      // Europe: 10 + 20 + 5 EUR; Poland: 10 + 5 EUR — overlapping, never summed.
      assert.equal(last.areaValues[area.europe], "148.75");
      assert.equal(last.areaValues[area.poland], "63.75");
      assert.equal(last.areaValues[area.asia], undefined);
    });

    it("values Other live over everything outside them, the unfiled stamp included", async () => {
      const history = await getOverviewValueHistory(userId, collectionId);
      // Asian 7 EUR, and the unfiled copy counted apart as unpriced rather than dropped.
      assert.deepEqual(history.other, {
        catalogueValue: "29.75",
        copiesHeld: 2,
        unpricedCount: 1,
        unconvertibleCount: 0,
      });
    });

    it("rolls coverage up over each subtree, with Other for the rest", async () => {
      const { coverage } = await getOverviewProgress(userId, collectionId);
      assert.equal(coverage.chosen, true);
      assert.deepEqual(
        coverage.tracked.map((t) => [t.name, t.owned, t.required]),
        [
          ["Poland", 1, 2],
          ["Europe", 2, 3],
        ]
      );
      assert.deepEqual(coverage.other, { owned: 0, required: 1, checklistCount: 1 });
    });
  });

  describe("with areas whose history or filing differ", () => {
    it("marks an area created later as beginning on its first recorded day", async () => {
      await saveOverviewAreaIds(userId, collectionId, [area.japan, area.poland]);
      const history = await getOverviewValueHistory(userId, collectionId);
      assert.deepEqual(
        history.areas.map((a) => [a.name, a.historyFrom]),
        [
          ["Poland", "2026-03-01"],
          ["Japan", "2026-03-02"],
        ]
      );
      assert.equal(history.points[0].areaValues[area.japan], undefined);
    });

    it("leaves a stamp filed inside a chosen area out of Other, however else it is filed", async () => {
      await saveOverviewAreaIds(userId, collectionId, [area.poland, area.asia]);
      const history = await getOverviewValueHistory(userId, collectionId);
      // German 20 EUR and the unpriced unfiled copy; the shared stamp is Poland's, though also filed
      // under Germany.
      assert.deepEqual(history.other, {
        catalogueValue: "85.00",
        copiesHeld: 2,
        unpricedCount: 1,
        unconvertibleCount: 0,
      });
    });

    it("has no Other line when the chosen areas cover the whole tree", async () => {
      await saveOverviewAreaIds(userId, collectionId, [area.europe, area.asia]);
      const history = await getOverviewValueHistory(userId, collectionId);
      assert.equal(history.other, null);
    });
  });

  describe("saving", () => {
    it("refuses an area of another collection and keeps the previous choice", async () => {
      await saveOverviewAreaIds(userId, collectionId, [area.poland]);
      const foreign = await prisma.collectionArea.create({
        data: { collectionId: strangerCollectionId, name: "Elsewhere" },
      });
      await assert.rejects(saveOverviewAreaIds(userId, collectionId, [area.asia, foreign.id]));
      assert.deepEqual(await getOverviewAreaIds(userId, collectionId), [area.poland]);
    });

    it("refuses another owner, reading or saving", async () => {
      await assert.rejects(getOverviewAreaIds(strangerId, collectionId));
      await assert.rejects(saveOverviewAreaIds(strangerId, collectionId, []));
    });

    it("drops a deleted area from the choice", async () => {
      const temporary = await prisma.collectionArea.create({
        data: { collectionId, name: "Temporary", parentId: area.asia },
      });
      await saveOverviewAreaIds(userId, collectionId, [temporary.id]);
      await prisma.collectionArea.delete({ where: { id: temporary.id } });
      assert.deepEqual(await getOverviewAreaIds(userId, collectionId), []);
      const history = await getOverviewValueHistory(userId, collectionId);
      assert.equal(history.chosen, false);
    });
  });
});
