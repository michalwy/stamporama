import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  heldConditionsText,
  summarizeHeldCopies,
  type HeldCopyRow,
} from "../../src/lib/held-copies";

// The collection's condition dictionary, in display order — what the intake dialog fills its
// Condition select from, and therefore the order the line lists conditions in.
const ORDER = ["mnh", "mh", "u"];
const NAMES: Record<string, string> = { mnh: "MNH", mh: "MH", u: "U" };
const nameFor = (id: string) => NAMES[id] ?? "?";

/** Delivered unless the case says otherwise — the ordinary copy, already filed. */
function row(partial: Partial<HeldCopyRow> & { conditionId: string; count: number }): HeldCopyRow {
  return {
    deliveryState: "delivered",
    inCollection: false,
    forSale: false,
    forTrade: false,
    ...partial,
  };
}

/** The whole line as the component reads it, so the assertions state what the collector sees. */
function line(rows: HeldCopyRow[]): string {
  const summary = summarizeHeldCopies(rows, ORDER);
  if (summary.total === 0 && summary.inFlight.length === 0) return "You hold none of this yet.";
  const head =
    summary.total === 0
      ? "You hold none"
      : `You hold ${summary.total}${summary.markers.length > 0 ? ":" : ""}`;
  const markers = summary.markers
    .map((m) => `${m.count} ${m.label} (${heldConditionsText(m, nameFor)})`)
    .join(" · ");
  // Each in-flight clause carries its own leading separator, as the component draws it: it may
  // follow the headline directly when nothing is held.
  const inFlight = summary.inFlight
    .map((b) => ` · ${b.count} ${b.label} (${heldConditionsText(b, nameFor)})`)
    .join("");
  return `${head}${markers ? ` ${markers}` : ""}${inFlight}`;
}

describe("summarizeHeldCopies", () => {
  it("reports nothing held for no rows", () => {
    const summary = summarizeHeldCopies([], ORDER);
    assert.equal(summary.total, 0);
    assert.deepEqual(summary.markers, []);
  });

  it("states the issue's own example", () => {
    assert.equal(
      line([
        row({ conditionId: "mnh", count: 1, inCollection: true }),
        row({ conditionId: "u", count: 1, forSale: true }),
      ]),
      "You hold 2: 1 in collection (MNH) · 1 for sale (U)"
    );
  });

  it("says nothing at all when there is neither a held nor an in-flight copy", () => {
    assert.equal(line([]), "You hold none of this yet.");
  });

  it("keeps a copy still in the post out of the headline", () => {
    // The auction-settlement case: the only identified copy is `ordered`, every disposition flag
    // false. Counted as bought — it is — but never as one you hold, and with no marker, since an
    // unset flag is not a decision.
    assert.equal(
      line([row({ conditionId: "mnh", count: 1, deliveryState: "ordered" })]),
      "You hold none · 1 on its way (MNH)"
    );
  });

  it("gives an unsorted copy a clause of its own, beside what is held", () => {
    // The second copy from the stockbook being worked through right now: physically on the desk,
    // not filed. Neither "you hold it" nor "it is coming".
    assert.equal(
      line([
        row({ conditionId: "mnh", count: 1, inCollection: true }),
        row({ conditionId: "u", count: 1, deliveryState: "to_sort", forSale: true }),
      ]),
      "You hold 1: 1 in collection (MNH) · 1 being sorted (U)"
    );
  });

  it("orders the in-flight clauses furthest-away-last, whatever order the rows arrive in", () => {
    assert.equal(
      line([
        row({ conditionId: "u", count: 1, deliveryState: "ordered" }),
        row({ conditionId: "mnh", count: 2, deliveryState: "to_sort" }),
        row({ conditionId: "mh", count: 1, deliveryState: "in_transit" }),
        row({ conditionId: "mnh", count: 1, inCollection: true }),
      ]),
      "You hold 1: 1 in collection (MNH) · 2 being sorted (MNH) · 1 in the post (MH) · 1 on its way (U)"
    );
  });

  it("counts an unrecognised delivery state as held rather than dropping the copy", () => {
    const summary = summarizeHeldCopies(
      [row({ conditionId: "mnh", count: 1, deliveryState: "whatever", inCollection: true })],
      ORDER
    );
    assert.equal(summary.total, 1);
    assert.deepEqual(summary.inFlight, []);
  });

  it("counts an overlapping copy once in the total and under both markers", () => {
    // A copy can be in the collection *and* for sale, so the markers are not a partition — which is
    // precisely why the total is counted from the rows rather than summed from the markers.
    const summary = summarizeHeldCopies(
      [row({ conditionId: "mnh", count: 1, inCollection: true, forSale: true })],
      ORDER
    );
    assert.equal(summary.total, 1);
    assert.deepEqual(
      summary.markers.map((m) => [m.key, m.count]),
      [
        ["inCollection", 1],
        ["forSale", 1],
      ]
    );
  });

  it("counts copies carrying no disposition rather than subtracting them", () => {
    const summary = summarizeHeldCopies(
      [
        row({ conditionId: "mnh", count: 2, inCollection: true, forSale: true }),
        row({ conditionId: "u", count: 1 }),
      ],
      ORDER
    );
    assert.equal(summary.total, 3);
    // Two overlapping markers over the same 2 copies leave the unmarked figure underivable from the
    // total: 2 + 2 against a total of 3 says nothing about how the copies pair up.
    assert.deepEqual(
      summary.markers.map((m) => [m.key, m.count]),
      [
        ["inCollection", 2],
        ["forSale", 2],
        ["unmarked", 1],
      ]
    );
  });

  it("lists a marker's conditions in the dictionary's own order, never by how many are held", () => {
    // `sortOrder` is display order and not a quality scale (ADR-0032), so nothing here ranks: `U`
    // trails `MNH` because the dictionary puts it there, not because three of them were found.
    const summary = summarizeHeldCopies(
      [
        row({ conditionId: "u", count: 3, inCollection: true }),
        row({ conditionId: "mnh", count: 1, inCollection: true }),
      ],
      ORDER
    );
    assert.deepEqual(summary.markers[0].conditions, [
      { conditionId: "mnh", count: 1 },
      { conditionId: "u", count: 3 },
    ]);
  });

  it("adds up two rows of one condition that differ only in disposition", () => {
    const summary = summarizeHeldCopies(
      [
        row({ conditionId: "mnh", count: 1, inCollection: true }),
        row({ conditionId: "mnh", count: 2, inCollection: true, forTrade: true }),
      ],
      ORDER
    );
    assert.deepEqual(summary.markers[0], {
      key: "inCollection",
      token: "collection",
      label: "in collection",
      count: 3,
      conditions: [{ conditionId: "mnh", count: 3 }],
    });
  });

  it("keeps a condition the dictionary no longer lists, sorted last", () => {
    // The copy is held whatever became of the dictionary row; dropping it would understate the
    // holding, which is the one thing this line must never do.
    const summary = summarizeHeldCopies(
      [
        row({ conditionId: "gone", count: 1, forSale: true }),
        row({ conditionId: "mnh", count: 1, forSale: true }),
      ],
      ORDER
    );
    assert.deepEqual(
      summary.markers[0].conditions.map((c) => c.conditionId),
      ["mnh", "gone"]
    );
  });
});

describe("heldConditionsText", () => {
  it("names the condition alone while there is only one, however many copies are in it", () => {
    // The clause's own count has already said how many; `2 in collection (2 MNH)` says it twice.
    const one = summarizeHeldCopies(
      [row({ conditionId: "mnh", count: 2, inCollection: true })],
      ORDER
    );
    assert.equal(heldConditionsText(one.markers[0], nameFor), "MNH");

    const several = summarizeHeldCopies(
      [
        row({ conditionId: "mnh", count: 3, inCollection: true }),
        row({ conditionId: "u", count: 1, inCollection: true }),
      ],
      ORDER
    );
    assert.equal(heldConditionsText(several.markers[0], nameFor), "3 MNH, 1 U");
  });
});
