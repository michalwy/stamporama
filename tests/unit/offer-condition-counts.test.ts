import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { offerConditionCounts, type ConditionedCopy } from "../../src/lib/offer-condition-counts";

// The conditions a Prepare row shows (#1941): each once, with its count, in dictionary order.

const MNH = { abbreviation: "MNH", name: "Mint never hinged", sortOrder: 0 };
const MH = { abbreviation: "MH", name: "Mint hinged", sortOrder: 1 };
const USED = { abbreviation: "U", name: "Used", sortOrder: 2 };

function copy(conditionId: string, condition: ConditionedCopy["condition"]): ConditionedCopy {
  return { conditionId, condition };
}

describe("offerConditionCounts", () => {
  it("counts each condition once, in the dictionary's order rather than the copies'", () => {
    const counts = offerConditionCounts([
      copy("u", USED),
      copy("mh", MH),
      copy("mnh", MNH),
      copy("mnh", MNH),
      copy("mnh", MNH),
    ]);
    assert.deepEqual(counts, [
      { id: "mnh", abbreviation: "MNH", name: "Mint never hinged", count: 3 },
      { id: "mh", abbreviation: "MH", name: "Mint hinged", count: 1 },
      { id: "u", abbreviation: "U", name: "Used", count: 1 },
    ]);
  });

  it("says nothing for an offer with no copies", () => {
    assert.deepEqual(offerConditionCounts([]), []);
  });

  it("keeps two conditions sharing a sort position apart, by abbreviation", () => {
    const counts = offerConditionCounts([copy("b", { ...MH, abbreviation: "B" }), copy("a", { ...MH, abbreviation: "A" })]);
    assert.deepEqual(
      counts.map((c) => c.abbreviation),
      ["A", "B"]
    );
  });
});
