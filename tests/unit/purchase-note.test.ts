import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizePurchaseNote } from "../../src/lib/purchase-note";

// What an intake document's note is stored as (#2378).

describe("normalizePurchaseNote", () => {
  it("keeps the text and its line breaks", () => {
    assert.equal(normalizePurchaseNote("Owes two stamps.\nAsk at the fair."), "Owes two stamps.\nAsk at the fair.");
  });

  it("drops the whitespace around it and makes Windows line endings plain ones", () => {
    assert.equal(normalizePurchaseNote("  \r\nLine one\r\nLine two\rLine three \n"), "Line one\nLine two\nLine three");
  });

  it("stores nothing left as no note at all", () => {
    assert.equal(normalizePurchaseNote(""), null);
    assert.equal(normalizePurchaseNote("  \n\t "), null);
    assert.equal(normalizePurchaseNote(null), null);
    assert.equal(normalizePurchaseNote(undefined), null);
  });

  it("leaves a link as text", () => {
    assert.equal(normalizePurchaseNote("https://example.com/lot/12"), "https://example.com/lot/12");
  });
});
