import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shortenNumericRangeEnd,
  formatNumericCatalogRange,
  formatCatalogRange,
} from "../../src/lib/catalog-range";

describe("shortenNumericRangeEnd", () => {
  it("drops the digits the endpoints share", () => {
    assert.equal(shortenNumericRangeEnd("1298", "1302"), "302");
    assert.equal(shortenNumericRangeEnd("1298", "1299"), "99");
    assert.equal(shortenNumericRangeEnd("240", "256"), "56");
  });

  it("keeps at least two digits", () => {
    // Only the last digit differs, but "1298-9" reads as a typo rather than as a span.
    assert.equal(shortenNumericRangeEnd("1291", "1292"), "92");
    assert.equal(shortenNumericRangeEnd("100", "101"), "01");
  });

  it("leaves a span with nothing to gain alone", () => {
    assert.equal(shortenNumericRangeEnd("40", "42"), "42");
    assert.equal(shortenNumericRangeEnd("1", "9"), "9");
    // Nothing shared: the whole end number is the differing part.
    assert.equal(shortenNumericRangeEnd("100", "999"), "999");
  });

  it("refuses to shorten across differing digit counts", () => {
    assert.equal(shortenNumericRangeEnd("98", "102"), "102");
    assert.equal(shortenNumericRangeEnd("9", "12"), "12");
  });
});

describe("formatNumericCatalogRange", () => {
  it("writes the prefix and suffix once around the shortened span", () => {
    assert.equal(formatNumericCatalogRange("BL", "31", "33", ""), "BL31-33");
    assert.equal(formatNumericCatalogRange("", "40", "42", "A"), "40-42A");
    assert.equal(formatNumericCatalogRange("", "1298", "1302", ""), "1298-302");
  });

  it("renders a single number when the span is one value", () => {
    assert.equal(formatNumericCatalogRange("BL", "31", "31", "a"), "BL31a");
  });

  it("takes the separator the surface uses", () => {
    assert.equal(formatNumericCatalogRange("", "1298", "1302", "", "–"), "1298–302");
  });
});

describe("formatCatalogRange", () => {
  it("shortens a numeric span", () => {
    assert.equal(formatCatalogRange("1298", "1302"), "1298-302");
    assert.equal(formatCatalogRange("BL31", "BL33"), "BL31-33");
    assert.equal(formatCatalogRange("40A", "42A"), "40-42A");
  });

  it("writes a suffix span's base once", () => {
    assert.equal(formatCatalogRange("128a", "128c"), "128a-c");
    assert.equal(formatCatalogRange("12I", "12III"), "12I-III");
    assert.equal(formatCatalogRange("BL92a", "BL92b"), "BL92a-b");
  });

  it("folds a bare Roman-numeral span", () => {
    assert.equal(formatCatalogRange("I", "III"), "I-III");
    assert.equal(formatCatalogRange("Mi·PL I", "Mi·PL III"), "Mi·PL I-III");
  });

  it("writes both endpoints out when nothing is constant", () => {
    assert.equal(formatCatalogRange("1294CKB", "1296KB"), "1294CKB-1296KB");
    assert.equal(formatCatalogRange("BL31", "Ark. 3"), "BL31-Ark. 3");
    // Two numerals under different catalogues never merge.
    assert.equal(formatCatalogRange("Mi·PL I", "Fi·PL III"), "Mi·PL I-Fi·PL III");
  });

  it("is just its start when there is no end, or the end repeats it", () => {
    assert.equal(formatCatalogRange("1298", null), "1298");
    assert.equal(formatCatalogRange("1298", ""), "1298");
    assert.equal(formatCatalogRange("1298", "1298"), "1298");
  });

  it("trims what it is given", () => {
    assert.equal(formatCatalogRange(" 1298 ", " 1302 "), "1298-302");
  });
});
