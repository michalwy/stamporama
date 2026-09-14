import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getOverviewValueHistory } from "../../src/lib/overview";
import { hasEnoughHistory, splitIntoRuns } from "../../src/lib/value-history-rules";

// The Overview's value-over-time read (#653). The series arithmetic — ordering, gap runs, the axis —
// is unit-tested in `value-history-rules.test.ts`; what needs a database is that the read hands the
// chart the stored rows as written:
//
//   - every recorded day, oldest first, with a missing day left missing (it draws as a gap);
//   - days recorded under another base currency counted apart, not plotted;
//   - the split offered over the top-level areas only, from their own subtree rows;
//   - a collection with one recorded day reads as not enough history;
//   - another owner is refused.
//
// Snapshot rows are seeded directly: the sweep that writes them is `value-snapshots.test.ts`'s.

describe("overview value history (#653)", () => {
  const ts = Date.now();
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let freshCollectionId: string;
  const area: Record<string, string> = {};

  const HOLDINGS = {
    catalogueUncertainValue: "0.00",
    cataloguePricedCount: 3,
    catalogueUnpricedCount: 0,
    catalogueUnconvertibleCount: 0,
    catalogueUncertainCount: 0,
    marketValue: "0.00",
    marketValuedCount: 0,
    marketNoEvidenceCount: 3,
    costKnownCount: 3,
    costPendingCount: 0,
    costNoneCount: 0,
    copiesHeld: 3,
  };

  async function snapshot(
    forCollection: string,
    day: string,
    baseCurrency: string,
    catalogueValue: string,
    areaValues: Record<string, string> = {}
  ) {
    await prisma.collectionValueSnapshot.create({
      data: {
        collectionId: forCollection,
        day: new Date(`${day}T00:00:00.000Z`),
        takenAt: new Date(`${day}T20:00:00.000Z`),
        baseCurrency,
        rates: {},
        ...HOLDINGS,
        catalogueValue,
        acquisitionCost: "50.00",
        askingValue: "0.00",
        askingOfferCount: 0,
        askingUnpricedCount: 0,
        askingUnconvertibleCount: 0,
        exposureCommitted: "0.00",
        exposureCeiling: "0.00",
        exposurePayableCount: 0,
        exposureUncappedCount: 0,
        exposureUnconvertibleCount: 0,
        areas: {
          create: Object.entries(areaValues).map(([collectionAreaId, value]) => ({
            collectionAreaId,
            ...HOLDINGS,
            catalogueValue: value,
            acquisitionCost: "0.00",
          })),
        },
      },
    });
  }

  before(async () => {
    userId = `test-user-value-history-${ts}`;
    strangerId = `test-user-value-history-stranger-${ts}`;
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
          slug: `col-value-history-${ts}`,
          name: `Collection value-history-${ts}`,
          baseCurrency: "PLN",
          ownerId: userId,
        },
      })
    ).id;
    freshCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-value-history-fresh-${ts}`,
          name: `Collection value-history-fresh-${ts}`,
          baseCurrency: "PLN",
          ownerId: userId,
        },
      })
    ).id;

    const createArea = async (name: string, parentId: string | null, sortOrder: number) =>
      (await prisma.collectionArea.create({ data: { collectionId, name, parentId, sortOrder } })).id;
    area.europe = await createArea("Europe", null, 0);
    area.poland = await createArea("Poland", area.europe, 0);
    area.asia = await createArea("Asia", null, 1);
    area.oceania = await createArea("Oceania", null, 2);

    // Recorded in EUR before the base currency changed — not on the PLN axis.
    await snapshot(collectionId, "2026-02-20", "EUR", "30.00", { [area.europe]: "30.00" });
    await snapshot(collectionId, "2026-03-01", "PLN", "100.00", {
      [area.europe]: "80.00",
      [area.poland]: "40.00",
      [area.asia]: "20.00",
      [area.oceania]: "0.00",
    });
    await snapshot(collectionId, "2026-03-02", "PLN", "110.00", {
      [area.europe]: "85.00",
      [area.poland]: "45.00",
      [area.asia]: "25.00",
      [area.oceania]: "0.00",
    });
    // 03-03 missing: the app was down.
    await snapshot(collectionId, "2026-03-04", "PLN", "130.00", {
      [area.europe]: "100.00",
      [area.poland]: "50.00",
      [area.asia]: "30.00",
      [area.oceania]: "0.00",
    });

    await snapshot(freshCollectionId, "2026-03-04", "PLN", "10.00");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, freshCollectionId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("returns every recorded day in the base currency, oldest first, gaps left as gaps", async () => {
    const history = await getOverviewValueHistory(userId, collectionId);
    assert.equal(history.baseCurrency, "PLN");
    assert.deepEqual(
      history.points.map((p) => [p.day, p.catalogueValue, p.acquisitionCost]),
      [
        ["2026-03-01", "100.00", "50.00"],
        ["2026-03-02", "110.00", "50.00"],
        ["2026-03-04", "130.00", "50.00"],
      ]
    );
    assert.equal(hasEnoughHistory(history), true);
    assert.deepEqual(
      splitIntoRuns(history.points).map((run) => run.map((p) => p.day)),
      [["2026-03-01", "2026-03-02"], ["2026-03-04"]]
    );
  });

  it("counts days recorded in another base currency apart", async () => {
    const history = await getOverviewValueHistory(userId, collectionId);
    assert.equal(history.otherCurrencyDays, 1);
  });

  it("splits by top-level areas that held value, from their subtree rows", async () => {
    const history = await getOverviewValueHistory(userId, collectionId);
    assert.deepEqual(history.areas, [
      { areaId: area.europe, name: "Europe" },
      { areaId: area.asia, name: "Asia" },
    ]);
    const last = history.points[history.points.length - 1];
    assert.equal(last.areaValues[area.europe], "100.00");
    assert.equal(last.areaValues[area.asia], "30.00");
    assert.equal(last.areaValues[area.poland], undefined);
  });

  it("reads a collection with one recorded day as still collecting", async () => {
    const history = await getOverviewValueHistory(userId, freshCollectionId);
    assert.equal(history.points.length, 1);
    assert.equal(hasEnoughHistory(history), false);
  });

  it("refuses another owner", async () => {
    await assert.rejects(getOverviewValueHistory(strangerId, collectionId));
  });
});
