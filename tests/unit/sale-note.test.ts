import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergedSaleNote, normalizeSaleNote, saleNoteAction } from "../../src/lib/sale-note";

describe("a sale's note (#2379)", () => {
  it("is stored with its ends trimmed and its line breaks kept", () => {
    assert.equal(normalizeSaleNote("  Promised a stockcard.\n\n  Ship after the 20th.  \n"), "Promised a stockcard.\n\n  Ship after the 20th.");
  });

  it("is none when blank, so *no note* has one form", () => {
    assert.equal(normalizeSaleNote(""), null);
    assert.equal(normalizeSaleNote(" \n\t "), null);
    assert.equal(normalizeSaleNote(null), null);
    assert.equal(normalizeSaleNote(undefined), null);
  });

  it("keeps both notes on a merge, the other's below after a blank line", () => {
    assert.equal(mergedSaleNote("Two parcels.", "Buyer pays postage."), "Two parcels.\n\nBuyer pays postage.");
  });

  it("keeps either alone as it is, and neither as none", () => {
    assert.equal(mergedSaleNote("Two parcels.", null), "Two parcels.");
    assert.equal(mergedSaleNote(null, "Buyer pays postage."), "Buyer pays postage.");
    assert.equal(mergedSaleNote("  ", ""), null);
    assert.equal(mergedSaleNote(null, null), null);
  });

  it("names the act on the to-review marker, never the private text", () => {
    assert.equal(saleNoteAction("Agreed a discount of 5 PLN"), "set the note");
    assert.equal(saleNoteAction(null), "cleared the note");
  });
});
