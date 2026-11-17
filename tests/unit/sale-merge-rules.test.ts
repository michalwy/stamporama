import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergedSaleAmounts,
  mergedSaleApiReview,
  mergedSalePreview,
  matchesSaleMergeSearch,
  postageSumRefusal,
  saleMergeCandidateGroups,
  saleMergeRefusal,
  type SaleMergeChoices,
  type SaleMergeSide,
} from "../../src/lib/sale-merge-rules";
import { CONFIRMED_SALE_API_REVIEW } from "../../src/lib/sale-review";

// Merging one sale into another (#2041): which two can be merged, and the merged sale's amounts —
// each the remaining sale's, the other's or their sum.

function side(overrides: Partial<SaleMergeSide> = {}): SaleMergeSide {
  return {
    saleNo: 1,
    platformId: "fb",
    currency: "PLN",
    status: "ordered",
    gross: "20.00",
    buyerHandling: null,
    buyerPaidTotal: null,
    commission: null,
    shippingCost: null,
    shippingCurrency: null,
    shippingFxRateToBase: null,
    ...overrides,
  };
}

const all = (pick: SaleMergeChoices["buyer"]): SaleMergeChoices => ({
  buyer: pick,
  commission: pick,
  postage: pick,
});

describe("saleMergeRefusal", () => {
  it("merges two open sales on one platform in one currency", () => {
    assert.equal(saleMergeRefusal(side(), side({ saleNo: 2, status: "packed" })), null);
  });

  it("refuses another platform, another currency, a sent sale and the sale itself", () => {
    assert.match(saleMergeRefusal(side(), side({ saleNo: 2, platformId: "allegro" }))!, /same platform/);
    assert.match(saleMergeRefusal(side(), side({ saleNo: 2, currency: "EUR" }))!, /same currency/);
    assert.match(saleMergeRefusal(side(), side({ saleNo: 2, status: "sent" }))!, /#2 has already been sent/);
    assert.match(saleMergeRefusal(side({ status: "received" }), side({ saleNo: 2 }))!, /#1 has already been sent/);
    assert.match(saleMergeRefusal(side(), side())!, /itself/);
  });
});

describe("mergedSaleAmounts", () => {
  const remaining = side({
    gross: "20.00",
    buyerHandling: "5.00",
    commission: "1.10",
    shippingCost: "8.50",
    shippingCurrency: "PLN",
  });
  const other = side({
    saleNo: 2,
    gross: "30.00",
    buyerHandling: "6.00",
    commission: "2.20",
    shippingCost: "9.00",
    shippingCurrency: "PLN",
  });

  it("takes the remaining sale's, the other's, or the sum of each amount", () => {
    assert.deepEqual(mergedSaleAmounts(remaining, other, all("remaining")), {
      buyerHandling: "5.00",
      buyerPaidTotal: null,
      commission: "1.10",
      shippingCost: "8.50",
      shippingCurrency: "PLN",
      shippingFxRateToBase: null,
    });
    assert.deepEqual(mergedSaleAmounts(remaining, other, all("other")), {
      buyerHandling: "6.00",
      buyerPaidTotal: null,
      commission: "2.20",
      shippingCost: "9.00",
      shippingCurrency: "PLN",
      shippingFxRateToBase: null,
    });
    assert.deepEqual(mergedSaleAmounts(remaining, other, all("sum")), {
      buyerHandling: "11.00",
      buyerPaidTotal: null,
      // In cents: 1.10 + 2.20 is 3.30, not 3.3000000000000003.
      commission: "3.30",
      shippingCost: "17.50",
      shippingCurrency: "PLN",
      shippingFxRateToBase: null,
    });
  });

  it("chooses each amount on its own", () => {
    const merged = mergedSaleAmounts(remaining, other, { buyer: "other", commission: "sum", postage: "remaining" });
    assert.equal(merged.buyerHandling, "6.00");
    assert.equal(merged.commission, "3.30");
    assert.equal(merged.shippingCost, "8.50");
  });

  it("keeps a total paid as a total — the buyer who paid once for everything", () => {
    const paidOnce = side({ gross: "20.00", buyerPaidTotal: "60.00" });
    const merged = mergedSaleAmounts(paidOnce, other, all("remaining"));
    assert.equal(merged.buyerPaidTotal, "60.00");
    assert.equal(merged.buyerHandling, null);
  });

  it("sums what each buyer paid once either sale is anchored on a total", () => {
    const totalled = side({ gross: "20.00", buyerPaidTotal: "26.00" });
    // 26.00 paid, plus 30.00 gross + 6.00 handling.
    assert.equal(mergedSaleAmounts(totalled, other, all("sum")).buyerPaidTotal, "62.00");
    assert.equal(mergedSaleAmounts(totalled, other, all("sum")).buyerHandling, null);
  });

  it("leaves an amount neither sale recorded unrecorded, and sums one with nothing", () => {
    const bare = side();
    assert.equal(mergedSaleAmounts(bare, side({ saleNo: 2 }), all("sum")).commission, null);
    assert.equal(mergedSaleAmounts(bare, side({ saleNo: 2 }), all("sum")).buyerHandling, null);
    const summed = mergedSaleAmounts(bare, other, all("sum"));
    assert.equal(summed.commission, "2.20");
    assert.equal(summed.shippingCost, "9.00");
    assert.equal(summed.shippingCurrency, "PLN");
  });

  it("carries a postage's own currency and frozen rate with it", () => {
    const eur = side({ saleNo: 2, shippingCost: "3.00", shippingCurrency: "EUR", shippingFxRateToBase: "4.25" });
    assert.deepEqual(
      (({ shippingCost, shippingCurrency, shippingFxRateToBase }) => ({
        shippingCost,
        shippingCurrency,
        shippingFxRateToBase,
      }))(mergedSaleAmounts(remaining, eur, all("other"))),
      { shippingCost: "3.00", shippingCurrency: "EUR", shippingFxRateToBase: "4.25" }
    );
  });

  it("refuses to sum postages in two currencies", () => {
    const eur = side({ saleNo: 2, shippingCost: "3.00", shippingCurrency: "EUR" });
    assert.match(postageSumRefusal(remaining, eur)!, /PLN and EUR/);
    assert.equal(postageSumRefusal(remaining, other), null);
    assert.equal(postageSumRefusal(remaining, side()), null);
    assert.throws(() => mergedSaleAmounts(remaining, eur, all("sum")), /PLN and EUR/);
  });
});

describe("mergedSalePreview", () => {
  it("previews both sales' gross, the handling, and what the buyer pays", () => {
    const preview = mergedSalePreview(
      side({ gross: "20.00", buyerHandling: "5.00" }),
      side({ saleNo: 2, gross: "30.00", buyerHandling: "6.00" }),
      all("sum")
    );
    assert.equal(preview.gross, "50.00");
    assert.equal(preview.effectiveHandling, "11.00");
    assert.equal(preview.buyerTotal, "61.00");
    assert.equal(preview.totalBelowGross, false);
  });

  it("flags a total paid now below the merged gross", () => {
    const preview = mergedSalePreview(
      side({ gross: "20.00", buyerPaidTotal: "26.00" }),
      side({ saleNo: 2, gross: "30.00" }),
      all("remaining")
    );
    assert.equal(preview.totalBelowGross, true);
    assert.equal(preview.effectiveHandling, "0.00");
  });
});

describe("mergedSaleApiReview", () => {
  const T1 = new Date("2026-10-18T09:00:00.000Z");
  const T2 = new Date("2026-10-18T11:00:00.000Z");

  it("leaves the remaining sale's marker alone when the other carries none", () => {
    const remaining = { apiReviewAt: T1, apiReviewCreated: true, apiReviewActions: ["added offer #1 at 5 PLN"] };
    assert.deepEqual(mergedSaleApiReview(remaining, { ...CONFIRMED_SALE_API_REVIEW, saleNo: 2 }), remaining);
    assert.deepEqual(
      mergedSaleApiReview(CONFIRMED_SALE_API_REVIEW, { ...CONFIRMED_SALE_API_REVIEW, saleNo: 2 }),
      CONFIRMED_SALE_API_REVIEW
    );
  });

  it("marks the merged sale to review when the agent recorded the other, naming the merge", () => {
    const merged = mergedSaleApiReview(CONFIRMED_SALE_API_REVIEW, {
      apiReviewAt: T2,
      apiReviewCreated: true,
      apiReviewActions: ["added offer #9 at 12 PLN"],
      saleNo: 7,
    });
    assert.deepEqual(merged, {
      apiReviewAt: T2,
      // The agent did not record the sale that remains.
      apiReviewCreated: false,
      apiReviewActions: ["merged in sale #7, recorded through the agent API", "added offer #9 at 12 PLN"],
    });
  });

  it("adds to a marker already standing, keeping the later time", () => {
    const merged = mergedSaleApiReview(
      { apiReviewAt: T2, apiReviewCreated: true, apiReviewActions: ["added offer #1 at 5 PLN"] },
      { apiReviewAt: T1, apiReviewCreated: false, apiReviewActions: ["added offer #2 at 6 PLN"], saleNo: 3 }
    );
    assert.deepEqual(merged, {
      apiReviewAt: T2,
      apiReviewCreated: true,
      apiReviewActions: ["added offer #1 at 5 PLN", "merged in sale #3", "added offer #2 at 6 PLN"],
    });
  });
});

describe("the merge dialog's candidates (#2565)", () => {
  const listing = (saleNo: number, buyerId: string | null, buyerName: string | null, externalRef: string | null = null) => ({
    saleNo,
    buyerId,
    buyerName,
    externalRef,
  });
  // Newest first, as the candidates come.
  const candidates = [
    listing(52, "w", "Waldek Ch", "FB-9"),
    listing(51, "k", "Krzysztof Łąka"),
    listing(48, "w", "Waldek Ch"),
    listing(45, null, null, "ORD-77"),
  ];

  it("puts the same buyer's sales first, then the rest, each in the order given", () => {
    const { sameBuyer, otherBuyers } = saleMergeCandidateGroups({ buyerId: "w" }, candidates, "");
    assert.deepEqual(sameBuyer.map((c) => c.saleNo), [52, 48]);
    assert.deepEqual(otherBuyers.map((c) => c.saleNo), [51, 45]);
  });

  it("has no same buyer when the sale names none", () => {
    const { sameBuyer, otherBuyers } = saleMergeCandidateGroups({ buyerId: null }, candidates, "");
    assert.deepEqual(sameBuyer, []);
    assert.equal(otherBuyers.length, 4);
  });

  it("narrows both groups by buyer, sale number or order number", () => {
    const groups = (q: string) => {
      const g = saleMergeCandidateGroups({ buyerId: "w" }, candidates, q);
      return [...g.sameBuyer, ...g.otherBuyers].map((c) => c.saleNo);
    };
    assert.deepEqual(groups("waldek"), [52, 48]);
    assert.deepEqual(groups("laka"), [51], "case and diacritics folded");
    assert.deepEqual(groups("#48"), [48]);
    assert.deepEqual(groups("51"), [51]);
    assert.deepEqual(groups("ord-7"), [45]);
    assert.deepEqual(groups("  "), [52, 48, 51, 45]);
    assert.deepEqual(groups("nobody"), []);
  });

  it("does not match a bare # to every sale", () => {
    assert.equal(matchesSaleMergeSearch(listing(1, null, null), "#"), false);
  });
});
