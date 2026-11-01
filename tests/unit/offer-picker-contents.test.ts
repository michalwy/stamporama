import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OFFER_PICKER_SET_LINES,
  offerPickerContents,
  offerPickerIssueLabel,
  offerPickerMatches,
  offerPickerSetLine,
  type OfferPickerCopy,
} from "../../src/lib/offer-picker-contents-rules";

// What an offer picker's row shows of its offer, and how its search reaches it (#2309). The contents
// are built and matched as a pair, for the reason `offer-compose-search.test.ts` gives.

const MNH = { id: "c1", abbreviation: "**" };
const USED = { id: "c2", abbreviation: "o" };

function copy(overrides: Partial<OfferPickerCopy> = {}): OfferPickerCopy {
  return {
    condition: MNH,
    issue: { name: "Birds", year: 1960 },
    stampName: "Eagle",
    catalogNumbers: ["Mi·PL 200"],
    ...overrides,
  };
}

describe("offerPickerIssueLabel", () => {
  it("names the issue with its year, the year only when known", () => {
    assert.equal(offerPickerIssueLabel("Birds", 1960), "Birds (1960)");
    assert.equal(offerPickerIssueLabel("Birds", null), "Birds");
    assert.equal(offerPickerIssueLabel(null, 1960), "(1960)");
    assert.equal(offerPickerIssueLabel("  ", null), null);
  });
});

describe("offerPickerSetLine", () => {
  it("lists each condition and each issue once, in copy order", () => {
    const line = offerPickerSetLine("Mi·PL 200-202", [
      copy({ condition: USED }),
      copy(),
      copy({ condition: USED }),
      copy({ issue: { name: "Flowers", year: 1961 } }),
    ]);
    assert.deepEqual(line, {
      catalog: "Mi·PL 200-202",
      conditions: [USED, MNH],
      issue: "Birds (1960), Flowers (1961)",
    });
  });

  it("has no issue when no copy is in one", () => {
    assert.equal(offerPickerSetLine("Mi·PL 200", [copy({ issue: null })]).issue, null);
  });
});

describe("offerPickerContents", () => {
  it("drops a blank title, which leaves the number to name the offer", () => {
    assert.equal(offerPickerContents("  ", null, []).ownTitle, null);
    assert.equal(offerPickerContents(" Eagles ", null, []).ownTitle, "Eagles");
  });

  it("spells out the first sets and counts the rest", () => {
    const sets = Array.from({ length: OFFER_PICKER_SET_LINES + 2 }, (_, i) => ({
      catalog: `Mi·PL ${200 + i}`,
      copies: [copy({ catalogNumbers: [`Mi·PL ${200 + i}`] })],
    }));
    const contents = offerPickerContents(null, "p1", sets);
    assert.equal(contents.sets.length, OFFER_PICKER_SET_LINES);
    assert.equal(contents.moreSets, 2);
    assert.equal(contents.photoId, "p1");
  });
});

describe("offerPickerMatches", () => {
  const offer = {
    offerNo: 3065,
    contents: offerPickerContents(null, null, [
      { catalog: "Mi·PL 200", copies: [copy()] },
      { catalog: "Mi·PL 201", copies: [copy({ catalogNumbers: ["Mi·PL 201"], issue: { name: "Flowers", year: 1961 } })] },
      { catalog: "Mi·PL 202", copies: [copy({ catalogNumbers: ["Mi·PL 202"] })] },
      { catalog: "Mi·PL 315", copies: [copy({ catalogNumbers: ["Mi·PL 315"], issue: { name: "Ships", year: 1970 } })] },
    ]),
  };

  it("finds the offer by its number, with or without #", () => {
    assert.ok(offerPickerMatches(offer, "3065"));
    assert.ok(offerPickerMatches(offer, "#3065"));
  });

  it("finds it by any catalogue number it holds, past the sets its row shows", () => {
    assert.ok(offerPickerMatches(offer, "Mi PL 315"));
    assert.ok(offerPickerMatches(offer, "315"));
    assert.ok(offerPickerMatches(offer, "mi·pl 201"));
  });

  it("finds it by an issue's name or a stamp's", () => {
    assert.ok(offerPickerMatches(offer, "ships"));
    assert.ok(offerPickerMatches(offer, "Flowers"));
    assert.ok(offerPickerMatches(offer, "eagle"));
  });

  it("finds it by its own title", () => {
    const titled = { offerNo: 1, contents: offerPickerContents("Polish birds", null, []) };
    assert.ok(offerPickerMatches(titled, "polish"));
  });

  it("does not find it by what it does not hold", () => {
    assert.ok(!offerPickerMatches(offer, "Trains"));
    assert.ok(!offerPickerMatches(offer, "Mi·DE 999"));
  });
});
