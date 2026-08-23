import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { matchesColnectTransactionUrl, readColnectOrders } from "./orders";

// Colnect's own **transaction** screens (#698), read for the order on them.
//
// The markup below is trimmed from the live transaction `hflVE` — the nesting, the addresses, the
// classes that survived and the wording are Colnect's own; the buyer and the listing titles are not,
// because a fixture is not a place to keep somebody's name. What it is here to prove is what the two
// screens each state: the detail page states a whole order, and the list page states only which
// order a row is.

const DETAIL_URL = "https://colnect.com/en/transaction/show/id/hflVE";
const LIST_URL = "https://colnect.com/en/transaction/list";

/** The transaction detail: a header, three listing rows, the four totals, and the shipping method. */
const DETAIL = `
<div class="_fn-transaction-hflVE">
  <div class="transaction-header">
    <div><span>Buyer:</span> <span>Sample Buyer</span> <a href="/en/collectors/collector/samplebuyer">samplebuyer</a> <span>[samplebuyer]</span></div>
    <div><span>Started:</span> <span>August 23, 2026 2:21 PM</span></div>
  </div>
  <div class="_sl-list">
    <div class="_sl-entry">
      <a href="/en/market/sale/aBcDe"><img src="/i/1.jpg" alt=""></a>
      <a href="/en/market/sale/aBcDe">One stamp</a>
      <div><span>Item count:</span><span>1</span></div>
      <div>Item condition: Used</div>
      <div>Catalog codes: Mi:PL 200</div>
      <div>Sale status: Sold</div>
      <div class="_sl-price">€ 0.46</div>
    </div>
    <div class="_sl-entry">
      <a href="/en/market/sale/fGhIj"><img src="/i/2.jpg" alt=""></a>
      <a href="/en/market/sale/fGhIj">Another stamp</a>
      <div><span>Item count:</span><span>1</span></div>
      <div>Sale status: Sold</div>
      <div class="_sl-price">€ 4.51</div>
    </div>
    <div class="_sl-entry">
      <a href="/en/market/sale/kLmNo"><img src="/i/3.jpg" alt=""></a>
      <a href="/en/market/sale/kLmNo">A third stamp</a>
      <div><span>Item count:</span><span>2</span></div>
      <div>Sale status: Sold</div>
      <div class="_sl-price">€ 5.00</div>
    </div>
  </div>
  <div class="_t-transaction-price">
    <div><span>Items total</span><span>€ 9.97</span></div>
    <div><span>Shipping price</span><span>€ 2.40</span></div>
    <div><span>Discount</span><span>-€ 0.37</span></div>
    <div><span>Total with shipping</span><span>€ 12.00</span></div>
  </div>
  <div><span>Shipping method:</span><span>Stamps→domestic: Registered mail (Poczta Polska)</span></div>
  <div class="shipping-ladder"><div>up to 50 g</div><div>€ 2.40</div></div>
  <div class="buyer-address">Sample Buyer, 1 Sample Street, 00-001 Sample City, Poland</div>
  <div class="status-ladder"><a href="/en/transaction/confirm/id/hflVE/what/items_sent">Items sent</a></div>
</div>`;

/** A single-listing transaction — the case where the whole page names one listing, so a row that
 *  climbed on "only this listing" alone would swallow the totals. */
const SINGLE = `
<div>
  <div><span>Buyer:</span> <a href="/en/collectors/collector/samplebuyer">samplebuyer</a></div>
  <div><span>Started:</span><span>August 23, 2026 2:21 PM</span></div>
  <div class="row">
    <a href="/en/market/sale/aBcDe">One stamp</a>
    <div>Item count: 1</div>
    <div>€ 0.46</div>
  </div>
  <div class="_t-transaction-price">
    <div>Items total € 0.46</div>
    <div>Total with shipping € 2.86</div>
  </div>
</div>`;

/** The seller's list: each row links its own transaction — **without** a locale segment — and says
 *  how many listings it could not print. */
const LIST = `
<table>
  <tr>
    <td>August 23, 2026</td>
    <td><a href="/en/collectors/collector/samplebuyer">samplebuyer</a></td>
    <td>3 listings <span>+ 12 more listings</span></td>
    <td><a href="/transaction/show/id/hflVE">Details</a></td>
  </tr>
  <tr>
    <td>August 21, 2026</td>
    <td><a href="/en/collectors/collector/otherbuyer">otherbuyer</a></td>
    <td>1 listing</td>
    <td><a href="/transaction/show/id/QrStU">Details</a></td>
  </tr>
</table>`;

function read(html: string, url: string) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return readColnectOrders(document as unknown as Document, url);
}

describe("matchesColnectTransactionUrl", () => {
  it("recognises the transaction detail and list, with and without a locale", () => {
    assert.equal(matchesColnectTransactionUrl(DETAIL_URL), true);
    assert.equal(matchesColnectTransactionUrl(LIST_URL), true);
    assert.equal(matchesColnectTransactionUrl("https://colnect.com/transaction/show/id/hflVE"), true);
    assert.equal(matchesColnectTransactionUrl("https://colnect.com/pl/transaction/list/page/2"), true);
  });

  it("is not every Colnect page, and not another site's transaction", () => {
    assert.equal(matchesColnectTransactionUrl("https://colnect.com/en/stamps/stamp/1133075"), false);
    assert.equal(matchesColnectTransactionUrl("https://colnect.com/en/market/sale/aBcDe"), false);
    assert.equal(matchesColnectTransactionUrl("https://example.com/en/transaction/list"), false);
    assert.equal(matchesColnectTransactionUrl("not a url"), false);
  });
});

describe("readColnectOrders — the transaction's own page", () => {
  it("states the whole order: the id from the address, the buyer, the date and the method", () => {
    const [order] = read(DETAIL, DETAIL_URL);
    assert.equal(order.orderId, "hflVE");
    assert.equal(order.orderUrl, DETAIL_URL);
    assert.equal(order.buyerLogin, "samplebuyer");
    assert.equal(order.buyerName, "Sample Buyer");
    assert.equal(order.soldAtText, "August 23, 2026 2:21 PM");
    assert.equal(order.shippingMethodText, "Stamps→domestic: Registered mail (Poczta Polska)");
    assert.equal(order.canImport, true);
  });

  it("reads one line per listing, by the sale code its address names", () => {
    const [order] = read(DETAIL, DETAIL_URL);
    assert.deepEqual(
      order.lines.map((line) => line.platformItemId),
      ["aBcDe", "fGhIj", "kLmNo"]
    );
    assert.deepEqual(
      order.lines.map((line) => line.title),
      ["One stamp", "Another stamp", "A third stamp"]
    );
    // The picture and the title link the same listing: one row, not two.
    assert.equal(order.lines.length, 3);
  });

  it("reports each row's price and item count exactly as printed", () => {
    const [order] = read(DETAIL, DETAIL_URL);
    assert.deepEqual(
      order.lines.map((line) => line.priceText),
      ["€ 0.46", "€ 4.51", "€ 5.00"]
    );
    assert.deepEqual(
      order.lines.map((line) => line.quantityText),
      ["Item count: 1", "Item count: 1", "Item count: 2"]
    );
    // Colnect dates the transaction, not its rows.
    assert.deepEqual(
      order.lines.map((line) => line.soldAtText),
      [null, null, null]
    );
    // Colnect prints no seller reference on a transaction row — the whole reason #696 exists.
    assert.deepEqual(
      order.lines.map((line) => line.reference),
      [null, null, null]
    );
  });

  it("keeps each total's own words, because four figures mean four things", () => {
    const [order] = read(DETAIL, DETAIL_URL);
    assert.deepEqual(order.totalTexts, [
      "Items total € 9.97",
      "Shipping price € 2.40",
      "Discount -€ 0.37",
      "Total with shipping € 12.00",
    ]);
  });

  it("marks the header, where the reader is already asking whose parcel this is", () => {
    const [order] = read(DETAIL, DETAIL_URL);
    assert.equal(order.anchor.getAttribute("href"), "/en/collectors/collector/samplebuyer");
  });

  it("does not read the row's price off the totals of a single-listing transaction", () => {
    const [order] = read(SINGLE, DETAIL_URL);
    assert.equal(order.lines.length, 1);
    assert.equal(order.lines[0].priceText, "€ 0.46");
    assert.deepEqual(order.totalTexts, ["Items total € 0.46", "Total with shipping € 2.86"]);
  });

  it("reads a page whose own classes have gone, by its labels and addresses alone", () => {
    const [order] = read(DETAIL.replace(/_sl-entry|_sl-price|_t-transaction-price/g, "x"), DETAIL_URL);
    assert.deepEqual(
      order.lines.map((line) => [line.platformItemId, line.priceText, line.quantityText]),
      [
        ["aBcDe", "€ 0.46", "Item count: 1"],
        ["fGhIj", "€ 4.51", "Item count: 1"],
        ["kLmNo", "€ 5.00", "Item count: 2"],
      ]
    );
    assert.ok(order.totalTexts.includes("Total with shipping € 12.00"));
  });
});

describe("readColnectOrders — the seller's list", () => {
  it("states which order each row is, and offers to record none of them", () => {
    const orders = read(LIST, LIST_URL);
    assert.deepEqual(
      orders.map((order) => order.orderId),
      ["hflVE", "QrStU"]
    );
    assert.deepEqual(
      orders.map((order) => order.canImport),
      [false, false]
    );
    // The list truncates its listings, so nothing about the order's contents is read here at all.
    assert.deepEqual(
      orders.map((order) => order.lines.length),
      [0, 0]
    );
    assert.equal(orders[0].orderUrl, "https://colnect.com/transaction/show/id/hflVE");
    assert.equal(orders[0].anchor.textContent, "Details");
  });

  it("leaves a page it does not recognise exactly as it found it", () => {
    assert.deepEqual(read(DETAIL, "https://colnect.com/en/stamps/stamp/1133075"), []);
    assert.deepEqual(read("<div>nothing here</div>", LIST_URL), []);
  });
});
