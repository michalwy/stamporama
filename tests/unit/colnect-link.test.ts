import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { colnectMarketUrl, colnectSearchUrl, colnectStampUrl } from "@/lib/colnect-link";
import { COLNECT_CONDITIONS } from "@/lib/colnect-conditions";

describe("colnectStampUrl", () => {
  it("builds the Colnect stamp URL from a stored item-ID", () => {
    assert.equal(
      colnectStampUrl("1133075"),
      "https://colnect.com/en/stamps/stamp/1133075"
    );
  });

  it("trims surrounding whitespace", () => {
    assert.equal(
      colnectStampUrl("  136748 "),
      "https://colnect.com/en/stamps/stamp/136748"
    );
  });

  it("returns null for a missing or blank id", () => {
    assert.equal(colnectStampUrl(null), null);
    assert.equal(colnectStampUrl(undefined), null);
    assert.equal(colnectStampUrl("   "), null);
  });

  it("escapes anything unexpected in the stored id", () => {
    assert.equal(
      colnectStampUrl("12 34/56"),
      "https://colnect.com/en/stamps/stamp/12%2034%2F56"
    );
  });
});

describe("colnectMarketUrl", () => {
  it("builds the marketplace search for one item at one grade, priced low to high", () => {
    assert.equal(
      colnectMarketUrl("1133075", "mint_never_hinged"),
      "https://colnect.com/en/market/list/category/stamps/condition/mint_never_hinged" +
        "/item/1133075/sort_order/ascending/sort/by_price"
    );
  });

  it("returns null when either half is missing — an unmatched stamp or an unmapped grade", () => {
    assert.equal(colnectMarketUrl(null, "used"), null);
    assert.equal(colnectMarketUrl("1133075", null), null);
    assert.equal(colnectMarketUrl("  ", "used"), null);
    assert.equal(colnectMarketUrl("1133075", "  "), null);
  });

  it("has a market slug for every grade the form offers, so a mapped condition always links", () => {
    for (const grade of COLNECT_CONDITIONS) {
      assert.ok(grade.marketSlug.length > 0, grade.abbrev);
      assert.ok(colnectMarketUrl("1", grade.marketSlug));
    }
  });
});

describe("colnectSearchUrl", () => {
  it("lists Colnect's catalogue by catalog code, spaces travelling as +", () => {
    assert.equal(
      colnectSearchUrl("RU-CH 35"),
      "https://colnect.com/en/stamps/list/catalog_code/RU-CH+35"
    );
  });

  it("escapes what a catalog number may otherwise carry", () => {
    assert.equal(
      colnectSearchUrl("PL 12/56"),
      "https://colnect.com/en/stamps/list/catalog_code/PL+12%2F56"
    );
  });

  it("returns null when there is nothing to search for", () => {
    assert.equal(colnectSearchUrl(null), null);
    assert.equal(colnectSearchUrl("   "), null);
  });
});
