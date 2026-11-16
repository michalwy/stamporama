import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeCopyApiReview, describeLotCopiesToReview, readCopyApiReview } from "../../src/lib/copy-review";
import { nextApiReview, CONFIRMED_API_REVIEW } from "../../src/lib/auction-review";
import { lotCopy } from "../../src/lib/agent-api/purchase-reads";

// A copy's *to review* marker (#2551): #1626's marker on one more record, put into words for a copy,
// and how an assistant is told about a lot's copies.

const at = new Date("2026-11-16T10:00:00.000Z");
const iso = (value: string) => value.slice(0, 10);

describe("a copy's to-review marker (#2551)", () => {
  it("is absent when nothing waits, and reads the stored columns otherwise", () => {
    assert.equal(readCopyApiReview(CONFIRMED_API_REVIEW), null);
    assert.deepEqual(readCopyApiReview({ apiReviewAt: at, apiReviewCreated: true, apiReviewFields: [] }), {
      at: at.toISOString(),
      created: true,
      fields: [],
    });
  });

  it("says what the assistant did and where to confirm it", () => {
    const added = nextApiReview(CONFIRMED_API_REVIEW, { kind: "created" }, at);
    const corrected = nextApiReview(added, { kind: "changed", fields: ["condition", "format"] }, at);
    assert.equal(
      describeCopyApiReview(readCopyApiReview(corrected)!, iso),
      "Added through the agent API, then changed: condition, format — last on 2026-11-16. Confirm it on its purchase's screen."
    );
    const onlyChanged = nextApiReview(CONFIRMED_API_REVIEW, { kind: "changed", fields: ["stamp"] }, at);
    assert.match(describeCopyApiReview(readCopyApiReview(onlyChanged)!, iso), /^Changed through the agent API: stamp/);
    assert.match(describeLotCopiesToReview(1), /^1 copy of this lot was/);
    assert.match(describeLotCopiesToReview(3), /^3 copies of this lot were/);
  });
});

describe("a lot's copy as the agent is told it (#2551)", () => {
  const row = {
    id: "c1",
    itemNo: 12,
    stampId: "s1",
    stampNo: 7,
    stampName: "Wawel",
    catalogNumbers: ["Mi 1234"],
    conditionName: "Mint Never Hinged",
    formatName: null,
    deliveryState: "ordered",
    apiReviewAt: at,
    apiReviewCreated: true,
    apiReviewFields: [],
  };

  it("names the stamp, the condition and the state, and leaves a single's format out", () => {
    assert.deepEqual(lotCopy(row), {
      copyId: "c1",
      itemNo: 12,
      stampId: "s1",
      stampNo: 7,
      stamp: "Wawel",
      catalogNumbers: ["Mi 1234"],
      condition: "Mint Never Hinged",
      state: "ordered",
      toReview: { at: at.toISOString(), created: true, changed: [] },
    });
  });

  it("carries no marker once confirmed, and no condition on a piece", () => {
    const copy = lotCopy({ ...row, conditionName: null, apiReviewAt: null, apiReviewCreated: false });
    assert.equal(copy.toReview, undefined);
    assert.equal(copy.condition, undefined);
  });
});
