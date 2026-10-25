import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkIssueListNarrowing,
  heldByCondition,
  issueListRow,
  ownPrefixes,
} from "../../src/lib/agent-api/issue-list-reads";
import { isApiError } from "../../src/lib/agent-api/errors";

// The pure half of `list_issues` (#2167): what a row says, how held copies fold into per-condition
// figures, and which narrowings make a call. The operation is driven end to end in
// `tests/integration/agent-api-list-issues.test.ts`.

const MNH = { id: "c-mnh", name: "Mint Never Hinged" };
const USED = { id: "c-used", name: "Used" };

describe("heldByCondition", () => {
  const counts = new Map([
    ["s1~c-mnh", 2],
    ["s2~c-mnh", 1],
    ["s2~c-used", 3],
    ["other~c-used", 9],
  ]);
  const countOf = (stampId: string, conditionId: string) => counts.get(`${stampId}~${conditionId}`) ?? 0;

  it("sums the issue's stamps per condition, in the collection's order, conditions held only", () => {
    assert.deepEqual(heldByCondition(["s1", "s2"], [MNH, USED], countOf), {
      heldCopies: 6,
      heldByCondition: [
        { condition: "Mint Never Hinged", copies: 3 },
        { condition: "Used", copies: 3 },
      ],
    });
    assert.deepEqual(heldByCondition(["s1"], [USED, MNH], countOf), {
      heldCopies: 2,
      heldByCondition: [{ condition: "Mint Never Hinged", copies: 2 }],
    });
  });

  it("counts a stamp listed twice once, and an issue with nothing held as none", () => {
    assert.equal(heldByCondition(["s1", "s1"], [MNH], countOf).heldCopies, 2);
    assert.deepEqual(heldByCondition([], [MNH, USED], countOf), { heldCopies: 0, heldByCondition: [] });
  });
});

describe("issueListRow", () => {
  const abbrOf = new Map([
    ["v-mi", "Mi"],
    ["v-fi", "Fi"],
  ]);
  const base = {
    id: "i1",
    issueNo: 12,
    name: "Castles",
    nameByLanguage: {},
    year: 1940,
    catalogPrefixes: [],
    memberCount: 5,
    requiredCount: 4,
  };
  const extras = {
    area: "Generalgouvernement",
    catalogRanges: ["Mi·GG 1–5"],
    abbrOf,
    held: { heldCopies: 0, heldByCondition: [] },
    path: "/c/mine/issues/i1",
  };

  it("states what the Issues list shows, leaving out what the issue does not state", () => {
    assert.deepEqual(issueListRow({ ...base, name: null, year: null }, { ...extras, area: null }), {
      issueId: "i1",
      issueNo: 12,
      catalogRanges: ["Mi·GG 1–5"],
      memberCount: 5,
      requiredCount: 4,
      heldCopies: 0,
      heldByCondition: [],
      path: "/c/mine/issues/i1",
    });
  });

  it("carries translated names and the issue's own prefixes", () => {
    const row = issueListRow(
      {
        ...base,
        nameByLanguage: { pl: "Zamki" },
        catalogPrefixes: [
          { catalogVendorId: "v-mi", areaPrefix: "GG" },
          { catalogVendorId: "v-fi", areaPrefix: "GG" },
        ],
      },
      { ...extras, held: { heldCopies: 2, heldByCondition: [{ condition: "Used", copies: 2 }] } }
    );
    assert.equal(row.name, "Castles");
    assert.equal(row.year, 1940);
    assert.equal(row.area, "Generalgouvernement");
    assert.deepEqual(row.translatedNames, { pl: "Zamki" });
    assert.deepEqual(row.prefixes, ["Fi: GG", "Mi: GG"]);
    assert.equal(row.heldCopies, 2);
  });

  it("spells an own prefix as update_issue takes it", () => {
    assert.deepEqual(ownPrefixes([{ catalogVendorId: "v-mi", areaPrefix: "PL" }], abbrOf), ["Mi: PL"]);
  });
});

describe("checkIssueListNarrowing", () => {
  const refused = (narrowing: Parameters<typeof checkIssueListNarrowing>[0]) => {
    try {
      checkIssueListNarrowing(narrowing);
    } catch (error) {
      assert.ok(isApiError(error));
      return error;
    }
    assert.fail("expected a refusal");
  };

  it("needs the area or the text", () => {
    const error = refused({ area: null, text: null, yearFrom: 1940, yearTo: 1945 });
    assert.deepEqual(error.accepted, ["area", "text"]);
    checkIssueListNarrowing({ area: "Poland", text: null, yearFrom: null, yearTo: null });
    checkIssueListNarrowing({ area: null, text: "Castles", yearFrom: null, yearTo: null });
  });

  it("refuses a span that runs backwards, and takes one year as both ends", () => {
    refused({ area: "Poland", text: null, yearFrom: 1945, yearTo: 1940 });
    checkIssueListNarrowing({ area: "Poland", text: null, yearFrom: 1940, yearTo: 1940 });
    checkIssueListNarrowing({ area: "Poland", text: null, yearFrom: 1940, yearTo: null });
  });
});
