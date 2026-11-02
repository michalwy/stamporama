import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Decimal } from "@prisma/client/runtime/client";
import {
  isStillValidCoverKind,
  resolveStillValid,
  stillValidCoverPrice,
  stillValidMarkToStore,
  stillValidRuleOf,
} from "../../src/lib/still-valid-postage";
import { pickFormatCatalogPrice, type RawCatalogPrice } from "../../src/lib/catalog-price";
import { derivedCellAmount } from "../../src/lib/variant-price-cells";

// Michel's rule for the on-cover prices of stamps still valid for postage (#2358): the used price
// +20 %, at least 0.40, at most the never-hinged price when that is above 0.40. The marks on areas
// and issues, and the price grid showing the figure, are in `tests/integration/still-valid-postage.test.ts`.

describe("Michel's rule for still-valid stamps (#2358)", () => {
  it("adds 20 % to the used price", () => {
    assert.equal(stillValidCoverPrice(2, 5), 2.4);
    assert.equal(stillValidCoverPrice(1.25, null), 1.5);
  });

  it("never goes below the 0.40 floor", () => {
    assert.equal(stillValidCoverPrice(0.1, 3), 0.4);
    assert.equal(stillValidCoverPrice(0.3, null), 0.4);
    // 0.34 + 20 % is 0.408: above the floor, so the rule's own figure, rounded.
    assert.equal(stillValidCoverPrice(0.34, null), 0.41);
  });

  it("is capped at the never-hinged price when that is above 0.40", () => {
    assert.equal(stillValidCoverPrice(2, 2.2), 2.2);
    assert.equal(stillValidCoverPrice(0.45, 0.5), 0.5);
  });

  it("keeps the floor when the never-hinged price is 0.40 or below", () => {
    assert.equal(stillValidCoverPrice(0.2, 0.3), 0.4);
    assert.equal(stillValidCoverPrice(0.2, 0.4), 0.4);
  });

  it("fills EF, MeF and MiF, and leaves on piece to its multiplier", () => {
    assert.deepEqual(
      (["cover_ef", "cover_mef", "cover_mif", "on_piece", null] as const).map(isStillValidCoverKind),
      [true, true, true, false, false]
    );
  });
});

describe("the conditions the rule reads (#2358)", () => {
  it("needs both a used and a never-hinged condition", () => {
    assert.deepEqual(
      stillValidRuleOf([
        { id: "mnh", priceRole: "never_hinged" },
        { id: "mh", priceRole: null },
        { id: "u", priceRole: "used" },
      ]),
      { usedConditionId: "u", neverHingedConditionId: "mnh" }
    );
  });

  it("gives nothing while either is unchosen", () => {
    assert.equal(stillValidRuleOf([{ id: "u", priceRole: "used" }]), null);
    assert.equal(stillValidRuleOf([{ id: "mnh", priceRole: "never_hinged" }]), null);
    assert.equal(stillValidRuleOf([]), null);
  });
});

describe("which stamps are still valid (#2358)", () => {
  it("takes the issue's own mark first, then the nearest area that says either way", () => {
    assert.equal(resolveStillValid(null, [null, true, false]), true);
    assert.equal(resolveStillValid(null, [false, true]), false);
    assert.equal(resolveStillValid(false, [true]), false);
    assert.equal(resolveStillValid(true, [false]), true);
  });

  it("is not still valid when nothing says so", () => {
    assert.equal(resolveStillValid(null, []), false);
    assert.equal(resolveStillValid(null, [null, null]), false);
  });

  it("stores a mark only where the inherited answer differs", () => {
    assert.equal(stillValidMarkToStore(false, true), true);
    assert.equal(stillValidMarkToStore(true, false), false);
    assert.equal(stillValidMarkToStore(true, true), null);
    assert.equal(stillValidMarkToStore(false, false), null);
  });
});

const RULE = { usedConditionId: "u", neverHingedConditionId: "mnh" };

// `RawCatalogPrice.price` is a Prisma Decimal; `catalog-price.ts` only ever calls Number() on it.
const D = (n: number): Decimal => n as unknown as Decimal;

function price(
  conditionId: string,
  amount: number | null,
  opts: { year?: number; formatId?: string | null; mark?: string | null } = {}
): RawCatalogPrice {
  return {
    price: amount === null ? null : D(amount),
    mark: opts.mark ?? null,
    currency: "EUR",
    conditionId,
    certificateStatusId: null,
    formatId: opts.formatId ?? null,
    catalogEdition: { year: opts.year ?? 2024, catalogNameId: "michel" },
  };
}

describe("a still-valid stamp's cover price as a list picks it (#2358)", () => {
  const pick = (prices: RawCatalogPrice[]) =>
    pickFormatCatalogPrice(prices, "michel", "u", null, "cover-mif", RULE);

  it("is the rule's figure, marked as derived", () => {
    const result = pick([price("u", 2), price("mnh", 5)]);
    assert.equal(result.picked?.amount, 2.4);
    assert.equal(result.derived, true);
  });

  it("is capped by the never-hinged price of the same edition only", () => {
    assert.equal(pick([price("u", 2), price("mnh", 2.1)]).picked?.amount, 2.1);
    // An older edition's never-hinged price is another catalogue's word, and caps nothing.
    assert.equal(pick([price("u", 2), price("mnh", 2.1, { year: 2020 })]).picked?.amount, 2.4);
  });

  it("gives way to a typed cover price", () => {
    const result = pick([price("u", 2), price("mnh", 5), price("u", 9, { formatId: "cover-mif" })]);
    assert.equal(result.picked?.amount, 9);
    assert.equal(result.derived, false);
  });

  it("gives nothing without a used price, and carries a marked one's mark", () => {
    assert.equal(pick([price("mnh", 5)]).picked, null);
    assert.equal(pick([price("u", null, { mark: "nonexistent" })]).mark, "nonexistent");
  });
});

describe("a still-valid stamp's cover cell on the variant grid (#2358)", () => {
  it("is the rule's figure from the used single and the never-hinged one", () => {
    assert.equal(derivedCellAmount("2", RULE, (c) => (c === "mnh" ? "2.2" : "")), "2.20");
    assert.equal(derivedCellAmount("0.1", RULE, () => ""), "0.40");
    assert.equal(derivedCellAmount("", RULE, () => "5"), null);
  });

  it("still multiplies on a cell a multiplier derives", () => {
    assert.equal(derivedCellAmount("2", 3), "6.00");
  });
});
