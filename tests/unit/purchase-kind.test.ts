import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OPENING_BALANCE_TITLE_MAX,
  intakeDocumentName,
  intakeDocumentType,
  isIntakeDocumentType,
  isOpeningBalance,
  isPurchaseKind,
  normalizeOpeningBalanceTitle,
} from "../../src/lib/purchase-kind";

describe("purchase kind vocabulary (#1323)", () => {
  it("accepts the two stored kinds and nothing else", () => {
    assert.equal(isPurchaseKind("purchase"), true);
    assert.equal(isPurchaseKind("opening_balance"), true);
    assert.equal(isPurchaseKind("trade"), false);
    assert.equal(isPurchaseKind(null), false);
  });

  it("knows an opening balance by its kind", () => {
    assert.equal(isOpeningBalance({ kind: "opening_balance" }), true);
    assert.equal(isOpeningBalance({ kind: "purchase" }), false);
  });
});

describe("intakeDocumentType", () => {
  it("files a purchase with a trade behind it under trades, and one without under purchases", () => {
    assert.equal(intakeDocumentType({ kind: "purchase", tradeId: null }), "purchase");
    assert.equal(intakeDocumentType({ kind: "purchase", tradeId: "t1" }), "trade");
  });

  it("files an opening balance under opening balances", () => {
    assert.equal(intakeDocumentType({ kind: "opening_balance", tradeId: null }), "opening_balance");
  });

  it("accepts exactly the three filter values", () => {
    for (const value of ["purchase", "trade", "opening_balance"]) {
      assert.equal(isIntakeDocumentType(value), true);
    }
    assert.equal(isIntakeDocumentType("auction"), false);
    assert.equal(isIntakeDocumentType(null), false);
  });
});

describe("normalizeOpeningBalanceTitle", () => {
  it("trims the title", () => {
    assert.equal(normalizeOpeningBalanceTitle("  Stockbook Poland 1 "), "Stockbook Poland 1");
  });

  it("refuses a blank title — it is the only name the document has", () => {
    assert.throws(() => normalizeOpeningBalanceTitle("   "), /needs a title/);
    assert.throws(() => normalizeOpeningBalanceTitle(null), /needs a title/);
  });

  it("refuses rather than truncates an over-long title", () => {
    const long = "x".repeat(OPENING_BALANCE_TITLE_MAX + 1);
    assert.throws(() => normalizeOpeningBalanceTitle(long), /at most/);
    assert.equal(normalizeOpeningBalanceTitle("x".repeat(OPENING_BALANCE_TITLE_MAX)).length, OPENING_BALANCE_TITLE_MAX);
  });
});

describe("intakeDocumentName", () => {
  it("names an opening balance by its title, even beside a stray contact", () => {
    assert.equal(
      intakeDocumentName({ kind: "opening_balance", title: "Inheritance", contactName: "Dealer" }),
      "Inheritance"
    );
  });

  it("names a purchase by its supplier, then its platform, else nothing", () => {
    assert.equal(
      intakeDocumentName({ kind: "purchase", title: null, contactName: "Dealer", platformName: "Allegro" }),
      "Dealer"
    );
    assert.equal(
      intakeDocumentName({ kind: "purchase", title: null, contactName: null, platformName: "Allegro" }),
      "Allegro"
    );
    assert.equal(intakeDocumentName({ kind: "purchase", title: null, contactName: null }), null);
  });
});
