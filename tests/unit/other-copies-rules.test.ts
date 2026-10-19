import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HELD_DELIVERY_STATES,
  isOneStampsCopy,
  otherCopiesFilters,
} from "../../src/lib/other-copies-rules";

describe("the other copies of a copy's stamp (#2090)", () => {
  it("names the held delivery states, the in-flight ones included", () => {
    assert.deepEqual([...HELD_DELIVERY_STATES], ["ordered", "in_transit", "to_sort", "delivered"]);
  });

  it("filters to the stamp's own one-stamp copies in those states", () => {
    assert.deepEqual(otherCopiesFilters("s1"), {
      stampId: "s1",
      multiStamp: "exclude",
      deliveryStates: ["ordered", "in_transit", "to_sort", "delivered"],
    });
  });

  it("is shown for an ordinary copy and one settled within one variant tree", () => {
    assert.equal(isOneStampsCopy({ multiStamp: false, candidateTrees: 0 }), true);
    assert.equal(isOneStampsCopy({ multiStamp: false, candidateTrees: 1 }), true);
  });

  it("is not shown for a piece carrying several stamps, nor one possibly in several trees", () => {
    assert.equal(isOneStampsCopy({ multiStamp: true, candidateTrees: 0 }), false);
    assert.equal(isOneStampsCopy({ multiStamp: false, candidateTrees: 2 }), false);
  });
});
