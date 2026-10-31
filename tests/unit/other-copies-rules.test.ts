import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HELD_DELIVERY_STATES,
  familyUmbrellaId,
  otherCopiesFilters,
  otherCopiesStampIds,
} from "../../src/lib/other-copies-rules";

describe("the other copies of a copy's stamp (#2090, #2282)", () => {
  it("names the held delivery states, the in-flight ones included", () => {
    assert.deepEqual([...HELD_DELIVERY_STATES], ["ordered", "in_transit", "to_sort", "delivered"]);
  });

  it("filters to the family's one-stamp copies in those states, less the copy itself", () => {
    assert.deepEqual(otherCopiesFilters(["s1", "s1a"], "c1"), {
      stampIds: ["s1", "s1a"],
      excludeIds: ["c1"],
      multiStamp: "exclude",
      deliveryStates: ["ordered", "in_transit", "to_sort", "delivered"],
    });
  });

  it("asks for the holding states the chips have on, and leaves them to the counts when absent", () => {
    assert.deepEqual(otherCopiesFilters(["s1"], "c1", ["held", "gone"]).holdingStates, [
      "held",
      "gone",
    ]);
    assert.equal("holdingStates" in otherCopiesFilters(["s1"], "c1"), false);
  });
});

describe("a stamp family's umbrella (#2282)", () => {
  it("is the stamp itself when it is no variant", () => {
    assert.equal(familyUmbrellaId([{ id: "base", isVariant: false }]), "base");
  });

  it("is the first ancestor that is no variant, over a variant of a variant", () => {
    assert.equal(
      familyUmbrellaId([
        { id: "v2", isVariant: true },
        { id: "v1", isVariant: true },
        { id: "base", isVariant: false },
        { id: "above", isVariant: false },
      ]),
      "base"
    );
  });

  it("stops at a distinct entry, which heads its own family", () => {
    assert.equal(
      familyUmbrellaId([
        { id: "error", isVariant: false },
        { id: "base", isVariant: false },
      ]),
      "error"
    );
  });

  it("ends at the top of a chain of variants", () => {
    assert.equal(familyUmbrellaId([{ id: "v", isVariant: true }]), "v");
  });
});

describe("the groups of the Other copies card (#2282)", () => {
  const copy = {
    stampId: "s1",
    multiStamp: false,
    candidateTrees: 0,
    carriedStamps: [] as { stampId: string }[],
  };

  it("is one group for an ordinary copy and one settled within one variant tree", () => {
    assert.deepEqual(otherCopiesStampIds(copy), ["s1"]);
    assert.deepEqual(otherCopiesStampIds({ ...copy, candidateTrees: 1 }), ["s1"]);
  });

  it("is one group per stamp a cover carries, each once, in its order", () => {
    assert.deepEqual(
      otherCopiesStampIds({
        ...copy,
        multiStamp: true,
        carriedStamps: [{ stampId: "s2" }, { stampId: "s1" }, { stampId: "s2" }],
      }),
      ["s2", "s1"]
    );
  });

  it("is none for a copy possibly in several variant trees", () => {
    assert.deepEqual(otherCopiesStampIds({ ...copy, candidateTrees: 2 }), []);
  });
});
