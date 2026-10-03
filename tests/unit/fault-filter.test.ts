import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NO_FAULTS,
  appendFaultFilterParams,
  faultFilterFromParams,
  faultFilterWhere,
} from "../../src/lib/fault-filter";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";
import { REMEMBERED_FILTER_KEYS } from "../../src/app/c/[collectionSlug]/inventory/copies-list-filters";

// The Copies list's fault filter (#1557): any of the ticked faults, and *No faults* as a value of its
// own. The half that goes wrong silently is the sentinel — read as an id it would match nothing, and
// dropped it would widen the list to every copy.

describe("faultFilterFromParams", () => {
  const read = (qs: string) => faultFilterFromParams(new URLSearchParams(qs));

  it("is no filter when nothing is named", () => {
    assert.deepEqual(read(""), {});
    assert.deepEqual(read("faultIds="), {});
    assert.deepEqual(read("faultIds=,%20,"), {});
  });

  it("reads the ids, trimmed, with the sentinel among them", () => {
    assert.deepEqual(read("faultIds=a,%20b%20,none"), { faultIds: ["a", "b", "none"] });
  });

  it("round-trips through appendFaultFilterParams", () => {
    const params = new URLSearchParams();
    appendFaultFilterParams(params, { faultIds: ["a", NO_FAULTS] });
    assert.deepEqual(faultFilterFromParams(params), { faultIds: ["a", NO_FAULTS] });
    const empty = new URLSearchParams();
    appendFaultFilterParams(empty, { faultIds: [] });
    assert.equal(empty.toString(), "");
  });
});

describe("faultFilterWhere", () => {
  it("is null when the filter is off", () => {
    assert.equal(faultFilterWhere({}), null);
    assert.equal(faultFilterWhere({ faultIds: [] }), null);
  });

  it("asks for one fault with one `some`", () => {
    assert.deepEqual(faultFilterWhere({ faultIds: ["a"] }), {
      faults: { some: { faultId: "a" } },
    });
  });

  it("asks for any of several, never all of them", () => {
    assert.deepEqual(faultFilterWhere({ faultIds: ["a", "b", "a"] }), {
      faults: { some: { faultId: { in: ["a", "b"] } } },
    });
  });

  it("reads the sentinel alone as the copies with no fault", () => {
    assert.deepEqual(faultFilterWhere({ faultIds: [NO_FAULTS] }), { faults: { none: {} } });
  });

  it("ORs the sentinel beside real faults", () => {
    assert.deepEqual(faultFilterWhere({ faultIds: ["a", NO_FAULTS] }), {
      OR: [{ faults: { none: {} } }, { faults: { some: { faultId: "a" } } }],
    });
  });
});

describe("the Copies list and its fault filter", () => {
  it("reads faultIds off the list's query string", () => {
    assert.deepEqual(readItemFilters(new URLSearchParams("faultIds=a,none")).faultIds, ["a", "none"]);
    assert.equal(readItemFilters(new URLSearchParams("")).faultIds, undefined);
  });

  it("remembers the filter with the others, so an exact link clears it", () => {
    assert.ok((REMEMBERED_FILTER_KEYS as readonly string[]).includes("faultIds"));
  });
});
