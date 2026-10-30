import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NO_SALE_STATUS_CHOICE,
  restoredSaleStatusChoice,
  saleStatusChoiceReducer,
  shownSaleStatus,
  type SaleStatusChoice,
  type SaleStatusChoiceEvent,
} from "../../src/lib/sale-status-choice";

function play(...events: SaleStatusChoiceEvent[]): SaleStatusChoice {
  return events.reduce(saleStatusChoiceReducer, NO_SALE_STATUS_CHOICE);
}

describe("sale status choice (#2270)", () => {
  it("draws the page's own status until something is chosen", () => {
    assert.equal(shownSaleStatus(NO_SALE_STATUS_CHOICE, "sent"), "sent");
  });

  it("shows the chosen status at once, before its save comes back", () => {
    const choice = play({ type: "chose", status: "received" });
    assert.equal(shownSaleStatus(choice, "sent"), "received");
    assert.equal(choice.inFlight, 1);
  });

  it("keeps the chosen status once its save succeeds, the page unread", () => {
    const choice = play(
      { type: "chose", status: "received" },
      { type: "settled", seq: 1, status: "received", ok: true }
    );
    assert.equal(shownSaleStatus(choice, "sent"), "received");
    assert.equal(choice.inFlight, 0);
  });

  it("puts the page's status back when the only save fails", () => {
    const choice = play(
      { type: "chose", status: "received" },
      { type: "settled", seq: 1, status: "received", ok: false }
    );
    assert.equal(shownSaleStatus(choice, "sent"), "sent");
  });

  it("puts back the status last saved, not the page's, when a later save fails", () => {
    const choice = play(
      { type: "chose", status: "sent" },
      { type: "settled", seq: 1, status: "sent", ok: true },
      { type: "chose", status: "received" },
      { type: "settled", seq: 2, status: "received", ok: false }
    );
    assert.equal(shownSaleStatus(choice, "packed"), "sent");
  });

  it("keeps the last one chosen while the saves before it come back", () => {
    const choice = play(
      { type: "chose", status: "sent" },
      { type: "chose", status: "received" },
      { type: "settled", seq: 1, status: "sent", ok: true }
    );
    assert.equal(shownSaleStatus(choice, "packed"), "received");
  });

  it("does not let an overtaken save's failure move the screen", () => {
    const choice = play(
      { type: "chose", status: "sent" },
      { type: "chose", status: "received" },
      { type: "settled", seq: 1, status: "sent", ok: false },
      { type: "settled", seq: 2, status: "received", ok: true }
    );
    assert.equal(shownSaleStatus(choice, "packed"), "received");
    assert.equal(choice.inFlight, 0);
  });

  it("falls back to the page's status when every save failed", () => {
    const choice = play(
      { type: "chose", status: "sent" },
      { type: "chose", status: "received" },
      { type: "settled", seq: 1, status: "sent", ok: false },
      { type: "settled", seq: 2, status: "received", ok: false }
    );
    assert.equal(shownSaleStatus(choice, "packed"), "packed");
  });

  it("gives way to a fresh page reading once nothing is in flight", () => {
    const choice = play(
      { type: "chose", status: "received" },
      { type: "settled", seq: 1, status: "received", ok: true },
      { type: "pageRead" }
    );
    assert.equal(choice.shown, null);
    assert.equal(shownSaleStatus(choice, "received"), "received");
  });

  it("stays over a page reading that lands while a save is out", () => {
    const choice = play({ type: "chose", status: "received" }, { type: "pageRead" });
    assert.equal(shownSaleStatus(choice, "sent"), "received");
  });

  it("restores a saved status over a cached reading that still carries the old one", () => {
    const choice = restoredSaleStatusChoice({ over: "sent", status: "received" }, "sent");
    assert.equal(shownSaleStatus(choice, "sent"), "received");
  });

  it("draws a reading that has caught up as it is", () => {
    assert.deepEqual(
      restoredSaleStatusChoice({ over: "sent", status: "received" }, "received"),
      NO_SALE_STATUS_CHOICE
    );
    assert.deepEqual(restoredSaleStatusChoice(undefined, "sent"), NO_SALE_STATUS_CHOICE);
  });
});
