import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkSetNonEmpty,
  deriveOfferLabel,
  deriveSetLabel,
  type SetLabelCopy,
} from "../../src/lib/offer-set-rules";

/** A copy named by one catalogue number under a vendor in the given area prefix. */
function copy(number: string, areaPrefix: string | null = "RU-NW", vendorId = "mi"): SetLabelCopy {
  return {
    catalog: { vendorId, vendorAbbr: vendorId === "mi" ? "Mi" : "Fi", areaPrefix, number },
    stampName: null,
  };
}

describe("deriveSetLabel (#379)", () => {
  it("prefers an explicit title", () => {
    assert.equal(deriveSetLabel("  Komplet 1938  ", [copy("15")]), "Komplet 1938");
  });

  it("collapses a consecutive run under its vendor and area prefix", () => {
    const label = deriveSetLabel(null, ["15", "16", "17", "18", "19"].map((n) => copy(n)));
    assert.equal(label, "Mi·RU-NW 15-19");
  });

  it("writes gaps as separate entries", () => {
    assert.equal(deriveSetLabel(null, ["1", "2", "4"].map((n) => copy(n))), "Mi·RU-NW 1-2,4");
  });

  it("keeps a vendor without an area prefix bare of one", () => {
    assert.equal(deriveSetLabel(null, [copy("200", null)]), "Mi 200");
  });

  it("joins two catalogues rather than mixing their numbers", () => {
    const label = deriveSetLabel(null, [copy("15"), copy("16"), copy("3", "PL", "fi")]);
    assert.equal(label, "Mi·RU-NW 15-16 / Fi·PL 3");
  });

  it("falls back to stamp names when nothing is numbered", () => {
    const copies: SetLabelCopy[] = [
      { catalog: null, stampName: "Mercury" },
      { catalog: null, stampName: "Mercury" },
      { catalog: null, stampName: "Chalon head" },
    ];
    assert.equal(deriveSetLabel(null, copies), "Mercury + Chalon head");
  });

  it("counts a large nameless set rather than spelling it out", () => {
    const copies: SetLabelCopy[] = Array.from({ length: 4 }, () => ({ catalog: null, stampName: null }));
    assert.equal(deriveSetLabel(null, copies), "4 copies");
  });

  it("names an empty set", () => {
    assert.equal(deriveSetLabel(null, []), "Empty set");
  });
});

describe("deriveOfferLabel", () => {
  it("reads as its only set", () => {
    assert.equal(deriveOfferLabel(["Mi·PL 1-3"]), "Mi·PL 1-3");
  });

  it("reads identical sets as a quantity", () => {
    assert.equal(deriveOfferLabel(["Mi 1", "Mi 1", "Mi 1"]), "3× (Mi 1)");
  });

  it("reads a mixed bag as its set count", () => {
    assert.equal(deriveOfferLabel(["Mi 1", "Mi 2"]), "2 sets");
  });

  it("names an empty offer", () => {
    assert.equal(deriveOfferLabel([]), "Empty offer");
  });
});

describe("checkSetNonEmpty", () => {
  it("rejects an empty set and accepts a filled one", () => {
    assert.match(checkSetNonEmpty(0) ?? "", /at least one copy/);
    assert.equal(checkSetNonEmpty(1), null);
  });
});
