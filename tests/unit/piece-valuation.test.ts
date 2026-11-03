import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  coverUsage,
  isPiece,
  mostExpensiveStamp,
  resolveMethod,
  valuePiece,
  type Franking,
  type MethodArea,
  type PieceComponent,
  type PieceKind,
  type ValuationMethod,
} from "../../src/lib/piece-valuation";
import { convertRecordedValue } from "../../src/lib/piece-value-conversion-rules";

// How a piece is valued by its method (#2359; ADR-0076). Every figure below is in the collection
// currency, as `item-valuation.ts` hands the prices in.

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

function value(
  method: ValuationMethod,
  kind: PieceKind | null,
  franking: Franking,
  components: PieceComponent[]
) {
  return valuePiece({ method, kind, franking, components });
}

const A = stamp("a", { used: 10, usedSingle: 10, coverEf: 40, coverMef: 60, coverMif: 30, onPiece: 15 });
const B = stamp("b", { used: 4, usedSingle: 4, coverEf: 12, coverMef: 18, coverMif: 50, onPiece: 6 });
const twoOfA = { ...A, quantity: 2 };
const threeOfA = { ...A, quantity: 3 };
const blockOfA = { ...A, id: "e-a-blk", multiple: true, used: 50, usedSingle: 10 };

describe("isPiece — which copies a method values", () => {
  it("is a copy carrying several stamps, or one on a format of a kind", () => {
    assert.equal(isPiece(1, null), false);
    assert.equal(isPiece(2, null), true);
    assert.equal(isPiece(1, "on_cover"), true);
    assert.equal(isPiece(1, "on_piece"), true);
  });
});

describe("coverUsage — EF, MeF or MiF counts stamps, not rows", () => {
  it("is EF for one stamp once", () => assert.equal(coverUsage([A]), "ef"));
  it("is MeF for one stamp several times", () => assert.equal(coverUsage([twoOfA]), "mef"));
  it("is MeF for a block of one stamp on the cover", () => assert.equal(coverUsage([blockOfA]), "mef"));
  it("is MeF for one stamp as a single and as a block", () =>
    assert.equal(coverUsage([A, blockOfA]), "mef"));
  it("is MiF for more than one stamp", () => assert.equal(coverUsage([A, B]), "mif"));
});

describe("Michel", () => {
  it("values a fragment at the sum of on-piece prices, whatever the franking", () => {
    for (const franking of ["rate_correct", "philatelic_posted", "not_posted"] as const) {
      const r = value("michel", "on_piece", franking, [twoOfA, B]);
      assert.equal(r.amount, 15 * 2 + 6);
      assert.equal(r.rule, "on_piece");
    }
  });

  it("values a rate-correct EF cover at its EF price", () => {
    const r = value("michel", "on_cover", "rate_correct", [A]);
    assert.equal(r.amount, 40);
    assert.equal(r.usage, "ef");
  });

  it("values a rate-correct MeF cover at the MeF price, a block on the cover included", () => {
    assert.equal(value("michel", "on_cover", "rate_correct", [twoOfA]).amount, 60);
    const block = value("michel", "on_cover", "rate_correct", [blockOfA]);
    assert.equal(block.amount, 60);
    assert.equal(block.usage, "mef");
  });

  it("values a rate-correct MiF cover at the highest MiF price, the rest adding nothing", () => {
    const r = value("michel", "on_cover", "rate_correct", [A, B]);
    assert.equal(r.amount, 50);
    assert.equal(r.rule, "highest_mif");
    assert.equal(r.partial, false);
  });

  it("values a philatelic, posted cover at the most expensive used price + 15 %", () => {
    const r = value("michel", "on_cover", "philatelic_posted", [A, { ...B, used: 1, usedSingle: 1 }]);
    assert.equal(r.amount, 11.5);
    assert.equal(r.rule, "philatelic");
    assert.deepEqual(r.floor, { amount: 11, ruleAmount: 11.5, applied: false });
  });

  it("values a cover not posted at the sum of used prices", () => {
    const r = value("michel", "on_cover", "not_posted", [twoOfA, B]);
    assert.equal(r.amount, 10 * 2 + 4);
    assert.equal(r.rule, "sum_of_used");
  });

  it("makes a MiF value partial when a stamp has no MiF price — it could have been the highest", () => {
    const r = value("michel", "on_cover", "rate_correct", [A, { ...B, coverMif: null }]);
    assert.equal(r.amount, 30);
    assert.equal(r.partial, true);
    assert.deepEqual(r.missing, [{ componentId: "e-b", stampId: "b", price: "cover_mif" }]);
  });

  it("says which price is missing on an EF cover, and has no rule figure without it", () => {
    const r = value("michel", "on_cover", "rate_correct", [{ ...A, coverEf: null }]);
    // The floor still stands: the rule priced nothing, the used price did (#2397).
    assert.equal(r.amount, 10);
    assert.deepEqual(r.floor, { amount: 10, ruleAmount: null, applied: true });
    assert.equal(r.partial, true);
    assert.deepEqual(r.missing, [{ componentId: "e-a", stampId: "a", price: "cover_ef" }]);
  });

  it("has no figure when neither the rule's price nor the used price is there", () => {
    const r = value("michel", "on_cover", "rate_correct", [{ ...A, coverEf: null, used: null }]);
    assert.equal(r.amount, null);
    assert.deepEqual(r.missing.map((m) => m.price), ["cover_ef", "used"]);
  });
});

describe("Fischer — one ⊠ price per stamp, its MiF price", () => {
  it("values an EF cover at the stamp's ⊠ price", () => {
    assert.equal(value("fischer", "on_cover", "rate_correct", [A]).amount, 30);
  });

  it("values two of a stamp at 150 % of its ⊠ price", () => {
    const r = value("fischer", "on_cover", "rate_correct", [twoOfA]);
    assert.equal(r.amount, 45);
    assert.equal(r.rule, "fischer_mef");
  });

  it("values three of a stamp at 150 % for the first two plus the third at its used price", () => {
    assert.equal(value("fischer", "on_cover", "rate_correct", [threeOfA]).amount, 45 + 10);
  });

  it("counts a block on the cover as one stamp at its own used price", () => {
    // The block takes the ⊠ share; the loose copy beside it is the further stamp. Its used prices
    // (the block's 50, two loose at 10) are the higher, so they are the value (#2397).
    const r = value("fischer", "on_cover", "rate_correct", [blockOfA, twoOfA]);
    assert.equal(r.floor?.ruleAmount, 45 + 10 * 2 - 10);
    assert.equal(r.amount, 50 + 10 * 2);
  });

  it("values a MiF cover at 50 % of the highest ⊠ plus every other stamp at its used price", () => {
    // B has the highest ⊠ (50): 25 + A's used 10.
    const r = value("fischer", "on_cover", "rate_correct", [A, B]);
    assert.equal(r.amount, 35);
    assert.equal(r.rule, "fischer_mif");
  });

  it("counts further copies of the most expensive stamp among the others", () => {
    // 25 for one B, the second B at 4, A at 10.
    assert.equal(value("fischer", "on_cover", "rate_correct", [A, { ...B, quantity: 2 }]).amount, 39);
  });

  it("values a philatelic, posted cover as a rate-correct one", () => {
    assert.equal(value("fischer", "on_cover", "philatelic_posted", [A, B]).amount, 35);
  });

  it("values a fragment and a cover not posted as Michel does", () => {
    assert.equal(value("fischer", "on_piece", "rate_correct", [A, B]).amount, 21);
    assert.equal(value("fischer", "on_cover", "not_posted", [A, B]).amount, 14);
  });

  it("makes a MiF value partial when a stamp has no ⊠ price", () => {
    const r = value("fischer", "on_cover", "rate_correct", [A, { ...B, coverMif: null }]);
    assert.equal(r.amount, 15 + 4);
    assert.equal(r.partial, true);
    assert.deepEqual(r.missing, [{ componentId: "e-b", stampId: "b", price: "cover_mif" }]);
  });
});

describe("Fischer FP/FW/FM — the three prices, no formula", () => {
  it("reads FP for EF, FW for MeF and the highest FM for MiF", () => {
    assert.equal(value("fischer_fp_fw_fm", "on_cover", "rate_correct", [A]).amount, 40);
    assert.equal(value("fischer_fp_fw_fm", "on_cover", "rate_correct", [threeOfA]).amount, 60);
    assert.equal(value("fischer_fp_fw_fm", "on_cover", "rate_correct", [A, B]).amount, 50);
  });

  it("values a philatelic cover as rate-correct, a fragment and a cover not posted as Michel does", () => {
    assert.equal(value("fischer_fp_fw_fm", "on_cover", "philatelic_posted", [A]).amount, 40);
    assert.equal(value("fischer_fp_fw_fm", "on_piece", "rate_correct", [A]).amount, 15);
    assert.equal(value("fischer_fp_fw_fm", "on_cover", "not_posted", [A]).amount, 10);
  });
});

describe("Sum of used, and a piece whose format has no kind", () => {
  it("adds up used prices in each entry's own format, times its quantity", () => {
    assert.equal(value("sum_of_used", "on_cover", "rate_correct", [blockOfA, { ...B, quantity: 3 }]).amount, 62);
  });

  it("values a piece whose format is neither on cover nor on piece as Sum of used, whatever the method", () => {
    const r = value("michel", null, "rate_correct", [A, B]);
    assert.equal(r.amount, 14);
    assert.equal(r.rule, "sum_of_used");
  });

  it("is unpriced, never zero, when nothing is priced", () => {
    const r = value("sum_of_used", "on_cover", "rate_correct", [{ ...A, used: null }]);
    assert.equal(r.amount, null);
    assert.equal(r.partial, true);
  });
});

describe("never below the sum of used prices (#2397)", () => {
  // Michel's example: six stamps at ⊙ 0.30 EUR, 1.33 PLN each, on a philatelic, posted cover.
  const six = Array.from({ length: 6 }, (_, i) =>
    stamp(`s${i}`, { used: 1.33, usedSingle: 1.33, coverEf: null, coverMef: null, coverMif: null })
  );

  it("values Michel's six-stamp philatelic cover at the sum of its used prices, not 115 % of one", () => {
    const r = value("michel", "on_cover", "philatelic_posted", six);
    assert.equal(r.rule, "philatelic");
    assert.deepEqual(r.floor, { amount: 7.98, ruleAmount: 1.53, applied: true });
    assert.equal(r.amount, 7.98);
    assert.equal(r.partial, false);
  });

  it("values a rate-correct MiF cover at the sum when its MiF price is lower, under every method", () => {
    // Highest MiF / FM 3, ⊠ 3 for each: every rule's figure is below the used prices' 14.
    const cheap = [{ ...A, coverMif: 3 }, { ...B, coverMif: 3 }];
    for (const method of ["michel", "fischer", "fischer_fp_fw_fm"] as const) {
      const r = value(method, "on_cover", "rate_correct", cheap);
      assert.equal(r.amount, 14, method);
      assert.equal(r.floor?.applied, true, method);
      assert.ok((r.floor?.ruleAmount ?? 0) < 14, method);
    }
  });

  it("keeps the rule's figure when it is the higher, the sum still beside it", () => {
    const r = value("michel", "on_cover", "rate_correct", [A, B]);
    assert.equal(r.amount, 50);
    assert.deepEqual(r.floor, { amount: 14, ruleAmount: 50, applied: false });
  });

  it("floors a fragment's on-piece sum too", () => {
    const r = value("michel", "on_piece", "rate_correct", [{ ...A, onPiece: 1 }, { ...B, onPiece: 1 }]);
    assert.equal(r.amount, 14);
  });

  it("makes the value partial under every method when a used price is missing — the floor could be higher", () => {
    const components = [A, { ...B, used: null, usedSingle: null }];
    for (const method of ["michel", "fischer", "fischer_fp_fw_fm"] as const) {
      for (const kind of ["on_cover", "on_piece"] as const) {
        const r = value(method, kind, "rate_correct", components);
        assert.equal(r.partial, true, `${method} ${kind}`);
        assert.ok(
          r.missing.some((m) => m.stampId === "b" && m.price === "used"),
          `${method} ${kind}`
        );
      }
    }
  });

  it("is its own floor under Sum of used", () => {
    assert.equal(value("sum_of_used", "on_cover", "rate_correct", [A, B]).floor, null);
    assert.equal(value("michel", "on_cover", "not_posted", [A, B]).floor, null);
    assert.equal(value("michel", null, "rate_correct", [A, B]).floor, null);
  });
});

describe("a price whose role is not set up (#2375)", () => {
  it("leaves the value partial and names the price unmapped, not missing", () => {
    const result = valuePiece({
      method: "fischer",
      kind: "on_cover",
      franking: "rate_correct",
      components: [{ ...A, coverMif: null }, { ...B, coverMif: null }],
      unmapped: new Set(["cover_mif"]),
    });
    assert.equal(result.partial, true);
    assert.deepEqual(result.unmapped, ["cover_mif"]);
    assert.deepEqual(result.missing, []);
    // The used prices still add up where Fischer reads them: A, the most expensive, would have taken
    // the ⊠ share, so only B is at its used price — and the floor, both used prices, is the value.
    assert.equal(result.floor?.ruleAmount, 4);
    assert.equal(result.amount, 14);
  });

  it("gives the rule no figure when the one price read is unmapped — never filled from another role", () => {
    const result = valuePiece({
      method: "michel",
      kind: "on_cover",
      franking: "rate_correct",
      components: [{ ...A, coverEf: null }],
      unmapped: new Set(["cover_ef"]),
    });
    // The used price is not read as the EF price: it is the floor, named as such (#2397).
    assert.equal(result.floor?.ruleAmount, null);
    assert.equal(result.amount, 10);
    assert.deepEqual(result.unmapped, ["cover_ef"]);
  });

  it("names the used price unmapped when the floor cannot read it (#2397)", () => {
    const result = valuePiece({
      method: "michel",
      kind: "on_cover",
      franking: "rate_correct",
      components: [{ ...A, used: null }],
      unmapped: new Set(["used"]),
    });
    assert.equal(result.amount, 40);
    assert.equal(result.partial, true);
    assert.deepEqual(result.unmapped, ["used"]);
    assert.deepEqual(result.missing, []);
  });

  it("is not noted where the rule does not read it", () => {
    const result = valuePiece({
      method: "michel",
      kind: "on_cover",
      franking: "rate_correct",
      components: [A],
      unmapped: new Set(["cover_mif", "on_piece"]),
    });
    assert.equal(result.partial, false);
    assert.deepEqual(result.unmapped, []);
  });
});

describe("which method values a piece", () => {
  const areas = new Map<string, MethodArea>([
    ["europe", { id: "europe", parentId: null, valuationMethod: "fischer" }],
    ["poland", { id: "poland", parentId: "europe", valuationMethod: null }],
    ["gg", { id: "gg", parentId: "poland", valuationMethod: "fischer_fp_fw_fm" }],
    ["reich", { id: "reich", parentId: null, valuationMethod: null }],
  ]);

  it("takes the area of the piece's most expensive stamp by used price", () => {
    assert.equal(mostExpensiveStamp([B, A]), "a");
    assert.equal(mostExpensiveStamp([{ ...A, usedSingle: null }, B]), "b");
  });

  it("inherits an area's method downwards, an area below setting its own", () => {
    assert.deepEqual(resolveMethod(null, areas, "poland", "michel"), {
      method: "fischer",
      source: { kind: "area", areaId: "europe" },
    });
    assert.deepEqual(resolveMethod(null, areas, "gg", "michel"), {
      method: "fischer_fp_fw_fm",
      source: { kind: "area", areaId: "gg" },
    });
  });

  it("falls to the collection's default where no area sets one", () => {
    assert.deepEqual(resolveMethod(null, areas, "reich", "michel"), {
      method: "michel",
      source: { kind: "collection" },
    });
  });

  it("lets a copy's own method win over its area's", () => {
    assert.deepEqual(resolveMethod("sum_of_used", areas, "gg", "michel"), {
      method: "sum_of_used",
      source: { kind: "copy" },
    });
  });
});

describe("convertRecordedValue — a recorded value moves onto the amount modifier", () => {
  const rates = new Map<string, number | null>([["EUR", 4]]);

  it("takes up the difference, so the piece is worth what it was", () => {
    const r = convertRecordedValue({
      recorded: { amount: 100, currency: "PLN" },
      modifier: null,
      computedBase: 60,
      baseCurrency: "PLN",
      rates,
    });
    assert.deepEqual(r, { status: "moved", modifier: { percent: null, amount: "40.00", note: null } });
  });

  it("converts the recorded figure and keeps a percentage the copy already had", () => {
    // Before: (25 EUR × 1.2) = 30 EUR = 120 PLN. After: 50 × 1.2 + 60 = 120.
    const r = convertRecordedValue({
      recorded: { amount: 25, currency: "EUR" },
      modifier: { percent: 20, amount: null, note: "Danzig" },
      computedBase: 50,
      baseCurrency: "PLN",
      rates,
    });
    assert.deepEqual(r, { status: "moved", modifier: { percent: 20, amount: "60.00", note: "Danzig" } });
  });

  it("needs no modifier when the method gives the recorded figure", () => {
    const r = convertRecordedValue({
      recorded: { amount: 60, currency: "PLN" },
      modifier: null,
      computedBase: 60,
      baseCurrency: "PLN",
      rates,
    });
    assert.deepEqual(r, { status: "moved", modifier: null });
  });

  it("keeps the recorded value where the method prices nothing or the currency has no rate", () => {
    const base = { modifier: null, baseCurrency: "PLN", rates };
    assert.equal(
      convertRecordedValue({ ...base, recorded: { amount: 10, currency: "PLN" }, computedBase: null })
        .status,
      "unpriced"
    );
    assert.equal(
      convertRecordedValue({ ...base, recorded: { amount: 10, currency: "USD" }, computedBase: 5 })
        .status,
      "unconvertible"
    );
  });
});
