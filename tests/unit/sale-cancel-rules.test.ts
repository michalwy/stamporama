import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cancelOutcomeLabel,
  cancelledSalesLabel,
  claimedSaleLines,
  cancelledSalesWarning,
  DEFAULT_CANCEL_REASON,
  normalizeCancelReason,
  resolveCancelOutcomes,
  setAllCancelOutcomes,
  sharedCancelOutcome,
} from "../../src/lib/sale-cancel-rules";
import {
  canCancelSale,
  isSaleCancelled,
  isSaleRecordStatus,
  isSaleSent,
  SALE_RECORD_STATUSES,
} from "../../src/lib/sale-status";
import { saleMergeRefusal } from "../../src/lib/sale-merge-rules";
import { saleMoveSourceRefusal, saleMoveTargetRefusal } from "../../src/lib/sale-move-rules";
import { saleCancelledAction } from "../../src/lib/sale-review";

// Cancelling a sale the buyer never paid for (#2500, ADR-0082).
describe("which sales can be cancelled (#2500)", () => {
  it("is every sale not yet sent, and none sent or already cancelled", () => {
    for (const s of ["ordered", "paid", "packed"]) assert.equal(canCancelSale(s), true, s);
    for (const s of ["sent", "received", "cancelled", "shipped"]) assert.equal(canCancelSale(s), false, s);
  });

  it("reads cancelled as its own status, after the lifecycle, and never as sent", () => {
    assert.deepEqual([...SALE_RECORD_STATUSES], ["ordered", "paid", "packed", "sent", "received", "cancelled"]);
    assert.equal(isSaleRecordStatus("cancelled"), true);
    assert.equal(isSaleRecordStatus("void"), false);
    assert.equal(isSaleCancelled("cancelled"), true);
    assert.equal(isSaleCancelled("ordered"), false);
    assert.equal(isSaleSent("cancelled"), false);
  });
});

describe("resolveCancelOutcomes (#2500)", () => {
  it("gives each closed offer its choice, back to active where none was made", () => {
    const outcomes = resolveCancelOutcomes(["o1", "o2", "o3"], { o2: "withdrawn", o3: "active" });
    assert.deepEqual([...outcomes], [
      ["o1", "active"],
      ["o2", "withdrawn"],
      ["o3", "active"],
    ]);
  });

  it("drops a choice for an offer the sale did not close", () => {
    assert.deepEqual([...resolveCancelOutcomes(["o1"], { o9: "withdrawn" })], [["o1", "active"]]);
  });

  it("reads an outcome that is neither as no choice", () => {
    const outcomes = resolveCancelOutcomes(["o1"], { o1: "deleted" as never });
    assert.equal(outcomes.get("o1"), "active");
  });
});

describe("the reason (#2500)", () => {
  it("starts as Not paid", () => {
    assert.equal(DEFAULT_CANCEL_REASON, "Not paid");
  });

  it("is stored trimmed, and a blank one is none", () => {
    assert.equal(normalizeCancelReason("  Not paid "), "Not paid");
    assert.equal(normalizeCancelReason("   "), null);
    assert.equal(normalizeCancelReason(null), null);
  });
});

describe("the buyer's cancelled sales (#2500)", () => {
  it("read as a count beside their sales, and nothing with none", () => {
    assert.equal(cancelledSalesLabel(0), null);
    assert.equal(cancelledSalesLabel(2), "2 cancelled");
  });

  it("warn a new sale with the count", () => {
    assert.equal(cancelledSalesWarning(0), null);
    assert.equal(cancelledSalesWarning(1), "This buyer has 1 cancelled sale.");
    assert.equal(cancelledSalesWarning(3), "This buyer has 3 cancelled sales.");
  });
});

describe("a cancelled sale's lines (#2500)", () => {
  it("say what became of their offer, and nothing where nothing did", () => {
    assert.equal(cancelOutcomeLabel("active"), "Back to active");
    assert.equal(cancelOutcomeLabel("withdrawn"), "Withdrawn");
    assert.equal(cancelOutcomeLabel(null), null);
  });
});

describe("a cancelled sale is a record (#2500)", () => {
  const open = { saleNo: 1, platformId: "p", currency: "PLN", status: "ordered" };
  const cancelled = { saleNo: 2, platformId: "p", currency: "PLN", status: "cancelled" };

  it("is merged with nothing", () => {
    assert.match(saleMergeRefusal(open, cancelled) ?? "", /cancelled/);
    assert.match(saleMergeRefusal(cancelled, open) ?? "", /cancelled/);
  });

  it("gives no sets, and takes none", () => {
    assert.match(saleMoveSourceRefusal({ status: "cancelled" }, 1, 2) ?? "", /cancelled/);
    const source = { id: "a", platformId: "p", currency: "PLN", buyerId: "b" };
    const target = { id: "c", saleNo: 3, platformId: "p", currency: "PLN", buyerId: "b", status: "cancelled" };
    assert.match(saleMoveTargetRefusal(source, target) ?? "", /cancelled/);
  });
});

describe("saleCancelledAction (#2500)", () => {
  it("says what the API's cancel did to the offers", () => {
    assert.equal(saleCancelledAction({ active: 2, withdrawn: 1 }), "cancelled the sale — 2 offers back to active, 1 withdrawn");
    assert.equal(saleCancelledAction({ active: 1, withdrawn: 0 }), "cancelled the sale — 1 offer back to active");
    assert.equal(saleCancelledAction({ active: 0, withdrawn: 0 }), "cancelled the sale");
  });
});

describe("claimedSaleLines (#2500)", () => {
  it("is a sale's own lines, and a cancelled sale's the ones it had sold", () => {
    const lines = [{ offerId: "o1" }];
    const cancelledLines = [{ offerId: "o2" }];
    assert.deepEqual(claimedSaleLines({ status: "paid", lines, cancelledLines: [] }), lines);
    assert.deepEqual(claimedSaleLines({ status: "cancelled", lines: [], cancelledLines }), cancelledLines);
  });
});

describe("the Cancel sale dialog's all-offers choice (#2515)", () => {
  const ids = ["o1", "o2", "o3", "o4", "o5"];

  it("All withdrawn sets every offer to withdrawn, and the choice shows as selected", () => {
    const all = setAllCancelOutcomes(ids, "withdrawn");
    assert.deepEqual(Object.keys(all), ids);
    for (const id of ids) assert.equal(all[id], "withdrawn");
    assert.equal(sharedCancelOutcome(ids, all), "withdrawn");
    assert.deepEqual(
      [...resolveCancelOutcomes(ids, all).values()],
      ids.map(() => "withdrawn")
    );
  });

  it("one row changed back clears the choice, and only that offer goes back to active", () => {
    const changed = { ...setAllCancelOutcomes(ids, "withdrawn"), o3: "active" as const };
    assert.equal(sharedCancelOutcome(ids, changed), null);
    const resolved = resolveCancelOutcomes(ids, changed);
    assert.deepEqual(
      ids.filter((id) => resolved.get(id) === "active"),
      ["o3"]
    );
  });

  it("shows the choice again once the rows agree", () => {
    const changed = { ...setAllCancelOutcomes(ids, "withdrawn"), o3: "active" as const };
    assert.equal(sharedCancelOutcome(ids, { ...changed, o3: "withdrawn" }), "withdrawn");
    assert.equal(sharedCancelOutcome(ids, setAllCancelOutcomes(ids, "active")), "active");
  });

  it("is nothing for no offers or an offer with no choice", () => {
    assert.equal(sharedCancelOutcome([], {}), null);
    assert.equal(sharedCancelOutcome(["o1", "o2"], { o2: "active" }), null);
  });
});
