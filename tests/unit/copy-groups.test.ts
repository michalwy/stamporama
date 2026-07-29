import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  anyAxes,
  copyGroupKey,
  decodeCopyGroupKey,
  encodeCopyGroupKey,
  mixedAxes,
  outlierCopyIds,
  type CopyGroupAxes,
} from "../../src/lib/copy-groups";

const ANY: CopyGroupAxes = { format: false, certificate: false };
const BOTH: CopyGroupAxes = { format: true, certificate: true };

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
    assert.notDeepEqual(copyGroupKey(a, BOTH), copyGroupKey(b, BOTH));
  });

  it("never groups two conditions together", () => {
    assert.notDeepEqual(
      copyGroupKey(copy("a", "s1", "mnh"), ANY),
      copyGroupKey(copy("b", "s1", "used"), ANY)
    );
  });
});

describe("encodeCopyGroupKey / decodeCopyGroupKey", () => {
  it("round-trips a plain stamp × condition key", () => {
    const key = copyGroupKey(copy("a", "s1", "mnh", "pair", "cert"), ANY);
    const encoded = encodeCopyGroupKey(key, ANY);
    assert.deepEqual(decodeCopyGroupKey(encoded), { key, axes: ANY });
  });

  it("round-trips a key that joined both axes, nulls included", () => {
    const key = copyGroupKey(copy("a", "s1", "mnh", null, null), BOTH);
    const encoded = encodeCopyGroupKey(key, BOTH);
    assert.deepEqual(decodeCopyGroupKey(encoded), { key, axes: BOTH });
  });

  it("distinguishes 'no format' from 'format not grouped on'", () => {
    const noFormat = encodeCopyGroupKey(
      copyGroupKey(copy("a", "s1", "mnh", null), { format: true, certificate: false }),
      { format: true, certificate: false }
    );
    const notGrouped = encodeCopyGroupKey(copyGroupKey(copy("a", "s1", "mnh", "pair"), ANY), ANY);
    assert.notEqual(noFormat, notGrouped);
    assert.equal(decodeCopyGroupKey(noFormat)!.axes.format, true);
    assert.equal(decodeCopyGroupKey(notGrouped)!.axes.format, false);
  });

  it("returns null on a malformed key rather than narrowing to nothing", () => {
    assert.equal(decodeCopyGroupKey("garbage"), null);
    assert.equal(decodeCopyGroupKey("|mnh||"), null);
  });
});

describe("anyAxes", () => {
  it("names the axes a group can still be mixed on", () => {
    assert.deepEqual(anyAxes(ANY), ["format", "certificate"]);
    assert.deepEqual(anyAxes({ format: true, certificate: false }), ["certificate"]);
    assert.deepEqual(anyAxes(BOTH), []);
  });
});

describe("mixedAxes", () => {
  it("marks an axis whose members actually disagree", () => {
    const members = [copy("a", "s1", "mnh", "pair"), copy("b", "s1", "mnh", null)];
    assert.deepEqual(mixedAxes(members, ANY), { format: true, certificate: false });
  });

  it("never marks an axis that is part of the key", () => {
    const members = [copy("a", "s1", "mnh", "pair"), copy("b", "s1", "mnh", "pair")];
    assert.deepEqual(mixedAxes(members, BOTH), { format: false, certificate: false });
  });

  it("leaves an agreeing axis unmarked", () => {
    const members = [copy("a", "s1", "mnh"), copy("b", "s1", "mnh")];
    assert.deepEqual(mixedAxes(members, ANY), { format: false, certificate: false });
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
    assert.equal(outlierCopyIds(members, BOTH).size, 0);
  });

  it("marks nothing in a group of one", () => {
    assert.equal(outlierCopyIds([copy("a", "s1", "mnh", "pair")], ANY).size, 0);
  });
});
