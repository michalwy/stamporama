import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  anyAxes,
  copyGroupKey,
  decodeCopyGroupKey,
  encodeCopyGroupKey,
  mixedAxes,
  outlierCopyIds,
  COLNECT_GROUP_AXES,
  DEFAULT_GROUP_AXES,
  type CopyGroupAxes,
} from "../../src/lib/copy-groups";

const ANY: CopyGroupAxes = { condition: false, format: false, certificate: false };
const ALL: CopyGroupAxes = { condition: true, format: true, certificate: true };
const BY_CONDITION: CopyGroupAxes = { condition: true, format: false, certificate: false };

/** A copy as the grouping sees it. */
const copy = (
  id: string,
  stampId: string,
  conditionId: string,
  formatId: string | null = null,
  certificateStatusId: string | null = null
) => ({ id, stampId, conditionId, formatId, certificateStatusId });

describe("copyGroupKey", () => {
  it("zeroes the axes that are off, so copies differing only there group together", () => {
    const a = copy("a", "s1", "mnh", "pair", "cert");
    const b = copy("b", "s1", "mnh", null, null);
    assert.deepEqual(copyGroupKey(a, ANY), copyGroupKey(b, ANY));
  });

  it("splits on an axis that is on", () => {
    const a = copy("a", "s1", "mnh", "pair", null);
    const b = copy("b", "s1", "mnh", null, null);
    assert.notDeepEqual(copyGroupKey(a, ALL), copyGroupKey(b, ALL));
  });

  it("groups every condition of a stamp together while condition is off (#1537)", () => {
    assert.deepEqual(
      copyGroupKey(copy("a", "s1", "mnh"), ANY),
      copyGroupKey(copy("b", "s1", "used"), ANY)
    );
  });

  it("splits by condition while condition is on", () => {
    assert.notDeepEqual(
      copyGroupKey(copy("a", "s1", "mnh"), BY_CONDITION),
      copyGroupKey(copy("b", "s1", "used"), BY_CONDITION)
    );
  });

  it("leaves condition off by default, and on in the Colnect reading", () => {
    assert.equal(DEFAULT_GROUP_AXES.condition, false);
    assert.deepEqual(COLNECT_GROUP_AXES, BY_CONDITION);
  });
});

describe("encodeCopyGroupKey / decodeCopyGroupKey", () => {
  it("round-trips a stamp-only key", () => {
    const key = copyGroupKey(copy("a", "s1", "mnh", "pair", "cert"), ANY);
    const encoded = encodeCopyGroupKey(key, ANY);
    assert.equal(key.conditionId, null);
    assert.deepEqual(decodeCopyGroupKey(encoded), { key, axes: ANY });
  });

  it("round-trips a stamp × condition key", () => {
    const key = copyGroupKey(copy("a", "s1", "mnh", "pair", "cert"), BY_CONDITION);
    const encoded = encodeCopyGroupKey(key, BY_CONDITION);
    assert.deepEqual(decodeCopyGroupKey(encoded), { key, axes: BY_CONDITION });
  });

  it("round-trips a key that joined both axes, nulls included", () => {
    const key = copyGroupKey(copy("a", "s1", "mnh", null, null), ALL);
    const encoded = encodeCopyGroupKey(key, ALL);
    assert.deepEqual(decodeCopyGroupKey(encoded), { key, axes: ALL });
  });

  it("distinguishes 'no format' from 'format not grouped on'", () => {
    const byFormat: CopyGroupAxes = { condition: false, format: true, certificate: false };
    const noFormat = encodeCopyGroupKey(
      copyGroupKey(copy("a", "s1", "mnh", null), byFormat),
      byFormat
    );
    const notGrouped = encodeCopyGroupKey(copyGroupKey(copy("a", "s1", "mnh", "pair"), ANY), ANY);
    assert.notEqual(noFormat, notGrouped);
    assert.equal(decodeCopyGroupKey(noFormat)!.axes.format, true);
    assert.equal(decodeCopyGroupKey(notGrouped)!.axes.format, false);
  });

  it("returns null on a malformed key rather than narrowing to nothing", () => {
    assert.equal(decodeCopyGroupKey("garbage"), null);
    assert.equal(decodeCopyGroupKey("|mnh||"), null);
    assert.equal(decodeCopyGroupKey("s1|mnh|"), null);
  });
});

describe("anyAxes", () => {
  it("names the axes a group can still be mixed on", () => {
    assert.deepEqual(anyAxes(ANY), ["condition", "format", "certificate"]);
    assert.deepEqual(anyAxes(BY_CONDITION), ["format", "certificate"]);
    assert.deepEqual(anyAxes({ condition: true, format: true, certificate: false }), [
      "certificate",
    ]);
    assert.deepEqual(anyAxes(ALL), []);
  });
});

describe("mixedAxes", () => {
  it("marks an axis whose members actually disagree", () => {
    const members = [copy("a", "s1", "mnh", "pair"), copy("b", "s1", "mnh", null)];
    assert.deepEqual(mixedAxes(members, ANY), {
      condition: false,
      format: true,
      certificate: false,
    });
  });

  it("marks mixed conditions while condition is off (#1537)", () => {
    const members = [copy("a", "s1", "mnh"), copy("b", "s1", "used")];
    assert.equal(mixedAxes(members, ANY).condition, true);
    assert.equal(mixedAxes(members, BY_CONDITION).condition, false);
  });

  it("never marks an axis that is part of the key", () => {
    const members = [copy("a", "s1", "mnh", "pair"), copy("b", "s1", "mnh", "pair")];
    assert.deepEqual(mixedAxes(members, ALL), {
      condition: false,
      format: false,
      certificate: false,
    });
  });

  it("leaves an agreeing axis unmarked", () => {
    const members = [copy("a", "s1", "mnh"), copy("b", "s1", "mnh")];
    assert.deepEqual(mixedAxes(members, ANY), {
      condition: false,
      format: false,
      certificate: false,
    });
  });
});

describe("outlierCopyIds", () => {
  it("flags the copies differing from the group's most common value", () => {
    const members = [
      copy("a", "s1", "mnh"),
      copy("b", "s1", "mnh"),
      copy("c", "s1", "mnh"),
      copy("d", "s1", "mnh", "pair"),
    ];
    assert.deepEqual([...outlierCopyIds(members, ANY)], ["d"]);
  });

  it("flags the plain single when the stock is mostly blocks", () => {
    const members = [
      copy("a", "s1", "mnh", "block"),
      copy("b", "s1", "mnh", "block"),
      copy("c", "s1", "mnh", null),
    ];
    assert.deepEqual([...outlierCopyIds(members, ANY)], ["c"]);
  });

  it("flags on the certificate axis too", () => {
    const members = [
      copy("a", "s1", "mnh", null, null),
      copy("b", "s1", "mnh", null, null),
      copy("c", "s1", "mnh", null, "cert"),
    ];
    assert.deepEqual([...outlierCopyIds(members, ANY)], ["c"]);
  });

  it("flags the copy in a minority condition while condition is off (#1537)", () => {
    const members = [copy("a", "s1", "mnh"), copy("b", "s1", "mnh"), copy("c", "s1", "used")];
    assert.deepEqual([...outlierCopyIds(members, ANY)], ["c"]);
    assert.equal(outlierCopyIds(members, BY_CONDITION).size, 0);
  });

  it("marks nothing on a tie — with no majority there is no exception", () => {
    const members = [copy("a", "s1", "mnh", "pair"), copy("b", "s1", "mnh", null)];
    assert.equal(outlierCopyIds(members, ANY).size, 0);
  });

  it("marks nothing when the axis is part of the key", () => {
    const members = [
      copy("a", "s1", "mnh", "pair"),
      copy("b", "s1", "mnh", "pair"),
      copy("c", "s1", "mnh", "pair"),
    ];
    assert.equal(outlierCopyIds(members, ALL).size, 0);
  });

  it("marks nothing in a group of one", () => {
    assert.equal(outlierCopyIds([copy("a", "s1", "mnh", "pair")], ANY).size, 0);
  });
});
