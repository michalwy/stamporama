import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ATTACH_FILTERS,
  effectiveAttachStates,
  matchesAttachFilters,
  parseAttachFilters,
  readAttachStates,
  serializeAttachFilters,
  toggleValue,
  type AttachFilterCopy,
  type AttachPickerFilters,
} from "../../src/lib/attach-picker-filters";

// The Attach existing copies picker's own filters (#2121): condition, certificate and format with
// their null sentinels, the purchase chips, and the state the server reads (#2120).

const copy = (over: Partial<AttachFilterCopy> = {}): AttachFilterCopy => ({
  conditionId: "mint",
  certificateStatusId: null,
  formatId: null,
  purchase: null,
  ...over,
});
const withFilters = (over: Partial<AttachPickerFilters>): AttachPickerFilters => ({
  ...DEFAULT_ATTACH_FILTERS,
  ...over,
});

describe("matchesAttachFilters (#2121)", () => {
  it("passes every copy with no filter set", () => {
    assert.ok(matchesAttachFilters(copy(), DEFAULT_ATTACH_FILTERS));
    assert.ok(matchesAttachFilters(copy({ purchase: { id: "p" } }), DEFAULT_ATTACH_FILTERS));
  });

  it("narrows by condition", () => {
    const f = withFilters({ conditionIds: ["used"] });
    assert.ok(!matchesAttachFilters(copy(), f));
    assert.ok(matchesAttachFilters(copy({ conditionId: "used" }), f));
  });

  it("reads No certificate and Single as values, alone or beside a real one", () => {
    const none = withFilters({ certificateStatusIds: ["none"] });
    assert.ok(matchesAttachFilters(copy(), none));
    assert.ok(!matchesAttachFilters(copy({ certificateStatusId: "cert" }), none));
    const both = withFilters({ certificateStatusIds: ["none", "cert"] });
    assert.ok(matchesAttachFilters(copy({ certificateStatusId: "cert" }), both));

    const single = withFilters({ formatIds: ["single"] });
    assert.ok(matchesAttachFilters(copy(), single));
    assert.ok(!matchesAttachFilters(copy({ formatId: "pair" }), single));
    assert.ok(matchesAttachFilters(copy({ formatId: "pair" }), withFilters({ formatIds: ["pair"] })));
  });

  it("separates the copies on no purchase from those on one, and shows both with both or neither lit", () => {
    const loose = copy();
    const filed = copy({ purchase: { id: "p" } });
    const none = withFilters({ purchase: ["none"] });
    const on = withFilters({ purchase: ["on"] });
    const both = withFilters({ purchase: ["none", "on"] });
    assert.ok(matchesAttachFilters(loose, none) && !matchesAttachFilters(filed, none));
    assert.ok(matchesAttachFilters(filed, on) && !matchesAttachFilters(loose, on));
    assert.ok(matchesAttachFilters(loose, both) && matchesAttachFilters(filed, both));
  });
});

describe("the state filter (#2120)", () => {
  it("opens on the held copies", () => {
    assert.deepEqual(DEFAULT_ATTACH_FILTERS.states, ["held"]);
    assert.deepEqual(parseAttachFilters(null).states, ["held"]);
  });

  it("asks for every state when no chip is lit, in a fixed order otherwise", () => {
    assert.deepEqual(effectiveAttachStates([]), ["held", "gone", "disposed"]);
    assert.deepEqual(effectiveAttachStates(["disposed", "held"]), ["held", "disposed"]);
  });

  it("reads the route's states, dropping unknown ones, and none as held", () => {
    assert.deepEqual(readAttachStates(["gone", "nonsense"]), ["gone"]);
    assert.deepEqual(readAttachStates([]), ["held"]);
    assert.deepEqual(readAttachStates(["nonsense"]), ["held"]);
  });
});

describe("remembered filters (#2121)", () => {
  it("round-trips, keeping an emptied state set as every state", () => {
    const f = withFilters({ conditionIds: ["a"], purchase: ["none"], states: [] });
    assert.deepEqual(parseAttachFilters(serializeAttachFilters(f)), f);
  });

  it("falls back to the default on anything unreadable", () => {
    assert.deepEqual(parseAttachFilters("{not json"), DEFAULT_ATTACH_FILTERS);
    assert.deepEqual(parseAttachFilters("42"), DEFAULT_ATTACH_FILTERS);
    assert.deepEqual(parseAttachFilters("{}"), DEFAULT_ATTACH_FILTERS);
    assert.deepEqual(
      parseAttachFilters(JSON.stringify({ purchase: ["sideways", "on"], states: ["lost"] })).purchase,
      ["on"]
    );
  });

  it("toggles a chip on and off", () => {
    assert.deepEqual(toggleValue(["held"], "gone"), ["held", "gone"]);
    assert.deepEqual(toggleValue(["held", "gone"], "held"), ["gone"]);
  });
});

describe("a stored state list with nothing recognisable (#2121)", () => {
  it("is the default, not every state", () => {
    assert.deepEqual(parseAttachFilters(JSON.stringify({ states: ["lost"] })).states, ["held"]);
  });
});
