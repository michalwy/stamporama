import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  valuePiece,
  type Franking,
  type PieceComponent,
  type PieceKind,
  type ValuationMethod,
} from "../../src/lib/piece-valuation";
import {
  inheritedMethodLabel,
  methodSourceText,
  missingPricesText,
  onPiecePrice,
  pieceArithmetic,
  pieceValueRule,
  priceHeading,
  unmappedRolesText,
} from "../../src/lib/piece-value-words";
import type { PiecePrice } from "../../src/lib/piece-valuation";
import type { PieceColumn } from "../../src/lib/valuation-method-roles";

// How a piece's value was reached (#2353): the terms the rule records as it adds, and the arithmetic
// the Valuation window and the identification step print from them. The rules themselves are
// `piece-valuation.test.ts`; what is pinned here is that every rule's terms add up to its figure and
// read as the catalogue states it — each price named by the condition its method maps it to (#2375).

function stamp(id: string, prices: Partial<PieceComponent> = {}): PieceComponent {
  return {
    id: `e-${id}`,
    stampId: id,
    quantity: 1,
    multiple: false,
    used: 10,
    usedSingle: 10,
    coverEf: 40,
    coverMef: 60,
    coverMif: 30,
    onPiece: 15,
    ...prices,
  };
}

const A = stamp("a", { used: 10, usedSingle: 10, coverEf: 40, coverMef: 60, coverMif: 30, onPiece: 15 });
const B = stamp("b", { used: 4, usedSingle: 4, coverEf: 12, coverMef: 18, coverMif: 50, onPiece: 6 });
const LABELS: Record<string, string> = { "e-a": "Mi 123", "e-b": "Mi 124" };
const label = (id: string) => LABELS[id] ?? id;

const column = (abbreviation: string, symbol: string | null = null): PieceColumn => ({
  conditionId: abbreviation,
  abbreviation,
  symbol,
});

/** The conditions a collection might map — the catalogues' own symbols where they print one. */
function columnsFor(method: ValuationMethod): Partial<Record<PiecePrice, PieceColumn>> {
  const used = column("U", "⊙");
  const onPiece = column("Bfst");
  switch (method) {
    case "michel":
      return { used, cover_ef: column("EF"), cover_mef: column("MeF"), cover_mif: column("MiF"), on_piece: onPiece };
    case "fischer":
      return { used, cover_mif: column("Cover", "⊠"), on_piece: onPiece };
    case "fischer_fp_fw_fm":
      return { used, cover_ef: column("FP"), cover_mef: column("FW"), cover_mif: column("FM"), on_piece: onPiece };
    case "sum_of_used":
      return { used };
  }
}

function read(
  method: ValuationMethod,
  kind: PieceKind | null,
  franking: Franking,
  components: PieceComponent[]
) {
  const result = valuePiece({ method, kind, franking, components });
  const piece = { ...result, method, kind, components, columns: columnsFor(method) };
  return { result, arithmetic: pieceArithmetic(piece, label), onPiece: onPiecePrice(piece) };
}

describe("pieceArithmetic — the figure as a sum the catalogue can check", () => {
  it("prints Fischer's mixed franking as 50 % of the highest ⊠ plus the others at used prices", () => {
    const { result, arithmetic } = read("fischer", "on_cover", "rate_correct", [A, B]);
    assert.equal(arithmetic, "MiF: 50 % × Mi 124 ⊠ 50.00 + Mi 123 ⊙ 10.00 = 35.00");
    assert.equal(result.amount, 35);
  });

  it("prints Fischer's multiple franking as 150 % of ⊠ and the further stamps", () => {
    const { arithmetic } = read("fischer", "on_cover", "rate_correct", [{ ...A, quantity: 3 }]);
    assert.equal(arithmetic, "MeF: 150 % × Mi 123 ⊠ 30.00 + Mi 123 ⊙ 10.00 = 55.00");
  });

  it("prints Michel's MiF as the one highest MiF price", () => {
    const { arithmetic } = read("michel", "on_cover", "rate_correct", [A, B]);
    assert.equal(arithmetic, "MiF: Mi 124 MiF 50.00 = 50.00");
  });

  it("prints Michel's philatelic cover as 115 % of the most expensive used price", () => {
    const { arithmetic, result } = read("michel", "on_cover", "philatelic_posted", [A, B]);
    assert.equal(arithmetic, "Philatelic: 115 % × Mi 123 ⊙ 10.00 = 11.50");
    assert.equal(result.amount, 11.5);
  });

  it("names Fischer FP/FW/FM's prices as the catalogue does", () => {
    assert.equal(read("fischer_fp_fw_fm", "on_cover", "rate_correct", [A]).arithmetic, "EF: Mi 123 FP 40.00 = 40.00");
  });

  it("prints a sum with each quantity, and a missing price as a dash where it would be added", () => {
    const { arithmetic, result } = read("sum_of_used", "on_cover", "rate_correct", [
      { ...A, quantity: 2 },
      { ...B, used: null },
    ]);
    assert.equal(arithmetic, "Sum of used: Mi 123 ⊙ 10.00 × 2 + Mi 124 ⊙ — = 20.00");
    assert.equal(result.partial, true);
  });

  it("adds up to the figure in whole cents, term by term", () => {
    const odd = stamp("a", { coverMif: 0.33, used: 0.07 });
    const { arithmetic, result } = read("fischer", "on_cover", "rate_correct", [odd, { ...B, coverMif: 0.01 }]);
    assert.equal(arithmetic, "MiF: 50 % × Mi 123 ⊠ 0.33 + Mi 124 ⊙ 4.00 = 4.17");
    assert.equal(result.amount, 4.17);
  });

  it("prints nothing when the rule added nothing", () => {
    // The highest MiF of stamps none of which has one: missing, never a term.
    const { arithmetic, result } = read("michel", "on_cover", "rate_correct", [
      { ...A, coverMif: null },
      { ...B, coverMif: null },
    ]);
    assert.equal(arithmetic, null);
    assert.equal(result.missing.length, 2);
  });
});

describe("naming a price by its condition (#2375)", () => {
  it("heads a column by the mapped condition's abbreviation, and by its role while it is not set up", () => {
    const piece = { method: "fischer_fp_fw_fm" as const, columns: columnsFor("fischer_fp_fw_fm") };
    assert.equal(priceHeading(piece, "cover_mif"), "FM");
    assert.equal(priceHeading(piece, "used"), "U");
    assert.equal(priceHeading({ method: "fischer" as const, columns: {} }, "cover_mif"), "Cover ⊠");
  });

  it("counts missing prices under their conditions' names", () => {
    const { result } = read("michel", "on_cover", "rate_correct", [
      { ...A, coverMif: null },
      { ...B, coverMif: null },
    ]);
    assert.equal(
      missingPricesText({ ...result, method: "michel", columns: columnsFor("michel") }),
      "MiF price missing for 2 stamps"
    );
  });

  it("says which roles of which method are not set up", () => {
    assert.equal(unmappedRolesText([]), null);
    assert.equal(unmappedRolesText([{ method: "fischer", role: "cover" }]), "Fischer's Cover ⊠ is not set up");
    assert.equal(
      unmappedRolesText([
        { method: "michel", role: "cover_mif" },
        { method: "michel", role: "never_hinged" },
      ]),
      "Michel's Cover MiF and Never hinged are not set up"
    );
  });

  it("marks a price Michel's rule worked out as derived", () => {
    const ruled = { ...A, coverEf: 12, derived: ["cover_ef" as const] };
    assert.equal(read("michel", "on_cover", "rate_correct", [ruled]).arithmetic, "EF: Mi 123 EF ~12.00 = 12.00");
  });
});

describe("onPiecePrice — which price each stamp shows beside its used one", () => {
  it("is the cover price the franking on the piece names", () => {
    assert.equal(read("michel", "on_cover", "rate_correct", [A]).onPiece, "cover_ef");
    assert.equal(read("michel", "on_cover", "rate_correct", [{ ...A, quantity: 2 }]).onPiece, "cover_mef");
    assert.equal(read("michel", "on_cover", "not_posted", [A, B]).onPiece, "cover_mif");
  });

  it("is ⊠ under Fischer whatever is on the cover, on piece on a fragment, and none without a kind", () => {
    assert.equal(read("fischer", "on_cover", "rate_correct", [A]).onPiece, "cover_mif");
    assert.equal(read("michel", "on_piece", "rate_correct", [A, B]).onPiece, "on_piece");
    assert.equal(read("michel", null, "rate_correct", [A, B]).onPiece, null);
  });
});

describe("the method beside a piece — where it came from, and what As inherited names (#2369)", () => {
  const fromPoland = { method: "fischer" as const, areaId: "pl", areaName: "Poland" };
  const fromCollection = { method: "michel" as const, areaId: null, areaName: null };

  it("names the method inherited and where it comes from", () => {
    assert.equal(inheritedMethodLabel(fromPoland), "As inherited (Fischer, from Poland)");
    assert.equal(inheritedMethodLabel(fromCollection), "As inherited (Michel, the collection's default)");
  });

  it("says a copy's own method is its own, and an inherited one where it comes from", () => {
    assert.equal(methodSourceText({ methodSource: { kind: "copy" }, inherited: fromPoland }), "set on this copy");
    assert.equal(
      methodSourceText({ methodSource: { kind: "area", areaId: "pl" }, inherited: fromPoland }),
      "from Poland"
    );
    assert.equal(
      methodSourceText({ methodSource: { kind: "collection" }, inherited: fromCollection }),
      "the collection's default"
    );
  });

  it("tells a piece without a kind to take a format with one, not another method", () => {
    const result = valuePiece({ method: "michel", kind: null, franking: "rate_correct", components: [A, B] });
    const rule = pieceValueRule({
      ...result,
      unmapped: [],
      columns: {},
      method: "michel",
      methodSource: { kind: "collection" },
      inherited: fromCollection,
      franking: "rate_correct",
      kind: null,
      components: [A, B],
    });
    assert.match(rule, /neither on cover nor on piece/);
    assert.match(rule, /give it a format of kind On cover or On piece/);
  });
});
