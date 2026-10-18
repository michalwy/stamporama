import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planOfferSale,
  saleTargetOf,
  soldIntoSaleMessage,
  type SaleCandidate,
} from "../../src/lib/offer-sale-plan";

/**
 * *Sell* over several ticked offers (#2050) and the toast that follows any *Sell* (#2049). One sale is
 * one platform and one currency, so the plan sells the offers most of the selection agrees on and
 * names the rest; each offer sells every set it still has at its own price.
 */
const offer = (n: number, over: Partial<SaleCandidate> = {}): SaleCandidate => ({
  id: `o${n}`,
  offerNo: n,
  platformId: "fb",
  platformName: "Facebook",
  currency: "PLN",
  price: `${n}.00`,
  ...over,
});
const set = (id: string) => ({ offerSetId: id, itemIds: [`${id}-i`] });

describe("the sale's platform and currency (#2050)", () => {
  it("is the pair most open offers share", () => {
    const target = saleTargetOf([
      offer(1, { platformId: "col", platformName: "Colnect" }),
      offer(2),
      offer(3),
    ]);
    assert.deepEqual(target, { platformId: "fb", platformName: "Facebook", currency: "PLN" });
  });

  it("goes to the first ticked on a tie", () => {
    const target = saleTargetOf([offer(1, { currency: "EUR" }), offer(2)]);
    assert.equal(target?.currency, "EUR");
  });

  it("ignores closed offers, and is null when every offer is closed", () => {
    const target = saleTargetOf([
      offer(1, { platformId: "col", platformName: "Colnect", closed: true }),
      offer(2, { platformId: "col", platformName: "Colnect", closed: true }),
      offer(3),
    ]);
    assert.equal(target?.platformId, "fb");
    assert.equal(saleTargetOf([offer(1, { closed: true })]), null);
  });
});

describe("planning the sale (#2050)", () => {
  it("sells every set each offer still has, at that offer's own price", () => {
    const offers = [offer(1), offer(2)];
    const plan = planOfferSale(offers, saleTargetOf(offers), new Map([["o1", [set("a"), set("b")]], ["o2", [set("c")]]]));
    assert.deepEqual(plan.sold.map((o) => o.offerNo), [1, 2]);
    assert.deepEqual(
      plan.lines.map((l) => [l.offerId, l.offerSetId, l.price]),
      [["o1", "a", "1.00"], ["o1", "b", "1.00"], ["o2", "c", "2.00"]]
    );
    assert.deepEqual(plan.skipped, []);
  });

  it("names an offer on another platform or currency, or with nothing left, and sells the rest", () => {
    const offers = [
      offer(1),
      offer(2, { platformId: "col", platformName: "Colnect" }),
      offer(3, { currency: "EUR" }),
      offer(4),
      offer(5, { closed: true }),
      offer(6),
    ];
    const plan = planOfferSale(offers, saleTargetOf(offers), new Map([["o1", [set("a")]], ["o4", [set("d")]]]));
    assert.deepEqual(plan.sold.map((o) => o.offerNo), [1, 4]);
    assert.deepEqual(
      plan.skipped.map((s) => [s.offer.offerNo, s.reason]),
      [
        [2, "is on Colnect, not Facebook"],
        [3, "is in EUR, not PLN"],
        [5, "has nothing left to sell"],
        [6, "has nothing left to sell"],
      ]
    );
  });

  it("sells nothing when nothing is left", () => {
    const offers = [offer(1, { closed: true })];
    const plan = planOfferSale(offers, saleTargetOf(offers), new Map());
    assert.deepEqual(plan.lines, []);
    assert.equal(plan.skipped.length, 1);
  });

  it("scopes one offer's flow to one set (#473)", () => {
    const offers = [offer(1)];
    const plan = planOfferSale(offers, saleTargetOf(offers), new Map([["o1", [set("a"), set("b")]]]), "b");
    assert.deepEqual(plan.lines.map((l) => l.offerSetId), ["b"]);
    const gone = planOfferSale(offers, saleTargetOf(offers), new Map([["o1", [set("a")]]]), "b");
    assert.deepEqual(gone.sold, []);
  });
});

describe("the toast after Sell (#2049)", () => {
  it("names the offer, the sale and the buyer", () => {
    assert.equal(
      soldIntoSaleMessage({ offerNos: [412], oneSet: false, saleNo: 12, buyerName: "Jan Kowalski" }),
      "Offer #412 added to sale #12 · Jan Kowalski"
    );
  });

  it("says when only a set was sold, and leaves out a buyer nobody named", () => {
    assert.equal(
      soldIntoSaleMessage({ offerNos: [412], oneSet: true, saleNo: 12, buyerName: null }),
      "A set of offer #412 added to sale #12"
    );
  });

  it("counts several offers", () => {
    assert.equal(
      soldIntoSaleMessage({ offerNos: [1, 2, 3], oneSet: false, saleNo: 7, buyerName: "Ola" }),
      "3 offers added to sale #7 · Ola"
    );
  });
});
