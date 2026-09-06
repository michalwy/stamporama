import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  composeSetCatalogKeys,
  composeSetMatches,
  composeSetSearchText,
  type ComposeSetSearchable,
} from "../../src/lib/offer-compose-search";
import { formatStampCN } from "../../src/lib/area-vendor";
import type { AreaCatalogEntry } from "../../src/lib/areas";

// The Add-to-offer picker's search (#188, #867).
//
// The builder and the matcher are run **as a pair** here, deliberately. A test that handed the
// matcher a key it had typed out itself ("mipl200") would pass whatever the builder produced, which
// is precisely the drift worth catching: the two halves now live on opposite sides of the wire, and
// a builder that stopped agreeing with its matcher would fail nowhere at all — the search would
// simply, quietly, stop finding things.
//
// The keys are therefore built from `formatStampCN`'s output, which is what
// `OfferLabeller.catalogNumbers` hands the builder in `listComposeTargets`.

/** One vendor as an area resolves it — the shape `OfferLabeller.catalogNumbers` prints through. */
function vendor(vendorAbbreviation: string, prefix: string | null): AreaCatalogEntry {
  return {
    catalogVendorId: `vendor-${vendorAbbreviation}`,
    vendorName: vendorAbbreviation,
    vendorAbbreviation,
    prefix,
    catalogNameId: null,
    catalogName: null,
  };
}

/** A set holding one copy: Michel Poland 200, "Warsaw Mermaid", issue "Definitives", in "A-14". */
function warsawSet(): ComposeSetSearchable {
  const michelPoland = vendor("Mi", "PL");
  return {
    label: "Mi·PL 200",
    itemLabels: ["200"],
    searchText: composeSetSearchText(["Warsaw Mermaid", "Definitives", "A-14"]),
    catalogKeys: composeSetCatalogKeys([formatStampCN("200", michelPoland)]),
  };
}

describe("composeSetMatches — the picker's catalog-number spellings (#104)", () => {
  // The three forms the user guide promises and the dialog's placeholder invites. Three cases and
  // not one, because they fail for different reasons: the first needs the vendor and the prefix to
  // have survived to the key, the second needs the spacing folded, the third needs the key to be
  // matched as a substring rather than compared whole.
  for (const typed of ["Mi PL 200", "PL200", "200"]) {
    it(`matches "${typed}"`, () => {
      assert.equal(composeSetMatches(warsawSet(), typed), true);
    });
  }

  it("matches the printed form itself, punctuation and all", () => {
    assert.equal(composeSetMatches(warsawSet(), "Mi·PL 200"), true);
  });

  it("matches whatever the case, since a collector types neither consistently", () => {
    assert.equal(composeSetMatches(warsawSet(), "mi pl 200"), true);
    assert.equal(composeSetMatches(warsawSet(), "MIPL200"), true);
  });

  it("does not match a number this set does not hold", () => {
    assert.equal(composeSetMatches(warsawSet(), "Mi PL 201"), false);
    assert.equal(composeSetMatches(warsawSet(), "201"), false);
  });

  it("does not match the same number under another area's prefix", () => {
    // `Mi·PL 200` and `Mi·DE 200` are different stamps (#66/#377), and the prefix is what separates
    // them — a key built without it would make this pass and the search a liar.
    assert.equal(composeSetMatches(warsawSet(), "Mi DE 200"), false);
  });
});

describe("composeSetMatches — the free-text half", () => {
  it("matches a stamp name, an issue name and a location ref (#303)", () => {
    for (const typed of ["warsaw", "Mermaid", "definitives", "A-14"]) {
      assert.equal(composeSetMatches(warsawSet(), typed), true, `"${typed}" should match`);
    }
  });

  it("matches the set's own label and its copies' short labels", () => {
    const set = { ...warsawSet(), label: "Poland 1960 · complete", itemLabels: ["865b"] };
    assert.equal(composeSetMatches(set, "complete"), true);
    assert.equal(composeSetMatches(set, "865b"), true);
  });

  it("matches nothing it was not given", () => {
    assert.equal(composeSetMatches(warsawSet(), "Gdansk"), false);
  });

  it("treats an empty query as matching, so clearing the box restores every set", () => {
    assert.equal(composeSetMatches(warsawSet(), ""), true);
    assert.equal(composeSetMatches(warsawSet(), "   "), true);
  });
});

describe("composeSetSearchText / composeSetCatalogKeys", () => {
  it("drops absent parts rather than rendering them", () => {
    // A copy with no location ref must not make its set match the word "null".
    const text = composeSetSearchText(["Warsaw Mermaid", null, undefined, ""]);
    assert.equal(text, "warsaw mermaid");
    assert.equal(composeSetMatches({ ...warsawSet(), searchText: text }, "null"), false);
  });

  it("lowercases once, since the matcher tests a plain substring", () => {
    assert.equal(composeSetSearchText(["Warsaw MERMAID"]), "warsaw mermaid");
  });

  it("de-duplicates keys — forty copies of one stamp are one key", () => {
    const printed = Array.from({ length: 40 }, () =>
      formatStampCN("200", vendor("Mi", "PL"))
    );
    assert.deepEqual(composeSetCatalogKeys(printed), ["mipl200"]);
  });

  it("keeps a set's several numbers apart, and drops one that normalizes to nothing", () => {
    const keys = composeSetCatalogKeys([
      formatStampCN("200", vendor("Mi", "PL")),
      formatStampCN("451", vendor("Sg", null)),
      "·",
    ]);
    assert.deepEqual(keys, ["mipl200", "sg451"]);
  });

  it("falls back to the bare number when the stamp's area declares no vendor for it", () => {
    // `formatStampCN` renders the number alone there, so the key is the number alone — the bare
    // spelling still hits, and no vendor is invented in front of it.
    const set = { ...warsawSet(), catalogKeys: composeSetCatalogKeys([formatStampCN("200", undefined)]) };
    assert.equal(composeSetMatches(set, "200"), true);
    assert.equal(composeSetMatches(set, "Mi PL 200"), false);
  });
});
