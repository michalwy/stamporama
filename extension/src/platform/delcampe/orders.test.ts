import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { matchesDelcampeSoldItemsUrl, readDelcampeOrders } from "./orders";

// Delcampe's **My Sold Items** screens (#612), read for the orders on them.
//
// The markup below is trimmed from the live `sold-items/archived` screen — the nesting, the
// addresses, the classes that survived and the wording are Delcampe's own; the buyers and the
// listing titles are not, because a fixture is not a place to keep somebody's name. What it is here
// to prove is the two things a page states that no file does: that the three item rows under one
// `payment-request/<id>` are **that order's**, and that a row's own price is not the order's total.

const PAGE_URL = "https://www.delcampe.net/en_GB/collectables/sell/sold-items/archived";

/** One order block: three items, a buyer, and a total printed twice — converted into the screen's
 *  display currency and again in the currency the listings were in. */
const THREE_ITEM_ORDER = `
<div class="table-list-line table-row">
  <ul>
    <li>
      <div>
        <div class="user-info">
          <div><a href="https://www.delcampe.net/en_GB/collectables/user/profile/212007-birdcollector" class="nickname">birdcollector</a>
          <a href="https://www.delcampe.net/en_GB/collectables/user/profile/212007-birdcollector"><span>100%</span><span>(84150x)</span></a></div>
          <p>Sample Buyer</p>
          <ul><li><a href="/en_GB/messages/contact/212007">Contact the buyer</a></li></ul>
        </div>
      </div>
    </li>
    <li class="payment-status-action">
      <div>
        <div><a href="/en_GB/payment-request/104867762"><strong>2026/03/01</strong> (3 items) </a></div>
        <div class="block-price">
          <ul><li><strong class="price">± €13.95</strong></li><li>US$16.15</li></ul>
          <p>Shipping included</p>
        </div>
        <div>
          <a href="/en_GB/bills/104867762/status/to_archive?list=seller-archived">Archive</a>
          <a href="/en_GB/payment-request/104867762/printBill?list=seller-archived">Print invoice</a>
        </div>
      </div>
    </li>
  </ul>
  <div class="table-body">
    <div class="table-list-line">
      <ul>
        <li>
          <div class="info-item">
            <a href="/en_GB/collectables/item/2508694478.html" class="item-title">One stamp</a>
            <ul><li>#2508694478</li><li><div class="personal-reference">Ref. A054</div></li></ul>
          </div>
        </li>
        <li class="list-price"><div><div><strong>US$0.15</strong></div><p>± €0.13</p></div></li>
        <li class="list-date"><span>Sun 22 Mar 2026</span><span>at 22:25</span></li>
      </ul>
    </div>
    <div class="table-list-line">
      <ul>
        <li>
          <div class="info-item">
            <a href="/en_GB/collectables/item/2508694520.html" class="item-title">Another stamp</a>
            <ul><li>#2508694520</li><li><div class="personal-reference">Ref. http://stamps.example/o/main/412</div></li></ul>
          </div>
        </li>
        <li class="list-price"><div><div><strong>US$3.00</strong></div><p>± €2.59</p></div></li>
        <li class="list-date"><span>Sun 22 Mar 2026</span><span>at 22:24</span></li>
      </ul>
    </div>
    <div class="table-list-line">
      <ul>
        <li>
          <div class="info-item">
            <a href="/en_GB/collectables/item/2509563164.html" class="item-title">A third stamp</a>
            <ul><li>#2509563164</li><li><div class="personal-reference">Ref. A214</div></li></ul>
          </div>
        </li>
        <li class="list-price">
          <div>
            <div><strong>US$12.75</strong></div><p>± €11.01</p>
            <div><strong>-15%</strong><strong class="line-through">US$15.00</strong></div>
          </div>
        </li>
        <li class="list-date"><span>Sun 22 Mar 2026</span><span>at 22:23</span></li>
      </ul>
    </div>
  </div>
</div>`;

/** A single-item order — the case where the whole block holds exactly one item link, so a row that
 *  climbed on "one item" alone would swallow the order's own header and read its total as a price. */
const ONE_ITEM_ORDER = `
<div class="table-list-line table-row">
  <ul>
    <li>
      <div class="user-info">
        <div><a href="/en_GB/collectables/user/profile/7933-onebuyer" class="nickname">onebuyer</a></div>
        <p>Another Buyer</p>
      </div>
    </li>
    <li class="payment-status-action">
      <div>
        <div><a href="/en_GB/payment-request/105220934"><strong>2026/04/04</strong> (1 item) </a></div>
        <div class="block-price"><ul><li><strong class="price">€5.42</strong></li></ul><p>Shipping included</p></div>
      </div>
    </li>
  </ul>
  <div class="table-body">
    <div class="table-list-line">
      <ul>
        <li>
          <div class="info-item">
            <a href="/en_GB/collectables/item/2519213720.html" class="item-title">USA $5 Liberty</a>
            <ul><li>#2519213720</li><li><div class="personal-reference">Ref. A733</div></li></ul>
          </div>
        </li>
        <li class="list-price"><div><strong>€2.62</strong></div></li>
        <li class="list-date"><span>Sat 1 Aug 2026</span><span>at 01:42</span></li>
      </ul>
    </div>
  </div>
</div>`;

function pageOf(...blocks: string[]): Document {
  return parseHTML(`<html><body><div class="table-view">${blocks.join("")}</div></body></html>`)
    .document as unknown as Document;
}

describe("matchesDelcampeSoldItemsUrl", () => {
  it("matches the seller's own sold-items screens, in either spelling", () => {
    for (const phase of ["list", "to-invoice", "invoiced", "to-send", "sent", "archived"]) {
      assert.equal(
        matchesDelcampeSoldItemsUrl(
          `https://www.delcampe.net/en_GB/collectables/sell/sold-items/${phase}`
        ),
        true
      );
    }
    assert.equal(
      matchesDelcampeSoldItemsUrl("https://www.delcampe.net/en_US/collectibles/sell/sold-items/sent"),
      true
    );
  });

  it("matches nothing else on Delcampe, and nothing off it", () => {
    assert.equal(
      matchesDelcampeSoldItemsUrl("https://www.delcampe.net/en_GB/collectables/item/2519213720.html"),
      false
    );
    assert.equal(
      matchesDelcampeSoldItemsUrl(
        "https://www.delcampe.net/en_GB/collectables/sell/item-for-sale/ongoing"
      ),
      false
    );
    assert.equal(
      matchesDelcampeSoldItemsUrl("https://delcampe.net.example.com/en_GB/collectables/sell/sold-items/sent"),
      false
    );
    assert.equal(matchesDelcampeSoldItemsUrl("not a url"), false);
  });
});

describe("readDelcampeOrders", () => {
  it("groups an order's items under the order they were bought in", () => {
    const [order] = readDelcampeOrders(pageOf(THREE_ITEM_ORDER), PAGE_URL);
    assert.equal(order.orderId, "104867762");
    assert.deepEqual(
      order.lines.map((line) => line.platformItemId),
      ["2508694478", "2508694520", "2509563164"]
    );
  });

  it("reads the order's own address, without the screen it was reached from", () => {
    const [order] = readDelcampeOrders(pageOf(THREE_ITEM_ORDER), PAGE_URL);
    assert.equal(order.orderUrl, "https://www.delcampe.net/en_GB/payment-request/104867762");
    assert.equal(order.anchor.getAttribute("href"), "/en_GB/payment-request/104867762");
  });

  it("reads the buyer as a login and a name, and nothing else about them", () => {
    const [order] = readDelcampeOrders(pageOf(THREE_ITEM_ORDER), PAGE_URL);
    assert.equal(order.buyerLogin, "birdcollector");
    assert.equal(order.buyerName, "Sample Buyer");
    assert.deepEqual(Object.keys(order).sort(), [
      "anchor",
      "buyerLogin",
      "buyerName",
      "canImport",
      "lines",
      "markPlacement",
      "orderId",
      "orderUrl",
      "shippingMethodText",
      "soldAtText",
      "totalTexts",
    ]);
  });

  it("dates its rows and names no delivery method, and says so at the order level (#698)", () => {
    const [order] = readDelcampeOrders(pageOf(THREE_ITEM_ORDER), PAGE_URL);
    assert.equal(order.soldAtText, null);
    assert.equal(order.shippingMethodText, null);
    // Every phase screen states the whole order, so every row here may be imported from.
    assert.equal(order.canImport, true);
  });

  it("carries both figures the header prints for one total, deciding between neither", () => {
    const [order] = readDelcampeOrders(pageOf(THREE_ITEM_ORDER), PAGE_URL);
    assert.deepEqual(order.totalTexts, ["± €13.95", "US$16.15"]);
  });

  it("reads each row's own price, date and reference as printed", () => {
    const [order] = readDelcampeOrders(pageOf(THREE_ITEM_ORDER), PAGE_URL);
    assert.deepEqual(order.lines[0], {
      platformItemId: "2508694478",
      title: "One stamp",
      reference: "A054",
      priceText: "US$0.15",
      soldAtText: "Sun 22 Mar 2026",
      // Delcampe prints one row per copy, so there is no count to read (#698).
      quantityText: null,
    });
  });

  it("takes the price paid off a discounted row, not the one struck through", () => {
    const [order] = readDelcampeOrders(pageOf(THREE_ITEM_ORDER), PAGE_URL);
    assert.equal(order.lines[2].priceText, "US$12.75");
  });

  it("hands back the reference with Delcampe's own label off it — an offer's URL included", () => {
    const [order] = readDelcampeOrders(pageOf(THREE_ITEM_ORDER), PAGE_URL);
    assert.equal(order.lines[1].reference, "http://stamps.example/o/main/412");
  });

  it("reads a single-item order's row price rather than the order's total", () => {
    const [order] = readDelcampeOrders(pageOf(ONE_ITEM_ORDER), PAGE_URL);
    assert.equal(order.lines.length, 1);
    // The block's own total is €5.42 and the row sold for €2.62; a row that climbed as far as the
    // header would report the first of those as what the stamp went for.
    assert.equal(order.lines[0].priceText, "€2.62");
    assert.deepEqual(order.totalTexts, ["€5.42"]);
  });

  it("does not take a price out of a title that happens to contain one", () => {
    const [order] = readDelcampeOrders(pageOf(ONE_ITEM_ORDER), PAGE_URL);
    assert.equal(order.lines[0].title, "USA $5 Liberty");
    assert.equal(order.lines[0].priceText, "€2.62");
  });

  it("keeps two orders on one screen apart", () => {
    const orders = readDelcampeOrders(pageOf(THREE_ITEM_ORDER, ONE_ITEM_ORDER), PAGE_URL);
    assert.deepEqual(
      orders.map((order) => order.orderId),
      ["104867762", "105220934"]
    );
    assert.deepEqual(
      orders.map((order) => order.lines.length),
      [3, 1]
    );
  });

  it("leaves a page it no longer recognises alone rather than reporting half an order", () => {
    const doc = parseHTML(
      `<html><body><div><a href="/en_GB/payment-request/1">2026/01/01</a></div></body></html>`
    ).document as unknown as Document;
    assert.deepEqual(readDelcampeOrders(doc, PAGE_URL), []);
  });
});
