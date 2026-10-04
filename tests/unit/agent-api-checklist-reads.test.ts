import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  agentChecklist,
  checklistInUse,
  compareChecklistOrder,
  stampsNotOnIssue,
  unfoundStamp,
  type ChecklistOrderKey,
  type ChecklistRow,
} from "../../src/lib/agent-api/checklist-reads";

// The pure half of the checklist operations (#1512): what a checklist is stated as, the order they
// are listed in, and the refusals. The operations are driven end to end in
// `tests/integration/agent-api-checklists.test.ts`.

const ROW: ChecklistRow = {
  id: "cl1",
  name: "Grosik 1928–1932",
  kind: "standard",
  nameByLanguage: {},
  issue: null,
  coversIssues: [
    { id: "i1", name: "Grosik", year: 1928 },
    { id: "i2", name: null, year: null },
  ],
  stampCount: 12,
  albums: [],
};

describe("agentChecklist", () => {
  it("states a checklist spanning issues with the issues it reaches, and no issue of its own", () => {
    assert.deepEqual(agentChecklist(ROW, "/c/x/checklists"), {
      checklistId: "cl1",
      name: "Grosik 1928–1932",
      type: "standard",
      spansIssues: true,
      coversIssues: [{ issueId: "i1", name: "Grosik", year: 1928 }, { issueId: "i2" }],
      stampCount: 12,
      path: "/c/x/checklists",
    });
  });

  it("states an issue's own checklist with its issue, its translations and the albums printing it", () => {
    const stated = agentChecklist(
      {
        ...ROW,
        nameByLanguage: { de: "Satz" },
        issue: { id: "i1", name: "Grosik", year: 1928 },
        albums: ["Poland I"],
      },
      "/c/x/issues/i1"
    );
    assert.equal(stated.spansIssues, false);
    assert.deepEqual(stated.issue, { issueId: "i1", name: "Grosik", year: 1928 });
    assert.equal(stated.coversIssues, undefined, "an anchored checklist does not restate what it covers");
    assert.deepEqual(stated.translatedNames, { de: "Satz" });
    assert.deepEqual(stated.albums, ["Poland I"]);
  });
});

describe("compareChecklistOrder", () => {
  const at = (ms: number) => new Date(ms);
  const key = (id: string, issue: ChecklistOrderKey["issue"], sortOrder = 0, created = 0): ChecklistOrderKey => ({
    id,
    sortOrder,
    createdAt: at(created),
    issue,
  });

  it("lists the spanning checklists first, then each issue's by year (unknown last), issue number and the collector's order", () => {
    const keys = [
      key("undated", { id: "u", year: null, issueNo: 1 }),
      key("1930-b", { id: "c", year: 1930, issueNo: 5 }, 1),
      key("1930-a", { id: "c", year: 1930, issueNo: 5 }, 0),
      key("1928", { id: "a", year: 1928, issueNo: 9 }),
      key("span-2", null, 1),
      key("1930-no3", { id: "b", year: 1930, issueNo: 3 }),
      key("span-1", null, 0),
    ];
    assert.deepEqual(
      [...keys].sort(compareChecklistOrder).map((k) => k.id),
      ["span-1", "span-2", "1928", "1930-no3", "1930-a", "1930-b", "undated"]
    );
  });

  it("falls back on creation time when two share a place, as every checklist list does", () => {
    const keys = [key("later", null, 0, 2000), key("earlier", null, 0, 1000)];
    assert.deepEqual([...keys].sort(compareChecklistOrder).map((k) => k.id), ["earlier", "later"]);
  });
});

describe("the refusals and the lenient report", () => {
  it("names the stamps an issue's checklist may not hold, and says nothing was added", () => {
    const err = stampsNotOnIssue("Basic set", "Grosik", [{ stampId: "s9", stampNo: 9, catalogNumbers: ["Mi·PL 300"] }]);
    assert.equal(err.code, "invalid_request");
    assert.match(err.message, /"Basic set" is "Grosik"'s own checklist/);
    assert.match(err.message, /Mi·PL 300 is not\. Nothing was added\./);
    assert.match(err.message, /spanning issues/);
  });

  it("names every album a checklist is printed in, and says nothing was deleted", () => {
    const err = checklistInUse("Basic set", [
      { id: "a1", name: "Poland I" },
      { id: "a2", name: "Poland II" },
    ]);
    assert.match(err.message, /printed in 2 albums "Poland I", "Poland II"/);
    assert.match(err.message, /Nothing was deleted\./);
  });

  it("says why an entry named no single stamp, per verdict", () => {
    assert.match(
      unfoundStamp({ input: "Mi 1", verdict: "ambiguous", stamps: [
        { stampId: "a", matchedNumber: "Mi·PL 1" },
        { stampId: "b", matchedNumber: "Mi·DE 1" },
      ] } as never).reason,
      /matches 2 stamps: Mi·PL 1 \(a\), Mi·DE 1 \(b\)/
    );
    assert.match(
      unfoundStamp({ input: "Xx 1", verdict: "unknown_vendor", acceptedVendors: ["Mi"], stamps: [] }).reason,
      /catalogues kept: Mi/
    );
    assert.deepEqual(unfoundStamp({ input: "nope", verdict: "no_match", stamps: [] }), {
      input: "nope",
      reason: "is no stamp id and no catalogue number of a stamp in this collection",
    });
  });
});
