import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePhoneYear,
  phoneBrowseAreaPath,
  phoneBrowseIssuePath,
  phoneBrowsePath,
  phoneBrowseYearPath,
} from "../../src/lib/phone";
import {
  phoneAreaAncestors,
  phoneAreaChildren,
  phoneIssueCountText,
  phoneIssueName,
  phoneIssueStampRows,
  phoneStampMarks,
  phoneYearLabel,
} from "../../src/lib/phone-browse-view";

// Browsing on the phone (#2005, ADR-0072): area → year → issue → stamp. The addresses, how a level
// of the area tree is laid out, and what a stamp in a browsed issue says at a glance.

describe("the browse addresses", () => {
  it("puts every level under the collection's phone path", () => {
    assert.equal(phoneBrowsePath("poland"), "/c/poland/phone/browse");
    assert.equal(phoneBrowseAreaPath("poland", "a1"), "/c/poland/phone/browse/areas/a1");
    assert.equal(phoneBrowseYearPath("poland", "a1", 1938), "/c/poland/phone/browse/areas/a1/1938");
    assert.equal(phoneBrowseIssuePath("poland", "i1"), "/c/poland/phone/browse/issues/i1");
  });

  it("says the issues without a year as the desk's list does", () => {
    assert.equal(phoneBrowseYearPath("poland", "a1", null), "/c/poland/phone/browse/areas/a1/none");
  });

  it("reads a year segment back, and refuses one it does not have", () => {
    assert.equal(parsePhoneYear("1938"), 1938);
    assert.equal(parsePhoneYear("none"), null);
    assert.equal(parsePhoneYear("19x8"), undefined);
    assert.equal(parsePhoneYear(""), undefined);
    assert.equal(parsePhoneYear("12345"), undefined);
  });
});

const AREAS = [
  { id: "europe", name: "Europe", parentId: null },
  { id: "poland", name: "Poland", parentId: "europe" },
  { id: "second", name: "Second Republic", parentId: "poland" },
  { id: "gg", name: "General Gouvernement", parentId: "poland" },
  { id: "asia", name: "Asia", parentId: null },
];

describe("phoneAreaChildren", () => {
  it("offers the top-level areas for the collection's own level, in the order given", () => {
    const rows = phoneAreaChildren(AREAS, new Map(), null);
    assert.deepEqual(
      rows.map((r) => r.name),
      ["Europe", "Asia"]
    );
  });

  it("counts every issue under a sub-area, its own and its sub-areas'", () => {
    const counts = new Map([
      ["poland", 2],
      ["second", 10],
      ["gg", 3],
    ]);
    assert.deepEqual(phoneAreaChildren(AREAS, counts, null), [
      { id: "europe", name: "Europe", issueCount: 15 },
      { id: "asia", name: "Asia", issueCount: 0 },
    ]);
    assert.deepEqual(phoneAreaChildren(AREAS, counts, "poland"), [
      { id: "second", name: "Second Republic", issueCount: 10 },
      { id: "gg", name: "General Gouvernement", issueCount: 3 },
    ]);
  });

  it("has nothing for an area without sub-areas", () => {
    assert.deepEqual(phoneAreaChildren(AREAS, new Map(), "gg"), []);
  });
});

describe("phoneAreaAncestors", () => {
  it("lists where an area sits, outermost first, the area left out", () => {
    assert.deepEqual(
      phoneAreaAncestors(AREAS, "second").map((a) => a.name),
      ["Europe", "Poland"]
    );
    assert.deepEqual(phoneAreaAncestors(AREAS, "europe"), []);
  });
});

describe("the browse words", () => {
  it("counts issues", () => {
    assert.equal(phoneIssueCountText(0), "No issues");
    assert.equal(phoneIssueCountText(1), "1 issue");
    assert.equal(phoneIssueCountText(12), "12 issues");
  });

  it("names the year bucket without one", () => {
    assert.equal(phoneYearLabel(null), "No year");
    assert.equal(phoneYearLabel(1938), "1938");
  });

  it("names an unnamed issue", () => {
    assert.equal(phoneIssueName(null), "Untitled issue");
    assert.equal(phoneIssueName("  "), "Untitled issue");
    assert.equal(phoneIssueName("Castles"), "Castles");
  });
});

describe("phoneIssueStampRows", () => {
  it("keeps the issue's order and draws each variant under the stamp it varies", () => {
    const rows = phoneIssueStampRows([
      { stampId: "a", parentId: null },
      { stampId: "b", parentId: null },
      { stampId: "a1", parentId: "a" },
      { stampId: "a1x", parentId: "a1" },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.stamp.stampId, r.depth]),
      [
        ["a", 0],
        ["a1", 1],
        ["a1x", 2],
        ["b", 0],
      ]
    );
  });

  it("stands a variant whose stamp is not on the issue at the top level", () => {
    const rows = phoneIssueStampRows([{ stampId: "v", parentId: "elsewhere" }]);
    assert.deepEqual(rows.map((r) => [r.stamp.stampId, r.depth]), [["v", 0]]);
  });

  it("loses no stamp to a loop", () => {
    const rows = phoneIssueStampRows([
      { stampId: "x", parentId: "y" },
      { stampId: "y", parentId: "x" },
    ]);
    assert.deepEqual(rows.map((r) => r.stamp.stampId).sort(), ["x", "y"]);
  });
});

describe("phoneStampMarks", () => {
  it("says how many copies are held, and that none are", () => {
    assert.equal(phoneStampMarks(2, 0, null).held, "2 held");
    assert.equal(phoneStampMarks(2, 0, null).isHeld, true);
    assert.equal(phoneStampMarks(0, 0, null).held, "Not held");
    assert.equal(phoneStampMarks(0, 0, null).isHeld, false);
  });

  it("states the copies under the variants beside the count, never in it", () => {
    const marks = phoneStampMarks(0, 3, null);
    assert.equal(marks.held, "Not held");
    assert.equal(marks.variants, "3 more under its variants");
    assert.equal(phoneStampMarks(1, 0, null).variants, null);
  });

  it("marks a wanted stamp with its loudest open want's priority", () => {
    assert.equal(phoneStampMarks(0, 0, { openCount: 2, topPriority: "high" }).wanted, "high");
    assert.equal(phoneStampMarks(0, 0, null).wanted, null);
  });
});
