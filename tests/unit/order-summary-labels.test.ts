import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasOrderSummaryLabels,
  ORDER_SUMMARY_LABEL_LANGUAGES,
  orderSummaryItemsLabel,
  orderSummaryLabels,
  orderSummaryStatus,
} from "../../src/lib/order-summary-labels";
import { SPECIFICATION_LABEL_LANGUAGES } from "../../src/lib/offer-specification-labels";

// The order summary's own words (#2604), in the buyer's language.

describe("order summary labels (#2604)", () => {
  it("has its words in the languages the specification has them in", () => {
    assert.deepEqual(ORDER_SUMMARY_LABEL_LANGUAGES, SPECIFICATION_LABEL_LANGUAGES);
  });

  it("leaves no word blank in any language", () => {
    for (const code of ORDER_SUMMARY_LABEL_LANGUAGES) {
      const labels = orderSummaryLabels(code);
      const words = [
        labels.orderSummary,
        labels.date,
        labels.buyer,
        labels.shipping,
        labels.status,
        ...Object.values(labels.statuses),
        labels.set,
        labels.copies,
        labels.price,
        labels.items,
        labels.sets.other,
        labels.total,
        labels.freeExtras,
      ];
      for (const word of words) assert.ok(word.trim().length > 0, `${code} has a blank word`);
    }
  });

  it("prints a language it has no words in, and none, in English", () => {
    assert.equal(hasOrderSummaryLabels("ja"), false);
    assert.equal(orderSummaryLabels("ja").orderSummary, "Order summary");
    assert.equal(orderSummaryLabels(null).total, "Total");
    assert.equal(hasOrderSummaryLabels("de-AT"), true);
    assert.equal(orderSummaryLabels("de-AT").orderSummary, "Bestellübersicht");
  });

  it("counts the sets in the language's plural form", () => {
    assert.equal(orderSummaryItemsLabel("en", 1), "Items (1 set)");
    assert.equal(orderSummaryItemsLabel("en", 3), "Items (3 sets)");
    assert.equal(orderSummaryItemsLabel("pl", 2), "Przedmioty (2 zestawy)");
    assert.equal(orderSummaryItemsLabel("pl", 5), "Przedmioty (5 zestawów)");
    assert.equal(orderSummaryItemsLabel("ja", 2), "Items (2 sets)");
  });

  it("names the status by its stored token, received as Delivered and a cancelled sale as Cancelled", () => {
    assert.equal(orderSummaryStatus("en", "received"), "Delivered");
    assert.equal(orderSummaryStatus("de", "paid"), "Bezahlt");
    assert.equal(orderSummaryStatus("de", "cancelled"), "Storniert");
    assert.equal(orderSummaryStatus("de", "something-new"), "something-new");
  });
});
