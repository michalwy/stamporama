import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRMED_SALE_API_REVIEW,
  describeSaleApiReview,
  nextSaleApiReview,
  readSaleApiReviewMark,
  saleLineAddedAction,
} from "../../src/lib/sale-review";

// The *to review* marker on sales written through the agent API (#1948): how a write accumulates
// into it, and what its hint says.

const T1 = new Date("2026-10-16T10:00:00.000Z");
const T2 = new Date("2026-10-16T12:30:00.000Z");
const at = (iso: string) => iso.slice(11, 16);

describe("nextSaleApiReview", () => {
  it("marks a sale the API recorded, with what it did", () => {
    assert.deepEqual(
      nextSaleApiReview(CONFIRMED_SALE_API_REVIEW, { kind: "created", actions: ["added offer #1 at 5 PLN"] }, T1),
      { apiReviewAt: T1, apiReviewCreated: true, apiReviewActions: ["added offer #1 at 5 PLN"] }
    );
  });

  it("adds a later write to an unconfirmed marker, in the order done, without repeating an action", () => {
    const first = nextSaleApiReview(
      CONFIRMED_SALE_API_REVIEW,
      { kind: "created", actions: ["added offer #1 at 5 PLN"] },
      T1
    );
    const second = nextSaleApiReview(
      first,
      { kind: "changed", actions: ["added offer #2 at 7 PLN", "added offer #1 at 5 PLN"] },
      T2
    );
    assert.deepEqual(second, {
      apiReviewAt: T2,
      apiReviewCreated: true,
      apiReviewActions: ["added offer #1 at 5 PLN", "added offer #2 at 7 PLN"],
    });
  });

  it("starts afresh on a confirmed sale, so a confirmed 'recorded' is not resurrected", () => {
    const next = nextSaleApiReview(
      CONFIRMED_SALE_API_REVIEW,
      { kind: "changed", actions: ["added offer #3 at 1 PLN"] },
      T1
    );
    assert.equal(next.apiReviewCreated, false);
    assert.deepEqual(next.apiReviewActions, ["added offer #3 at 1 PLN"]);
  });
});

describe("readSaleApiReviewMark", () => {
  it("reads no marker as null", () => {
    assert.equal(readSaleApiReviewMark(CONFIRMED_SALE_API_REVIEW), null);
  });
});

describe("saleLineAddedAction", () => {
  it("words a line as the issue does", () => {
    assert.equal(
      saleLineAddedAction({ offerNo: 2680, price: "15", currency: "PLN" }),
      "added offer #2680 at 15 PLN"
    );
  });

  it("names the set when there is one to name", () => {
    assert.equal(
      saleLineAddedAction({ offerNo: 12, setLabel: "set 2", price: "4.00", currency: "EUR" }),
      "added offer #12 (set 2) at 4.00 EUR"
    );
  });
});

describe("describeSaleApiReview", () => {
  const iso = T2.toISOString();

  it("names what was done on a recorded sale", () => {
    assert.equal(
      describeSaleApiReview({ at: iso, created: true, actions: ["added offer #1 at 5 PLN", "added offer #2 at 7 PLN"] }, at),
      "Recorded through the agent API: added offer #1 at 5 PLN; added offer #2 at 7 PLN — last on 12:30."
    );
  });

  it("says when a sale was only recorded", () => {
    assert.equal(
      describeSaleApiReview({ at: iso, created: true, actions: [] }, at),
      "Recorded through the agent API on 12:30."
    );
  });

  it("says what was added to a sale the collector had", () => {
    assert.equal(
      describeSaleApiReview({ at: iso, created: false, actions: ["added offer #9 at 3 PLN"] }, at),
      "Changed through the agent API: added offer #9 at 3 PLN — last on 12:30."
    );
  });
});
