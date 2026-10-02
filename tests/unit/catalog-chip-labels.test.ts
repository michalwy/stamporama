import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AreaCatalogEntry } from "../../src/lib/areas";
import { catalogChipLabels } from "../../src/lib/area-vendor";

// The identified stamp's numbers as chips (#1525): the main catalogue's first and the one marked
// primary, the others after it in their stored order — the order a picked stamp's labels have
// always had, so the one-line label and the chips never disagree about which number leads.

const entry = (catalogVendorId: string, abbreviation: string, prefix: string): AreaCatalogEntry => ({
  catalogVendorId,
  vendorName: abbreviation,
  vendorAbbreviation: abbreviation,
  prefix,
  catalogNameId: null,
  catalogName: null,
});

const VENDORS = new Map<string, AreaCatalogEntry>([
  ["fi", entry("fi", "Fi", "PL-ON")],
  ["mi", entry("mi", "Mi", "DE-GO")],
  ["sg", entry("sg", "SG", "PL")],
]);

const NUMBERS = [
  { catalogVendorId: "mi", number: "27" },
  { catalogVendorId: "fi", number: "GG 27" },
  { catalogVendorId: "sg", number: "389" },
];

describe("catalogChipLabels (#1525)", () => {
  it("puts the main catalogue's number first and marks it alone as primary", () => {
    assert.deepEqual(catalogChipLabels(NUMBERS, VENDORS, "fi"), [
      { label: "Fi·PL-ON GG 27", primary: true },
      { label: "Mi·DE-GO 27", primary: false },
      { label: "SG·PL 389", primary: false },
    ]);
  });

  it("marks nothing when the stamp has no number in the main catalogue", () => {
    const chips = catalogChipLabels(NUMBERS, VENDORS, "yt");
    assert.deepEqual(
      chips.map((c) => c.label),
      ["Mi·DE-GO 27", "Fi·PL-ON GG 27", "SG·PL 389"]
    );
    assert.ok(chips.every((c) => !c.primary));
  });

  it("marks nothing when the area declares no main catalogue", () => {
    assert.ok(catalogChipLabels(NUMBERS, VENDORS, null).every((c) => !c.primary));
  });

  it("highlights one chip even when the main catalogue holds two numbers", () => {
    const chips = catalogChipLabels(
      [...NUMBERS, { catalogVendorId: "fi", number: "GG 27a" }],
      VENDORS,
      "fi"
    );
    assert.deepEqual(
      chips.map((c) => [c.label, c.primary]),
      [
        ["Fi·PL-ON GG 27", true],
        ["Fi·PL-ON GG 27a", false],
        ["Mi·DE-GO 27", false],
        ["SG·PL 389", false],
      ]
    );
  });
});
