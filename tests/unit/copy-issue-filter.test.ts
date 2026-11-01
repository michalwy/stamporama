import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ISSUE_FILTER_PARAM,
  copyIssues,
  showIssueCopiesUpdate,
} from "../../src/lib/copy-issue-filter";
import { REMEMBERED_FILTER_KEYS } from "../../src/app/c/[collectionSlug]/inventory/copies-list-filters";

// #2308: a copy's row on the Copies list shows its issue's copies — the search replaced by an issue
// filter, every other filter kept.

const legions = { id: "i1", name: "Polish Legions", year: 1918 };
const chopin = { id: "i2", name: "Chopin", year: 1949 };
const airmail = { id: "i3", name: "Airmail", year: 1925 };

const carried = (issues: typeof legions[]) => ({
  stampId: "s",
  stampName: null,
  quantity: 1,
  formatName: null,
  formatAbbreviation: null,
  catalogNumbers: [],
  areaId: null,
  issueId: issues[0]?.id ?? null,
  issues,
});

describe("copyIssues", () => {
  it("offers every issue a single stamp is filed in, in the row's order", () => {
    assert.deepEqual(
      copyIssues({ multiStamp: false, issues: [legions, chopin], carriedStamps: [] }),
      [legions, chopin]
    );
  });

  it("offers nothing for a stamp filed in no issue", () => {
    assert.deepEqual(copyIssues({ multiStamp: false, issues: [], carriedStamps: [] }), []);
  });

  it("offers one per issue a multi-stamp copy carries, each once", () => {
    assert.deepEqual(
      copyIssues({
        multiStamp: true,
        // The leading stamp's issues are not the piece's: the carried stamps are read instead.
        issues: [airmail],
        carriedStamps: [carried([legions]), carried([chopin, legions]), carried([])],
      }),
      [legions, chopin]
    );
  });
});

describe("showIssueCopiesUpdate", () => {
  it("drops the search and sets the issue, naming nothing else", () => {
    assert.deepEqual(showIssueCopiesUpdate("i1"), { search: "", issueId: "i1" });
  });

  it("is not a remembered filter, so it lives in the address alone", () => {
    assert.equal((REMEMBERED_FILTER_KEYS as readonly string[]).includes(ISSUE_FILTER_PARAM), false);
  });
});
