import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { phoneOfferMoves } from "../../src/lib/phone-offer-moves";

// The phone offer screen's moves (#2008): pause, resume and withdraw, each exactly when the desk's
// manual transitions allow it — and never publishing or an approval dressed as a resume.

describe("phoneOfferMoves", () => {
  it("pauses or withdraws an active offer", () => {
    assert.deepEqual(phoneOfferMoves("active"), ["pause", "withdraw"]);
  });

  it("resumes or withdraws a paused offer", () => {
    assert.deepEqual(phoneOfferMoves("paused"), ["resume", "withdraw"]);
  });

  it("only withdraws an offer that is not up yet — publishing and approving stay at the desk", () => {
    assert.deepEqual(phoneOfferMoves("preparing"), ["withdraw"]);
    assert.deepEqual(phoneOfferMoves("ready"), ["withdraw"]);
    assert.deepEqual(phoneOfferMoves("pending"), ["withdraw"]);
  });

  it("offers nothing on a closed offer", () => {
    assert.deepEqual(phoneOfferMoves("sold"), []);
    assert.deepEqual(phoneOfferMoves("withdrawn"), []);
  });
});
