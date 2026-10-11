import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  duplicateStamps,
  newOfferCopiesSummary,
  orderNewOfferCopies,
  sameStampKey,
  type NewOfferCopy,
} from "../../src/lib/new-offer-copies";

// The New offer dialog's list of the copies going in (#1793): which stamps are doubled, what the set
// is worth at catalogue and at cost, and the orders the rows can be read in.

let next = 0;
function copy(overrides: Partial<NewOfferCopy> = {}): NewOfferCopy {
  next++;
  return {
    id: `i${next}`,
    itemNo: next,
    stampName: null,
    stampId: `s${next}`,
    multiStamp: false,
    carriedStamps: [],
    value: { baseAmountDisplay: null, uncertain: false },
    costBasis: null,
    lotId: null,
    lotStatus: null,
    lotValued: null,
    openingBalance: false,
    costEstimate: null,
    ...overrides,
  };
}

const priced = (amount: string, o: Partial<NewOfferCopy> = {}) =>
  copy({ value: { baseAmountDisplay: amount, uncertain: false }, ...o });
const costing = (amount: string, o: Partial<NewOfferCopy> = {}) =>
  copy({ costBasis: amount, lotId: "L", lotStatus: "closed", lotValued: true, ...o });
const estimated = (amount: string | null, o: Partial<NewOfferCopy> = {}) =>
  copy({ lotId: "L", lotStatus: "open", lotValued: true, costEstimate: amount, ...o });

describe("the same stamp in a new offer (#1793)", () => {
  it("is the same stamp or variant, whatever the copies' conditions", () => {
    const a = copy({ stampId: "eagle" });
    const b = copy({ stampId: "eagle" });
    const other = copy({ stampId: "crown" });
    const dupes = duplicateStamps([a, other, b]);
    assert.equal(dupes.doubledStamps, 1);
    assert.equal(dupes.doubledCopies, 2);
    assert.equal(dupes.copiesOfSameStamp.get(a.id), 2);
    assert.equal(dupes.copiesOfSameStamp.get(b.id), 2);
    assert.equal(dupes.copiesOfSameStamp.has(other.id), false);
  });

  it("counts each doubled stamp once, however many copies it has", () => {
    const dupes = duplicateStamps([
      copy({ stampId: "eagle" }),
      copy({ stampId: "eagle" }),
      copy({ stampId: "eagle" }),
      copy({ stampId: "crown" }),
      copy({ stampId: "crown" }),
    ]);
    assert.equal(dupes.doubledStamps, 2);
    assert.equal(dupes.doubledCopies, 5);
  });

  it("is nothing when every copy is a different stamp", () => {
    const dupes = duplicateStamps([copy(), copy(), copy()]);
    assert.equal(dupes.doubledStamps, 0);
    assert.equal(dupes.copiesOfSameStamp.size, 0);
  });

  it("matches a multi-stamp piece only to one carrying exactly the same stamps", () => {
    const piece = (ids: string[]) =>
      copy({ stampId: ids[0], multiStamp: true, carriedStamps: ids.map((stampId) => ({ stampId })) });
    assert.equal(sameStampKey(piece(["a", "b"])), sameStampKey(piece(["b", "a"])));
    assert.notEqual(sameStampKey(piece(["a", "b"])), sameStampKey(piece(["a", "c"])));
    // A cover led by stamp a is not a single copy of a.
    assert.notEqual(sameStampKey(piece(["a", "b"])), sameStampKey(copy({ stampId: "a" })));
  });
});

describe("the new offer's summary (#1793)", () => {
  it("counts the copies and sums their catalogue values in cents", () => {
    const summary = newOfferCopiesSummary([priced("1.10"), priced("0.20"), copy()]);
    assert.equal(summary.count, 3);
    assert.equal(summary.catalogue.amount, "1.30");
    assert.equal(summary.catalogue.unpricedCount, 1);
    assert.equal(summary.catalogue.uncertain, false);
  });

  it("has no catalogue figure when no copy is priced", () => {
    assert.equal(newOfferCopiesSummary([copy(), copy()]).catalogue.amount, null);
  });

  it("marks the catalogue total when a counted copy's variant is unknown", () => {
    const summary = newOfferCopiesSummary([
      priced("2.00"),
      copy({ value: { baseAmountDisplay: "1.00", uncertain: true } }),
    ]);
    assert.equal(summary.catalogue.uncertain, true);
  });

  it("costs the copies as an offer's COST does — an open lot's copy at its estimate (#1743)", () => {
    const summary = newOfferCopiesSummary([costing("2.00"), estimated("0.75")]);
    assert.equal(summary.cost.amount, "2.75");
    assert.equal(summary.cost.estimated, true);
  });

  it("names a pending copy with no estimate by its number and stamp", () => {
    const summary = newOfferCopiesSummary([estimated(null, { itemNo: 7, stampName: "Eagle" })]);
    assert.deepEqual(summary.cost.unestimated, ["#00007 (Eagle)"]);
  });
});

describe("ordering the new offer's copies (#1793)", () => {
  it("keeps the picked order by default, as a new array", () => {
    const copies = [priced("1.00"), priced("9.00")];
    const ordered = orderNewOfferCopies(copies, "picked");
    assert.deepEqual(ordered, copies);
    assert.notEqual(ordered, copies);
  });

  it("puts the highest catalogue value first and an unpriced copy last", () => {
    const cheap = priced("1.00");
    const none = copy();
    const dear = priced("12.50");
    const mid = priced("3.00");
    assert.deepEqual(orderNewOfferCopies([cheap, none, dear, mid], "value"), [dear, mid, cheap, none]);
  });

  it("puts the highest cost first, an estimate counting at its figure, and no cost last", () => {
    const none = copy();
    const cheap = costing("0.50");
    const guess = estimated("4.00");
    const dear = costing("6.00");
    assert.deepEqual(orderNewOfferCopies([none, cheap, guess, dear], "cost"), [dear, guess, cheap, none]);
  });

  it("keeps the picked order between equal figures", () => {
    const a = priced("2.00");
    const b = priced("2.00");
    assert.deepEqual(orderNewOfferCopies([a, b], "value"), [a, b]);
    assert.deepEqual(orderNewOfferCopies([b, a], "value"), [b, a]);
  });
});
