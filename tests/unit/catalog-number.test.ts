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
  formatSchemeValue,
  computeIssueRangeExtension,
  computeIssueRangeSuggestions,
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

describe("formatSchemeValue", () => {
  function scheme(first: string, last: string) {
    const r = resolveCatalogRange(first, last);
    if ("error" in r) throw new Error(r.error);
    return r.scheme;
  }

  it("renders one position for each scheme kind", () => {
    assert.equal(formatSchemeValue(scheme("100", "105"), 108), "108");
    assert.equal(formatSchemeValue(scheme("BL17", "BL18"), 19), "BL19");
    assert.equal(formatSchemeValue(scheme("40A", "50A"), 43), "43A");
    assert.equal(formatSchemeValue(scheme("423a", "423c"), 4), "423d");
    assert.equal(formatSchemeValue(scheme("12I", "12III"), 4), "12IV");
  });

  it("agrees with generateCatalogNumbers position by position", () => {
    const s = scheme("100", "104");
    const all = generateCatalogNumbers(s, 5);
    for (let i = 0; i < all.length; i++) {
      assert.equal(formatSchemeValue(s, s.from + i), all[i]);
    }
  });
});

describe("computeIssueRangeExtension", () => {
  it("proposes widening a numeric range above and below", () => {
    assert.deepEqual(computeIssueRangeExtension("100", "105", ["104", "106"]), {
      kind: "extend",
      proposedFirst: "100",
      proposedLast: "106",
      outsideNumbers: ["106"],
    });
    assert.deepEqual(computeIssueRangeExtension("100", "105", ["098", "103"]), {
      kind: "extend",
      proposedFirst: "98",
      proposedLast: "105",
      outsideNumbers: ["098"],
    });
  });

  it("returns null when members stay within the declared range (partial entry is fine)", () => {
    assert.equal(computeIssueRangeExtension("100", "105", ["100", "101", "102"]), null);
    assert.equal(computeIssueRangeExtension("100", "105", []), null);
  });

  it("ignores members from a different family (block / sheet vs numeric range)", () => {
    // BL12 (prefix "BL") and "Ark. 103" (prefix "Ark. ") are not part of a bare
    // numeric 100–105 range.
    assert.equal(computeIssueRangeExtension("100", "105", ["BL12", "Ark. 103", "103"]), null);
  });

  it("extends a prefixed range when a same-prefix member exceeds it", () => {
    assert.deepEqual(computeIssueRangeExtension("BL17", "BL18", ["BL19"]), {
      kind: "extend",
      proposedFirst: "BL17",
      proposedLast: "BL19",
      outsideNumbers: ["BL19"],
    });
  });

  it("extends a letter-suffix range", () => {
    assert.deepEqual(computeIssueRangeExtension("423a", "423c", ["423d"]), {
      kind: "extend",
      proposedFirst: "423a",
      proposedLast: "423d",
      outsideNumbers: ["423d"],
    });
    // A different base (424a) is a different family — ignored.
    assert.equal(computeIssueRangeExtension("423a", "423c", ["424a"]), null);
  });

  it("extends a Roman-suffix range", () => {
    assert.deepEqual(computeIssueRangeExtension("12I", "12III", ["12IV"]), {
      kind: "extend",
      proposedFirst: "12I",
      proposedLast: "12IV",
      outsideNumbers: ["12IV"],
    });
  });

  it("widens a lone-First single value when a same-family member sits beyond it", () => {
    assert.deepEqual(computeIssueRangeExtension("105", null, ["107"]), {
      kind: "extend",
      proposedFirst: "105",
      proposedLast: "107",
      outsideNumbers: ["107"],
    });
  });

  it("adopts basic numbering when a block range gains a basic-numbered member", () => {
    // A block range BL1–BL3 with a basic-numbered member (200) takes over the basic span.
    assert.deepEqual(computeIssueRangeExtension("BL1", "BL3", ["200"]), {
      kind: "adopt-basic",
      proposedFirst: "200",
      proposedLast: null,
      outsideNumbers: ["200"],
    });
    // Several basic members → their span; block members are set aside.
    assert.deepEqual(computeIssueRangeExtension("BL1", "BL3", ["BL2", "200", "202"]), {
      kind: "adopt-basic",
      proposedFirst: "200",
      proposedLast: "202",
      outsideNumbers: ["200", "202"],
    });
  });

  it("does not adopt basic numbering for a bare numeric declared range", () => {
    // Declared range is already basic (no prefix) → block members stay ignored.
    assert.equal(computeIssueRangeExtension("100", "105", ["102", "BL2"]), null);
  });

  it("returns null when the declared range cannot be interpreted", () => {
    assert.equal(computeIssueRangeExtension("BL", null, ["BL5"]), null);
    assert.equal(computeIssueRangeExtension("", "5", ["3"]), null);
  });
});

describe("computeIssueRangeSuggestions", () => {
  const abbrev = new Map([
    ["mi", "Mi"],
    ["sc", "Sc"],
  ]);

  it("returns one suggestion per extended vendor and skips in-range vendors", () => {
    const ranges = [
      { catalogVendorId: "mi", firstNumber: "100", lastNumber: "105" },
      { catalogVendorId: "sc", firstNumber: "10", lastNumber: "12" },
    ];
    const members = [
      { catalogVendorId: "mi", number: "106" }, // extends Mi
      { catalogVendorId: "mi", number: "BL3" }, // different family, ignored
      { catalogVendorId: "sc", number: "11" }, // within Sc range
    ];
    assert.deepEqual(computeIssueRangeSuggestions(ranges, members, abbrev), [
      {
        catalogVendorId: "mi",
        vendorAbbreviation: "Mi",
        kind: "extend",
        currentFirst: "100",
        currentLast: "105",
        proposedFirst: "100",
        proposedLast: "106",
        outsideNumbers: ["106"],
      },
    ]);
  });

  it("proposes adopting basic numbering over a declared block range", () => {
    const ranges = [{ catalogVendorId: "mi", firstNumber: "BL1", lastNumber: "BL3" }];
    const members = [
      { catalogVendorId: "mi", number: "200" },
      { catalogVendorId: "mi", number: "BL2" },
    ];
    assert.deepEqual(computeIssueRangeSuggestions(ranges, members, abbrev), [
      {
        catalogVendorId: "mi",
        vendorAbbreviation: "Mi",
        kind: "adopt-basic",
        currentFirst: "BL1",
        currentLast: "BL3",
        proposedFirst: "200",
        proposedLast: null,
        outsideNumbers: ["200"],
      },
    ]);
  });

  it("returns an empty array when nothing extends", () => {
    const ranges = [{ catalogVendorId: "mi", firstNumber: "100", lastNumber: "105" }];
    const members = [{ catalogVendorId: "mi", number: "102" }];
    assert.deepEqual(computeIssueRangeSuggestions(ranges, members, abbrev), []);
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
