import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeCommittedCopies,
  describeDepartedCopies,
  describeListedCopies,
  type CommittedCopy,
  type DepartedCopy,
  type ListedCopy,
} from "../../src/lib/trade-reservation-rules";
import { nameFew } from "../../src/lib/trade-rules";

// Reservation of committed copies against marketplace collisions (#639) — the sentences the two
// gates refuse in. What matters here: one collision reads the same from either end, a refusal names
// the *thing to go and deal with* rather than counting copies, and the departure warning tells sold
// apart from no-longer-held because they are answered in two different places.

function committed(n: number, tradeNo = 7): CommittedCopy {
  return {
    itemId: `i${n}`,
    label: `Copy #${n}`,
    trade: { tradeId: `t${tradeNo}`, tradeNo, partnerName: `Partner ${tradeNo}` },
  };
}

function listed(n: number, offerNo = 14): ListedCopy {
  return {
    itemId: `i${n}`,
    label: `Copy #${n}`,
    offer: {
      offerId: `o${offerNo}`,
      offerNo,
      label: "Chopin block",
      platformName: "Colnect",
    },
  };
}

function departed(n: number, reason: DepartedCopy["reason"]): DepartedCopy {
  return { itemId: `i${n}`, label: `Copy #${n}`, reason };
}

describe("nameFew (#639, #638)", () => {
  it("names everything up to five", () => {
    assert.equal(nameFew(["a", "b", "c"]), "a, b, c");
    assert.equal(nameFew(["a", "b", "c", "d", "e"]), "a, b, c, d, e");
  });

  it("names five and counts the rest", () => {
    assert.equal(nameFew(["a", "b", "c", "d", "e", "f", "g"]), "a, b, c, d, e, and 2 more");
  });

  it("says nothing about nothing", () => {
    assert.equal(nameFew([]), "");
  });
});

describe("describeCommittedCopies (#639)", () => {
  it("names the one copy when there is one", () => {
    const message = describeCommittedCopies([committed(12)]);
    assert.match(message, /^Copy #12 is promised in an agreed trade/);
    assert.match(message, /#7 \(Partner 7\)/);
  });

  it("counts the copies but names the trades — the trade is what has to be dealt with", () => {
    const message = describeCommittedCopies([committed(1), committed(2), committed(3)]);
    assert.match(message, /3 of this offer's copies are promised/);
    // One trade holding all three is named once, not three times.
    assert.equal(message.match(/#7 \(Partner 7\)/g)?.length, 1);
  });

  it("names every trade involved when the copies are spread over several", () => {
    const message = describeCommittedCopies([committed(1, 7), committed(2, 9)]);
    assert.match(message, /#7 \(Partner 7\), #9 \(Partner 9\)/);
  });
});

describe("describeListedCopies (#639)", () => {
  it("is the mirror of the offer's refusal — one collision, told from the other end", () => {
    const message = describeListedCopies([listed(12)]);
    assert.match(message, /^Copy #12 is live on a marketplace/);
    assert.match(message, /#14 Chopin block on Colnect/);
    assert.match(message, /before agreeing this trade/);
  });

  it("names each listing once however many copies it holds", () => {
    const message = describeListedCopies([listed(1), listed(2)]);
    assert.match(message, /2 of the copies you are giving are live/);
    assert.equal(message.match(/#14 Chopin block on Colnect/g)?.length, 1);
  });
});

describe("describeDepartedCopies (#639)", () => {
  it("says nothing when nothing has left", () => {
    assert.deepEqual(describeDepartedCopies([]), []);
  });

  it("keeps sold apart from no-longer-held — they are fixed in different places", () => {
    const messages = describeDepartedCopies([
      departed(1, "sold"),
      departed(2, "disposed"),
      departed(3, "sold"),
    ]);
    assert.equal(messages.length, 2);
    assert.match(messages[0], /2 copies promised here have since sold elsewhere: Copy #1, Copy #3\./);
    assert.match(messages[1], /A copy promised here is no longer held: Copy #2\./);
  });

  it("counts past five rather than listing them all", () => {
    const messages = describeDepartedCopies(
      [1, 2, 3, 4, 5, 6, 7].map((n) => departed(n, "sold"))
    );
    assert.match(messages[0], /and 2 more/);
  });
});
