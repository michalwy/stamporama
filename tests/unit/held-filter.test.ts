import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  asHeldFilter,
  heldSplitParam,
  heldStackKeys,
  inHeldStack,
  readHeldSplit,
  stackMatchesHeld,
} from "../../src/lib/held-filter";
import { DEFAULT_GROUP_AXES, type CopyGroupAxes, type GroupableCopy } from "../../src/lib/copy-groups";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";
import { REMEMBERED_FILTER_KEYS } from "../../src/app/c/[collectionSlug]/inventory/copies-list-filters";

// The Copies list's *Held* filter (#1932) — the pure half: what a query-string value reads as, and
// which stacks each value keeps, counted by the very key duplicate grouping groups on.

const copy = (stampId: string, conditionId: string, formatId: string | null = null): GroupableCopy => ({
  stampId,
  conditionId,
  formatId,
  certificateStatusId: null,
});

describe("asHeldFilter", () => {
  it("reads the two values the filter has", () => {
    assert.equal(asHeldFilter("once"), "once");
    assert.equal(asHeldFilter("several"), "several");
  });

  it("reads anything else as no filter, never as an unmatchable one", () => {
    for (const value of [null, undefined, "", "any", "ONCE", "2"]) {
      assert.equal(asHeldFilter(value), undefined, String(value));
    }
  });
});

describe("stackMatchesHeld", () => {
  it("keeps a stack of one under *once* and of two or more under *several*", () => {
    assert.equal(stackMatchesHeld(1, "once"), true);
    assert.equal(stackMatchesHeld(2, "once"), false);
    assert.equal(stackMatchesHeld(1, "several"), false);
    assert.equal(stackMatchesHeld(2, "several"), true);
    assert.equal(stackMatchesHeld(7, "several"), true);
  });
});

describe("the split switches on the query string", () => {
  it("round-trips every combination", () => {
    for (const condition of [false, true]) {
      for (const format of [false, true]) {
        for (const certificate of [false, true]) {
          const axes: CopyGroupAxes = { condition, format, certificate };
          assert.deepEqual(readHeldSplit(heldSplitParam(axes)), axes);
        }
      }
    }
  });

  it("reads absent or empty as one stack per stamp", () => {
    assert.deepEqual(readHeldSplit(null), DEFAULT_GROUP_AXES);
    assert.deepEqual(readHeldSplit(""), DEFAULT_GROUP_AXES);
  });
});

describe("heldStackKeys", () => {
  // Stamp A: MNH single, MNH pair, MH single. Stamp B: MNH single.
  const copies = [copy("A", "mnh"), copy("A", "mnh", "pair"), copy("A", "mh"), copy("B", "mnh")];

  it("counts one stack per stamp with every switch off", () => {
    const several = heldStackKeys(copies, DEFAULT_GROUP_AXES, "several");
    assert.deepEqual(copies.map((c) => inHeldStack(c, DEFAULT_GROUP_AXES, several)), [true, true, true, false]);
    const once = heldStackKeys(copies, DEFAULT_GROUP_AXES, "once");
    assert.deepEqual(copies.map((c) => inHeldStack(c, DEFAULT_GROUP_AXES, once)), [false, false, false, true]);
  });

  it("splits the stacks by condition when that switch is on", () => {
    const axes = { ...DEFAULT_GROUP_AXES, condition: true };
    const several = heldStackKeys(copies, axes, "several");
    assert.deepEqual(copies.map((c) => inHeldStack(c, axes, several)), [true, true, false, false]);
  });

  it("splits by condition and format together", () => {
    const axes = { ...DEFAULT_GROUP_AXES, condition: true, format: true };
    assert.equal(heldStackKeys(copies, axes, "several").size, 0, "every stack is now a single");
    assert.equal(heldStackKeys(copies, axes, "once").size, 4);
  });

  it("keeps a copy outside the counted set by its stack — a narrower read keeps what the list kept", () => {
    const several = heldStackKeys(copies, DEFAULT_GROUP_AXES, "several");
    assert.equal(inHeldStack(copy("A", "mh", "block"), DEFAULT_GROUP_AXES, several), true);
    assert.equal(inHeldStack(copy("C", "mnh"), DEFAULT_GROUP_AXES, several), false);
  });
});

describe("the Held filter on the query string", () => {
  it("is read by the routes' one parser, with its switches only while it is on", () => {
    const on = readItemFilters(new URLSearchParams("held=several&heldSplit=condition,format"));
    assert.equal(on.held, "several");
    assert.deepEqual(on.heldAxes, { condition: true, format: true, certificate: false });
    const off = readItemFilters(new URLSearchParams("heldSplit=condition"));
    assert.equal(off.held, undefined);
    assert.equal(off.heldAxes, undefined);
  });

  it("reads a group's member read's list filters as the scope it counts over", () => {
    const list = new URLSearchParams("held=once&locationId=box");
    const filters = readItemFilters(
      new URLSearchParams(`held=once&locationId=album&locationExact=true&heldWithin=${encodeURIComponent(list.toString())}`)
    );
    assert.equal(filters.heldScope?.locationId, "box");
    assert.equal(filters.heldScope?.locationExact, undefined);
    assert.equal(filters.heldScope?.held, "once");
  });

  it("is absent from a link that does not name it, or names nonsense", () => {
    assert.equal(readItemFilters(new URLSearchParams("")).held, undefined);
    assert.equal(readItemFilters(new URLSearchParams("held=twice")).held, undefined);
  });

  it("is remembered with the list's other filters, so Reset filters clears it", () => {
    assert.ok((REMEMBERED_FILTER_KEYS as readonly string[]).includes("held"));
  });
});
