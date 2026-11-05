import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendIssueFormatParam,
  copyStampIssueFormatIds,
  issueFormatFilterOptions,
  issueFormatItemWhere,
  issueFormatStampWhere,
  ISSUE_FORMAT_FILTER_PARAM,
  matchesIssueFormatFilter,
  ORDINARY_STAMP_ISSUE_FORMAT,
  parseIssueFormatIds,
} from "../../src/lib/issue-format-filter";
import { offerMatchesFilters } from "../../src/lib/listing-groups";

// The issue-format filter (#2440): one set of rules for every screen that filters stamps or copies.

describe("issue-format filter (#2440)", () => {
  it("offers Stamp (none) first, then the formats in their order", () => {
    assert.deepEqual(
      issueFormatFilterOptions([
        { id: "bl", name: "Souvenir sheet" },
        { id: "hbl", name: "Booklet pane" },
      ]),
      [
        { id: ORDINARY_STAMP_ISSUE_FORMAT, label: "Stamp (none)" },
        { id: "bl", label: "Souvenir sheet" },
        { id: "hbl", label: "Booklet pane" },
      ]
    );
  });

  it("reads the param back as it was written, blanks and repeats dropped", () => {
    const params = new URLSearchParams();
    appendIssueFormatParam(params, ["stamp", "bl"]);
    assert.deepEqual(parseIssueFormatIds(params.get(ISSUE_FORMAT_FILTER_PARAM)), ["stamp", "bl"]);
    assert.deepEqual(parseIssueFormatIds(" bl,,bl , hbl"), ["bl", "hbl"]);
    assert.deepEqual(parseIssueFormatIds(null), []);
    const none = new URLSearchParams();
    appendIssueFormatParam(none, []);
    assert.equal(none.toString(), "");
  });

  it("is no filter when nothing is ticked", () => {
    assert.equal(issueFormatStampWhere(undefined), null);
    assert.equal(issueFormatStampWhere([]), null);
    assert.equal(issueFormatItemWhere([]), null);
  });

  it("matches a real format by `in`, Stamp (none) by null, and both by an OR", () => {
    assert.deepEqual(issueFormatStampWhere(["bl", "ms"]), { issueFormatId: { in: ["bl", "ms"] } });
    assert.deepEqual(issueFormatStampWhere(["stamp"]), { issueFormatId: null });
    assert.deepEqual(issueFormatStampWhere(["stamp", "bl"]), {
      OR: [{ issueFormatId: null }, { issueFormatId: { in: ["bl"] } }],
    });
  });

  it("reads a copy through its leading stamp or any stamp it carries", () => {
    assert.deepEqual(issueFormatItemWhere(["bl"]), {
      OR: [
        { stamp: { issueFormatId: { in: ["bl"] } } },
        { stamps: { some: { stamp: { issueFormatId: { in: ["bl"] } } } } },
      ],
    });
  });

  it("passes a row already read when any of its stamps is in a ticked format", () => {
    assert.equal(matchesIssueFormatFilter([null], []), true);
    assert.equal(matchesIssueFormatFilter([null], ["stamp"]), true);
    assert.equal(matchesIssueFormatFilter([null], ["bl"]), false);
    assert.equal(matchesIssueFormatFilter(["bl"], ["stamp"]), false);
    assert.equal(matchesIssueFormatFilter([null, "bl"], ["bl"]), true);
    assert.deepEqual(
      copyStampIssueFormatIds({ issueFormatId: null, carriedStamps: [{ issueFormatId: "bl" }] }),
      [null, "bl"]
    );
  });

  it("keeps a ready offer in the listing workspace only when every copy passes", () => {
    const offer = (copyIssueFormats: (string | null)[][]) => ({ areaYears: [], copyIssueFormats });
    assert.equal(offerMatchesFilters(offer([["bl"], ["bl"]]), { issueFormatIds: ["bl"] }), true);
    assert.equal(offerMatchesFilters(offer([["bl"], [null]]), { issueFormatIds: ["bl"] }), false);
    assert.equal(offerMatchesFilters(offer([["bl"], [null]]), { issueFormatIds: ["bl", "stamp"] }), true);
    // A piece carrying a souvenir sheet among ordinary stamps passes on the sheet.
    assert.equal(offerMatchesFilters(offer([[null, null, "bl"]]), { issueFormatIds: ["bl"] }), true);
    assert.equal(offerMatchesFilters(offer([]), { issueFormatIds: ["bl"] }), false);
    assert.equal(offerMatchesFilters(offer([]), {}), true);
  });
});
