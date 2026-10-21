import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BUYER_MESSAGE_PLACEHOLDERS,
  buyerMessageValues,
  renderBuyerMessage,
  unknownBuyerMessagePlaceholders,
  type BuyerMessageSale,
} from "../../src/lib/buyer-message-rules";
import { resolveTemplateToken } from "../../src/lib/template-amount";

// The message to a buyer after a sale (#1815): what each placeholder comes out as, and the total
// that includes the shipping only once an option is on the sale. Which template a sale takes is the
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
    shippingOptionName: null,
    buyerHandling: null,
    shippingOptions: [
      { name: "Letter", price: "8.00", currency: "PLN" },
      { name: "Registered letter", price: "12.50", currency: "PLN" },
    ],
    ...overrides,
  };
}

/** Each placeholder as it is written with no parameter — an amount with the currency's symbol (#2028). */
function written(forSale: BuyerMessageSale): Record<string, string> {
  const values = buyerMessageValues(forSale);
  return Object.fromEntries(Object.keys(values).map((token) => [token, resolveTemplateToken(token, values)!]));
}

describe("buyerMessageValues (#1815)", () => {
  it("fills every placeholder it lists", () => {
    const values = buyerMessageValues(sale());
    for (const p of BUYER_MESSAGE_PLACEHOLDERS) {
      assert.ok(p.token in values, `${p.token} has a value`);
    }
  });

  it("states the items alone before a shipping option is chosen, and lists the options", () => {
    const values = written(sale({ buyerHandling: "12.00" }));
    assert.equal(values["{buyer}"], "Jan Kowalski");
    assert.equal(values["{items}"], "#412 Austria 1850 Mercury\n#413 Poland 1860 No. 1");
    assert.equal(values["{itemsTotal}"], "35.50 zł");
    assert.equal(values["{shipping}"], "");
    // A handling recorded before the method is not in the total: the method is what says the buyer
    // has chosen how it is sent.
    assert.equal(values["{total}"], "35.50 zł");
    assert.equal(values["{shippingOptions}"], "Letter — 8 zł\nRegistered letter — 12.50 zł");
    assert.equal(values["{sale}"], "57");
  });

  it("adds what the buyer pays for postage once a method is on the sale", () => {
    const values = written(sale({ shippingOptionName: "Registered letter", buyerHandling: "12.50" }));
    assert.equal(values["{shipping}"], "Registered letter — 12.50 zł");
    assert.equal(values["{total}"], "48 zł");
  });

  it("names a chosen method with no postage recorded, and totals the items alone", () => {
    const values = written(sale({ shippingOptionName: "Letter" }));
    assert.equal(values["{shipping}"], "Letter");
    assert.equal(values["{total}"], "35.50 zł");
  });

  it("writes amounts as generated text does (#1787) and sums them to the cent", () => {
    const values = written(
      sale({
        items: [
          { offerNo: 1, title: "A", price: "0.10" },
          { offerNo: 2, title: "B", price: "0.20" },
        ],
      })
    );
    assert.equal(values["{itemsTotal}"], "0.30 zł");
    assert.equal(written(sale({ items: [{ offerNo: 1, title: "A", price: "15.00" }] }))["{itemsTotal}"], "15 zł");
  });

  it("leaves what the sale does not know empty, never a stand-in (#1692)", () => {
    const values = written(sale({ buyerName: null, shippingOptions: [], items: [] }));
    assert.equal(values["{buyer}"], "");
    assert.equal(values["{items}"], "");
    assert.equal(values["{shippingOptions}"], "");
    assert.equal(values["{itemsTotal}"], "0 zł");
  });

  it("lists an item whose offer is gone by its title alone", () => {
    const values = written(sale({ items: [{ offerNo: null, title: "Mercury", price: "5.00" }] }));
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
      "Hi Jan Kowalski,\n\n#412 Austria 1850 Mercury\n#413 Poland 1860 No. 1\nTotal: 35.50 zł {totl}\nAccount: 12 3456"
    );
  });

  it("writes every amount with the symbol, the code or neither, as its placeholder asks (#2028)", () => {
    const chosen = sale({ shippingOptionName: "Registered letter", buyerHandling: "12.50" });
    assert.equal(renderBuyerMessage("{total} | {total:symbol} | {total:code} | {total:none}", chosen), "48 zł | 48 zł | 48 PLN | 48");
    assert.equal(renderBuyerMessage("{itemsTotal:code}", chosen), "35.50 PLN");
    assert.equal(renderBuyerMessage("{shipping:none}", chosen), "Registered letter — 12.50");
    // A list writes each of its amounts the way it is asked.
    assert.equal(renderBuyerMessage("{shippingOptions:code}", chosen), "Letter — 8 PLN\nRegistered letter — 12.50 PLN");
    assert.equal(renderBuyerMessage("{total}", sale({ currency: "EUR" })), "35.50 €");
    assert.equal(renderBuyerMessage("{total}", sale({ currency: "USD" })), "$35.50");
  });

  it("writes the sale number plain, or padded with :N (#2097)", () => {
    assert.equal(renderBuyerMessage("Sale {sale}, ref {sale:4}", sale()), "Sale 57, ref 0057");
    assert.equal(renderBuyerMessage("{sale:0} {sale:x}", sale()), "{sale:0} {sale:x}");
    assert.deepEqual(unknownBuyerMessagePlaceholders("{sale:4} {sale:0} {total:4}"), ["{sale:0}", "{total:4}"]);
  });

  it("keeps a token with a parameter that is not a choice, or on a placeholder writing no amount, as typed (#2028)", () => {
    assert.equal(renderBuyerMessage("{total:cod} {buyer:code} {total:}", sale()), "{total:cod} {buyer:code} {total:}");
  });

  it("names the tokens that are not placeholders, once each", () => {
    assert.deepEqual(unknownBuyerMessagePlaceholders("{total} {totl} {totl} {sale} {Buyer}"), ["{totl}", "{Buyer}"]);
    assert.deepEqual(unknownBuyerMessagePlaceholders("{buyer} {shippingOptions}"), []);
  });

  it("names a currency parameter that is not a choice, or one on a placeholder writing no amount (#2028)", () => {
    assert.deepEqual(
      unknownBuyerMessagePlaceholders("{total:code} {itemsTotal:none} {shipping:symbol} {total:cod} {sale:none} {total:}"),
      ["{total:cod}", "{sale:none}", "{total:}"]
    );
  });
});
