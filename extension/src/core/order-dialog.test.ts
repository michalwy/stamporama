import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { closeOrderDialog, showOrderDialog, type OrderImportSummary } from "./order-dialog";
import { isAssistantNode, ORDER_DIALOG_ATTR } from "./marker-shell";

// The window one *Import* click opens (#612/#698).
//
// What it is here to prove is the two things the mark could not do: state what was recorded well
// enough to check it against the screen underneath, and list **every** reason an order was refused
// rather than running them together in a tooltip.

const SALE = { url: "https://stamps.example/c/main/sales/s1", saleNo: 34, status: "ordered" };

const SUMMARY: OrderImportSummary = {
  buyer: "samplebuyer",
  soldAt: "2026-08-23",
  currency: "EUR",
  lineCount: 3,
  gross: "9.97",
  buyerPaidTotal: "12.00",
  shippingMethodName: "Stamps→domestic: Registered mail (Poczta Polska)",
  setChoicePending: 0,
};

function page() {
  const { document } = parseHTML("<!doctype html><html><body><p>Colnect</p></body></html>");
  return document as unknown as Document;
}

/** A keyboard event linkedom can dispatch: it ships `Event` and no `KeyboardEvent`, and what the
 *  handler under test reads is the `key`. */
function keydown(doc: Document, key: string): Event {
  const view = doc.defaultView as unknown as { Event: typeof Event };
  return Object.assign(new view.Event("keydown", { bubbles: true, cancelable: true }), { key });
}

function text(doc: Document): string {
  return doc.querySelector(`[${ORDER_DIALOG_ATTR}]`)?.textContent ?? "";
}

describe("showOrderDialog", () => {
  it("opens on the click and says it is working before anything is known", () => {
    const doc = page();
    showOrderDialog(doc, "hflVE", { kind: "working" }, null);
    assert.match(text(doc), /Order hflVE/);
    assert.match(text(doc), /Recording this order…/);
  });

  it("states the sale it recorded, with the figures to check the page against", () => {
    const doc = page();
    showOrderDialog(doc, "hflVE", { kind: "recorded", sale: SALE, summary: SUMMARY, created: true }, null);
    const body = text(doc);
    assert.match(body, /Sale #34/);
    assert.match(body, /Recorded in Stamporama\./);
    assert.match(body, /samplebuyer/);
    assert.match(body, /2026-08-23/);
    assert.match(body, /9\.97 EUR/);
    assert.match(body, /12\.00 EUR/);
    assert.match(body, /Registered mail/);

    const link = doc.querySelector(`[${ORDER_DIALOG_ATTR}] a[href]`);
    assert.equal(link?.getAttribute("href"), SALE.url);
    // A new tab: the screen being packed from is the one the collector is coming back to.
    assert.equal(link?.getAttribute("target"), "_blank");
  });

  it("says when the order was already recorded, so nothing reads as a second write", () => {
    const doc = page();
    showOrderDialog(doc, "hflVE", { kind: "recorded", sale: SALE, summary: SUMMARY, created: false }, null);
    assert.match(text(doc), /already recorded — nothing was written just now/);
  });

  it("names the decision an imported quantity line still wants (#697)", () => {
    const doc = page();
    showOrderDialog(
      doc,
      "hflVE",
      { kind: "recorded", sale: SALE, summary: { ...SUMMARY, setChoicePending: 2 }, created: true },
      null
    );
    assert.match(text(doc), /2 lines name a set nobody has chosen yet/);
  });

  it("shows the link alone when the instance answered without a summary", () => {
    const doc = page();
    showOrderDialog(doc, "hflVE", { kind: "recorded", sale: SALE, summary: null, created: true }, null);
    assert.match(text(doc), /Sale #34/);
    assert.doesNotMatch(text(doc), /Buyer/);
  });

  it("lists every reason an order was refused, one per line", () => {
    const doc = page();
    showOrderDialog(
      doc,
      "hflVE",
      {
        kind: "refused",
        message: "one two",
        problems: [
          "Listing aBcDe: no offer here carries this Colnect listing.",
          "Listing fGhIj: priced in USD, but this platform's sales are in EUR.",
        ],
      },
      null
    );
    const items = [...doc.querySelectorAll(`[${ORDER_DIALOG_ATTR}] li`)].map((li) => li.textContent);
    assert.deepEqual(items, [
      "Listing aBcDe: no offer here carries this Colnect listing.",
      "Listing fGhIj: priced in USD, but this platform's sales are in EUR.",
    ]);
    assert.match(text(doc), /Nothing was recorded\./);
    assert.match(text(doc), /recorded whole or not at all/);
  });

  it("falls back to the whole sentence for a refusal about no row in particular", () => {
    const doc = page();
    showOrderDialog(
      doc,
      "hflVE",
      { kind: "refused", message: "No platform is marked as Colnect yet.", problems: [] },
      null
    );
    const items = [...doc.querySelectorAll(`[${ORDER_DIALOG_ATTR}] li`)].map((li) => li.textContent);
    assert.deepEqual(items, ["No platform is marked as Colnect yet."]);
  });

  it("replaces what it was saying rather than stacking a second window", () => {
    const doc = page();
    showOrderDialog(doc, "hflVE", { kind: "working" }, null);
    showOrderDialog(doc, "hflVE", { kind: "recorded", sale: SALE, summary: SUMMARY, created: true }, null);
    assert.equal(doc.querySelectorAll(`[${ORDER_DIALOG_ATTR}]`).length, 1);
    assert.doesNotMatch(text(doc), /Recording this order…/);
  });

  it("closes on its own button and on Escape, leaving the page as it was", () => {
    const doc = page();
    showOrderDialog(doc, "hflVE", { kind: "working" }, null);
    const view = doc.defaultView as unknown as { Event: typeof Event };
    const close = [...doc.querySelectorAll(`[${ORDER_DIALOG_ATTR}] a[role="button"]`)].at(-1);
    close?.dispatchEvent(new view.Event("click", { bubbles: true, cancelable: true }));
    assert.equal(doc.querySelectorAll(`[${ORDER_DIALOG_ATTR}]`).length, 0);

    showOrderDialog(doc, "hflVE", { kind: "working" }, null);
    doc.dispatchEvent(keydown(doc, "Escape"));
    assert.equal(doc.querySelectorAll(`[${ORDER_DIALOG_ATTR}]`).length, 0);
    // And the key handler goes with it: a content script that left one behind would keep swallowing
    // the page's own Escape long after the window was gone.
    doc.dispatchEvent(keydown(doc, "Escape"));
  });

  it("counts as the Assistant's own markup, so the page watcher does not chase it", () => {
    const doc = page();
    const dialog = showOrderDialog(doc, "hflVE", { kind: "working" }, null);
    assert.ok(dialog);
    assert.equal(isAssistantNode(dialog), true);
    assert.equal(isAssistantNode(doc.querySelector(`[${ORDER_DIALOG_ATTR}] div`)!), true);
    assert.equal(isAssistantNode(doc.querySelector("p")!), false);
    closeOrderDialog(doc);
  });
});
