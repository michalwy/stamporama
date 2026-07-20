import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCatalogKey,
  catalogDigits,
  formatCatalogNumber,
  catalogMatchKey,
  catalogKeyMatches,
  parseCatalogRangeEndpoint,
} from "../../src/lib/catalog-number";

describe("normalizeCatalogKey", () => {
  it("lowercases and strips spaces and punctuation", () => {
    assert.equal(normalizeCatalogKey("Mi·PL 200"), "mipl200");
    assert.equal(normalizeCatalogKey("Mi PL200"), "mipl200");
    assert.equal(normalizeCatalogKey("MiPL200"), "mipl200");
  });

  it("keeps a bare number intact", () => {
    assert.equal(normalizeCatalogKey("200"), "200");
  });

  it("returns empty for punctuation-only input", () => {
    assert.equal(normalizeCatalogKey("· -"), "");
  });
});

describe("catalogDigits", () => {
  it("extracts only digits", () => {
    assert.equal(catalogDigits("Mi PL200a"), "200");
    assert.equal(catalogDigits("MiPL"), "");
  });
});

describe("formatCatalogNumber", () => {
  it("joins vendor abbreviation, prefix, and number", () => {
    assert.equal(formatCatalogNumber("Mi", "PL", "200"), "Mi·PL 200");
  });

  it("omits the prefix separator when there is no prefix", () => {
    assert.equal(formatCatalogNumber("Sc", null, "45"), "Sc 45");
    assert.equal(formatCatalogNumber("Sc", "", "45"), "Sc 45");
  });
});

describe("catalogMatchKey", () => {
  it("builds a normalized abbr+prefix+number key", () => {
    assert.equal(catalogMatchKey("Mi", "PL", "200"), "mipl200");
    assert.equal(catalogMatchKey("Sc", null, "45"), "sc45");
  });
});

describe("parseCatalogRangeEndpoint", () => {
  it("parses a bare number with an empty prefix", () => {
    assert.deepEqual(parseCatalogRangeEndpoint("120"), { prefix: "", value: 120 });
  });

  it("splits a leading non-digit prefix from its numeric part", () => {
    assert.deepEqual(parseCatalogRangeEndpoint("BL120"), { prefix: "BL", value: 120 });
  });

  it("ignores surrounding whitespace", () => {
    assert.deepEqual(parseCatalogRangeEndpoint("  BL123 "), { prefix: "BL", value: 123 });
  });

  it("drops leading zeros in the numeric value", () => {
    assert.deepEqual(parseCatalogRangeEndpoint("BL007"), { prefix: "BL", value: 7 });
  });

  it("rejects a trailing non-digit, empty, non-numeric, or zero input", () => {
    for (const bad of ["BL120a", "", "  ", "BL", "0", "BL0"]) {
      assert.equal(parseCatalogRangeEndpoint(bad), null, bad);
    }
  });
});

describe("catalogKeyMatches", () => {
  const keys = [catalogMatchKey("Mi", "PL", "200")]; // ["mipl200"]

  it("matches every documented spacing variant", () => {
    for (const q of ["Mi PL 200", "Mi PL200", "MiPL200", "mi pl 200"]) {
      assert.equal(catalogKeyMatches(q, keys), true, q);
    }
  });

  it("matches a bare number and a prefix+number tail", () => {
    assert.equal(catalogKeyMatches("200", keys), true);
    assert.equal(catalogKeyMatches("PL200", keys), true);
  });

  it("does not match an unrelated number", () => {
    assert.equal(catalogKeyMatches("300", keys), false);
  });

  it("never matches an empty query", () => {
    assert.equal(catalogKeyMatches("", keys), false);
    assert.equal(catalogKeyMatches("  ", keys), false);
  });
});
