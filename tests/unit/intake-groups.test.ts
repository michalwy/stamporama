import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildIntakeGroups,
  formatIntakeGroupAxes,
  intakeGroupKey,
  matchesIntakeGroup,
  parseIntakeGroupAxes,
  withGroupScope,
  NO_GROUP_KEY,
  type GroupableCopy,
  type IntakeGroupNode,
} from "../../src/lib/intake-groups";

// How a purchase lot's item list piles up (#1189). The case #1189 settles explicitly — a copy with
// no area, or no year of issue — is the one pinned down hardest here: it is the case that goes
// wrong by being quietly filed under a neighbour or dropped, and neither failure shows up as an
// error anywhere.

const AREAS = new Map([
  ["pl", "Poland"],
  ["de", "Germany"],
]);

function mk(partial: Partial<GroupableCopy> = {}): GroupableCopy {
  return {
    areaId: null,
    issuedYear: null,
    issueYear: null,
    issueId: null,
    issueName: null,
    lotStatus: "open",
    ...partial,
  };
}

/** Every copy the tree accounts for, level by level — the invariant "exactly once" is checked on. */
function totals(nodes: IntakeGroupNode[]): number {
  return nodes.reduce((sum, n) => sum + n.count, 0);
}

function labels(nodes: IntakeGroupNode[]): string[] {
  return nodes.map((n) => n.label);
}

describe("intakeGroupKey", () => {
  it("takes the stamp's own year, falling back to the issue's", () => {
    assert.equal(intakeGroupKey("year", mk({ issuedYear: 1950, issueYear: 1949 })), "1950");
    assert.equal(intakeGroupKey("year", mk({ issuedYear: null, issueYear: 1949 })), "1949");
  });

  it("reports no area and no year as the same reserved key", () => {
    assert.equal(intakeGroupKey("area", mk()), NO_GROUP_KEY);
    assert.equal(intakeGroupKey("year", mk()), NO_GROUP_KEY);
    assert.equal(intakeGroupKey("issue", mk()), NO_GROUP_KEY);
  });
});

describe("buildIntakeGroups", () => {
  it("draws no headings at all when no axis is asked for", () => {
    assert.deepEqual(buildIntakeGroups([mk(), mk()], [], { areaNameById: AREAS }), []);
  });

  it("keeps a copy with no area, under a heading that says so", () => {
    const items = [mk({ areaId: "pl" }), mk({ areaId: null }), mk({ areaId: "pl" })];
    const tree = buildIntakeGroups(items, ["area"], { areaNameById: AREAS });
    assert.deepEqual(labels(tree), ["Poland", "No area"]);
    assert.deepEqual(
      tree.map((n) => n.count),
      [2, 1]
    );
    assert.equal(totals(tree), items.length);
  });

  it("keeps a copy with no year, under a heading that says so", () => {
    const items = [
      mk({ issuedYear: 1950 }),
      mk({ issuedYear: null, issueYear: null }),
      mk({ issuedYear: 1918 }),
    ];
    const tree = buildIntakeGroups(items, ["year"], { areaNameById: AREAS });
    // Chronological, and the leftovers pile last whatever the years are.
    assert.deepEqual(labels(tree), ["1918", "1950", "No year"]);
    assert.equal(totals(tree), items.length);
  });

  it("puts a copy missing *both* in one nested pile, never in a neighbour's", () => {
    const items = [
      mk({ areaId: "pl", issuedYear: 1950 }),
      mk({ areaId: "pl", issuedYear: null }),
      mk({ areaId: null, issuedYear: 1950 }),
      mk({ areaId: null, issuedYear: null }),
    ];
    const tree = buildIntakeGroups(items, ["area", "year"], { areaNameById: AREAS });
    assert.deepEqual(labels(tree), ["Poland", "No area"]);
    assert.deepEqual(labels(tree[0].children), ["1950", "No year"]);
    assert.deepEqual(labels(tree[1].children), ["1950", "No year"]);
    // One copy in each of the four leaves: nothing doubled, nothing dropped.
    for (const area of tree) {
      assert.equal(totals(area.children), area.count);
      for (const year of area.children) assert.equal(year.count, 1);
    }
    assert.equal(totals(tree), items.length);
  });

  it("nests area outside year however the axes are handed in", () => {
    const items = [mk({ areaId: "de", issuedYear: 1961 })];
    const asked = buildIntakeGroups(items, ["year", "area"], { areaNameById: AREAS });
    assert.deepEqual(labels(asked), ["Germany"]);
    assert.deepEqual(labels(asked[0].children), ["1961"]);
  });

  it("orders areas by name and leaves issues in the order the lot acquired them", () => {
    const items = [
      mk({ areaId: "pl", issueId: "b", issueName: "Later" }),
      mk({ areaId: "de", issueId: "a", issueName: "Earlier" }),
    ];
    assert.deepEqual(labels(buildIntakeGroups(items, ["area"], { areaNameById: AREAS })), [
      "Germany",
      "Poland",
    ]);
    assert.deepEqual(labels(buildIntakeGroups(items, ["issue"], { areaNameById: AREAS })), [
      "Later",
      "Earlier",
    ]);
  });

  it("names an area the collection no longer has rather than dropping its copies", () => {
    const tree = buildIntakeGroups([mk({ areaId: "gone" })], ["area"], { areaNameById: AREAS });
    assert.deepEqual(labels(tree), ["Unnamed area"]);
    assert.equal(tree[0].count, 1);
  });

  it("counts only the copies in a still-open lot as writable", () => {
    const tree = buildIntakeGroups(
      [mk({ areaId: "pl", lotStatus: "open" }), mk({ areaId: "pl", lotStatus: "closed" })],
      ["area"],
      { areaNameById: AREAS }
    );
    assert.equal(tree[0].count, 2);
    assert.equal(tree[0].openCount, 1);
  });

  it("gives every heading a path its children extend", () => {
    const tree = buildIntakeGroups([mk({ areaId: "pl", issuedYear: 1950 })], ["area", "year"], {
      areaNameById: AREAS,
    });
    assert.equal(tree[0].path, "area:pl");
    assert.equal(tree[0].children[0].path, "area:pl/year:1950");
  });
});

describe("the scope a heading's page is fetched with", () => {
  it("accumulates down the tree without disturbing a sibling's", () => {
    const area = withGroupScope({}, "area", "pl");
    assert.deepEqual(withGroupScope(area, "year", "1950"), { areaKey: "pl", yearKey: "1950" });
    assert.deepEqual(area, { areaKey: "pl" });
  });

  it("matches exactly the copies the heading counted", () => {
    const copy = mk({ areaId: null, issuedYear: null });
    assert.ok(matchesIntakeGroup(copy, "area", NO_GROUP_KEY));
    assert.ok(matchesIntakeGroup(copy, "year", NO_GROUP_KEY));
    assert.ok(!matchesIntakeGroup(copy, "area", "pl"));
    // No key is no narrowing — the ungrouped list.
    assert.ok(matchesIntakeGroup(copy, "area", undefined));
  });
});

describe("the axes as a request parameter", () => {
  it("round-trips in nesting order whatever order it is given", () => {
    assert.equal(formatIntakeGroupAxes(["issue", "area"]), "area,issue");
    assert.deepEqual(parseIntakeGroupAxes("issue,area"), ["area", "issue"]);
  });

  it("drops anything unrecognised rather than refusing the read", () => {
    assert.deepEqual(parseIntakeGroupAxes("area,condition"), ["area"]);
    assert.deepEqual(parseIntakeGroupAxes(""), []);
    assert.deepEqual(parseIntakeGroupAxes(null), []);
  });
});
