import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildValueHistory,
  dayTicks,
  hasEnoughHistory,
  splitIntoRuns,
  valueScale,
  type SnapshotRowInput,
} from "../../src/lib/value-history-rules";

function row(day: string, overrides: Partial<SnapshotRowInput> = {}): SnapshotRowInput {
  return {
    day: new Date(`${day}T00:00:00.000Z`),
    baseCurrency: "PLN",
    catalogueValue: "100.00",
    acquisitionCost: "60.00",
    marketValue: "0.00",
    marketValuedCount: 0,
    copiesHeld: 3,
    catalogueUnpricedCount: 0,
    catalogueUnconvertibleCount: 0,
    costPendingCount: 0,
    costNoneCount: 0,
    areas: [],
    ...overrides,
  };
}

const EUROPE = { areaId: "europe", name: "Europe" };
const ASIA = { areaId: "asia", name: "Asia" };

describe("buildValueHistory", () => {
  it("orders the recorded days oldest first and leaves missing days missing", () => {
    const history = buildValueHistory(
      [row("2026-03-04"), row("2026-03-01"), row("2026-03-02")],
      "PLN",
      []
    );
    assert.deepEqual(
      history.points.map((p) => p.day),
      ["2026-03-01", "2026-03-02", "2026-03-04"]
    );
  });

  it("leaves out days recorded in another base currency and counts them", () => {
    const history = buildValueHistory(
      [row("2026-02-01", { baseCurrency: "EUR" }), row("2026-03-01"), row("2026-03-02")],
      "PLN",
      []
    );
    assert.equal(history.points.length, 2);
    assert.equal(history.otherCurrencyDays, 1);
    assert.equal(history.baseCurrency, "PLN");
  });

  it("carries the stored figures and caveat counts as written", () => {
    const [point] = buildValueHistory(
      [
        row("2026-03-01", {
          catalogueValue: "148.75",
          acquisitionCost: "90.10",
          catalogueUnpricedCount: 2,
          costNoneCount: 1,
        }),
      ],
      "PLN",
      []
    ).points;
    assert.equal(point.catalogueValue, "148.75");
    assert.equal(point.acquisitionCost, "90.10");
    assert.equal(point.unpricedCount, 2);
    assert.equal(point.costNoneCount, 1);
  });

  it("splits by the given top-level areas only, dropping areas that never held value", () => {
    const history = buildValueHistory(
      [
        row("2026-03-01", {
          areas: [
            { collectionAreaId: "europe", catalogueValue: "80.00" },
            { collectionAreaId: "poland", catalogueValue: "30.00" },
            { collectionAreaId: "asia", catalogueValue: "0.00" },
          ],
        }),
      ],
      "PLN",
      [EUROPE, ASIA]
    );
    assert.deepEqual(history.areas, [EUROPE]);
    assert.deepEqual(history.points[0].areaValues, { europe: "80.00", asia: "0.00" });
  });

  it("keeps the tree order of the areas it keeps", () => {
    const history = buildValueHistory(
      [
        row("2026-03-01", {
          areas: [
            { collectionAreaId: "asia", catalogueValue: "5.00" },
            { collectionAreaId: "europe", catalogueValue: "80.00" },
          ],
        }),
      ],
      "PLN",
      [EUROPE, ASIA]
    );
    assert.deepEqual(
      history.areas.map((a) => a.areaId),
      ["europe", "asia"]
    );
  });
});

describe("hasEnoughHistory", () => {
  it("waits until two days are recorded", () => {
    assert.equal(hasEnoughHistory(buildValueHistory([], "PLN", [])), false);
    assert.equal(hasEnoughHistory(buildValueHistory([row("2026-03-01")], "PLN", [])), false);
    assert.equal(
      hasEnoughHistory(buildValueHistory([row("2026-03-01"), row("2026-03-09")], "PLN", [])),
      true
    );
  });
});

describe("splitIntoRuns", () => {
  const days = (runs: { day: string }[][]) => runs.map((run) => run.map((p) => p.day));

  it("keeps consecutive days in one run", () => {
    const points = [{ day: "2026-03-01" }, { day: "2026-03-02" }, { day: "2026-03-03" }];
    assert.deepEqual(days(splitIntoRuns(points)), [["2026-03-01", "2026-03-02", "2026-03-03"]]);
  });

  it("breaks the line at a single missing day instead of drawing across it", () => {
    const points = [
      { day: "2026-03-01" },
      { day: "2026-03-02" },
      { day: "2026-03-04" },
      { day: "2026-03-05" },
    ];
    assert.deepEqual(days(splitIntoRuns(points)), [
      ["2026-03-01", "2026-03-02"],
      ["2026-03-04", "2026-03-05"],
    ]);
  });

  it("crosses a month and a year boundary without seeing a gap", () => {
    const points = [{ day: "2025-12-31" }, { day: "2026-01-01" }, { day: "2026-02-01" }];
    assert.deepEqual(days(splitIntoRuns(points)), [["2025-12-31", "2026-01-01"], ["2026-02-01"]]);
  });

  it("breaks where a line has no value that day", () => {
    const points = [
      { day: "2026-03-01", v: "1" },
      { day: "2026-03-02", v: undefined },
      { day: "2026-03-03", v: "2" },
      { day: "2026-03-04", v: "3" },
    ];
    assert.deepEqual(days(splitIntoRuns(points, (p) => p.v != null)), [
      ["2026-03-01"],
      ["2026-03-03", "2026-03-04"],
    ]);
  });

  it("returns no runs for an empty series", () => {
    assert.deepEqual(splitIntoRuns([]), []);
  });
});

describe("valueScale", () => {
  it("rounds the top of the axis up to a round step and starts at zero", () => {
    assert.deepEqual(valueScale(148.75), { max: 150, ticks: [0, 50, 100, 150] });
    assert.deepEqual(valueScale(151), { max: 200, ticks: [0, 50, 100, 150, 200] });
  });

  it("never puts the top below the largest value", () => {
    for (const max of [1, 7, 99.99, 100, 101, 2345.6, 1_000_000]) {
      const scale = valueScale(max);
      assert.ok(scale.max >= max, `${max} → ${scale.max}`);
      assert.equal(scale.ticks[0], 0);
      assert.ok(scale.ticks.length <= 6, `${max} → ${scale.ticks.length} ticks`);
    }
  });

  it("still draws an axis for an all-zero series", () => {
    assert.deepEqual(valueScale(0), { max: 1, ticks: [0, 1] });
  });
});

describe("dayTicks", () => {
  it("includes the first and last day, spread evenly", () => {
    assert.deepEqual(dayTicks("2026-03-01", "2026-03-09", 5), [
      "2026-03-01",
      "2026-03-03",
      "2026-03-05",
      "2026-03-07",
      "2026-03-09",
    ]);
  });

  it("never repeats a day over a short span", () => {
    assert.deepEqual(dayTicks("2026-03-01", "2026-03-02", 5), ["2026-03-01", "2026-03-02"]);
    assert.deepEqual(dayTicks("2026-03-01", "2026-03-01", 5), ["2026-03-01"]);
  });
});
