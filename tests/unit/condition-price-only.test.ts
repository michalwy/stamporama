import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COPY_CONDITION_WHERE, conditionRecordUsesText } from "../../src/lib/condition-price-only";

// A condition that is a price column only (#2374): the filter every copy-side check spreads, and the
// sentence that refuses to mark one already in use. The rows, the pickers and the refusal itself are
// in `tests/integration/price-only-conditions.test.ts`.

describe("price-column-only conditions (#2374)", () => {
  it("lets a copy-side check match only conditions a copy can be in", () => {
    assert.deepEqual(COPY_CONDITION_WHERE, { priceOnly: false });
  });

  it("names what uses the condition, one or several of each", () => {
    assert.equal(
      conditionRecordUsesText([
        { kind: "copies", count: 3 },
        { kind: "wants", count: 1 },
        { kind: "Colnect condition mappings", count: 1 },
      ]),
      "This condition cannot be a price column only while it is used by 3 copies, 1 want, 1 Colnect condition mapping."
    );
  });
});
