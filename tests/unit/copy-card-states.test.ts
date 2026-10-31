import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SHOWN_HOLDING_STATES,
  countShown,
  hiddenCopiesText,
  holdingStateChips,
  parseShownHoldingStates,
  toggleShownHoldingState,
  writeShownHoldingStates,
} from "../../src/lib/copy-card-states";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";

// #2281: the Copies card's state chips on a stamp's and an issue's page — Held on by default, sold &
// traded and written off off, any number on together, remembered as one value.

describe("parseShownHoldingStates", () => {
  it("shows only held copies when nothing is stored", () => {
    assert.deepEqual(parseShownHoldingStates(null), ["held"]);
    assert.deepEqual(parseShownHoldingStates(""), [...DEFAULT_SHOWN_HOLDING_STATES]);
  });

  it("reads a stored choice in the states' order", () => {
    assert.deepEqual(parseShownHoldingStates("disposed,held"), ["held", "disposed"]);
  });

  it("reads every chip off as nothing shown", () => {
    assert.deepEqual(parseShownHoldingStates("none"), []);
  });

  it("falls back to the default when nothing named is a state", () => {
    assert.deepEqual(parseShownHoldingStates("lost,sold"), ["held"]);
  });
});

describe("writeShownHoldingStates", () => {
  it("stores the default as nothing", () => {
    assert.equal(writeShownHoldingStates(["held"]), "");
  });

  it("stores every chip off apart from the default", () => {
    assert.equal(writeShownHoldingStates([]), "none");
    assert.deepEqual(parseShownHoldingStates(writeShownHoldingStates([])), []);
  });

  it("round-trips any other choice", () => {
    for (const shown of [["gone"], ["held", "gone"], ["held", "gone", "disposed"]] as const) {
      assert.deepEqual(parseShownHoldingStates(writeShownHoldingStates(shown)), shown);
    }
  });
});

describe("toggleShownHoldingState", () => {
  it("adds and removes one state, keeping the others on", () => {
    assert.deepEqual(toggleShownHoldingState(["held"], "disposed"), ["held", "disposed"]);
    assert.deepEqual(toggleShownHoldingState(["held", "gone"], "held"), ["gone"]);
    assert.deepEqual(toggleShownHoldingState(["held"], "held"), []);
  });
});

describe("holdingStateChips", () => {
  it("gives a chip only to a state with copies, counting the possible ones too", () => {
    assert.deepEqual(
      holdingStateChips({ held: 3, gone: 0, disposed: 1 }, { held: 1, gone: 2, disposed: 0 }),
      [
        { state: "held", count: 4 },
        { state: "gone", count: 2 },
        { state: "disposed", count: 1 },
      ]
    );
    assert.deepEqual(holdingStateChips({ held: 0, gone: 2, disposed: 0 }, undefined), [
      { state: "gone", count: 2 },
    ]);
  });

  it("has no chip at all for a stamp never held", () => {
    assert.deepEqual(holdingStateChips({ held: 0, gone: 0, disposed: 0 }, undefined), []);
  });
});

describe("countShown", () => {
  it("counts the copies in the states switched on", () => {
    const counts = { held: 3, gone: 2, disposed: 1 };
    assert.equal(countShown(counts, ["held"]), 3);
    assert.equal(countShown(counts, ["gone", "disposed"]), 3);
    assert.equal(countShown(counts, []), 0);
    assert.equal(countShown(undefined, ["held"]), 0);
  });
});

describe("hiddenCopiesText", () => {
  it("names what the chips hide", () => {
    const chips = holdingStateChips({ held: 0, gone: 2, disposed: 1 });
    assert.equal(hiddenCopiesText(chips, ["held"]), "2 sold & traded, 1 written off hidden");
  });

  it("names held copies when Held is off", () => {
    const chips = holdingStateChips({ held: 3, gone: 0, disposed: 0 });
    assert.equal(hiddenCopiesText(chips, []), "3 held hidden");
  });
});

describe("readItemFilters' holding states", () => {
  it("asks for the named states, lifting both defaults that hide copies which have left", () => {
    const filters = readItemFilters(new URLSearchParams("stampId=s1&holdingStates=gone,disposed"));
    assert.deepEqual(filters.holdingStates, ["gone", "disposed"]);
    assert.equal(filters.excludeGone, undefined);
  });

  it("drops unknown states, and none left is the defaults", () => {
    const filters = readItemFilters(new URLSearchParams("holdingStates=lost"));
    assert.equal(filters.holdingStates, undefined);
    assert.equal(filters.excludeGone, true);
  });
});
