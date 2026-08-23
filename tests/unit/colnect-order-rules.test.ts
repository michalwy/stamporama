import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BUYER_PAID_LABEL,
  chooseColnectSets,
  describeColnectOrderProblems,
  planColnectOrderSale,
  readColnectAmount,
  readColnectItemCount,
  readColnectOrderDate,
  readColnectTotal,
  type ColnectOrderCandidate,
  type ColnectOrderInput,
} from "../../src/lib/colnect-order-rules";
import type { MappableSet } from "../../src/lib/order-sale-rules";

// What a Colnect transaction *says*, and what this app is allowed to conclude from it (#698).
//
// Every figure below is one the live transaction `hflVE` printed. The point of the file is the
// refusals: a transaction the collector clicks *Import* on is written with nothing reviewed in
// between, so anything this module is unsure of has to stop the whole order and say why.

function set(id: string, itemIds: string[]): MappableSet {
  return { offerSetId: id, label: id, itemIds };
}

const ORDER: ColnectOrderInput = {
  orderId: "hflVE",
  orderUrl: "https://colnect.com/en/transaction/show/id/hflVE",
  buyerLogin: "samplebuyer",
  buyerName: "Sample Buyer",
  soldAtText: "August 23, 2026 2:21 PM",
  shippingMethodText: "Stamps→domestic: Registered mail (Poczta Polska)",
  totalTexts: [
    "Items total € 5.00",
    "Shipping price € 2.40",
    "Discount -€ 0.37",
    "Total with shipping € 7.03",
  ],
  lines: [
    { saleCode: "aBcDe", title: "One stamp", priceText: "€ 2.00", quantityText: "Item count: 1" },
    { saleCode: "fGhIj", title: "Another stamp", priceText: "€ 3.00", quantityText: "Item count: 1" },
  ],
};

const CANDIDATES: ColnectOrderCandidate[] = [
  { saleCode: "aBcDe", offer: { id: "o1", offerNo: 41, label: "One stamp" }, sets: [set("s1", ["i1"])] },
  { saleCode: "fGhIj", offer: { id: "o2", offerNo: 42, label: "Another stamp" }, sets: [set("s2", ["i2"])] },
];

function plan(order: Partial<ColnectOrderInput> = {}, candidates: ColnectOrderCandidate[] = CANDIDATES) {
  return planColnectOrderSale({ ...ORDER, ...order }, { currency: "EUR", candidates });
}

describe("readColnectAmount", () => {
  it("reads what Colnect prints, symbol first and space and all", () => {
    assert.deepEqual(readColnectAmount("€ 0.46"), { amount: "0.46", currency: "EUR" });
    assert.deepEqual(readColnectAmount("€ 1,234.56"), { amount: "1234.56", currency: "EUR" });
    assert.deepEqual(readColnectAmount("€ 1.234,56"), { amount: "1234.56", currency: "EUR" });
  });

  it("keeps the sign of a deduction, because a discount is not a payment", () => {
    assert.deepEqual(readColnectAmount("Discount -€ 0.37"), { amount: "-0.37", currency: "EUR" });
  });

  it("answers a figure with no currency, and nothing at all for no figure", () => {
    assert.deepEqual(readColnectAmount("¤ 9.97"), { amount: "9.97", currency: null });
    assert.equal(readColnectAmount("Sold"), null);
    assert.equal(readColnectAmount(null), null);
  });

  it("does not read a bare dollar sign as dollars", () => {
    // ADR-0038 §5, kept: an unrecognised symbol refuses the order rather than guessing the money.
    assert.deepEqual(readColnectAmount("$ 3.00"), { amount: "3.00", currency: null });
    assert.deepEqual(readColnectAmount("US$ 3.00"), { amount: "3.00", currency: "USD" });
  });
});

describe("readColnectOrderDate", () => {
  it("reads the transaction's own start, month first, past the time of day", () => {
    assert.equal(readColnectOrderDate("August 23, 2026 2:21 PM"), "2026-08-23");
    assert.equal(readColnectOrderDate("Started: Sep 1, 2026 11:05 AM"), "2026-09-01");
  });

  it("reads no date rather than a guessed one", () => {
    assert.equal(readColnectOrderDate("23 sierpnia 2026"), null);
    assert.equal(readColnectOrderDate("just now"), null);
    assert.equal(readColnectOrderDate(null), null);
  });
});

describe("readColnectItemCount", () => {
  it("reads the count out of the printed label", () => {
    assert.equal(readColnectItemCount("Item count: 1"), 1);
    assert.equal(readColnectItemCount("Item count: 12"), 12);
  });

  it("answers nothing for a row that states no count", () => {
    assert.equal(readColnectItemCount("Item count:"), null);
    assert.equal(readColnectItemCount(null), null);
  });
});

describe("readColnectTotal", () => {
  it("picks a total by its own words, not by its size", () => {
    const totals = ["Items total € 9.97", "Shipping price € 2.40", "Total with shipping € 12.00"];
    assert.deepEqual(readColnectTotal(totals, BUYER_PAID_LABEL), { amount: "12.00", currency: "EUR" });
    assert.deepEqual(readColnectTotal(totals, "Items total"), { amount: "9.97", currency: "EUR" });
    assert.equal(readColnectTotal(totals, "Refund"), null);
  });
});

describe("chooseColnectSets (#697)", () => {
  const sets = [set("a", ["i1"]), set("b", ["i2"]), set("c", ["i3"])];

  it("takes every set when the row bought the lot, and nobody has to choose", () => {
    const choice = chooseColnectSets(3, sets);
    assert.deepEqual(choice.sets.map((s) => s.offerSetId), ["a", "b", "c"]);
    assert.equal(choice.setChoicePending, false);
    assert.equal(choice.skipped, null);
  });

  it("picks the lowest sets and says nobody has chosen yet", () => {
    const choice = chooseColnectSets(1, sets);
    assert.deepEqual(choice.sets.map((s) => s.offerSetId), ["a"]);
    assert.equal(choice.setChoicePending, true);
    assert.equal(choice.skipped, null);
  });

  it("refuses an offer with nothing left, and one with less left than sold", () => {
    assert.equal(chooseColnectSets(1, []).skipped, "sold-out");
    assert.equal(chooseColnectSets(4, sets).skipped, "short");
  });
});

describe("planColnectOrderSale", () => {
  it("records the transaction: its date, its buyer, its lines and what the buyer paid", () => {
    const result = plan();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.soldAt, "2026-08-23");
    assert.equal(result.currency, "EUR");
    assert.deepEqual(result.buyer, { name: "samplebuyer", fullName: "Sample Buyer" });
    assert.equal(result.buyerPaidTotal, "7.03");
    assert.equal(result.shippingMethodName, "Stamps→domestic: Registered mail (Poczta Polska)");
    assert.deepEqual(result.lines, [
      { offerId: "o1", offerSetId: "s1", price: "2.00", itemIds: ["i1"], setChoicePending: false },
      { offerId: "o2", offerSetId: "s2", price: "3.00", itemIds: ["i2"], setChoicePending: false },
    ]);
  });

  it("anchors on what the buyer paid, never on what the goods came to", () => {
    // `Items total` and `Total with shipping` are two claims; taking the larger figure by accident
    // is how postage the buyer paid ends up recorded as money nobody received.
    const result = plan({ totalTexts: ["Items total € 5.00", "Total with shipping € 7.03"] });
    assert.equal(result.ok && result.buyerPaidTotal, "7.03");
  });

  it("leaves the anchor blank rather than take a total that is not the sale's", () => {
    /** What the plan anchored on, for a transaction that is recorded either way. */
    function anchorOf(totalTexts: string[]): string | null {
      const result = plan({ totalTexts });
      assert.equal(result.ok, true);
      return result.ok ? result.buyerPaidTotal : null;
    }
    assert.equal(anchorOf(["Total with shipping US$ 7.03"]), null);
    // Below what the rows add up to: not a total of this transaction, whatever it is.
    assert.equal(anchorOf(["Total with shipping € 1.00"]), null);
    assert.equal(anchorOf([]), null);
  });

  it("flags the line where the offer still has copies nobody has picked between (#697)", () => {
    const result = plan({ lines: [ORDER.lines[0]] }, [
      {
        saleCode: "aBcDe",
        offer: { id: "o1", offerNo: 41, label: "One stamp" },
        sets: [set("s1", ["i1"]), set("s2", ["i2"]), set("s3", ["i3"])],
      },
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.lines, [
      { offerId: "o1", offerSetId: "s1", price: "2.00", itemIds: ["i1"], setChoicePending: true },
    ]);
  });

  it("refuses a row no offer here carries, naming the listing", () => {
    const result = plan({}, [CANDIDATES[0], { saleCode: "fGhIj", offer: null, sets: [] }]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0].saleCode, "fGhIj");
    assert.match(result.problems[0].message, /no offer here carries this Colnect listing/);
  });

  it("refuses a foreign currency, an unreadable price and a free row", () => {
    const foreign = plan({ lines: [{ ...ORDER.lines[0], priceText: "US$ 2.00" }] });
    assert.equal(foreign.ok, false);
    if (!foreign.ok) assert.match(foreign.problems[0].message, /priced in USD/);

    const unreadable = plan({ lines: [{ ...ORDER.lines[0], priceText: null }] });
    assert.equal(unreadable.ok, false);
    if (!unreadable.ok) assert.match(unreadable.problems[0].message, /price on this row/);

    const free = plan({ lines: [{ ...ORDER.lines[0], priceText: "€ 0.00" }] });
    assert.equal(free.ok, false);
    if (!free.ok) assert.match(free.problems[0].message, /no amount for this row/);
  });

  it("refuses a multi-item row until a real one says what its figure means (§5)", () => {
    const result = plan({ lines: [{ ...ORDER.lines[0], quantityText: "Item count: 2" }] }, [
      {
        saleCode: "aBcDe",
        offer: { id: "o1", offerNo: 41, label: "One stamp" },
        sets: [set("s1", ["i1"]), set("s2", ["i2"])],
      },
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.problems[0].message, /price of one or of all/);
  });

  it("refuses a row whose count no rule could read", () => {
    const result = plan({ lines: [{ ...ORDER.lines[0], quantityText: null }] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.problems[0].message, /item count on this row/);
  });

  it("refuses a transaction whose date cannot be read, which is not about any row", () => {
    const result = plan({ soldAtText: "23 sierpnia 2026" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.problems[0].saleCode, null);
    assert.match(result.problems[0].message, /date this transaction started/);
  });

  it("refuses an offer with nothing left, and one that sold more than it has", () => {
    const soldOut = plan({ lines: [ORDER.lines[0]] }, [
      { saleCode: "aBcDe", offer: { id: "o1", offerNo: 41, label: "One stamp" }, sets: [] },
    ]);
    assert.equal(soldOut.ok, false);
    if (!soldOut.ok) assert.match(soldOut.problems[0].message, /no copies left to sell here/);
  });

  it("names every reason at once, so the collector makes one trip", () => {
    const result = plan({
      lines: [
        { ...ORDER.lines[0], priceText: "US$ 2.00" },
        { ...ORDER.lines[1], priceText: null },
      ],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.problems.map((problem) => problem.saleCode), ["aBcDe", "fGhIj"]);
    assert.match(describeColnectOrderProblems(result.problems), /priced in USD.*price on this row/s);
  });

  it("refuses a transaction that lists nothing", () => {
    const result = plan({ lines: [] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.problems[0].message, /lists no items/);
  });

  it("files an anonymous buyer as nobody rather than inventing one", () => {
    const result = plan({ buyerLogin: null, buyerName: null });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.buyer, { name: null, fullName: null });
  });
});
