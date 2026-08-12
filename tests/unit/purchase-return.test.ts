import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attributeLineToPurchase,
  summarizePurchaseReturn,
  type PurchaseReturnCopy,
} from "../../src/lib/purchase-return";

const mine = (...ids: string[]) => (id: string) => ids.includes(id);

describe("attributeLineToPurchase", () => {
  it("attributes a line made entirely of the purchase's copies whole, without splitting", () => {
    // Neither copy carries a catalogue price, which would block a split — and must not, since a
    // line wholly ours needs none: the whole net is this order's however the copies weigh.
    const result = attributeLineToPurchase(
      100,
      [
        { id: "a", catalogPrice: null },
        { id: "b", catalogPrice: null },
      ],
      mine("a", "b")
    );
    assert.equal(result.proceeds, 100);
    assert.deepEqual(result.resolvedItemIds, ["a", "b"]);
    assert.deepEqual(result.unresolvedItemIds, []);
  });

  it("splits a mixed line by catalogue weight and takes only our share", () => {
    const result = attributeLineToPurchase(
      100,
      [
        { id: "a", catalogPrice: 30 },
        { id: "b", catalogPrice: 10 },
      ],
      mine("a")
    );
    assert.equal(result.proceeds, 75);
    assert.deepEqual(result.resolvedItemIds, ["a"]);
  });

  it("keeps the cent on a mixed line: our share plus theirs is the line's net", () => {
    const ours = attributeLineToPurchase(
      10.01,
      [
        { id: "a", catalogPrice: 1 },
        { id: "b", catalogPrice: 1 },
        { id: "c", catalogPrice: 1 },
      ],
      mine("a")
    );
    const theirs = attributeLineToPurchase(
      10.01,
      [
        { id: "a", catalogPrice: 1 },
        { id: "b", catalogPrice: 1 },
        { id: "c", catalogPrice: 1 },
      ],
      mine("b", "c")
    );
    assert.equal(Math.round((ours.proceeds + theirs.proceeds) * 100), 1001);
  });

  it("reports a blocked mixed line rather than throwing, and claims none of its proceeds", () => {
    const result = attributeLineToPurchase(
      100,
      [
        { id: "a", catalogPrice: null },
        { id: "b", catalogPrice: 10 },
      ],
      mine("a")
    );
    assert.equal(result.proceeds, 0);
    assert.deepEqual(result.resolvedItemIds, []);
    assert.deepEqual(result.unresolvedItemIds, ["a"]);
  });

  it("carries a negative net (fees over price) through to the purchase", () => {
    const result = attributeLineToPurchase(-4, [{ id: "a", catalogPrice: 5 }], mine("a"));
    assert.equal(result.proceeds, -4);
  });

  it("is silent about a line carrying none of the purchase's copies", () => {
    const result = attributeLineToPurchase(100, [{ id: "x", catalogPrice: 5 }], mine("a"));
    assert.deepEqual(result, { proceeds: 0, resolvedItemIds: [], unresolvedItemIds: [] });
  });
});

function copy(over: Partial<PurchaseReturnCopy> & { id: string }): PurchaseReturnCopy {
  return {
    costBasis: null,
    lotId: "lot-1",
    lotStatus: "closed",
    sold: false,
    proceedsResolved: false,
    ...over,
  };
}

describe("summarizePurchaseReturn", () => {
  it("reports both returns and the sold/unsold split", () => {
    const result = summarizePurchaseReturn(
      [
        copy({ id: "a", costBasis: "10.00", sold: true, proceedsResolved: true }),
        copy({ id: "b", costBasis: "10.00", sold: true, proceedsResolved: true }),
        copy({ id: "c", costBasis: "10.00" }),
        copy({ id: "d", costBasis: "10.00" }),
      ],
      30,
      "PLN"
    );
    assert.equal(result.copyCount, 4);
    assert.equal(result.soldCount, 2);
    assert.equal(result.realized, "30.00");
    assert.equal(result.spent.totalCostBasis, "40.00");
    assert.equal(result.soldCost.totalCostBasis, "20.00");
    // The whole order is still 10 down; the two copies that sold made 10 on a 20 cost.
    assert.equal(result.netReturn, "-10.00");
    assert.equal(result.netReturnPercent, -25);
    assert.equal(result.soldMargin, "10.00");
    assert.equal(result.soldMarginPercent, 50);
  });

  it("counts a copy whose proceeds could not be attributed as sold, but adds nothing for it", () => {
    const result = summarizePurchaseReturn(
      [
        copy({ id: "a", costBasis: "10.00", sold: true, proceedsResolved: true }),
        copy({ id: "b", costBasis: "10.00", sold: true, proceedsResolved: false }),
      ],
      12,
      "PLN"
    );
    assert.equal(result.soldCount, 2);
    assert.equal(result.unattributedCount, 1);
    assert.equal(result.realized, "12.00");
    // Its cost still counts: the copy is gone and was paid for.
    assert.equal(result.soldCost.totalCostBasis, "20.00");
  });

  it("states no percentage when nothing is costed yet", () => {
    const result = summarizePurchaseReturn(
      [copy({ id: "a", lotStatus: "open", sold: true, proceedsResolved: true })],
      25,
      "PLN"
    );
    assert.equal(result.spent.totalCostBasis, "0.00");
    assert.equal(result.spent.pendingCount, 1);
    assert.equal(result.netReturn, "25.00");
    assert.equal(result.netReturnPercent, null);
    assert.equal(result.soldMarginPercent, null);
  });

  it("reads as a whole-order loss while nothing has sold", () => {
    const result = summarizePurchaseReturn([copy({ id: "a", costBasis: "10.00" })], 0, "PLN");
    assert.equal(result.soldCount, 0);
    assert.equal(result.realized, "0.00");
    assert.equal(result.netReturn, "-10.00");
    assert.equal(result.netReturnPercent, -100);
    // Nothing sold, so there is no margin to state — zero cost, zero realized, no percentage.
    assert.equal(result.soldMargin, "0.00");
    assert.equal(result.soldMarginPercent, null);
  });
});
