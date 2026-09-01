import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  colnectItemIdInput,
  colnectMarketUrl,
  colnectSaleCode,
  colnectSearchUrl,
  colnectStampUrl,
} from "@/lib/colnect-link";
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

// The listing's own id (#696). Stored on `Offer.colnectSaleId` because a code buried inside a URL
// varies with the locale Colnect answered in, cannot be indexed, and cannot be made unique — which
// is exactly what the transaction import (#698) has to join one row to one offer on.
//
// These cases mirror the extension's own `colnectSaleCode` tests: the two are hand-mirrored
// (separate builds, no import path) and a reading that drifts apart is a listing edited at the
// wrong address.
describe("colnectSaleCode", () => {
  it("reads the code off the public entry Colnect lands on after a save (#412)", () => {
    assert.equal(colnectSaleCode("https://colnect.com/en/market/sale/h5UXNh"), "h5UXNh");
  });

  it("reads it off the edit form too, which is the same code at the other address (#462)", () => {
    assert.equal(colnectSaleCode("https://www.colnect.com/de/sell/edit/sale_id/h5pxfc/"), "h5pxfc");
  });

  it("accepts whatever locale Colnect served — the segment is not the seller's choice", () => {
    assert.equal(colnectSaleCode("https://colnect.com/pl/market/sale/h5UXNh"), "h5UXNh");
  });

  it("ignores the query and the fragment, which name no listing", () => {
    assert.equal(colnectSaleCode("https://colnect.com/en/market/sale/h5UXNh?ref=mail#pics"), "h5UXNh");
  });

  it("is null for a Colnect page that is not a sale", () => {
    assert.equal(colnectSaleCode("https://colnect.com/en/market/list"), null);
    assert.equal(colnectSaleCode("https://colnect.com/en/stamps/stamp/1133075"), null);
  });

  it("is null for another marketplace entirely — the shape alone must not be enough", () => {
    assert.equal(colnectSaleCode("https://not-colnect.test/en/market/sale/h5UXNh"), null);
  });

  it("is null for nothing at all, and for a string that will not parse", () => {
    assert.equal(colnectSaleCode(null), null);
    assert.equal(colnectSaleCode("   "), null);
    assert.equal(colnectSaleCode("market/sale/h5UXNh"), null);
  });
});

describe("colnectItemIdInput", () => {
  it("takes a bare item-ID as typed", () => {
    assert.equal(colnectItemIdInput("1133075"), "1133075");
    assert.equal(colnectItemIdInput("  1133075 "), "1133075");
  });

  it("reads the id out of a pasted Colnect stamp address, slug and all", () => {
    assert.equal(
      colnectItemIdInput("https://colnect.com/en/stamps/stamp/1133075-X-Poland"),
      "1133075"
    );
    assert.equal(colnectItemIdInput("https://www.colnect.com/pl/stamps/stamp/136748"), "136748");
    assert.equal(colnectItemIdInput("https://colnect.com/en/stamps/stamp/136748/"), "136748");
  });

  it("returns null for a Colnect stamp address naming no id", () => {
    assert.equal(colnectItemIdInput("https://colnect.com/en/stamps/stamp/"), null);
    assert.equal(colnectItemIdInput("https://colnect.com/en/stamps/list/catalog_code/PL+865"), null);
  });

  it("hands back anything that is not a Colnect address, trimmed", () => {
    assert.equal(colnectItemIdInput("https://example.com/1133075"), "https://example.com/1133075");
    assert.equal(colnectItemIdInput("not a url"), "not a url");
  });

  it("returns null for nothing typed", () => {
    assert.equal(colnectItemIdInput(null), null);
    assert.equal(colnectItemIdInput(undefined), null);
    assert.equal(colnectItemIdInput("   "), null);
  });
});
