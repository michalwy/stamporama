import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BUYER_MESSAGE_PLACEHOLDERS,
  buyerMessageValues,
  renderBuyerMessage,
  unknownBuyerMessagePlaceholders,
  type BuyerMessageSale,
} from "../../src/lib/buyer-message-rules";

// The message to a buyer after a sale (#1815): what each placeholder comes out as, and the total
// that includes the shipping only once a method is on the sale. Which template a sale takes is the
// database half — `tests/integration/sale-buyer-message.test.ts`.

function sale(overrides: Partial<BuyerMessageSale> = {}): BuyerMessageSale {
  return {
    saleNo: 57,
    buyerName: "Jan Kowalski",
    currency: "PLN",
    items: [
      { offerNo: 412, title: "Austria 1850 Mercury", price: "25.00" },
      { offerNo: 413, title: "Poland 1860 No. 1", price: "10.50" },
    ],
    shippingMethodName: null,
    buyerHandling: null,
    shippingOptions: [
      { name: "Letter", cost: "8.00", currency: "PLN" },
      { name: "Registered letter", cost: "12.50", currency: "PLN" },
    ],
    ...overrides,
  };
}

describe("buyerMessageValues (#1815)", () => {
  it("fills every placeholder it lists", () => {
    const values = buyerMessageValues(sale());
    for (const p of BUYER_MESSAGE_PLACEHOLDERS) {
      assert.ok(p.token in values, `${p.token} has a value`);
    }
  });

  it("states the items alone before a shipping method is chosen, and lists the methods", () => {
    const values = buyerMessageValues(sale({ buyerHandling: "12.00" }));
    assert.equal(values["{buyer}"], "Jan Kowalski");
    assert.equal(values["{items}"], "#412 Austria 1850 Mercury\n#413 Poland 1860 No. 1");
    assert.equal(values["{itemsTotal}"], "35.50 PLN");
    assert.equal(values["{shipping}"], "");
    // A handling recorded before the method is not in the total: the method is what says the buyer
    // has chosen how it is sent.
    assert.equal(values["{total}"], "35.50 PLN");
    assert.equal(values["{shippingOptions}"], "Letter — 8 PLN\nRegistered letter — 12.50 PLN");
    assert.equal(values["{sale}"], "57");
  });

  it("adds what the buyer pays for postage once a method is on the sale", () => {
    const values = buyerMessageValues(sale({ shippingMethodName: "Registered letter", buyerHandling: "12.50" }));
    assert.equal(values["{shipping}"], "Registered letter — 12.50 PLN");
    assert.equal(values["{total}"], "48 PLN");
  });

  it("names a chosen method with no postage recorded, and totals the items alone", () => {
    const values = buyerMessageValues(sale({ shippingMethodName: "Letter" }));
    assert.equal(values["{shipping}"], "Letter");
    assert.equal(values["{total}"], "35.50 PLN");
  });

  it("writes amounts as generated text does (#1787) and sums them to the cent", () => {
    const values = buyerMessageValues(
      sale({
        items: [
          { offerNo: 1, title: "A", price: "0.10" },
          { offerNo: 2, title: "B", price: "0.20" },
        ],
      })
    );
    assert.equal(values["{itemsTotal}"], "0.30 PLN");
    assert.equal(buyerMessageValues(sale({ items: [{ offerNo: 1, title: "A", price: "15.00" }] }))["{itemsTotal}"], "15 PLN");
  });

  it("leaves what the sale does not know empty, never a stand-in (#1692)", () => {
    const values = buyerMessageValues(sale({ buyerName: null, shippingOptions: [], items: [] }));
    assert.equal(values["{buyer}"], "");
    assert.equal(values["{items}"], "");
    assert.equal(values["{shippingOptions}"], "");
    assert.equal(values["{itemsTotal}"], "0 PLN");
  });

  it("lists an item whose offer is gone by its title alone", () => {
    const values = buyerMessageValues(sale({ items: [{ offerNo: null, title: "Mercury", price: "5.00" }] }));
    assert.equal(values["{items}"], "Mercury");
  });
});

describe("renderBuyerMessage (#1815)", () => {
  it("fills the template and keeps its own lines, and an unknown token as typed", () => {
    const text = renderBuyerMessage(
      "Hi {buyer},\n\n{items}\nTotal: {total} {totl}\nAccount: 12 3456",
      sale()
    );
    assert.equal(
      text,
      "Hi Jan Kowalski,\n\n#412 Austria 1850 Mercury\n#413 Poland 1860 No. 1\nTotal: 35.50 PLN {totl}\nAccount: 12 3456"
    );
  });

  it("names the tokens that are not placeholders, once each", () => {
    assert.deepEqual(unknownBuyerMessagePlaceholders("{total} {totl} {totl} {sale} {Buyer}"), ["{totl}", "{Buyer}"]);
    assert.deepEqual(unknownBuyerMessagePlaceholders("{buyer} {shippingOptions}"), []);
  });
});
