import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, getHoldingsValuation } from "../../src/lib/items";
import { recordValueSnapshots } from "../../src/lib/value-snapshots";

// Daily collection value snapshots (#652; ADR-0053). The day key, the stored shape and the subtree
// walk are unit-tested in `value-snapshot-rules.test.ts`; what needs a database is the sweep's own
// contract:
//
//   - a pass records the day's collection row and one row per area subtree;
//   - the collection figures are the Overview's own read, not a second arithmetic;
//   - a second pass the same day updates the rows and leaves the row count unchanged;
//   - the next day appends;
//   - the rates the figures were converted with are recorded beside them.
//
// The collection's base is PLN and its catalogue prices are EUR, with a fresh rate table seeded, so a
// conversion really happens and still no rate is fetched — the suite runs offline.

const RATE_FETCHED_AT = new Date();
const MORNING = new Date("2026-03-01T08:00:00.000Z");
const EVENING = new Date("2026-03-01T21:30:00.000Z");
const NEXT_DAY = new Date("2026-03-02T07:00:00.000Z");

describe("daily value snapshots (#652)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let editionId: string;
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

  async function snapshots() {
    return prisma.collectionValueSnapshot.findMany({
      where: { collectionId },
      orderBy: { day: "asc" },
      include: { areas: true },
    });
  }

  function areaRow(
    snapshot: Awaited<ReturnType<typeof snapshots>>[number],
    areaId: string
  ) {
    const row = snapshot.areas.find((a) => a.collectionAreaId === areaId);
    assert.ok(row, `no row for area ${areaId}`);
    return row;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-value-snapshots-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User value-snapshots-${ts}`,
        email: `test-value-snapshots-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-value-snapshots-${ts}`,
          name: `Collection value-snapshots-${ts}`,
          baseCurrency: "PLN",
          ownerId: userId,
        },
      })
    ).id;

    // A fresh EUR-anchored table, so the PLN conversion is answered from the cache and never fetched.
    await prisma.exchangeRate.createMany({
      data: [
        ["EUR", "1"],
        ["PLN", "4.25"],
        ["USD", "1.1"],
      ].map(([toCurrency, rate]) => ({
        collectionId,
        fromCurrency: "EUR",
        toCurrency,
        rate,
        fetchedAt: RATE_FETCHED_AT,
      })),
    });

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Europa", currency: "EUR" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    const createArea = async (name: string, parentId: string | null) =>
      (
        await prisma.collectionArea.create({
          data: { collectionId, name, parentId, primaryCatalogNameId: catalogName.id },
        })
      ).id;
    area.europe = await createArea("Europe", null);
    area.poland = await createArea("Poland", area.europe);
    area.germany = await createArea("Germany", area.europe);
    area.asia = await createArea("Asia", null);

    stamp.polish = await pricedStamp("Polish", "10.00", [area.poland]);
    stamp.german = await pricedStamp("German", "20.00", [area.germany]);
    // Filed in both countries: counted under each, and once under Europe.
    stamp.shared = await pricedStamp("Shared", "5.00", [area.poland, area.germany]);

    for (const stampId of [stamp.polish, stamp.german, stamp.shared]) {
      await createItem(userId, collectionId, { stampId, conditionId });
    }
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("records the day's collection row and a row per area subtree", async () => {
    const pass = await recordValueSnapshots({ now: MORNING, collectionIds: [collectionId] });
    assert.deepEqual(pass, { recorded: 1, created: 1, areaRows: 4, failed: 0 });

    const [snapshot, ...rest] = await snapshots();
    assert.equal(rest.length, 0);
    assert.equal(snapshot.day.toISOString(), "2026-03-01T00:00:00.000Z");
    assert.equal(snapshot.takenAt.toISOString(), MORNING.toISOString());
    assert.equal(snapshot.baseCurrency, "PLN");

    // 10 + 20 + 5 EUR at 4.25.
    assert.equal(snapshot.catalogueValue.toFixed(2), "148.75");
    assert.equal(snapshot.cataloguePricedCount, 3);
    assert.equal(snapshot.copiesHeld, 3);
    // No sales, no lots, no offers: stated as zero counts beside zero sums.
    assert.equal(snapshot.marketValue.toFixed(2), "0.00");
    assert.equal(snapshot.marketNoEvidenceCount, 3);
    assert.equal(snapshot.askingValue.toFixed(2), "0.00");
    assert.equal(snapshot.askingOfferCount, 0);
    assert.equal(snapshot.exposureCommitted.toFixed(2), "0.00");

    assert.equal(areaRow(snapshot, area.poland).catalogueValue.toFixed(2), "63.75");
    assert.equal(areaRow(snapshot, area.germany).catalogueValue.toFixed(2), "106.25");
    assert.equal(areaRow(snapshot, area.europe).catalogueValue.toFixed(2), "148.75");
    assert.equal(areaRow(snapshot, area.europe).copiesHeld, 3);
    // An area holding nothing still has its point, at zero.
    assert.equal(areaRow(snapshot, area.asia).catalogueValue.toFixed(2), "0.00");
    assert.equal(areaRow(snapshot, area.asia).copiesHeld, 0);
  });

  it("states the collection figures exactly as the Overview's holdings read does", async () => {
    const [snapshot] = await snapshots();
    const holdings = await getHoldingsValuation(userId, collectionId, { excludeGone: true });
    assert.equal(snapshot.catalogueValue.toFixed(2), holdings.totalBaseAmount);
    assert.equal(snapshot.acquisitionCost.toFixed(2), holdings.cost.totalCostBasis);
    assert.equal(snapshot.costNoneCount, holdings.cost.noneCount);
    assert.equal(snapshot.marketValue.toFixed(2), holdings.market.totalBaseAmount);
  });

  it("records the rates the figures were converted with, restated into the base", async () => {
    const [snapshot] = await snapshots();
    const rates = snapshot.rates as Record<string, number>;
    assert.deepEqual(Object.keys(rates), ["EUR", "USD"]);
    assert.equal(rates.EUR, 4.25);
    assert.ok(Math.abs(rates.USD - 4.25 / 1.1) < 1e-9);
    assert.equal(snapshot.ratesFetchedAt?.toISOString(), RATE_FETCHED_AT.toISOString());
  });

  it("updates rather than appends on a second pass the same day", async () => {
    await createItem(userId, collectionId, { stampId: stamp.polish, conditionId });
    const germanCopy = await prisma.item.findFirstOrThrow({
      where: { collectionId, stampId: stamp.german },
    });
    // Gone copies leave the day's holdings (the Overview's own scope), not the history of it.
    await prisma.item.update({ where: { id: germanCopy.id }, data: { disposedAt: new Date() } });

    const pass = await recordValueSnapshots({ now: EVENING, collectionIds: [collectionId] });
    assert.deepEqual(pass, { recorded: 1, created: 0, areaRows: 4, failed: 0 });

    const all = await snapshots();
    assert.equal(all.length, 1);
    const [snapshot] = all;
    assert.equal(snapshot.areas.length, 4);
    assert.equal(snapshot.takenAt.toISOString(), EVENING.toISOString());
    // 10 + 10 + 5 EUR held; the German copy is gone.
    assert.equal(snapshot.catalogueValue.toFixed(2), "106.25");
    assert.equal(snapshot.copiesHeld, 3);
    assert.equal(areaRow(snapshot, area.germany).catalogueValue.toFixed(2), "21.25");
    assert.equal(areaRow(snapshot, area.poland).catalogueValue.toFixed(2), "106.25");
  });

  it("appends the next day's row beside the first", async () => {
    const pass = await recordValueSnapshots({ now: NEXT_DAY, collectionIds: [collectionId] });
    assert.equal(pass.created, 1);

    const all = await snapshots();
    assert.deepEqual(
      all.map((s) => s.day.toISOString()),
      ["2026-03-01T00:00:00.000Z", "2026-03-02T00:00:00.000Z"]
    );
    assert.equal(await prisma.collectionAreaValueSnapshot.count({ where: { snapshot: { collectionId } } }), 8);
  });

  it("lets a deleted area take its own history with it, leaving the collection's", async () => {
    await prisma.collectionArea.delete({ where: { id: area.asia } });

    const all = await snapshots();
    assert.equal(all.length, 2);
    for (const snapshot of all) {
      assert.equal(snapshot.areas.length, 3);
      assert.equal(snapshot.areas.some((a) => a.collectionAreaId === area.asia), false);
    }
  });
});
