import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isPhoneClosingLot,
  phoneClosingTicks,
  phoneClosingTotal,
  phoneLotNumbersText,
  phoneLotsSoldMessage,
  phoneLotsWithdrawnMessage,
} from "../../src/lib/phone-post-close-rules";
import { facebookLotWithdrawMessage } from "../../src/lib/facebook-post-rules";
import type { OfferState } from "../../src/lib/offer-rules";

// Closing a Facebook post from the phone (#2631): which lots take a tick, the ticks left after a move,
// the ticked lots' total and the words after each move. The writes are
// `tests/integration/phone-post-close.test.ts`.

describe("closing a post from the phone (#2631)", () => {
  it("ticks only a lot still up in its group", () => {
    const ticks = (state: OfferState) => isPhoneClosingLot({ state });
    assert.equal(ticks("active"), true);
    assert.equal(ticks("paused"), true);
    for (const state of ["preparing", "ready", "pending", "sold", "withdrawn"] as OfferState[]) {
      assert.equal(ticks(state), false, state);
    }
  });

  it("drops a lot sold or withdrawn since it was ticked, keeping lot order", () => {
    const lots = [
      { offerId: "a", state: "active" as OfferState },
      { offerId: "b", state: "sold" as OfferState },
      { offerId: "c", state: "paused" as OfferState },
      { offerId: "d", state: "withdrawn" as OfferState },
      { offerId: "e", state: "active" as OfferState },
    ];
    assert.deepEqual(phoneClosingTicks(new Set(["e", "b", "a", "d"]), lots), ["a", "e"]);
    assert.deepEqual(phoneClosingTicks(new Set(), lots), []);
  });

  it("adds the ticked lots' prices in their currency, to the cent", () => {
    assert.deepEqual(
      phoneClosingTotal([
        { price: "12.10", currency: "PLN" },
        { price: "0.20", currency: "PLN" },
        { price: "5", currency: "PLN" },
      ]),
      { amount: "17.30", currency: "PLN" }
    );
    assert.equal(phoneClosingTotal([]), null);
    assert.equal(
      phoneClosingTotal([
        { price: "1.00", currency: "PLN" },
        { price: "1.00", currency: "EUR" },
      ]),
      null,
      "one sale cannot take two currencies"
    );
  });

  it("names the lots by number, in lot order", () => {
    assert.equal(phoneLotNumbersText([4]), "lot 4");
    assert.equal(phoneLotNumbersText([7, 1]), "lots 1 and 7");
    assert.equal(phoneLotNumbersText([7, 1, 4]), "lots 1, 4 and 7");
  });

  it("says which lots went into which sale, and what was left out", () => {
    assert.equal(
      phoneLotsSoldMessage({ lotNos: [1, 4, 7], created: true, saleNo: 12, buyerName: "Jan Kowalski", skipped: [] }),
      "Lots 1, 4 and 7 sold in new sale #12 · Jan Kowalski."
    );
    assert.equal(
      phoneLotsSoldMessage({
        lotNos: [2],
        created: false,
        saleNo: 9,
        buyerName: null,
        skipped: [{ lotNo: 3, reason: "has nothing left to sell" }],
      }),
      "Lot 2 sold into sale #9. Lot 3 has nothing left to sell — not sold."
    );
    assert.equal(phoneLotsWithdrawnMessage([8, 3, 5]), "Lots 3, 5 and 8 withdrawn");
    assert.equal(phoneLotsWithdrawnMessage([6]), "Lot 6 withdrawn");
  });

  it("asks before withdrawing in the desk's words, for one lot or several", () => {
    assert.equal(
      facebookLotWithdrawMessage(1, 10),
      "This lot is no longer for sale; the post and its other lots stay up. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
    );
    assert.equal(
      facebookLotWithdrawMessage(6, 10),
      "These 6 lots are no longer for sale; the post and its other lots stay up. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
    );
    assert.equal(
      facebookLotWithdrawMessage(1, 1),
      "This takes the listing down. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
    );
  });
});
