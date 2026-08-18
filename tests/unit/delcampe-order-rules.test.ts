import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeDelcampeOrderProblems,
  planDelcampeOrderSale,
  readDelcampeAmount,
  readDelcampeRowDate,
  type DelcampeOrderCandidate,
  type DelcampeOrderInput,
} from "../../src/lib/delcampe-order-rules";

// The figures and wordings below are copied off Delcampe's own **My Sold Items** screens, where an
// order's total is printed in the seller's display currency and its rows in the currency each
// listing was in — `± €13.95` over three `US$` rows being the case that makes the difference matter.

describe("readDelcampeAmount", () => {
  it("reads the row's own price and the currency its symbol names", () => {
    assert.deepEqual(readDelcampeAmount("US$3.00"), {
      amount: "3.00",
      currency: "USD",
      approximate: false,
    });
    assert.deepEqual(readDelcampeAmount("€5.42"), {
      amount: "5.42",
      currency: "EUR",
      approximate: false,
    });
  });

  it("marks Delcampe's own conversion as approximate", () => {
    const total = readDelcampeAmount("± €13.95");
    assert.equal(total?.approximate, true);
    assert.equal(total?.amount, "13.95");
  });

  it("takes the last separator as the decimal point, whichever way round the page writes it", () => {
    assert.equal(readDelcampeAmount("US$1,234.56")?.amount, "1234.56");
    assert.equal(readDelcampeAmount("€1.234,56")?.amount, "1234.56");
  });

  it("treats a separator followed by three digits as a thousands separator", () => {
    assert.equal(readDelcampeAmount("€1,500")?.amount, "1500.00");
  });

  it("reads a figure through the non-breaking space Delcampe prints after the symbol", () => {
    assert.equal(readDelcampeAmount("CHF 12.00")?.amount, "12.00");
  });

  it("does not take a full stop that ends a sentence for a decimal point", () => {
    assert.equal(readDelcampeAmount("€13.95.")?.amount, "13.95");
  });

  it("answers a null currency for a symbol it does not recognise — a bare $ is not dollars", () => {
    const read = readDelcampeAmount("$4.00");
    assert.equal(read?.amount, "4.00");
    assert.equal(read?.currency, null);
  });

  it("answers null when there is no figure at all", () => {
    assert.equal(readDelcampeAmount("Shipping included"), null);
    assert.equal(readDelcampeAmount(null), null);
  });
});

describe("readDelcampeRowDate", () => {
  it("reads the day off a row and reads past the time", () => {
    assert.equal(readDelcampeRowDate("Sun 22 Mar 2026 at 22:25"), "2026-03-22");
    assert.equal(readDelcampeRowDate("Sat 1 Aug 2026 at 01:42"), "2026-08-01");
  });

  it("takes a full month name as readily as an abbreviation", () => {
    assert.equal(readDelcampeRowDate("Thu 4 June 2026 at 23:55"), "2026-06-04");
  });

  it("refuses a month it cannot read rather than dating a sale by guesswork", () => {
    // French abbreviates June and July to the same three letters, which is exactly the case where a
    // guess would be a sale dated a month out.
    assert.equal(readDelcampeRowDate("jeu. 4 juin 2026 à 23:55"), null);
    assert.equal(readDelcampeRowDate("Details"), null);
  });

  it("reads a month whose first three letters are unambiguous, whatever language wrote it", () => {
    // Not a feature so much as the shape of the rule: what it cannot read it refuses, and no
    // language's month abbreviates to a *different* English month.
    assert.equal(readDelcampeRowDate("dim. 22 mars 2026 à 22:25"), "2026-03-22");
  });
});

const ORDER: DelcampeOrderInput = {
  orderId: "104867762",
  orderUrl: "https://www.delcampe.net/en_GB/payment-request/104867762",
  buyerLogin: "yo1311",
  buyerName: "Blumann Yoram",
  totalTexts: ["± €13.95", "US$16.15"],
  lines: [
    {
      itemId: "2508694478",
      title: "Poland - 1965 - 20th Anniversary",
      reference: "A054",
      priceText: "US$0.15",
      soldAtText: "Sun 22 Mar 2026 at 22:25",
    },
    {
      itemId: "2508694520",
      title: "Poland - 1963 - Animals",
      reference: "A042",
      priceText: "US$3.00",
      soldAtText: "Sun 22 Mar 2026 at 22:24",
    },
  ],
};

function candidate(
  itemId: string,
  offerNo: number,
  sets: { offerSetId: string; itemIds: string[] }[]
): DelcampeOrderCandidate {
  return {
    itemId,
    offer: { id: `offer-${offerNo}`, offerNo, label: `Offer #${offerNo}` },
    matchedBy: "item-id",
    sets: sets.map((set) => ({ ...set, label: "one stamp" })),
  };
}

const CANDIDATES: DelcampeOrderCandidate[] = [
  candidate("2508694478", 54, [{ offerSetId: "set-a", itemIds: ["copy-a"] }]),
  candidate("2508694520", 42, [{ offerSetId: "set-b", itemIds: ["copy-b"] }]),
];

describe("planDelcampeOrderSale", () => {
  it("records every row against the set it sold, dated by the latest of them", () => {
    const plan = planDelcampeOrderSale(ORDER, { currency: "USD", candidates: CANDIDATES });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.soldAt, "2026-03-22");
    assert.equal(plan.currency, "USD");
    assert.deepEqual(plan.lines, [
      { offerId: "offer-54", offerSetId: "set-a", price: "0.15", itemIds: ["copy-a"] },
      { offerId: "offer-42", offerSetId: "set-b", price: "3.00", itemIds: ["copy-b"] },
    ]);
  });

  it("files the buyer under their login and keeps the printed name beside it", () => {
    const plan = planDelcampeOrderSale(ORDER, { currency: "USD", candidates: CANDIDATES });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.buyer, { name: "yo1311", fullName: "Blumann Yoram" });
  });

  it("anchors on the exact total in the sale's own currency, never on Delcampe's conversion", () => {
    const plan = planDelcampeOrderSale(ORDER, { currency: "USD", candidates: CANDIDATES });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    // The header prints `± €13.95` and `US$16.15` for one total. 0.15 + 3.00 of it is these two
    // rows; the rest is the third row of that order plus the postage the buyer was charged (#205).
    assert.equal(plan.buyerPaidTotal, "16.15");
  });

  it("leaves the anchor blank when the page states nothing but a conversion", () => {
    const plan = planDelcampeOrderSale(
      { ...ORDER, totalTexts: ["± €13.95"] },
      { currency: "USD", candidates: CANDIDATES }
    );
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.buyerPaidTotal, null);
  });

  it("leaves the anchor blank when the stated total is below what the rows add up to", () => {
    const plan = planDelcampeOrderSale(
      { ...ORDER, totalTexts: ["US$1.00"] },
      { currency: "USD", candidates: CANDIDATES }
    );
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.buyerPaidTotal, null);
  });

  it("refuses the whole order when one row matches no offer, naming that row", () => {
    const plan = planDelcampeOrderSale(ORDER, {
      currency: "USD",
      candidates: [CANDIDATES[0]],
    });
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.equal(plan.problems.length, 1);
    assert.equal(plan.problems[0].itemId, "2508694520");
    assert.match(plan.problems[0].message, /no offer here carries/);
  });

  it("refuses a row whose offer still has several sets for sale rather than picking one", () => {
    const ambiguous = candidate("2508694520", 42, [
      { offerSetId: "set-b", itemIds: ["copy-b"] },
      { offerSetId: "set-c", itemIds: ["copy-c"] },
    ]);
    const plan = planDelcampeOrderSale(ORDER, {
      currency: "USD",
      candidates: [CANDIDATES[0], ambiguous],
    });
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.match(plan.problems[0].message, /several sets/);
  });

  it("refuses a row sold in a currency this platform's sales are not in", () => {
    const plan = planDelcampeOrderSale(ORDER, { currency: "EUR", candidates: CANDIDATES });
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.equal(plan.problems.length, 2);
    assert.match(plan.problems[0].message, /sold in USD, but this platform's sales are in EUR/);
  });

  it("refuses a cancelled row — Delcampe prices it at zero and zeroes the order with it", () => {
    const plan = planDelcampeOrderSale(
      {
        ...ORDER,
        totalTexts: ["€0.00"],
        lines: [{ ...ORDER.lines[0], priceText: "€0.00" }],
      },
      { currency: "EUR", candidates: [CANDIDATES[0]] }
    );
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.match(plan.problems[0].message, /no amount for this row/);
  });

  it("reports every reason at once, so fixing them is one trip", () => {
    const plan = planDelcampeOrderSale(
      {
        ...ORDER,
        lines: [
          { ...ORDER.lines[0], soldAtText: "Details" },
          { ...ORDER.lines[1], priceText: null },
        ],
      },
      { currency: "USD", candidates: CANDIDATES }
    );
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.equal(plan.problems.length, 2);
    assert.match(describeDelcampeOrderProblems(plan.problems), /date on this row|price on this row/);
  });

  it("refuses an order with no rows at all", () => {
    const plan = planDelcampeOrderSale({ ...ORDER, lines: [] }, { currency: "USD", candidates: [] });
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.equal(plan.problems[0].itemId, null);
  });
});
