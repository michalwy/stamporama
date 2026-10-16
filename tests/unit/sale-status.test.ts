import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSaleSent, UNSENT_SALE_STATUSES } from "../../src/lib/sale-status";

// Which sales the *Sell* dialog offers to add to, and which ones refuse more sets (#1950).
describe("isSaleSent", () => {
  it("is true once the parcel has gone, and false before", () => {
    assert.equal(isSaleSent("sent"), true);
    assert.equal(isSaleSent("received"), true);
    for (const s of UNSENT_SALE_STATUSES) assert.equal(isSaleSent(s), false, s);
  });

  it("does not read an unknown token as sent", () => {
    assert.equal(isSaleSent("shipped"), false);
  });
});
