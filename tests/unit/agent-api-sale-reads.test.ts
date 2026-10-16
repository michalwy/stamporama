import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isApiError } from "../../src/lib/agent-api/errors";
import { resolveSeller } from "../../src/lib/agent-api/purchase-reads";
import {
  AGENT_SALE_STATUSES,
  buyer,
  parseSalePrice,
  saleRecord,
  saleRow,
} from "../../src/lib/agent-api/sale-reads";

// The sale projections and the price rule (#1949) — what an agent is told about a sale, and what it
// may send as the price of a sold set.
//
// Pure and structurally typed, so this file holds the decisions. That `SaleListItem` and `SaleDetail`
// satisfy the row shapes is `tsc`'s answer where the handlers call these, and
// `tests/integration/agent-api-sales.test.ts` answers it against a real database.

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(isApiError(error), `expected an ApiError, got ${String(error)}`);
    return error.message;
  }
  assert.fail("expected a refusal");
}

const REVIEW = { at: "2026-10-16T10:00:00.000Z", created: true, actions: ["added offer #12 at 15.00 PLN"] };

describe("the sale row (#1949)", () => {
  const row = {
    id: "s1",
    saleNo: 7,
    platformName: "Facebook",
    buyerName: "Jan Nowak",
    status: "ordered",
    soldAt: new Date("2026-10-15T00:00:00.000Z"),
    currency: "PLN",
    lineCount: 2,
    itemCount: 5,
    grossProceeds: "30.00",
    netProceeds: "30.00",
    baseCurrency: "PLN",
    externalRef: null,
    transactionUrl: null,
    apiReview: REVIEW,
    // What the screen's row carries and an agent is not told.
    pendingSetChoiceCount: 0,
    createdAt: new Date(),
  };

  it("states the sale in the screen's figures, the day as yyyy-mm-dd, and the marker", () => {
    assert.deepEqual(saleRow(row, "/c/x/sales/s1"), {
      id: "s1",
      saleNo: 7,
      platform: "Facebook",
      buyer: "Jan Nowak",
      status: "ordered",
      soldAt: "2026-10-15",
      currency: "PLN",
      sets: 2,
      copies: 5,
      gross: "30.00",
      net: "30.00",
      baseCurrency: "PLN",
      externalRef: null,
      transactionUrl: null,
      toReview: REVIEW,
      path: "/c/x/sales/s1",
    });
  });

  it("says nothing waits when there is no marker", () => {
    assert.equal(saleRow({ ...row, apiReview: null }, "/p").toReview, null);
  });
});

describe("the sale record (#1949)", () => {
  const detail = {
    id: "s1",
    saleNo: 7,
    platformName: "Facebook",
    buyerId: "c1",
    buyerName: "Jan Nowak",
    status: "paid",
    soldAt: new Date("2026-10-15T00:00:00.000Z"),
    currency: "PLN",
    baseCurrency: "PLN",
    externalRef: null,
    transactionUrl: null,
    lines: [
      {
        id: "l1",
        offerId: "o1",
        offerSetId: "set1",
        setLabel: "Set 1",
        price: "15.00",
        itemLabels: ["Mi 100", "Mi 101"],
        setChoicePending: false,
        // What the screen's line carries and an agent is not told.
        netBase: "15.00",
      },
      {
        id: "l2",
        offerId: null,
        offerSetId: "set9",
        setLabel: "Set 9",
        price: "5.00",
        itemLabels: [],
        setChoicePending: true,
      },
    ],
    grossProceeds: "20.00",
    buyerHandling: "3.00",
    buyerPaidTotal: null,
    commission: null,
    shippingCost: "8.50",
    shippingCurrency: "PLN",
    netProceeds: "14.50",
    apiReview: null,
  };

  it("names each line's offer by the number the collector calls it, and a line whose offer is gone by none", () => {
    const record = saleRecord(detail, new Map([["o1", 12]]), "/c/x/sales/s1");
    assert.deepEqual(record.lines, [
      {
        id: "l1",
        offerId: "o1",
        offerNo: 12,
        setId: "set1",
        set: "Set 1",
        price: "15.00",
        copies: ["Mi 100", "Mi 101"],
        setChoicePending: false,
      },
      {
        id: "l2",
        offerId: null,
        offerNo: null,
        setId: "set9",
        set: "Set 9",
        price: "5.00",
        copies: [],
        setChoicePending: true,
      },
    ]);
    assert.deepEqual(record.buyer, { id: "c1", name: "Jan Nowak" });
    assert.equal(record.net, "14.50");
    assert.equal(record.soldAt, "2026-10-15");
  });

  it("states an anonymous sale's buyer as absent", () => {
    assert.equal(saleRecord({ ...detail, buyerId: null, buyerName: null }, new Map(), "/p").buyer, null);
  });
});

describe("the buyer (#1949)", () => {
  it("is three fields and how it was found — nothing personal rides along", () => {
    const contact = {
      id: "c1",
      name: "Jan Nowak",
      facebookProfileUrl: "https://www.facebook.com/jan.nowak",
      email: "jan@example.com",
      phone: "+48 600 700 800",
    };
    assert.deepEqual(buyer(contact, "profile"), {
      id: "c1",
      name: "Jan Nowak",
      facebookProfile: "https://www.facebook.com/jan.nowak",
      found: "profile",
    });
  });

  it("is refused, when unknown, with the operation that adds a buyer rather than a seller", () => {
    const message = refusal(() =>
      resolveSeller("Zbigniew", [{ id: "c1", name: "Jan Nowak", fullName: null }], "buyer", {
        who: "buyer",
        operation: "find_or_create_buyer",
      })
    );
    assert.match(message, /If the buyer is somebody new, create them with `find_or_create_buyer` first/);
  });
});

describe("a sold set's price (#1949)", () => {
  it("takes an amount to the cent and writes it to two decimals", () => {
    assert.equal(parseSalePrice("15", "price"), "15.00");
    assert.equal(parseSalePrice(" 15.5 ", "price"), "15.50");
    assert.equal(parseSalePrice("0", "price"), "0.00");
  });

  it("refuses a third decimal, a comma, a sign or a word, rather than guessing", () => {
    for (const value of ["15.005", "15,50", "-3", "fifteen", "15 PLN"]) {
      assert.match(refusal(() => parseSalePrice(value, "price")), /is not a price for "price"/, value);
    }
  });
});

describe("the sale statuses (#1949)", () => {
  it("are the lifecycle, in order", () => {
    assert.deepEqual([...AGENT_SALE_STATUSES], ["ordered", "paid", "packed", "sent", "received"]);
  });
});
