import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Decimal } from "@prisma/client/runtime/client";
import {
  combineCatalogPriceMarks,
  parsePriceCellInput,
  settlePriceMarkInput,
  type CatalogPriceMark,
} from "../../src/lib/catalog-price-mark";
import {
  foldChecklistPrices,
  pickCatalogCellFor,
  pickFormatCatalogPrice,
  pickHeadlineCatalogPrice,
  type RawCatalogPrice,
} from "../../src/lib/catalog-price";
import { aggregateHoldings, isMissingCatalogPrice, valuateCopy } from "../../src/lib/valuation";
import { fillCertificateCell } from "../../src/lib/certificate-price-fill";
import { fillConditionCell, parsePriceFactor } from "../../src/lib/condition-price-fill";
import {
  cellWriteValue,
  derivedCellAmount,
  rolledUpCellMark,
  settleCellInput,
  summarizeUmbrellaCell,
  type VariantTreeRow,
} from "../../src/lib/variant-price-cells";
import { unpricedVariantCells } from "../../src/lib/variant-price-coverage";
import { catalogPriceCells, parseCellPrice, type PriceTreeRow } from "../../src/lib/agent-api/catalog-prices";

// A catalogue price cell that says the catalogue gives no price on purpose (#1615): *does not exist*
// (it prints —) or *not determinable* (?). Neither is a missing price, an umbrella's value skips them,
// and the two grid fills treat them as the issue settled.

const D = (n: number): Decimal => n as unknown as Decimal;
const MICHEL = "michel";
const MNH = "mnh";
const MH = "mh";

function row(
  value: number | CatalogPriceMark,
  opts: { conditionId?: string; formatId?: string | null; year?: number } = {}
): RawCatalogPrice {
  return {
    price: typeof value === "number" ? D(value) : null,
    mark: typeof value === "number" ? null : value,
    currency: "EUR",
    conditionId: opts.conditionId ?? MNH,
    certificateStatusId: null,
    formatId: opts.formatId ?? null,
    catalogEdition: { year: opts.year ?? 2024, catalogNameId: MICHEL },
  };
}

const RATES = new Map<string, number | null>();

describe("parsePriceCellInput", () => {
  it("reads - and its dashes as does not exist, ? as not determinable, blank as nothing", () => {
    for (const dash of ["-", " – ", "—"]) {
      assert.deepEqual(parsePriceCellInput(dash), { kind: "mark", mark: "nonexistent" });
    }
    assert.deepEqual(parsePriceCellInput("?"), { kind: "mark", mark: "undeterminable" });
    assert.deepEqual(parsePriceCellInput("  "), { kind: "empty" });
    assert.deepEqual(parsePriceCellInput("12,50"), { kind: "amount", amount: 12.5 });
    assert.deepEqual(parsePriceCellInput("abc"), { kind: "invalid" });
  });

  it("settles a typed mark to the catalogue's sign, and leaves an amount alone", () => {
    assert.equal(settlePriceMarkInput("-"), "—");
    assert.equal(settlePriceMarkInput("?"), "?");
    assert.equal(settlePriceMarkInput("5"), null);
    assert.equal(settleCellInput("-"), "—");
    assert.equal(settleCellInput("4,5"), "4.50");
    assert.equal(settleCellInput(""), "");
    assert.equal(cellWriteValue("—"), "nonexistent");
    assert.equal(cellWriteValue("?"), "undeterminable");
    assert.equal(cellWriteValue("4.50"), 4.5);
    assert.equal(cellWriteValue(""), null);
  });
});

describe("combineCatalogPriceMarks", () => {
  it("is does not exist only when every mark is, and not determinable otherwise", () => {
    assert.equal(combineCatalogPriceMarks(["nonexistent", "nonexistent"]), "nonexistent");
    assert.equal(combineCatalogPriceMarks(["nonexistent", "undeterminable"]), "undeterminable");
    assert.equal(combineCatalogPriceMarks([]), null);
  });
});

describe("pickCatalogCellFor", () => {
  it("answers with the newest edition's row, a mark outranking an older price", () => {
    const cell = pickCatalogCellFor(
      [row(10, { year: 2020 }), row("undeterminable", { year: 2024 })],
      MICHEL,
      MNH,
      null
    );
    assert.equal(cell.picked, null);
    assert.equal(cell.mark, "undeterminable");
  });

  it("and a newer price outranks an older mark", () => {
    const cell = pickCatalogCellFor(
      [row("nonexistent", { year: 2020 }), row(7, { year: 2024 })],
      MICHEL,
      MNH,
      null
    );
    assert.equal(cell.picked?.amount, 7);
    assert.equal(cell.mark, null);
  });
});

describe("pickFormatCatalogPrice", () => {
  it("carries a marked single onto a format with no row of its own, factor or not", () => {
    const pick = pickFormatCatalogPrice([row("nonexistent")], MICHEL, MNH, null, "block4", 4.5);
    assert.equal(pick.picked, null);
    assert.equal(pick.mark, "nonexistent");
    assert.equal(pick.derived, false);
  });

  it("lets the format's own row answer over the single's mark", () => {
    const pick = pickFormatCatalogPrice(
      [row("nonexistent"), row(40, { formatId: "block4" })],
      MICHEL,
      MNH,
      null,
      "block4",
      null
    );
    assert.equal(pick.picked?.amount, 40);
    assert.equal(pick.mark, null);
  });
});

describe("pickHeadlineCatalogPrice — the umbrella roll-up", () => {
  const base = {
    ownPrices: [] as RawCatalogPrice[],
    isUmbrella: true,
    primaryCatalogNameId: MICHEL,
    displayConditionId: MNH,
    baseCurrency: "EUR",
    rates: RATES,
  };

  it("takes the lowest priced variant, a marked one not standing in the way", () => {
    const h = pickHeadlineCatalogPrice({
      ...base,
      variantPrices: [
        { prices: [row("undeterminable")], identified: true },
        { prices: [row(12)], identified: true },
        { prices: [row(30)], identified: true },
      ],
    });
    assert.equal(h.picked?.amount, 12);
    assert.equal(h.mark, null);
    assert.equal(h.uncertain, true);
  });

  it("takes the state itself when every identified variant is marked", () => {
    const all = (marks: CatalogPriceMark[]) =>
      pickHeadlineCatalogPrice({
        ...base,
        variantPrices: [
          // An intermediate umbrella with nothing of its own is valued by its children below.
          { prices: [], identified: false },
          ...marks.map((m) => ({ prices: [row(m)], identified: true })),
        ],
      });
    assert.equal(all(["nonexistent", "nonexistent"]).mark, "nonexistent");
    assert.equal(all(["nonexistent", "undeterminable"]).mark, "undeterminable");
    assert.equal(all(["nonexistent"]).uncertain, true);
  });

  it("stays not entered while any identified variant is merely empty", () => {
    const h = pickHeadlineCatalogPrice({
      ...base,
      variantPrices: [
        { prices: [row("nonexistent")], identified: true },
        { prices: [], identified: true },
      ],
    });
    assert.equal(h.picked, null);
    assert.equal(h.mark, null);
  });

  it("reads a stamp's own mark as its answer", () => {
    const h = pickHeadlineCatalogPrice({ ...base, isUmbrella: false, ownPrices: [row("nonexistent")] });
    assert.equal(h.mark, "nonexistent");
    assert.equal(h.uncertain, false);
  });
});

describe("valuateCopy", () => {
  const input = {
    conditionId: MNH,
    certificateStatusId: null,
    primaryCatalogNameId: MICHEL,
    baseCurrency: "EUR",
    rates: RATES,
  };

  it("says so on an identified copy whose cell is marked, without calling it missing", () => {
    const v = valuateCopy({ ...input, unknownVariant: false, ownPrices: [row("undeterminable")] });
    assert.equal(v.unpriced, true);
    assert.equal(v.mark, "undeterminable");
    assert.equal(isMissingCatalogPrice(v), false);
    assert.equal(isMissingCatalogPrice({ unpriced: true, mark: null }), true);
  });

  it("rolls an umbrella up past marked variants and does not list them as gaps", () => {
    const v = valuateCopy({
      ...input,
      unknownVariant: true,
      ownPrices: [],
      variantPrices: [
        { stampId: "a", prices: [row("nonexistent")] },
        { stampId: "b", prices: [row(8)] },
        { stampId: "c", prices: [] },
      ],
    });
    assert.equal(v.amount, "8.00");
    assert.equal(v.sourceStampId, "b");
    assert.deepEqual(v.unpricedVariantIds, ["c"]);
  });

  it("gives an umbrella whose variants are all marked their shared state", () => {
    const v = valuateCopy({
      ...input,
      unknownVariant: true,
      ownPrices: [],
      variantPrices: [
        { stampId: "a", prices: [row("nonexistent")] },
        { stampId: "b", prices: [row("undeterminable")] },
      ],
    });
    assert.equal(v.unpriced, true);
    assert.equal(v.mark, "undeterminable");
    assert.equal(v.uncertain, true);
    assert.deepEqual(v.unpricedVariantIds, []);
  });

  it("is counted apart in a holdings total", () => {
    const marked = valuateCopy({ ...input, unknownVariant: false, ownPrices: [row("nonexistent")] });
    const missing = valuateCopy({ ...input, unknownVariant: false, ownPrices: [] });
    const priced = valuateCopy({ ...input, unknownVariant: false, ownPrices: [row(10)] });
    const total = aggregateHoldings([marked, missing, priced], "EUR");
    assert.equal(total.totalBaseAmount, "10.00");
    assert.equal(total.pricedCount, 1);
    assert.equal(total.unpricedCount, 1);
    assert.equal(total.markedCount, 1);
  });
});

describe("foldChecklistPrices", () => {
  it("reports the stamps it left out for having no catalogue price", () => {
    const total = foldChecklistPrices(
      [{ amount: 5, currency: "EUR", older: false, estimated: false, derived: false }],
      3,
      "EUR",
      RATES,
      2
    );
    assert.equal(total?.pricedCount, 1);
    assert.equal(total?.markedCount, 2);
  });
});

describe("the fills (#1242, #1529)", () => {
  it("carries a marked None price onto an empty certificate cell", () => {
    assert.equal(fillCertificateCell({ plain: "—", current: "", percent: 120 }), "—");
    assert.equal(fillCertificateCell({ plain: "?", current: "", percent: 120 }), "?");
    // A marked certificate cell is not empty, and stays.
    assert.equal(fillCertificateCell({ plain: "10.00", current: "?", percent: 120 }), null);
  });

  it("skips a marked target and gives a marked source's target nothing", () => {
    const parsed = parsePriceFactor("0.5");
    assert.ok(parsed.ok);
    const factor = parsed.factor;
    assert.equal(fillConditionCell({ source: "—", current: "", factor }), null);
    assert.equal(fillConditionCell({ source: "?", current: "", factor }), null);
    assert.equal(fillConditionCell({ source: "10.00", current: "—", factor }), null);
    assert.equal(fillConditionCell({ source: "10.00", current: "", factor }), "5.00");
  });
});

describe("variant price cells", () => {
  const TREE: VariantTreeRow[] = [
    { stampId: "u", depth: 0, identified: false, isVariant: false },
    { stampId: "a", depth: 1, identified: true, isVariant: true },
    { stampId: "b", depth: 1, identified: true, isVariant: true },
  ];

  it("derives a marked single's mark onto a format cell", () => {
    assert.equal(derivedCellAmount("—", 4), "—");
    assert.equal(derivedCellAmount("?", null), "?");
  });

  it("rolls an umbrella cell up to the variants' shared mark", () => {
    const marks: Record<string, CatalogPriceMark> = { a: "nonexistent", b: "nonexistent" };
    assert.equal(rolledUpCellMark(TREE, "u", (id) => marks[id] ?? null), "—");
    assert.equal(rolledUpCellMark(TREE, "u", (id) => (id === "a" ? "nonexistent" : null)), null);
  });

  it("does not count a marked variant as unpriced in the umbrella's heading", () => {
    const summary = summarizeUmbrellaCell({
      rows: TREE,
      umbrellaId: "u",
      own: "",
      amountOf: (id) => (id === "b" ? 6 : null),
      markOf: (id) => (id === "a" ? "undeterminable" : null),
    });
    assert.equal(summary.value, "6.00");
    assert.equal(summary.unpricedCount, 0);
  });
});

describe("unpricedVariantCells", () => {
  it("does not ask for a cell the catalogue marks", () => {
    const cells = unpricedVariantCells({
      variants: [
        { stampId: "a", identified: true, prices: [row("nonexistent"), row(3, { conditionId: MH })] },
        { stampId: "b", identified: true, prices: [] },
      ],
      conditionIds: [MNH, MH],
      primaryCatalogNameId: MICHEL,
    });
    assert.deepEqual(cells, [
      { stampId: "b", conditionId: MNH },
      { stampId: "b", conditionId: MH },
    ]);
  });
});

describe("agent API", () => {
  it("takes -, ? and the marks' names as a price", () => {
    assert.deepEqual(parseCellPrice("-"), { ok: true, amount: "nonexistent", text: "nonexistent" });
    assert.deepEqual(parseCellPrice("?"), { ok: true, amount: "undeterminable", text: "undeterminable" });
    assert.deepEqual(parseCellPrice("Undeterminable"), {
      ok: true,
      amount: "undeterminable",
      text: "undeterminable",
    });
    assert.equal(parseCellPrice("12.5").ok, true);
  });

  it("reads a recorded mark, and an umbrella whose variants are all marked, as marks", () => {
    const rows: PriceTreeRow[] = [
      { stampId: "u", depth: 0, identified: false, isVariant: false, label: "Mi 1", name: null },
      { stampId: "a", depth: 1, identified: true, isVariant: true, label: "Mi 1a", name: null },
    ];
    const cells = catalogPriceCells({
      rows,
      prices: [
        {
          stampId: "a",
          catalogEditionId: "ed",
          conditionId: MNH,
          certificateStatusId: null,
          formatId: null,
          amount: "",
          mark: "nonexistent",
        },
      ],
      factors: [],
    });
    const byStamp = new Map(cells.map((c) => [c.stampId, c]));
    assert.equal(byStamp.get("a")?.mark, "nonexistent");
    assert.equal(byStamp.get("a")?.source, "recorded");
    assert.equal(byStamp.get("u")?.mark, "nonexistent");
    assert.equal(byStamp.get("u")?.source, "rolled_up");
    assert.equal(byStamp.get("u")?.amount, "");
  });
});
