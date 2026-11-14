import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  axisPosition,
  axisZones,
  colnectMarketView,
  dotAreaScale,
  dotDiameter,
  dotLegendCounts,
  parseColnectMarketReadInput,
  priceUnder,
  storeColnectMarketRead,
  type ColnectMarketOfferInput,
  type StoredColnectMarketRead,
} from "../../src/lib/colnect-market-rules";

// Check Colnect market (#2454): the read the Assistant hands over, what is kept, and the card.

const offer = (over: Partial<ColnectMarketOfferInput> = {}): ColnectMarketOfferInput => ({
  saleCode: "s1",
  grade: "4",
  gradeLabel: "U - Used",
  amount: "0.01",
  currency: "EUR",
  originalPrice: null,
  seller: "someone",
  note: null,
  ...over,
});

const input = (offers: ColnectMarketOfferInput[], signedInAs: string | null = "michalwy") => ({
  signedInAs,
  items: [{ colnectId: "60512", offers, lots: 1, unreadable: 0, truncated: false }],
});

const store = (offers: ColnectMarketOfferInput[], opts: Partial<Parameters<typeof storeColnectMarketRead>[1]> = {}) => {
  const out = storeColnectMarketRead(input(offers), {
    currency: "EUR",
    rateTo: () => null,
    ownSaleCodes: new Set(),
    ...opts,
  });
  assert.ok(out.ok);
  return out.read;
};

describe("parseColnectMarketReadInput (#2454)", () => {
  it("accepts the read as the Assistant sends it", () => {
    const parsed = parseColnectMarketReadInput(input([offer({ note: "  Oblitéré  TTB " })]));
    assert.equal(parsed?.items[0].offers[0].note, "Oblitéré TTB");
    assert.equal(parsed?.signedInAs, "michalwy");
  });

  it("refuses the whole read over one malformed listing — a strip with holes is a wrong answer", () => {
    assert.equal(parseColnectMarketReadInput(input([offer(), offer({ amount: "abc" })])), null);
    assert.equal(parseColnectMarketReadInput(input([offer({ amount: "0" })])), null);
    assert.equal(parseColnectMarketReadInput(input([offer({ currency: "€" })])), null);
    assert.equal(parseColnectMarketReadInput(input([offer({ grade: "U" })])), null);
    assert.equal(
      parseColnectMarketReadInput({ signedInAs: null, items: [{ colnectId: "1/../2", offers: [], lots: 0, unreadable: 0 }] }),
      null
    );
    assert.equal(parseColnectMarketReadInput("nope"), null);
  });
});

describe("storeColnectMarketRead (#2454)", () => {
  it("keeps a price Colnect showed in the offer's currency as it is, marked where Colnect converted it", () => {
    const read = store([offer({ amount: "0.5" }), offer({ saleCode: "s2", originalPrice: "A$ 0.01" })]);
    assert.deepEqual(
      read.items[0].offers.map((o) => [o.amount, o.converted, o.original]),
      [
        ["0.50", false, null],
        ["0.01", true, "A$ 0.01"],
      ]
    );
  });

  it("converts a price shown in another currency at the rate the app holds, and says so", () => {
    const read = store([offer({ amount: "1.00" })], { currency: "PLN", rateTo: (c) => (c === "EUR" ? 4.25 : null) });
    assert.deepEqual(read.items[0].offers[0], {
      grade: "4",
      gradeLabel: "U - Used",
      amount: "4.25",
      converted: true,
      original: "1.00 EUR",
      note: null,
      own: false,
    });
    assert.equal(read.currency, "PLN");
  });

  it("refuses a read it cannot convert rather than keeping prices in the wrong money", () => {
    const out = storeColnectMarketRead(input([offer()]), { currency: "PLN", rateTo: () => null, ownSaleCodes: new Set() });
    assert.equal(out.ok, false);
  });

  it("marks the collector's own listings — by the login read as, or by a sale code an offer records", () => {
    const read = store(
      [offer({ seller: "MichalWy" }), offer({ saleCode: "mine", seller: "other" }), offer({ saleCode: "s3" })],
      { ownSaleCodes: new Set(["mine"]) }
    );
    assert.deepEqual(read.items[0].offers.map((o) => o.own), [true, true, false]);
  });

  it("keeps nothing about who the other sellers are", () => {
    const read = store([offer({ seller: "someone" })]);
    assert.equal(JSON.stringify(read).includes("someone"), false);
  });
});

describe("colnectMarketView (#2454)", () => {
  const stored = (): StoredColnectMarketRead =>
    store([
      offer({ amount: "0.01" }),
      offer({ saleCode: "a", amount: "0.01" }),
      offer({ saleCode: "b", amount: "0.03" }),
      offer({ saleCode: "c", amount: "1.00" }),
      offer({ saleCode: "d", grade: "1", gradeLabel: "MNH - Mint Never Hinged", amount: "10.00", note: "Superb" }),
      offer({ saleCode: "e", grade: "1", amount: "8.00", seller: "michalwy" }),
      offer({ saleCode: "f", grade: "9", gradeLabel: "Damaged", amount: "0.05" }),
    ]);
  const names = new Map([
    ["4", ["Used"]],
    ["1", ["Mint", "Mint**"]],
  ]);

  it("draws a row for every Colnect condition, named by the collector's own, Colnect's grade beside it", () => {
    const view = colnectMarketView(stored(), [{ colnectId: "60512", label: "Mi·PT 789", grades: ["4"] }], names);
    const rows = view.items[0].rows!;
    assert.deepEqual(
      rows.map((r) => [r.name, r.colnectGrade, r.count]),
      [
        ["Mint / Mint**", "MNH", 1],
        ["MH - Mint Hinged", null, 0],
        ["MNG - Mint No Gum", null, 0],
        ["Used", "U", 4],
        ["CTO - Cancelled To Order", null, 0],
        ["Damaged", null, 1],
      ]
    );
    assert.equal(view.anyListings, true);
  });

  it("highlights the offer's own condition", () => {
    const view = colnectMarketView(stored(), [{ colnectId: "60512", label: "x", grades: ["4"] }], names);
    assert.deepEqual(view.items[0].rows!.filter((r) => r.highlighted).map((r) => r.key), ["4"]);
  });

  it("recedes every condition but the offer's own (#2469)", () => {
    const rows = colnectMarketView(stored(), [{ colnectId: "60512", label: "x", grades: ["4"] }], names).items[0].rows!;
    assert.deepEqual(rows.filter((r) => !r.receded).map((r) => r.key), ["4"]);
  });

  it("keeps every row of several own conditions in full (#2469)", () => {
    const rows = colnectMarketView(stored(), [{ colnectId: "60512", label: "x", grades: ["1", "4"] }], names).items[0].rows!;
    assert.deepEqual(rows.filter((r) => !r.receded).map((r) => r.key), ["1", "4"]);
  });

  it("recedes nothing where the offer has no own row (#2469)", () => {
    for (const grades of [[], ["99"]]) {
      const rows = colnectMarketView(stored(), [{ colnectId: "60512", label: "x", grades }], names).items[0].rows!;
      assert.equal(rows.some((r) => r.receded), false);
    }
  });

  it("gives lowest, median and count, the collector's own listings left out and counted apart", () => {
    const rows = colnectMarketView(stored(), [{ colnectId: "60512", label: "x", grades: [] }], names).items[0].rows!;
    const used = rows.find((r) => r.key === "4")!;
    assert.deepEqual([used.lowest, used.median, used.count, used.ownCount], ["0.01", "0.02", 4, 0]);
    const mint = rows.find((r) => r.key === "1")!;
    assert.deepEqual([mint.lowest, mint.median, mint.count, mint.ownCount], ["10.00", "10.00", 1, 1]);
    assert.equal(mint.dots[0].note, "Superb");
  });

  it("puts every row of one read on one logarithmic axis", () => {
    const rows = colnectMarketView(stored(), [{ colnectId: "60512", label: "x", grades: [] }], names).items[0].rows!;
    const used = rows.find((r) => r.key === "4")!;
    const mint = rows.find((r) => r.key === "1")!;
    // 0.01 → 1.00 is the same distance as 0.10 → 10.00 would be: two decades.
    const decade = (used.dots[3].position - used.dots[0].position) / 2;
    assert.ok(Math.abs(mint.dots[0].position - used.dots[0].position - 3 * decade) < 1e-9);
    for (const dot of rows.flatMap((r) => r.dots)) assert.ok(dot.position > 0 && dot.position < 1);
  });

  it("says when nothing is on sale, and when an item of the offer was not read", () => {
    const empty = store([]);
    const view = colnectMarketView(
      empty,
      [
        { colnectId: "60512", label: "x", grades: [] },
        { colnectId: "777", label: "y", grades: [] },
      ],
      names
    );
    assert.equal(view.anyListings, false);
    assert.equal(view.items[0].rows!.every((r) => r.count === 0 && r.lowest === null), true);
    assert.equal(view.items[1].rows, null);
  });
});

describe("priceUnder (#2454)", () => {
  it("prices just under, by the platform's step or a cent", () => {
    assert.equal(priceUnder("1.00", null), "0.99");
    assert.equal(priceUnder("1.00", "0.05"), "0.95");
    assert.equal(priceUnder("0.29", "0.01"), "0.28");
  });

  it("never goes below a cent", () => {
    assert.equal(priceUnder("0.01", "0.01"), "0.01");
    assert.equal(priceUnder("0.03", "0.50"), "0.01");
  });
});

describe("colnectMarketView ticks (#2454)", () => {
  it("labels round figures along the axis, in order", () => {
    const read = storeColnectMarketRead(
      input([offer({ amount: "0.01" }), offer({ saleCode: "b", amount: "1.00" })]),
      { currency: "EUR", rateTo: () => null, ownSaleCodes: new Set() }
    );
    assert.ok(read.ok);
    const view = colnectMarketView(read.read, [{ colnectId: "60512", label: "x", grades: [] }], new Map());
    assert.deepEqual(
      view.ticks.map((t) => t.label),
      ["0.01", "0.02", "0.05", "0.1", "0.2", "0.5", "1"]
    );
    const positions = view.ticks.map((t) => t.position);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  });
});

describe("colnectMarketView reads at a glance (#2464)", () => {
  const view = (offers: ColnectMarketOfferInput[]) => {
    const read = storeColnectMarketRead(input(offers), { currency: "EUR", rateTo: () => null, ownSaleCodes: new Set() });
    assert.ok(read.ok);
    return colnectMarketView(read.read, [{ colnectId: "60512", label: "x", grades: [] }], new Map());
  };

  it("draws several offers at one price as one dot with their count", () => {
    const used = view([
      offer({ saleCode: "a", amount: "0.40" }),
      offer({ saleCode: "b", amount: "0.40", note: "Nice" }),
      offer({ saleCode: "c", amount: "1.20" }),
    ]).items[0].rows!.find((r) => r.key === "4")!;
    assert.deepEqual(
      used.groups.map((g) => [g.amount, g.count, g.notes]),
      [
        ["0.40", 2, ["Nice"]],
        ["1.20", 1, []],
      ]
    );
    assert.equal(used.dots.length, 3);
    assert.equal(used.groups[0].position, used.dots[0].position);
  });

  it("gives a narrow read a scale of a few 1-2-5 values, never one", () => {
    const v = view([offer({ amount: "1.00" })]);
    assert.deepEqual(
      v.ticks.map((t) => t.label),
      ["0.5", "1", "2"]
    );
    assert.equal(v.ticks[0].position, 0);
    assert.ok(Math.abs(v.ticks[2].position - 1) < 1e-9);
  });

  it("falls back to the decades where 1-2-5 would crowd the scale", () => {
    const v = view([offer({ saleCode: "a", amount: "0.01" }), offer({ saleCode: "b", amount: "50.00" })]);
    assert.deepEqual(
      v.ticks.map((t) => t.label),
      ["0.01", "0.1", "1", "10"]
    );
  });

  it("places the offer's own price on the axis, at an end when outside it, nowhere without one", () => {
    const v = view([offer({ saleCode: "a", amount: "0.10" }), offer({ saleCode: "b", amount: "1.00" })]);
    const inside = axisPosition(v.axis, "0.10")!;
    assert.equal(inside.outside, null);
    assert.ok(Math.abs(inside.position - v.items[0].rows!.find((r) => r.key === "4")!.dots[0].position) < 1e-9);
    assert.deepEqual(axisPosition(v.axis, "500.00"), { position: 1, outside: "above" });
    assert.deepEqual(axisPosition(v.axis, "0.001"), { position: 0, outside: "below" });
    assert.equal(axisPosition(v.axis, null), null);
    assert.equal(axisPosition(v.axis, "0.00"), null);
  });
});

describe("colnectMarketView dot sizes (#2473)", () => {
  /** `count` listings at each price, every one in grade `grade`. */
  const listings = (groups: readonly (readonly [string, number, string?])[]) =>
    groups.flatMap(([amount, n, grade = "4"], g) =>
      Array.from({ length: n }, (_, i) => offer({ saleCode: `${g}-${i}`, amount, grade }))
    );
  const view = (offers: ColnectMarketOfferInput[]) => {
    const read = storeColnectMarketRead(input(offers), { currency: "EUR", rateTo: () => null, ownSaleCodes: new Set() });
    assert.ok(read.ok);
    return colnectMarketView(read.read, [{ colnectId: "60512", label: "x", grades: ["4"] }], new Map());
  };

  it("scales to the largest group of the read, not to fixed thresholds", () => {
    const small = view(listings([["0.10", 1], ["0.20", 3]]));
    assert.equal(small.largestGroup, 3);
    assert.equal(dotAreaScale(3, small.largestGroup), 1);
    const large = view(listings([["0.10", 1], ["0.20", 3], ["0.50", 40]]));
    assert.equal(large.largestGroup, 40);
    assert.ok(dotAreaScale(3, large.largestGroup) < 0.1);
    assert.equal(dotAreaScale(40, large.largestGroup), 1);
    assert.equal(dotAreaScale(1, large.largestGroup), 0);
  });

  it("shares one scale across every row of the read, receded rows included", () => {
    const v = view(listings([["0.10", 2, "4"], ["1.00", 7, "1"]]));
    assert.equal(v.largestGroup, 7);
  });

  it("grows a dot's area, not its width, in proportion to its count", () => {
    assert.equal(dotDiameter(0, 12, 24), 12);
    assert.equal(dotDiameter(1, 12, 24), 24);
    const half = dotDiameter(0.5, 12, 24);
    assert.ok(Math.abs(half ** 2 - (12 ** 2 + 24 ** 2) / 2) < 1e-9);
  });

  it("draws every dot the smallest when every group is one offer", () => {
    const v = view(listings([["0.10", 1], ["0.20", 1]]));
    assert.equal(v.largestGroup, 1);
    assert.equal(dotAreaScale(1, v.largestGroup), 0);
    assert.deepEqual(dotLegendCounts(1), [1]);
  });

  it("names one offer, about half the largest group and the largest in the legend, each once", () => {
    assert.deepEqual(dotLegendCounts(40), [1, 20, 40]);
    assert.deepEqual(dotLegendCounts(3), [1, 2, 3]);
    assert.deepEqual(dotLegendCounts(2), [1, 2]);
    assert.deepEqual(dotLegendCounts(0), [1]);
  });
});

describe("the offer's price zones on the market's axis (#2523)", () => {
  // A logarithmic axis from 0.10 to 10.00: 1.00 sits halfway.
  const axis = { lo: 0.1, hi: 10 };
  const round = (zones: Array<{ key: string; start: number; end: number }>) =>
    zones.map((z) => [z.key, Number(z.start.toFixed(3)), Number(z.end.toFixed(3))]);

  it("places each zone at its prices on the log axis, the first from the left end", () => {
    const zones = axisZones(axis, [
      { key: "below", from: 0, to: 0.4 },
      { key: "minimumCost", from: 0.4, to: 1 },
      { key: "costEstimated", from: 1, to: 2 },
      { key: "aboveCatalogue", from: 2, to: null },
    ]);
    assert.deepEqual(round(zones), [
      ["below", 0, 0.301],
      ["minimumCost", 0.301, 0.5],
      ["costEstimated", 0.5, 0.651],
      ["aboveCatalogue", 0.651, 1],
    ]);
  });

  it("keeps the axis's scale: a zone past either end is cut at that end, one wholly outside it dropped", () => {
    const zones = axisZones(axis, [
      { key: "below", from: 0, to: 0.05 },
      { key: "minimumCost", from: 0.05, to: 0.5 },
      { key: "estimatedCatalogue", from: 0.5, to: 40 },
      { key: "aboveCatalogue", from: 40, to: null },
    ]);
    assert.deepEqual(round(zones), [
      ["minimumCost", 0, 0.349],
      ["estimatedCatalogue", 0.349, 1],
    ]);
  });

  it("puts a price above Catalogue on the Above Cat. tint", () => {
    const zones = axisZones(axis, [
      { key: "estimatedCatalogue", from: 1.19, to: 2 },
      { key: "aboveCatalogue", from: 2, to: null },
    ]);
    const dot = axisPosition(axis, "3.50")!.position;
    assert.equal(zones.find((z) => z.start <= dot && dot <= z.end)?.key, "aboveCatalogue");
  });
});
