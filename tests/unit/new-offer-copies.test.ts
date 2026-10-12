import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NO_NEW_OFFER_COPY_FILTERS,
  duplicateStamps,
  filterNewOfferCopies,
  groupNewOfferCopies,
  newOfferCopiesSummary,
  newOfferCopyFiltersActive,
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
    conditionId: "mint",
    issueId: null,
    issueName: null,
    areaId: null,
    catalogNumbers: [],
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

const carried = (stampId: string, numbers: string[] = []) => ({
  stampId,
  areaId: "gg",
  catalogNumbers: numbers.map((number) => ({ catalogVendorId: "fi", number })),
});
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
      copy({ stampId: ids[0], multiStamp: true, carriedStamps: ids.map((stampId) => carried(stampId)) });
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

// A series read for gaps and doubles in its own order (#1869).

/** A copy numbered in the primary catalogue (`fi`) and, where given, another one (`mi`). */
const numbered = (fi: string | null, o: Partial<NewOfferCopy> & { mi?: string } = {}) => {
  const { mi, ...rest } = o;
  return copy({
    areaId: "gg",
    catalogNumbers: [
      ...(mi ? [{ catalogVendorId: "mi", number: mi }] : []),
      ...(fi ? [{ catalogVendorId: "fi", number: fi }] : []),
    ],
    ...rest,
  });
};
const primary = new Map([["gg", "fi"]]);

describe("ordering the new offer's copies by catalogue number (#1869)", () => {
  it("reads numbers as numbers, a suffix after its base, no number last", () => {
    const n47 = numbered("47");
    const none = numbered(null);
    const n45 = numbered("45");
    const n46a = numbered("46a");
    const n100 = numbered("100");
    const n46 = numbered("46");
    assert.deepEqual(
      orderNewOfferCopies([n47, none, n45, n46a, n100, n46], "catalog", { primaryVendorByArea: primary }),
      [n45, n46, n46a, n47, n100, none]
    );
  });

  it("goes by the area's primary catalogue, not whichever number comes first", () => {
    // By the lowest number of any catalogue, `a` (Mi 1) would lead.
    const a = numbered("2", { mi: "1" });
    const b = numbered("1", { mi: "3" });
    assert.deepEqual(orderNewOfferCopies([a, b], "catalog", { primaryVendorByArea: primary }), [b, a]);
  });

  it("keeps the picked order between copies of one number", () => {
    const a = numbered("5");
    const b = numbered("5");
    assert.deepEqual(orderNewOfferCopies([b, a], "catalog", { primaryVendorByArea: primary }), [b, a]);
  });

  it("orders a multi-stamp piece by its first carried stamp", () => {
    const piece = copy({ multiStamp: true, carriedStamps: [carried("x", ["3"]), carried("y", ["9"])] });
    const n4 = numbered("4");
    const n2 = numbered("2");
    assert.deepEqual(orderNewOfferCopies([n4, piece, n2], "catalog", { primaryVendorByArea: primary }), [
      n2,
      piece,
      n4,
    ]);
  });
});

describe("ordering the new offer's copies in series order (#1869)", () => {
  const slot = (checklistId: string, position: number) => ({ checklistId, position });

  it("reads a series picked out of order in its checklist's order, the rest after by number", () => {
    // Checklist order is not catalogue order here: the block comes first on its checklist.
    const first = numbered("12");
    const second = numbered("10");
    const third = numbered("11");
    const loose2 = numbered("90");
    const loose1 = numbered("80");
    const slots = {
      [third.id]: [slot("set", 2)],
      [first.id]: [slot("set", 0)],
      [second.id]: [slot("set", 1)],
    };
    assert.deepEqual(
      orderNewOfferCopies([loose2, third, loose1, second, first], "series", {
        primaryVendorByArea: primary,
        checklistSlots: slots,
      }),
      [first, second, third, loose1, loose2]
    );
  });

  it("keeps two copies of one slot together, in the picked order", () => {
    const a = numbered("1");
    const b = numbered("2");
    const b2 = numbered("2");
    const slots = { [a.id]: [slot("set", 0)], [b.id]: [slot("set", 1)], [b2.id]: [slot("set", 1)] };
    assert.deepEqual(orderNewOfferCopies([b2, a, b], "series", { checklistSlots: slots }), [a, b2, b]);
  });

  it("puts each copy under the checklist holding most of the set, and orders checklists by number", () => {
    // `both` is on the small checklist and on the big one; the big one takes it.
    const big1 = numbered("20");
    const big2 = numbered("21");
    const both = numbered("22");
    const small = numbered("5");
    const slots = {
      [big1.id]: [slot("big", 0)],
      [big2.id]: [slot("big", 1)],
      [both.id]: [slot("small", 1), slot("big", 2)],
      [small.id]: [slot("small", 0)],
    };
    // The small checklist's lowest number (5) reads before the big one's (20).
    assert.deepEqual(
      orderNewOfferCopies([both, big2, small, big1], "series", {
        primaryVendorByArea: primary,
        checklistSlots: slots,
      }),
      [small, big1, big2, both]
    );
  });

  it("is catalogue-number order while no copy is on a checklist", () => {
    const n3 = numbered("3");
    const n1 = numbered("1");
    const n2 = numbered("2");
    assert.deepEqual(orderNewOfferCopies([n3, n1, n2], "series", { primaryVendorByArea: primary }), [n1, n2, n3]);
  });

  it("orders within each group when the list is grouped", () => {
    const a1 = numbered("2", { issueId: "A", issueName: "A" });
    const b1 = numbered("9", { issueId: "B", issueName: "B" });
    const a0 = numbered("1", { issueId: "A", issueName: "A" });
    const slots = { [a1.id]: [slot("A", 1)], [a0.id]: [slot("A", 0)] };
    const groups = groupNewOfferCopies(
      orderNewOfferCopies([a1, b1, a0], "series", { primaryVendorByArea: primary, checklistSlots: slots }),
      "issue"
    );
    assert.deepEqual(
      groups.map((g) => g.copies),
      [[a0, a1], [b1]]
    );
  });
});

// The filters and groups (#1795): what is shown, never what goes in.

describe("filterNewOfferCopies", () => {
  it("lets everything through with no filter on", () => {
    const copies = [copy(), copy()];
    assert.deepEqual(filterNewOfferCopies(copies, NO_NEW_OFFER_COPY_FILTERS), copies);
    assert.equal(newOfferCopyFiltersActive(NO_NEW_OFFER_COPY_FILTERS), false);
  });

  it("keeps only the copies of a stamp the offer holds more than once, whatever their condition", () => {
    const a = copy({ stampId: "A", conditionId: "mint" });
    const b = copy({ stampId: "B" });
    const a2 = copy({ stampId: "A", conditionId: "used" });
    const filtered = filterNewOfferCopies([a, b, a2], { ...NO_NEW_OFFER_COPY_FILTERS, duplicatesOnly: true });
    assert.deepEqual(filtered.map((c) => c.id), [a.id, a2.id]);
  });

  it("asks *duplicates* of the whole offer, so another filter hiding one copy keeps the other", () => {
    const a = copy({ stampId: "A", conditionId: "mint" });
    const a2 = copy({ stampId: "A", conditionId: "used" });
    const filtered = filterNewOfferCopies([a, a2], {
      ...NO_NEW_OFFER_COPY_FILTERS,
      duplicatesOnly: true,
      conditionIds: ["used"],
    });
    assert.deepEqual(filtered.map((c) => c.id), [a2.id]);
  });

  it("narrows to the conditions ticked", () => {
    const m = copy({ conditionId: "mint" });
    const u = copy({ conditionId: "used" });
    const h = copy({ conditionId: "hinged" });
    const filtered = filterNewOfferCopies([m, u, h], { ...NO_NEW_OFFER_COPY_FILTERS, conditionIds: ["used", "hinged"] });
    assert.deepEqual(filtered.map((c) => c.id), [u.id, h.id]);
  });

  it("keeps the copies worth at least the floor, and hides one with no catalogue value", () => {
    const cheap = priced("4.99");
    const even = priced("5.00");
    const dear = priced("20.00");
    const unpriced = copy();
    const filters = { ...NO_NEW_OFFER_COPY_FILTERS, minValue: "5" };
    assert.equal(newOfferCopyFiltersActive(filters), true);
    assert.deepEqual(filterNewOfferCopies([cheap, even, dear, unpriced], filters).map((c) => c.id), [even.id, dear.id]);
  });

  it("treats a blank, zero or unreadable floor as no floor", () => {
    const unpriced = copy();
    for (const minValue of ["", "  ", "0", "abc"]) {
      const filters = { ...NO_NEW_OFFER_COPY_FILTERS, minValue };
      assert.equal(newOfferCopyFiltersActive(filters), false, minValue);
      assert.deepEqual(filterNewOfferCopies([unpriced], filters), [unpriced], minValue);
    }
  });
});

describe("groupNewOfferCopies", () => {
  it("groups by issue in the order the first copy comes, the copies with no issue last", () => {
    const loose = copy();
    const x1 = priced("2.00", { issueId: "X", issueName: "Castles" });
    const y = priced("3.00", { issueId: "Y", issueName: "Birds" });
    const x2 = priced("5.00", { issueId: "X", issueName: "Castles" });
    const groups = groupNewOfferCopies([loose, x1, y, x2], "issue");
    assert.deepEqual(
      groups.map((g) => [g.label, g.copies.map((c) => c.id)]),
      [
        ["Castles", [x1.id, x2.id]],
        ["Birds", [y.id]],
        ["No issue", [loose.id]],
      ]
    );
    assert.equal(groups[0].summary.count, 2);
    assert.equal(groups[0].summary.catalogue.amount, "7.00");
  });

  it("groups by stamp so a stamp's copies sit together, a group summed at cost too", () => {
    const a = costing("1.50", { stampId: "A", stampName: "Eagle" });
    const b = copy({ stampId: "B", stampName: "Owl" });
    const a2 = costing("2.00", { stampId: "A", stampName: "Eagle" });
    const groups = groupNewOfferCopies([a, b, a2], "stamp");
    assert.deepEqual(
      groups.map((g) => [g.label, g.copies.map((c) => c.id)]),
      [
        ["Eagle", [a.id, a2.id]],
        ["Owl", [b.id]],
      ]
    );
    assert.equal(groups[0].summary.cost.amount, "3.50");
  });

  it("puts a multi-stamp piece with another carrying the same stamps", () => {
    const p1 = copy({ multiStamp: true, carriedStamps: [carried("A"), carried("B")] });
    const p2 = copy({ multiStamp: true, carriedStamps: [carried("B"), carried("A")] });
    assert.equal(groupNewOfferCopies([p1, p2], "stamp").length, 1);
  });
});
