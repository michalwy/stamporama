import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { colnectMarketPath, ColnectMarketPageError, readColnectMarketPage } from "./market";

// Reading Colnect's market list for one item (#2454), against markup copied from the live page on
// 2026-11-05 (item 60512) — trimmed, the structure and the attributes kept as served.

function entry({
  code,
  grade = "4",
  label = "U - Used",
  price = "0.01",
  seller = "Aleksagor",
  note = "",
  orig = null as string | null,
  featured = false,
}: {
  code: string;
  grade?: string;
  label?: string;
  price?: string;
  seller?: string;
  note?: string;
  orig?: string | null;
  featured?: boolean;
}): string {
  const tip = orig
    ? `<span data-tip-title="Estimated price conversion" data-tip-text="&lt;div&gt;Original price: ${orig}&lt;/div&gt;" data-orig-val="0.01" data-orig-cur="29" class="_tip ">`
    : `<span class="_tip">`;
  return `<div class="_sl-entry${featured ? " _sl-sale-f" : ""}">
    <div class="_sl-entry-container">
      <a class="_sl-pic-container" href="/en/market/sale/${code}"><img class="_sl-pic" alt="Knight"></a>
      <div class="_sl-description">
        <div class="_sl-titles"><a class="_sl-title" href="/en/market/sale/${code}">Portugal: Knight on horseback, 1953</a></div>
        <div class="_sl-info">
          <div class="_sl-condition _sl-c-entry"><a href="/en/help/collecting/item_condition_stamps">Item Condition</a>:
            <span class="_tip _t-cond" data-tip="condition_20_${grade}">${label}</span>
            <span class="hidden tip_condition_20_${grade} _tip-text">Used stamp that has traveled through the post.</span>
          </div>
          <div class="_sl-subtitle _sl-c-entry">${note}</div>
          <div class="_sl-price _sl-price-big">${tip}<span data-val="8" class="_sl-price-currency " itemprop="priceCurrency" content="EUR">€</span>&nbsp;<span data-val="${price}" class="_sl-price-val " itemprop="price" content="${price}">${price}</span></span></div>
          <div class="_sl-c-entry _sl-private-note"></div>
          <div class="_sl-c-entry">Sale ends in <span class="_tip"><span class="_uftl-d"><span>6</span>d</span></span></div>
        </div>
      </div>
    </div>
    <div class="_sl-seller-details _sl-seller-list"><strong class="centered">Sold by</strong>
      <span><a class="_sl-avatar-link" href="/en/collectors/collector/${seller}"><span>${seller}</span></a></span>
      <div class="_sl-seller-info"><div class="_sl-c-entry"><a href="/en/collectors/ratings/collector/${seller}">Seller rating</a></div></div>
    </div>
  </div>`;
}

const LOT = `<div class="_sl-entry"><div class="_sl-entry-container"><div class="_sl-description">
  <div class="_sl-titles"><a class="_sl-title" href="/en/market/sale/TM4z7">7 stamps, including: Portugal: Knight</a></div>
  <div class="_sl-info"><div class="_sl-c-entry possibly-clip clipped">
    <span class="_sl-title-prefix">Items in this listing:</span>
    <span class="_sl-title-prefix">Stamp: Knight, <span class="_tip _t-cond" data-tip="condition_20_4">U - Used</span></span>
    <span class="_sl-title-prefix">Stamp: Knight, <span class="_tip _t-cond" data-tip="condition_20_4">U - Used</span></span>
  </div>
  <div class="_sl-price _sl-price-big"><span><span class="_sl-price-currency" content="EUR">€</span> <span class="_sl-price-val" content="0.51">0.51</span></span></div>
  </div></div></div>
  <div class="_sl-seller-details"><a href="/en/collectors/collector/Darrin">Darrin</a></div></div>`;

function page(body: string, { signedIn = "michalwy", paging = "" } = {}) {
  const { document } = parseHTML(`<!doctype html><html><body>
    <header><a class="collector_link" href="/en/collectors/collector/${signedIn}">${signedIn}<span id="user-icon"></span></a></header>
    ${body}
    ${paging}
    <div class="rand_marketplace rand_static"><div class="header">Sale listings you might like:</div>
      ${entry({ code: "rand1", price: "9.99", seller: "someone" })}
    </div>
  </body></html>`);
  return document;
}

describe("colnectMarketPath (#2454)", () => {
  it("asks for the item's listings by price, in English, same-origin", () => {
    assert.equal(colnectMarketPath("60512"), "/en/stamps/marketplace/item/60512/sort/by_price");
    assert.equal(colnectMarketPath(" 60512 ", 3), "/en/stamps/marketplace/item/60512/sort/by_price/page/3");
  });

  it("refuses anything that is not a plain item id", () => {
    assert.throws(() => colnectMarketPath("60512/../../sell"));
    assert.throws(() => colnectMarketPath(""));
  });
});

describe("readColnectMarketPage (#2454)", () => {
  it("reads each listing's condition, price, currency, seller and note", () => {
    const doc = page(
      `<div class="sales-list">
        <nav class="navigation_box _nvb-filter"></nav>
        ${entry({ code: "hrIaXq", note: "Oblitéré TTB - Cachet rond" })}
        ${entry({ code: "a2", grade: "2", label: "MH - Mint Hinged", price: "0.02", seller: "lucianocrimi" })}
        ${entry({ code: "a3", grade: "1", label: "MNH - Mint Never Hinged", price: "1,200.00", seller: "depro" })}
      </div>`
    );
    const read = readColnectMarketPage(doc);
    assert.equal(read.signedInAs, "michalwy");
    assert.deepEqual(read.offers[0], {
      saleCode: "hrIaXq",
      grade: "4",
      gradeLabel: "U - Used",
      amount: "0.01",
      currency: "EUR",
      originalPrice: null,
      seller: "Aleksagor",
      note: "Oblitéré TTB - Cachet rond",
    });
    assert.deepEqual(
      read.offers.map((o) => [o.grade, o.amount, o.seller, o.note]),
      [
        ["4", "0.01", "Aleksagor", "Oblitéré TTB - Cachet rond"],
        ["2", "0.02", "lucianocrimi", null],
        ["1", "1200.00", "depro", null],
      ]
    );
    assert.equal(read.lots, 0);
    assert.equal(read.lastPage, 1);
  });

  it("leaves out the 'you might like' box, which draws other stamps' listings in the same markup", () => {
    const read = readColnectMarketPage(page(`<div class="sales-list">${entry({ code: "x" })}</div>`));
    assert.deepEqual(read.offers.map((o) => o.saleCode), ["x"]);
  });

  it("counts a lot instead of reading its price as this stamp's", () => {
    const read = readColnectMarketPage(page(`<div class="sales-list">${entry({ code: "x" })}${LOT}</div>`));
    assert.equal(read.offers.length, 1);
    assert.equal(read.lots, 1);
  });

  it("says where Colnect converted a price, with what the seller asked", () => {
    const read = readColnectMarketPage(
      page(`<div class="sales-list">${entry({ code: "c", orig: "A$ 0.01" })}</div>`)
    );
    assert.equal(read.offers[0].originalPrice, "A$ 0.01");
    assert.equal(read.offers[0].currency, "EUR");
  });

  it("reads a featured listing drawn twice once", () => {
    const read = readColnectMarketPage(
      page(`<div class="sales-list">${entry({ code: "f", featured: true })}${entry({ code: "f" })}</div>`)
    );
    assert.equal(read.offers.length, 1);
  });

  it("counts a listing with no readable price rather than inventing one", () => {
    const read = readColnectMarketPage(
      page(`<div class="sales-list">${entry({ code: "z", price: "" })}</div>`)
    );
    assert.equal(read.offers.length, 0);
    assert.equal(read.unreadable, 1);
  });

  it("follows the paging", () => {
    const read = readColnectMarketPage(
      page(`<div class="sales-list">${entry({ code: "x" })}</div>`, {
        paging: `<a href="/en/stamps/marketplace/item/60512-Knight/sort/by_price/page/2">2</a>
                 <a href="/en/stamps/marketplace/item/60512-Knight/sort/by_price/page/4">4</a>`,
      })
    );
    assert.equal(read.lastPage, 4);
  });

  it("reads Colnect's own empty list as no listings", () => {
    const read = readColnectMarketPage(page(`<div class="empty">The list is empty!</div>`));
    assert.deepEqual(read.offers, []);
  });

  it("refuses a page that is not a market list — never 'nobody is selling it'", () => {
    const { document } = parseHTML(`<html><body><h1>Colnect Collectors Protection</h1></body></html>`);
    assert.throws(() => readColnectMarketPage(document), ColnectMarketPageError);
  });
});
