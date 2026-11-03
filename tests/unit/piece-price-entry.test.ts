import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  piecePricesRead,
  type Franking,
  type PieceKind,
  type PiecePrice,
  type ValuationMethod,
} from "../../src/lib/piece-valuation";
import {
  changedPiecePrices,
  parseTypedPiecePrices,
  piecePriceKey,
  piecePriceOfKey,
  piecePriceSlots,
} from "../../src/lib/piece-price-entry";

// A piece's stamp prices typed in place (#2368): which prices each row asks for, which row carries
// each field, and what a save sends.

function entry(stampId: string, quantity = 1, multiple = false, id = `e-${stampId}`) {
  return { id, stampId, quantity, multiple };
}

function read(
  method: ValuationMethod,
  kind: PieceKind | null,
  franking: Franking,
  components: ReturnType<typeof entry>[]
): Record<string, PiecePrice[]> {
  return Object.fromEntries(piecePricesRead({ method, kind, franking, components }));
}

describe("piecePricesRead", () => {
  it("asks every stamp's used price under Sum of used, a cover not posted and a piece with no kind", () => {
    const two = [entry("a"), entry("b")];
    const all = { "e-a": ["used"], "e-b": ["used"] };
    assert.deepEqual(read("sum_of_used", "on_cover", "rate_correct", two), all);
    assert.deepEqual(read("michel", "on_cover", "not_posted", two), all);
    assert.deepEqual(read("michel", null, "rate_correct", two), all);
  });

  it("asks every stamp's on-piece price on a fragment", () => {
    assert.deepEqual(read("fischer", "on_piece", "rate_correct", [entry("a"), entry("b")]), {
      "e-a": ["on_piece"],
      "e-b": ["on_piece"],
    });
  });

  it("asks Michel's rate-correct cover for the price its franking names", () => {
    assert.deepEqual(read("michel", "on_cover", "rate_correct", [entry("a")]), { "e-a": ["cover_ef"] });
    assert.deepEqual(read("michel", "on_cover", "rate_correct", [entry("a", 2)]), { "e-a": ["cover_mef"] });
    // MiF: every stamp's MiF is compared for the highest, so each is asked — the same stamp once.
    assert.deepEqual(
      read("michel", "on_cover", "rate_correct", [entry("a"), entry("b"), entry("a", 1, false, "e-a2")]),
      { "e-a": ["cover_mif"], "e-b": ["cover_mif"], "e-a2": [] }
    );
  });

  it("asks a philatelic cover for each stamp's used price", () => {
    assert.deepEqual(read("michel", "on_cover", "philatelic_posted", [entry("a"), entry("b")]), {
      "e-a": ["used"],
      "e-b": ["used"],
    });
  });

  it("asks Fischer's MeF for ⊠ of the first and the used price of the third stamp on", () => {
    assert.deepEqual(read("fischer", "on_cover", "rate_correct", [entry("a", 2)]), { "e-a": ["cover_mif"] });
    assert.deepEqual(read("fischer", "on_cover", "rate_correct", [entry("a", 3)]), {
      "e-a": ["cover_mif", "used"],
    });
  });

  it("asks Fischer's MiF for every stamp's ⊠ and used price, whichever wins", () => {
    assert.deepEqual(read("fischer", "on_cover", "rate_correct", [entry("a"), entry("b")]), {
      "e-a": ["cover_mif", "used"],
      "e-b": ["cover_mif", "used"],
    });
  });
});

describe("piecePriceSlots", () => {
  const columns: PiecePrice[] = ["used", "cover_mif"];

  it("gives each row the fields it reads, the same stamp's later row pointing at the first", () => {
    const rows = [entry("a"), entry("b"), entry("a", 1, false, "e-a2")];
    const slots = piecePriceSlots(
      rows,
      new Map([
        ["e-a", ["cover_mif", "used"]],
        ["e-b", ["cover_mif"]],
        ["e-a2", ["used"]],
      ]),
      columns,
      () => null
    );
    // Column order, whatever order the rule read them in.
    assert.deepEqual(
      slots[0].slots.map((s) => [s.price, s.entryIndex]),
      [
        ["used", 0],
        ["cover_mif", 0],
      ]
    );
    assert.deepEqual(slots[1].slots.map((s) => [s.price, s.entryIndex]), [["cover_mif", 1]]);
    assert.deepEqual(slots[2].slots.map((s) => [s.key, s.entryIndex]), [[piecePriceKey("a", "used"), 0]]);
  });

  it("asks an umbrella's variants instead of the umbrella", () => {
    const slots = piecePriceSlots(
      [entry("u"), entry("v1")],
      new Map([
        ["e-u", ["cover_mif"]],
        ["e-v1", ["cover_mif"]],
      ]),
      columns,
      (stampId) => (stampId === "u" ? ["v1", "v2"] : null)
    );
    assert.deepEqual(slots[0].slots, []);
    assert.deepEqual(
      slots[0].variants!.map((v) => [v.stampId, v.slots.map((s) => [s.price, s.entryIndex])]),
      [
        ["v1", [["cover_mif", 0]]],
        ["v2", [["cover_mif", 0]]],
      ]
    );
    // The variant is also on the piece on its own, after its umbrella: it is typed under the umbrella.
    assert.equal(slots[1].slots[0].entryIndex, 0);
  });
});

describe("changedPiecePrices", () => {
  const fields = [piecePriceOfKey(piecePriceKey("a", "used")), piecePriceOfKey(piecePriceKey("b", "cover_mif"))];
  const recorded = (key: string) => (key === piecePriceKey("a", "used") ? "1.50" : null);

  it("sends what differs from what is on file, a comma read as a point", () => {
    assert.deepEqual(changedPiecePrices({ [piecePriceKey("a", "used")]: "1,50" }, recorded, fields), {
      changes: [],
      invalid: false,
    });
    assert.deepEqual(
      changedPiecePrices({ [piecePriceKey("a", "used")]: "2", [piecePriceKey("b", "cover_mif")]: "?" }, recorded, fields),
      {
        changes: [
          { stampId: "a", price: "used", amount: "2" },
          { stampId: "b", price: "cover_mif", amount: "?" },
        ],
        invalid: false,
      }
    );
  });

  it("sends nothing for a blank field and refuses what is not a price", () => {
    assert.deepEqual(changedPiecePrices({ [piecePriceKey("a", "used")]: "  " }, recorded, fields), {
      changes: [],
      invalid: false,
    });
    assert.equal(changedPiecePrices({ [piecePriceKey("b", "cover_mif")]: "abc" }, recorded, fields).invalid, true);
  });

  it("leaves out a field no longer shown", () => {
    assert.deepEqual(changedPiecePrices({ [piecePriceKey("c", "used")]: "3" }, recorded, fields).changes, []);
  });
});

describe("parseTypedPiecePrices", () => {
  it("keeps only well-formed prices", () => {
    assert.deepEqual(
      parseTypedPiecePrices([
        { stampId: "a", price: "cover_ef", amount: "1" },
        { stampId: "a", price: "bogus", amount: "1" },
        { stampId: 3, price: "used", amount: "1" },
        null,
      ]),
      [{ stampId: "a", price: "cover_ef", amount: "1" }]
    );
    assert.deepEqual(parseTypedPiecePrices("nope"), []);
  });
});
