import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PRICE_CELLS,
  agentEdition,
  catalogPriceCells,
  checkCellCount,
  parseCellPrice,
  parseCellSpec,
  resolveAxisValue,
  resolveEdition,
  summarizeCells,
  type EditionSource,
  type PriceTreeRow,
  type RecordedPrice,
} from "../../src/lib/agent-api/catalog-prices";
import { ApiError } from "../../src/lib/agent-api/errors";

// The pure half of catalogue prices through the agent API (#1540): naming an edition, the cell
// grammar, reading a price the way the grid's cell is read, and what a price reads back as — an
// umbrella's rollup and a derived format figure computed by the grid's own arithmetic. The operations
// are driven end to end in `tests/integration/agent-api-catalog-prices.test.ts`.

function refusal(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ApiError, `expected an ApiError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected a refusal");
}

const EDITIONS: EditionSource[] = [
  { id: "ed-pl-24", catalogName: "Michel Polen", vendorAbbreviation: "Mi", year: 2024, currency: "EUR" },
  { id: "ed-pl-20", catalogName: "Michel Polen", vendorAbbreviation: "Mi", year: 2020, currency: "EUR" },
  { id: "ed-fi-24", catalogName: "Fischer", vendorAbbreviation: "Fi", year: 2024, currency: "PLN" },
];

describe("resolveEdition", () => {
  it("takes an id, the book and the year, or the vendor and the year", () => {
    assert.equal(resolveEdition("ed-pl-20", EDITIONS, "edition").id, "ed-pl-20");
    assert.equal(resolveEdition("michel polen 2024", EDITIONS, "edition").id, "ed-pl-24");
    assert.equal(resolveEdition("Fi 2024", EDITIONS, "edition").id, "ed-fi-24");
  });

  it("refuses a vendor and year two books answer to, with their ids", () => {
    const two = [...EDITIONS, { id: "ed-de-24", catalogName: "Michel Deutschland", vendorAbbreviation: "Mi", year: 2024, currency: "EUR" }];
    const err = refusal(() => resolveEdition("Mi 2024", two, "edition"));
    assert.deepEqual([...(err.accepted ?? [])].sort(), ["ed-de-24", "ed-pl-24"]);
    assert.match(err.message, /list_catalog_editions/);
  });

  it("refuses an unknown edition naming the ones there are, and points at the edition list", () => {
    const err = refusal(() => resolveEdition("Scott 2024", EDITIONS, "edition"));
    assert.match(err.message, /list_catalog_editions/);
    assert.ok(err.accepted?.includes("Michel Polen 2024 (Mi 2024)"), JSON.stringify(err.accepted));
  });

  it("says so when the collection has no edition at all", () => {
    assert.match(refusal(() => resolveEdition("Mi 2024", [], "edition")).message, /no catalogue edition/);
  });
});

describe("agentEdition", () => {
  it("names an edition by its book and year and marks a primary one only when asked", () => {
    assert.deepEqual(agentEdition(EDITIONS[0]), {
      id: "ed-pl-24",
      name: "Michel Polen 2024",
      catalog: "Michel Polen",
      vendor: "Mi",
      year: 2024,
      currency: "EUR",
    });
    assert.equal(agentEdition(EDITIONS[0], true).primary, true);
  });
});

describe("resolveAxisValue", () => {
  const formats = [
    { id: "f-pair", name: "Pair", abbreviation: "Pr" },
    { id: "f-blk", name: "Block of 4", abbreviation: "Blk4" },
  ];
  const context = { vocabulary: "format", parameter: "format" } as const;

  it("reads absence and the keyword as the axis's null", () => {
    assert.equal(resolveAxisValue(null, formats, "single", context), null);
    assert.equal(resolveAxisValue(" Single ", formats, "single", context), null);
  });

  it("prefers a row of the collection's own named like the keyword", () => {
    assert.equal(resolveAxisValue("single", [...formats, { id: "f-single", name: "Single" }], "single", context), "f-single");
  });

  it("refuses an unknown value offering the keyword beside the names", () => {
    const err = refusal(() => resolveAxisValue("strip", formats, "single", context));
    assert.deepEqual(err.accepted, ["single", "Pair (Pr)", "Block of 4 (Blk4)"]);
  });
});

describe("parseCellSpec", () => {
  it("reads name=value pairs in any order, defaulting the certificate and the format", () => {
    assert.deepEqual(parseCellSpec(" price=12,50 ; Stamp = Mi 309AP;condition=MNH ", "set"), {
      ok: true,
      cell: { stamp: "Mi 309AP", condition: "MNH", certificate: null, format: null, price: "12,50" },
    });
    assert.deepEqual(parseCellSpec("stamp=s1; condition=MH; certificate=Expertised; format=Pair", "clear"), {
      ok: true,
      cell: { stamp: "s1", condition: "MH", certificate: "Expertised", format: "Pair", price: null },
    });
  });

  it("refuses a pair without a value, an unknown field and a field named twice", () => {
    for (const [entry, pattern] of [
      ["stamp=s1; condition; price=1", /not `name=value`/],
      ["stamp=s1; condition=MNH; grade=VF; price=1", /not a cell field/],
      ["stamp=s1; stamp=s2; condition=MNH; price=1", /twice/],
    ] as const) {
      const parsed = parseCellSpec(entry, "set");
      assert.equal(parsed.ok, false, entry);
      if (!parsed.ok) assert.match(parsed.reason, pattern);
    }
  });

  it("needs a price to set and refuses one on a clear", () => {
    const set = parseCellSpec("stamp=s1; condition=MNH", "set");
    assert.ok(!set.ok && /no price/.test(set.reason));
    const clear = parseCellSpec("stamp=s1; condition=MNH; price=3", "clear");
    assert.ok(!clear.ok && /takes no price/.test(clear.reason));
    const bare = parseCellSpec("condition=MNH", "clear");
    assert.ok(!bare.ok && /no stamp/.test(bare.reason));
  });
});

describe("parseCellPrice", () => {
  it("reads a price as the grid's cell does: either decimal mark, a sum, rounded to cents", () => {
    assert.deepEqual(parseCellPrice("12,5"), { ok: true, amount: 12.5, text: "12.50" });
    assert.deepEqual(parseCellPrice("2.005"), { ok: true, amount: 2.01, text: "2.01" });
    assert.deepEqual(parseCellPrice("10+2.5"), { ok: true, amount: 12.5, text: "12.50" });
    assert.deepEqual(parseCellPrice("0"), { ok: true, amount: 0, text: "0.00" });
  });

  it("refuses a negative figure, words, and one the column cannot hold", () => {
    assert.equal(parseCellPrice("-4").ok, false);
    assert.equal(parseCellPrice("twelve").ok, false);
    assert.equal(parseCellPrice("100000000").ok, false);
    assert.equal(parseCellPrice("99999999.99").ok, true);
  });
});

describe("checkCellCount", () => {
  it("refuses an empty write and one over the cap", () => {
    refusal(() => checkCellCount([], "prices"));
    refusal(() => checkCellCount(Array.from({ length: MAX_PRICE_CELLS + 1 }, () => "x"), "prices"));
    checkCellCount(Array.from({ length: MAX_PRICE_CELLS }, () => "x"), "prices");
  });
});

describe("catalogPriceCells", () => {
  // `309` is an umbrella over the variants `309A` and `309B`; `309B` is itself an umbrella over
  // `309Ba`. `310` is an ordinary stamp beside them.
  const rows: PriceTreeRow[] = [
    { stampId: "309", depth: 0, identified: false, isVariant: false, label: "Mi 309", name: null },
    { stampId: "309A", depth: 1, identified: true, isVariant: true, label: "Mi 309A", name: null },
    { stampId: "309B", depth: 1, identified: false, isVariant: true, label: "Mi 309B", name: null },
    { stampId: "309Ba", depth: 2, identified: true, isVariant: true, label: "Mi 309Ba", name: null },
    { stampId: "310", depth: 0, identified: true, isVariant: false, label: "Mi 310", name: null },
  ];
  const price = (stampId: string, amount: string, over: Partial<RecordedPrice> = {}): RecordedPrice => ({
    stampId,
    catalogEditionId: "ed",
    conditionId: "mnh",
    certificateStatusId: null,
    formatId: null,
    amount,
    ...over,
  });
  const find = (cells: ReturnType<typeof catalogPriceCells>, stampId: string, over: Partial<RecordedPrice> = {}) =>
    cells.filter(
      (c) =>
        c.stampId === stampId &&
        c.conditionId === (over.conditionId ?? "mnh") &&
        c.formatId === (over.formatId ?? null) &&
        c.certificateStatusId === (over.certificateStatusId ?? null)
    );

  it("rolls an umbrella with no price up to the lowest of its variants at any depth", () => {
    const cells = catalogPriceCells({ rows, prices: [price("309A", "4.00"), price("309Ba", "2.50")], factors: [] });
    assert.deepEqual(find(cells, "309").map((c) => [c.amount, c.source]), [["2.50", "rolled_up"]]);
    assert.deepEqual(find(cells, "309B").map((c) => [c.amount, c.source]), [["2.50", "rolled_up"]]);
    assert.deepEqual(find(cells, "309A").map((c) => [c.amount, c.source]), [["4.00", "recorded"]]);
    assert.deepEqual(find(cells, "310"), [], "an ordinary stamp with nothing recorded has no figure");
  });

  it("reports a price recorded on the umbrella as recorded, outranking the rollup", () => {
    const cells = catalogPriceCells({
      rows,
      prices: [price("309", "9.00"), price("309A", "4.00")],
      factors: [],
    });
    assert.deepEqual(find(cells, "309").map((c) => [c.amount, c.source]), [["9.00", "recorded"]]);
  });

  it("keeps every axis apart: a rollup is taken within one edition, condition, certificate and format", () => {
    const cells = catalogPriceCells({
      rows,
      prices: [price("309A", "4.00"), price("309Ba", "1.00", { conditionId: "used" }), price("309Ba", "3.00", { catalogEditionId: "old" })],
      factors: [],
    });
    const rolled = cells.filter((c) => c.stampId === "309").map((c) => [c.catalogEditionId, c.conditionId, c.amount]);
    assert.deepEqual(rolled, [
      ["ed", "mnh", "4.00"],
      ["ed", "used", "1.00"],
      ["old", "mnh", "3.00"],
    ]);
  });

  it("derives an empty format cell from the single by the multiplier, and rolls derived figures up", () => {
    const cells = catalogPriceCells({
      rows,
      prices: [price("309A", "4.00"), price("309Ba", "2.00"), price("309A", "6.00", { formatId: "pair" })],
      factors: [
        { stampId: "309A", formatId: "pair", conditionId: "mnh", factor: 2 },
        { stampId: "309Ba", formatId: "pair", conditionId: "mnh", factor: 2.5 },
      ],
    });
    const pair = { formatId: "pair" };
    assert.deepEqual(find(cells, "309A", pair).map((c) => [c.amount, c.source]), [["6.00", "recorded"]]);
    assert.deepEqual(find(cells, "309Ba", pair).map((c) => [c.amount, c.source]), [["5.00", "derived"]]);
    assert.deepEqual(find(cells, "309", pair).map((c) => [c.amount, c.source]), [["5.00", "rolled_up"]]);
  });

  it("derives nothing with no multiplier and nothing on the single", () => {
    const cells = catalogPriceCells({ rows, prices: [price("310", "1.00")], factors: [] });
    assert.deepEqual(cells.map((c) => [c.stampId, c.source]), [["310", "recorded"]]);
  });
});

describe("summarizeCells", () => {
  it("counts each outcome and names the edition and its currency", () => {
    const answer = summarizeCells(agentEdition(EDITIONS[2]), [
      { entry: "a", outcome: "written" },
      { entry: "b", outcome: "written" },
      { entry: "c", outcome: "refused", reason: "no" },
      { entry: "d", outcome: "unchanged" },
    ]);
    assert.deepEqual(
      [answer.edition, answer.currency, answer.written, answer.cleared, answer.unchanged, answer.refused],
      ["Fischer 2024", "PLN", 2, 0, 1, 1]
    );
  });
});
