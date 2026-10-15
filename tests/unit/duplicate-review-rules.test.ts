import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  duplicateReviewStacks,
  keeperReplaces,
  type DuplicateReviewCopy,
} from "../../src/lib/duplicate-review-rules";
import { DEFAULT_GROUP_AXES } from "../../src/lib/copy-groups";

// The duplicate review's stacks (#1938): which stamps it offers, in what order, and what picking the
// keeper pairs.

let n = 0;
function copy(over: Partial<DuplicateReviewCopy> = {}): DuplicateReviewCopy {
  n += 1;
  return {
    id: `c${n}`,
    itemNo: n,
    stampId: "s1",
    stampLabel: "Mi 1",
    conditionId: "mnh",
    formatId: null,
    certificateStatusId: null,
    keptAll: false,
    replacedByItemNo: null,
    ...over,
  };
}

describe("duplicateReviewStacks", () => {
  it("offers a stamp held twice and not one held once", () => {
    const stacks = duplicateReviewStacks(
      [copy(), copy(), copy({ stampId: "s2", stampLabel: "Mi 2" })],
      DEFAULT_GROUP_AXES
    );
    assert.equal(stacks.length, 1);
    assert.equal(stacks[0].stampId, "s1");
    assert.equal(stacks[0].copies.length, 2);
  });

  it("keeps a mint-and-used pair apart under Split by condition", () => {
    const pair = [copy(), copy({ conditionId: "used" })];
    assert.equal(duplicateReviewStacks(pair, DEFAULT_GROUP_AXES).length, 1);
    assert.equal(
      duplicateReviewStacks(pair, { ...DEFAULT_GROUP_AXES, condition: true }).length,
      0
    );
  });

  it("leaves out a stack whose every undecided copy is kept, until an unmarked copy joins", () => {
    const kept = [copy({ keptAll: true }), copy({ keptAll: true })];
    assert.equal(duplicateReviewStacks(kept, DEFAULT_GROUP_AXES).length, 0);
    const joined = duplicateReviewStacks([...kept, copy()], DEFAULT_GROUP_AXES);
    assert.equal(joined.length, 1);
    assert.equal(joined[0].copies.length, 3);
  });

  it("shows a copy already being replaced with its stack, but does not count it", () => {
    const settled = [copy({ replacedByItemNo: 99 }), copy()];
    assert.equal(duplicateReviewStacks(settled, DEFAULT_GROUP_AXES).length, 0);
    const three = duplicateReviewStacks(
      [copy({ replacedByItemNo: 99 }), copy(), copy()],
      DEFAULT_GROUP_AXES
    );
    assert.equal(three.length, 1);
    assert.equal(three[0].copies.length, 3);
  });

  it("lists the biggest stack first, then by stamp in reading order", () => {
    const stacks = duplicateReviewStacks(
      [
        copy({ stampId: "a", stampLabel: "Mi 10" }),
        copy({ stampId: "a", stampLabel: "Mi 10" }),
        copy({ stampId: "b", stampLabel: "Mi 9" }),
        copy({ stampId: "b", stampLabel: "Mi 9" }),
        copy({ stampId: "c", stampLabel: "Mi 20" }),
        copy({ stampId: "c", stampLabel: "Mi 20" }),
        copy({ stampId: "c", stampLabel: "Mi 20" }),
      ],
      DEFAULT_GROUP_AXES
    );
    assert.deepEqual(
      stacks.map((s) => s.stampLabel),
      ["Mi 20", "Mi 9", "Mi 10"]
    );
  });
});

describe("keeperReplaces", () => {
  it("pairs every other undecided copy with the keeper", () => {
    const a = copy();
    const b = copy();
    const c = copy({ replacedByItemNo: 99 });
    const d = copy();
    assert.deepEqual(
      keeperReplaces([a, b, c, d], a.id)?.map((x) => x.id),
      [b.id, d.id]
    );
  });

  it("refuses a keeper that is already being replaced", () => {
    const a = copy({ replacedByItemNo: 99 });
    assert.equal(keeperReplaces([a, copy()], a.id), null);
  });
});
