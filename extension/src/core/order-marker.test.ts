import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { orderNeedsMark, removeOrderMarks, renderOrderMark } from "./order-marker";
import { isAssistantNode } from "./marker-shell";

// The mark on a sold order (#612). What is worth asserting is not how it looks but that a row can be
// answered twice — a re-scan, an import, a refusal — and still carry exactly one mark saying what
// the instance last said.

const SALE = { url: "https://stamps.example/c/main/sales/cms7q5", saleNo: 34, status: "ordered" };
const ORDER = "104867762";

function rowDoc(): Document {
  return parseHTML(
    `<html><body><li><div><a href="/en_GB/payment-request/${ORDER}"><strong>2026/03/01</strong> (3 items)</a></div></li></body></html>`
  ).document as unknown as Document;
}

function anchorOf(doc: Document): Element {
  return doc.querySelector("a")!;
}

describe("renderOrderMark", () => {
  it("links to the sale when the instance says the order is recorded", () => {
    const doc = rowDoc();
    const mark = renderOrderMark(anchorOf(doc), ORDER, { kind: "recorded", sale: SALE }, null, () => {})!;

    assert.equal(mark.textContent, "Sale #34");
    assert.equal(mark.getAttribute("href"), SALE.url);
    assert.equal(mark.getAttribute("target"), "_blank");
    assert.match(mark.getAttribute("title") ?? "", /ordered/);
  });

  it("offers the import when it does not, and calls back rather than writing anything", () => {
    const doc = rowDoc();
    let asked = 0;
    const mark = renderOrderMark(anchorOf(doc), ORDER, { kind: "importable" }, null, () => {
      asked += 1;
    })!;

    assert.equal(mark.textContent, "Import");
    assert.equal(mark.getAttribute("href"), null);
    (mark as HTMLElement).click();
    assert.equal(asked, 1);
  });

  it("sits after the row's own order link, where the row already says which order it is", () => {
    const doc = rowDoc();
    const mark = renderOrderMark(anchorOf(doc), ORDER, { kind: "importable" }, null, () => {})!;
    assert.equal(anchorOf(doc).nextSibling, mark);
  });

  it("replaces the mark a row already carries instead of adding a second", () => {
    const doc = rowDoc();
    renderOrderMark(anchorOf(doc), ORDER, { kind: "importable" }, null, () => {});
    renderOrderMark(anchorOf(doc), ORDER, { kind: "importing" }, null, () => {});
    renderOrderMark(anchorOf(doc), ORDER, { kind: "recorded", sale: SALE }, null, () => {});

    const marks = doc.querySelectorAll("[data-stamporama-order]");
    assert.equal(marks.length, 1);
    assert.equal(marks[0].textContent, "Sale #34");
  });

  it("keeps the refusal in full on hover and the button under it, because the way through is to retry", () => {
    const doc = rowDoc();
    let retried = 0;
    const message = "Item 2508694520: no offer here carries this Delcampe listing.";
    const mark = renderOrderMark(anchorOf(doc), ORDER, { kind: "refused", message }, null, () => {
      retried += 1;
    })!;

    assert.equal(mark.textContent, "Not imported");
    assert.equal(mark.getAttribute("title"), message);
    (mark as HTMLElement).click();
    assert.equal(retried, 1);
  });

  it("counts as the Assistant's own markup, so the page watcher does not re-scan for it", () => {
    const doc = rowDoc();
    const mark = renderOrderMark(anchorOf(doc), ORDER, { kind: "importable" }, null, () => {})!;
    assert.equal(isAssistantNode(mark), true);
    assert.equal(isAssistantNode(anchorOf(doc)), false);
  });
});

describe("orderNeedsMark", () => {
  it("is asked once per order, and again when a re-render moves the row to another one", () => {
    const doc = rowDoc();
    const anchor = anchorOf(doc);
    assert.equal(orderNeedsMark(anchor, ORDER), true);

    renderOrderMark(anchor, ORDER, { kind: "importable" }, null, () => {});
    assert.equal(orderNeedsMark(anchor, ORDER), false);
    assert.equal(orderNeedsMark(anchor, "105042326"), true);
  });
});

describe("removeOrderMarks", () => {
  it("leaves the row exactly as it was found", () => {
    const doc = rowDoc();
    const before = doc.body.innerHTML;
    renderOrderMark(anchorOf(doc), ORDER, { kind: "recorded", sale: SALE }, null, () => {});
    removeOrderMarks(doc);

    // The bookkeeping attribute stays: it is on Delcampe's own element and says this row has been
    // answered, which is what stops a re-scan asking about it again.
    assert.equal(doc.querySelectorAll("[data-stamporama-order]").length, 0);
    assert.equal(doc.body.innerHTML.replace(/ data-stamporama-order-answered="[^"]*"/, ""), before);
  });
});
