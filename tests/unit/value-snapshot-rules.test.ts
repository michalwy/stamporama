import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  copyIdsByAreaSubtree,
  holdingsSnapshotFields,
  ratesIntoBase,
  snapshotDay,
} from "../../src/lib/value-snapshot-rules";
import type { HoldingsSummary } from "../../src/lib/valuation";

// The pure half of the daily value snapshots (#652). The sweep's own contract — one row per day,
// a re-run updating rather than appending — needs a database and lives in
// `tests/integration/value-snapshots.test.ts`.

describe("snapshotDay", () => {
  it("is the UTC calendar day, whatever the time of day", () => {
    assert.equal(
      snapshotDay(new Date("2026-09-13T00:00:00.000Z")).toISOString(),
      "2026-09-13T00:00:00.000Z"
    );
    assert.equal(
      snapshotDay(new Date("2026-09-13T23:59:59.999Z")).toISOString(),
      "2026-09-13T00:00:00.000Z"
    );
  });

  it("does not follow a local offset across midnight", () => {
    // 01:30 in Warsaw on the 14th is still the 13th in UTC.
    assert.equal(
      snapshotDay(new Date("2026-09-14T01:30:00+02:00")).toISOString(),
      "2026-09-13T00:00:00.000Z"
    );
  });
});

describe("holdingsSnapshotFields", () => {
  const summary: HoldingsSummary = {
    baseCurrency: "PLN",
    totalBaseAmount: "120.50",
    pricedCount: 4,
    unpricedCount: 2,
    unconvertibleCount: 1,
    uncertainCount: 1,
    uncertainBaseAmount: "10.00",
    cost: { baseCurrency: "PLN", totalCostBasis: "80.00", knownCount: 5, pendingCount: 1, noneCount: 1, noOpeningValueCount: 0 },
    // #1324: never in the acquisition cost or its counts, but its copies are still held.
    openingValue: { baseCurrency: "PLN", totalCostBasis: "500.00", knownCount: 2, pendingCount: 0, noneCount: 1, noOpeningValueCount: 1 },
    writeOff: {
      cost: { baseCurrency: "PLN", totalCostBasis: "999.00", knownCount: 3, pendingCount: 0, noneCount: 0, noOpeningValueCount: 0 },
      count: 3,
    },
    market: { baseCurrency: "PLN", totalBaseAmount: "60.00", valuedCount: 3, noEvidenceCount: 4 },
  };

  it("keeps every sum beside the counts that say what it left out", () => {
    assert.deepEqual(holdingsSnapshotFields(summary), {
      catalogueValue: "120.50",
      catalogueUncertainValue: "10.00",
      cataloguePricedCount: 4,
      catalogueUnpricedCount: 2,
      catalogueUnconvertibleCount: 1,
      catalogueUncertainCount: 1,
      marketValue: "60.00",
      marketValuedCount: 3,
      marketNoEvidenceCount: 4,
      acquisitionCost: "80.00",
      costKnownCount: 5,
      costPendingCount: 1,
      costNoneCount: 1,
      copiesHeld: 10,
    });
  });
});

describe("ratesIntoBase", () => {
  const table = new Map([
    ["EUR", 1],
    ["PLN", 4.25],
    ["USD", 1.1],
  ]);

  it("restates the EUR-anchored table into the base currency, leaving the base out", () => {
    const rates = ratesIntoBase(table, "PLN");
    assert.deepEqual(Object.keys(rates), ["EUR", "USD"]);
    assert.equal(rates.EUR, 4.25);
    assert.ok(Math.abs(rates.USD - 4.25 / 1.1) < 1e-12);
  });

  it("is empty when the table cannot express the base", () => {
    assert.deepEqual(ratesIntoBase(table, "CHF"), {});
    assert.deepEqual(ratesIntoBase(new Map(), "EUR"), {});
  });
});

describe("copyIdsByAreaSubtree", () => {
  const areas = [
    { id: "europe", parentId: null },
    { id: "poland", parentId: "europe" },
    { id: "gg", parentId: "poland" },
    { id: "germany", parentId: "europe" },
    { id: "asia", parentId: null },
  ];

  it("counts a copy under its linked area and every ancestor, and gives empty areas a list", () => {
    const out = copyIdsByAreaSubtree(areas, [
      { id: "c1", areaIds: ["gg"] },
      { id: "c2", areaIds: ["germany"] },
      { id: "c3", areaIds: [] },
    ]);
    assert.deepEqual(out.get("gg"), ["c1"]);
    assert.deepEqual(out.get("poland"), ["c1"]);
    assert.deepEqual(out.get("germany"), ["c2"]);
    assert.deepEqual(out.get("europe")!.sort(), ["c1", "c2"]);
    assert.deepEqual(out.get("asia"), []);
  });

  it("counts a copy filed in two areas under both, but once under their shared ancestor", () => {
    const out = copyIdsByAreaSubtree(areas, [{ id: "c1", areaIds: ["poland", "germany"] }]);
    assert.deepEqual(out.get("poland"), ["c1"]);
    assert.deepEqual(out.get("germany"), ["c1"]);
    assert.deepEqual(out.get("europe"), ["c1"]);
  });

  it("ignores a link to an area it was not given, and survives a cycle", () => {
    const out = copyIdsByAreaSubtree(
      [
        { id: "a", parentId: "b" },
        { id: "b", parentId: "a" },
      ],
      [{ id: "c1", areaIds: ["a", "gone"] }]
    );
    assert.deepEqual(out.get("a"), ["c1"]);
    assert.deepEqual(out.get("b"), ["c1"]);
    assert.equal(out.has("gone"), false);
  });
});
