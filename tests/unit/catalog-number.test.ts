import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCatalogKey,
  catalogDigits,
  catalogIdentityKey,
  formatCatalogNumber,
  catalogMatchKey,
  catalogKeyMatches,
  parseCatalogNumberParts,
  parseCatalogSearch,
  resolveCatalogRange,
  generateCatalogNumbers,
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

describe("catalogIdentityKey", () => {
  it("distinguishes identities by vendor, prefix, and number", () => {
    // Same vendor + prefix + number → equal (a real duplicate).
    assert.equal(
      catalogIdentityKey("v1", "PL", "200"),
      catalogIdentityKey("v1", "PL", "200")
    );
    // Different area prefix under the same vendor → not a duplicate.
    assert.notEqual(
      catalogIdentityKey("v1", "PL", "200"),
      catalogIdentityKey("v1", "DE", "200")
    );
    // Different vendor → not a duplicate.
    assert.notEqual(
      catalogIdentityKey("v1", "PL", "200"),
      catalogIdentityKey("v2", "PL", "200")
    );
    // Exact number match only: "200" ≠ "200a".
    assert.notEqual(
      catalogIdentityKey("v1", "PL", "200"),
      catalogIdentityKey("v1", "PL", "200a")
    );
  });

  it("treats null, undefined, and empty prefix identically and trims", () => {
    assert.equal(catalogIdentityKey("v1", null, "5"), catalogIdentityKey("v1", "", "5"));
    assert.equal(catalogIdentityKey("v1", undefined, "5"), catalogIdentityKey("v1", "", "5"));
    assert.equal(catalogIdentityKey("v1", "PL", " 5 "), catalogIdentityKey("v1", "PL", "5"));
  });

  it("does not alias across part boundaries", () => {
    // "ab" + "c" must not equal "a" + "bc".
    assert.notEqual(
      catalogIdentityKey("ab", "c", "1"),
      catalogIdentityKey("a", "bc", "1")
    );
  });
});

describe("parseCatalogNumberParts", () => {
  it("splits prefix, base, and suffix", () => {
    assert.deepEqual(parseCatalogNumberParts("BL120a"), { prefix: "BL", base: "120", suffix: "a" });
    assert.deepEqual(parseCatalogNumberParts("120"), { prefix: "", base: "120", suffix: "" });
    assert.deepEqual(parseCatalogNumberParts("12II"), { prefix: "", base: "12", suffix: "II" });
  });

  it("ignores surrounding whitespace and keeps leading zeros in the base", () => {
    assert.deepEqual(parseCatalogNumberParts("  007a "), { prefix: "", base: "007", suffix: "a" });
  });

  it("rejects input with no digit run", () => {
    for (const bad of ["", "  ", "BL"]) {
      assert.equal(parseCatalogNumberParts(bad), null, bad);
    }
  });
});

describe("resolveCatalogRange + generateCatalogNumbers", () => {
  function expand(first: string, last: string | null): string[] | string {
    const r = resolveCatalogRange(first, last);
    if ("error" in r) return r.error;
    return generateCatalogNumbers(r.scheme, r.span ?? 1);
  }

  it("expands a numeric range", () => {
    assert.deepEqual(expand("100", "103"), ["100", "101", "102", "103"]);
  });

  it("expands a prefixed range (#149)", () => {
    assert.deepEqual(expand("BL120", "BL123"), ["BL120", "BL121", "BL122", "BL123"]);
  });

  it("expands a lowercase-letter suffix range", () => {
    assert.deepEqual(expand("423a", "423c"), ["423a", "423b", "423c"]);
  });

  it("expands a Roman-numeral suffix range", () => {
    assert.deepEqual(expand("12I", "12III"), ["12I", "12II", "12III"]);
  });

  it("varies the base while keeping a constant letter suffix", () => {
    assert.deepEqual(expand("40A", "50A").slice(0, 3), ["40A", "41A", "42A"]);
    assert.equal((expand("40A", "50A") as string[]).length, 11);
  });

  it("treats a lone First as a single stamp", () => {
    assert.deepEqual(expand("423a", null), ["423a"]);
    assert.deepEqual(expand("BL7", ""), ["BL7"]);
  });

  it("rejects mismatched prefixes", () => {
    assert.match(expand("BL120", "SS123") as string, /prefix/);
  });

  it("rejects a range that varies both number and suffix", () => {
    assert.match(expand("40a", "50c") as string, /only the number or only the suffix/);
  });

  it("rejects an unrecognized suffix sequence", () => {
    assert.match(expand("12x", "12z9") as string, /number/);
    assert.match(expand("100!", "100@") as string, /suffix sequence/);
  });

  it("rejects a descending range", () => {
    assert.match(expand("105", "100") as string, /≤/);
    assert.match(expand("100c", "100a") as string, /≤/);
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

describe("parseCatalogSearch", () => {
  const vendors = [
    { id: "mi", abbreviation: "Mi" },
    { id: "sc", abbreviation: "Sc" },
  ];

  it("resolves a vendor abbreviation and area code regardless of spacing", () => {
    for (const q of ["Mi PL 200", "Mi PL200", "MiPL200", "mi pl 200"]) {
      assert.deepEqual(parseCatalogSearch(q, vendors), { vendorId: "mi", number: "200" }, q);
    }
  });

  it("resolves a vendor with no area code", () => {
    assert.deepEqual(parseCatalogSearch("Mi 200", vendors), { vendorId: "mi", number: "200" });
  });

  it("keeps a bare number vendorless", () => {
    assert.deepEqual(parseCatalogSearch("200", vendors), { vendorId: null, number: "200" });
  });

  it("treats an unknown leading prefix as an area code, not a vendor", () => {
    assert.deepEqual(parseCatalogSearch("PL200", vendors), { vendorId: null, number: "200" });
  });

  it("preserves a suffix on the number", () => {
    assert.deepEqual(parseCatalogSearch("Mi 200a", vendors), { vendorId: "mi", number: "200a" });
  });

  it("returns an empty number when there is no digit run", () => {
    assert.deepEqual(parseCatalogSearch("Mi", vendors), { vendorId: null, number: "" });
    assert.deepEqual(parseCatalogSearch("", vendors), { vendorId: null, number: "" });
  });
});
