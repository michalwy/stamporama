import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  incomingPurchaseItem,
  incomingSheetItem,
  intakeDocumentNo,
  phoneStartedPurchaseItem,
} from "../../src/lib/dashboard-incoming-rules";

// How a row of the dashboard's Incoming purchases section reads (#1810): a purchase is its supplier,
// then its number, date and value, aged by how long it has been in its state; a scan is its batch,
// then the document it belongs to.

const purchase = {
  id: "p1",
  kind: "purchase",
  title: null,
  purchaseNo: 12,
  contactName: "Kowalski",
  platformName: "Allegro",
  purchasedAt: "2026-09-30",
  currency: "PLN",
  total: "123.45",
  statusChangedAt: "2026-10-02T08:00:00.000Z",
  toCompleteSince: null,
};

describe("incomingPurchaseItem (#1810)", () => {
  it("names the supplier, then number, date and value, aged in its state", () => {
    assert.deepEqual(incomingPurchaseItem(purchase), {
      key: "p1",
      label: "Kowalski",
      detail: "Order #12 · 2026-09-30 · 123.45 PLN",
      at: "2026-10-02T08:00:00.000Z",
      href: "purchases/p1",
    });
  });

  it("falls back to the platform, then to the list's own wording", () => {
    assert.equal(incomingPurchaseItem({ ...purchase, contactName: null }).label, "Allegro");
    assert.equal(
      incomingPurchaseItem({ ...purchase, contactName: null, platformName: null }).label,
      "No supplier"
    );
  });

  it("names an opening balance by its title and says when it has no value", () => {
    const item = incomingPurchaseItem({
      ...purchase,
      kind: "opening_balance",
      title: "Klaser Polska 1",
      contactName: null,
      platformName: null,
      total: null,
    });
    assert.equal(item.label, "Klaser Polska 1");
    assert.equal(item.detail, "Opening balance #12 · 2026-09-30 · No opening value");
  });
});

describe("phoneStartedPurchaseItem (#2006)", () => {
  it("reads as any purchase row, aged from when the phone started it", () => {
    const started = { ...purchase, toCompleteSince: "2026-10-01T12:00:00.000Z" };
    assert.deepEqual(phoneStartedPurchaseItem(started), {
      ...incomingPurchaseItem(started),
      at: "2026-10-01T12:00:00.000Z",
    });
  });
});

describe("incomingSheetItem (#1810)", () => {
  const sheet = {
    id: "s1",
    batchNo: 3,
    side: "front" as const,
    label: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    purchase: { id: "p1", kind: "purchase", purchaseNo: 12, title: null, contactName: "Kowalski", platformName: null },
  };

  it("names the batch and the document it belongs to, and opens the document", () => {
    assert.deepEqual(incomingSheetItem(sheet), {
      key: "s1",
      label: "Batch 3",
      detail: "Order #12 · Kowalski",
      at: "2026-10-01T10:00:00.000Z",
      href: "purchases/p1",
    });
  });

  it("carries the card's name and says when it is the back", () => {
    assert.equal(incomingSheetItem({ ...sheet, label: "Klaser A", side: "back" }).label, "Batch 3 · Klaser A — back");
  });
});

describe("intakeDocumentNo", () => {
  it("numbers an order and an opening balance in their own words", () => {
    assert.equal(intakeDocumentNo({ kind: "purchase", purchaseNo: 4 }), "Order #4");
    assert.equal(intakeDocumentNo({ kind: "opening_balance", purchaseNo: 4 }), "Opening balance #4");
  });
});
