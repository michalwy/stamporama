import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareReplacementPlace,
  copyMootReason,
  describeReplacementStatus,
  pairMootReason,
  replacedCopiesConflict,
  replacementConflict,
} from "../../src/lib/replacement-rules";

// Replacement pairs (#1936, ADR-0070): the pure half.

const held = { sold: false, tradedAway: false, disposed: false };
const label = (n: number) => `#${n}`;

describe("copyMootReason", () => {
  it("is null for a copy still held", () => {
    assert.equal(copyMootReason(held), null);
  });

  it("names each way a copy leaves", () => {
    assert.equal(copyMootReason(null), "deleted");
    assert.equal(copyMootReason({ ...held, sold: true }), "sold");
    assert.equal(copyMootReason({ ...held, tradedAway: true }), "traded");
    assert.equal(copyMootReason({ ...held, disposed: true }), "disposed");
  });
});

describe("pairMootReason", () => {
  it("is null while both copies are held", () => {
    assert.equal(pairMootReason(held, held), null);
  });

  it("names the old copy first when both have gone", () => {
    assert.deepEqual(pairMootReason({ ...held, sold: true }, null), {
      reason: "deleted",
      side: "old",
    });
  });

  it("names the new copy when only it has gone", () => {
    assert.deepEqual(pairMootReason({ ...held, disposed: true }, held), {
      reason: "disposed",
      side: "new",
    });
  });
});

describe("describeReplacementStatus", () => {
  const pair = { newItemNo: 12, oldItemNo: 7, mootReason: null, mootSide: null };

  it("reads the plain statuses", () => {
    assert.equal(describeReplacementStatus({ ...pair, status: "open" }, label), "Open");
    assert.equal(describeReplacementStatus({ ...pair, status: "done" }, label), "Done");
    assert.equal(describeReplacementStatus({ ...pair, status: "cancelled" }, label), "Cancelled");
  });

  it("says which copy made a moot pair close, and why", () => {
    assert.equal(
      describeReplacementStatus(
        { ...pair, status: "moot", mootReason: "sold", mootSide: "old" },
        label
      ),
      "Closed — #7 was sold"
    );
    assert.equal(
      describeReplacementStatus(
        { ...pair, status: "moot", mootReason: "deleted", mootSide: "new" },
        label
      ),
      "Closed — #12 was deleted"
    );
  });
});

describe("compareReplacementPlace", () => {
  it("walks by location, then by ref in walk order, copies stored nowhere last", () => {
    const places = [
      { locationPath: null, locationRef: null, oldItemNo: 1 },
      { locationPath: "Box B", locationRef: "A2", oldItemNo: 2 },
      { locationPath: "Box A", locationRef: "A10", oldItemNo: 3 },
      { locationPath: "Box A", locationRef: "A9", oldItemNo: 4 },
    ];
    const order = [...places].sort(compareReplacementPlace).map((p) => p.oldItemNo);
    assert.deepEqual(order, [4, 3, 2, 1]);
  });
});

describe("replacementConflict", () => {
  const ok = {
    newCopy: { itemNo: 2, gone: null, openAsNew: false },
    oldCopy: { itemNo: 1, gone: null, openAsOld: false },
    copyLabel: label,
  };

  it("allows two held copies in no open pair", () => {
    assert.equal(replacementConflict(ok), null);
  });

  it("refuses a copy replacing itself", () => {
    assert.match(
      replacementConflict({ ...ok, oldCopy: { ...ok.oldCopy, itemNo: 2 } }) ?? "",
      /cannot replace itself/
    );
  });

  it("refuses a copy that has gone", () => {
    assert.equal(
      replacementConflict({ ...ok, oldCopy: { ...ok.oldCopy, gone: "sold" } }),
      "#1 was sold."
    );
  });

  it("refuses a second open pair on the same side", () => {
    assert.match(
      replacementConflict({ ...ok, newCopy: { ...ok.newCopy, openAsNew: true } }) ?? "",
      /#2 already replaces another copy/
    );
    assert.match(
      replacementConflict({ ...ok, oldCopy: { ...ok.oldCopy, openAsOld: true } }) ?? "",
      /#1 is already being replaced/
    );
  });
});

describe("replacedCopiesConflict (#1937)", () => {
  const held = { itemNo: 1, gone: null, openAsOld: false };

  it("allows held copies in no open pair, and no copies at all", () => {
    assert.equal(replacedCopiesConflict([held, { ...held, itemNo: 2 }], label), null);
    assert.equal(replacedCopiesConflict([], label), null);
  });

  it("refuses a copy that has gone", () => {
    assert.equal(replacedCopiesConflict([{ ...held, gone: "traded" }], label), "#1 was traded away.");
  });

  it("refuses a copy already being replaced", () => {
    assert.match(
      replacedCopiesConflict([{ ...held, openAsOld: true }], label) ?? "",
      /#1 is already being replaced/
    );
  });

  it("refuses two tiles replacing the same copy", () => {
    assert.equal(replacedCopiesConflict([held, held], label), "Two tiles cannot both replace #1.");
  });
});
