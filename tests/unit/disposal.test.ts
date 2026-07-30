import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DISPOSAL_REASONS,
  DISPOSAL_REASON_META,
  describeDisposal,
  disposalNoteRequired,
  disposalReasonLabel,
  disposalReasonToken,
  isDisposalReason,
  isHeld,
} from "../../src/lib/disposal";
import { costBasisCopyCount } from "../../src/lib/valuation";

describe("isDisposalReason", () => {
  it("accepts every reason in the vocabulary", () => {
    for (const reason of DISPOSAL_REASONS) assert.equal(isDisposalReason(reason), true);
  });

  it("rejects anything else, including empty and absent values", () => {
    assert.equal(isDisposalReason("stolen"), false);
    assert.equal(isDisposalReason(""), false);
    assert.equal(isDisposalReason(null), false);
    assert.equal(isDisposalReason(undefined), false);
  });
});

describe("disposal display", () => {
  it("labels and tints every reason", () => {
    for (const reason of DISPOSAL_REASONS) {
      assert.equal(disposalReasonLabel(reason), DISPOSAL_REASON_META[reason].label);
      assert.equal(disposalReasonToken(reason), DISPOSAL_REASON_META[reason].token);
    }
  });

  it("falls back to the raw value rather than rendering blank", () => {
    assert.equal(disposalReasonLabel("stolen"), "stolen");
    assert.equal(disposalReasonToken("stolen"), "muted");
  });
});

describe("disposalNoteRequired", () => {
  it("demands a note only for `other`, which says nothing on its own", () => {
    assert.equal(disposalNoteRequired("other"), true);
    assert.equal(disposalNoteRequired("lost"), false);
    assert.equal(disposalNoteRequired("damaged"), false);
  });
});

describe("isHeld", () => {
  it("holds a delivered, undisposed copy", () => {
    assert.equal(isHeld({ disposedAt: null, deliveryState: "delivered" }), true);
  });

  it("counts in-flight copies as held — they are on their way in, not gone", () => {
    for (const state of ["ordered", "in_transit", "to_sort"]) {
      assert.equal(isHeld({ disposedAt: null, deliveryState: state }), true);
    }
  });

  it("drops the two unavailable delivery outcomes", () => {
    assert.equal(isHeld({ disposedAt: null, deliveryState: "not_delivered" }), false);
    assert.equal(isHeld({ disposedAt: null, deliveryState: "damaged" }), false);
  });

  it("drops a disposed copy whatever its delivery state says", () => {
    assert.equal(isHeld({ disposedAt: new Date(), deliveryState: "delivered" }), false);
    assert.equal(isHeld({ disposedAt: "2026-07-30T00:00:00.000Z", deliveryState: "delivered" }), false);
  });
});

describe("describeDisposal", () => {
  it("returns null for a copy that is still held, so callers render nothing", () => {
    assert.equal(
      describeDisposal({ disposedAt: null, disposalReason: null, disposalNote: null }),
      null
    );
  });

  it("states the reason and the date, appending a note when one was given", () => {
    assert.equal(
      describeDisposal({
        disposedAt: "2026-07-30T09:15:00.000Z",
        disposalReason: "lost",
        disposalNote: null,
      }),
      "Lost · 2026-07-30"
    );
    assert.equal(
      describeDisposal({
        disposedAt: "2026-07-30T09:15:00.000Z",
        disposalReason: "other",
        disposalNote: "given away",
      }),
      "No longer held · 2026-07-30 · given away"
    );
  });
});

describe("costBasisCopyCount", () => {
  it("partitions the set — every copy is in exactly one of the three states", () => {
    assert.equal(
      costBasisCopyCount({
        baseCurrency: "PLN",
        totalCostBasis: "12.00",
        knownCount: 2,
        pendingCount: 1,
        noneCount: 3,
      }),
      6
    );
  });
});
