import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateListingPreconditions,
  type PreconditionCopy,
  type PreconditionInput,
} from "../../src/lib/listing-preconditions";

let seq = 0;

function copy(over: Partial<PreconditionCopy> = {}): PreconditionCopy {
  seq += 1;
  return {
    itemId: `i${seq}`,
    label: `${seq}`,
    stampId: `s${seq}`,
    catalogItemId: `c${seq}`,
    conditionId: "cond-mnh",
    conditionName: "Mint Never Hinged",
    platformCondition: "1",
    ...over,
  };
}

function input(over: Partial<PreconditionInput> = {}): PreconditionInput {
  return {
    platformModule: "colnect",
    state: "ready",
    sets: [{ setId: "set-1", label: "Mi·PL 1-2", copies: [copy(), copy()] }],
    ...over,
  };
}

const codes = (i: PreconditionInput) => evaluateListingPreconditions(i).map((b) => b.code);

describe("evaluateListingPreconditions", () => {
  it("passes a Ready offer whose copies are all matched and graded", () => {
    assert.deepEqual(evaluateListingPreconditions(input()), []);
  });

  it("refuses a platform with no Assistant module, and says nothing else about the offer", () => {
    const blockers = evaluateListingPreconditions(
      input({
        platformModule: null,
        sets: [{ setId: "set-1", label: "A", copies: [copy({ catalogItemId: null })] }],
      })
    );
    assert.deepEqual(
      blockers.map((b) => b.code),
      ["no-platform-module"]
    );
    assert.match(blockers[0].message, /by hand/);
  });

  it("refuses a module with no listing half the same way (#471)", () => {
    // Allegro's marker names the marketplace a captured auction lot belongs to (#355); nothing here
    // posts a sale form to it, so its offers are not judged by Colnect's rules.
    const blockers = evaluateListingPreconditions(
      input({
        platformModule: "allegro",
        sets: [{ setId: "set-1", label: "A", copies: [copy({ catalogItemId: null })] }],
      })
    );
    assert.deepEqual(
      blockers.map((b) => b.code),
      ["no-platform-module"]
    );
  });

  it("refuses anything but Ready, and says which state it is in", () => {
    const blockers = evaluateListingPreconditions(input({ state: "preparing" }));
    assert.deepEqual(
      blockers.map((b) => b.code),
      ["not-ready"]
    );
    assert.match(blockers[0].message, /Preparing/);
  });

  it("reports only the state on an unfinished offer — the rest buries the one thing to do", () => {
    const blockers = evaluateListingPreconditions(
      input({
        state: "preparing",
        sets: [{ setId: "set-1", label: "A", copies: [copy({ catalogItemId: null })] }],
      })
    );
    assert.deepEqual(
      blockers.map((b) => b.code),
      ["not-ready"]
    );
  });

  it("refuses an offer with no copies", () => {
    assert.deepEqual(codes(input({ sets: [] })), ["no-sets"]);
    assert.deepEqual(codes(input({ sets: [{ setId: "s", label: "A", copies: [] }] })), ["no-sets"]);
  });

  it("names the stamps with no catalog item-ID, and carries their ids for the fix", () => {
    const missing = copy({ label: "12a", stampId: "stamp-12a", catalogItemId: null });
    const blockers = evaluateListingPreconditions(
      input({ sets: [{ setId: "set-1", label: "A", copies: [copy(), missing] }] })
    );
    assert.deepEqual(
      blockers.map((b) => b.code),
      ["missing-catalog-id"]
    );
    assert.deepEqual(blockers[0].subjects, ["12a"]);
    assert.deepEqual(blockers[0].stampIds, ["stamp-12a"]);
    assert.match(blockers[0].message, /One stamp has/);
  });

  it("names an unmapped condition by our own name, once however many copies carry it", () => {
    const used = () =>
      copy({ conditionId: "cond-u", conditionName: "Used", platformCondition: null });
    const blockers = evaluateListingPreconditions(
      input({ sets: [{ setId: "set-1", label: "A", copies: [used(), used(), copy()] }] })
    );
    assert.deepEqual(
      blockers.map((b) => b.code),
      ["unmapped-condition"]
    );
    assert.deepEqual(blockers[0].subjects, ["Used"]);
    assert.deepEqual(blockers[0].stampIds, []);
  });

  it("accepts sets holding the same goods in a different order — a quantity still describes them", () => {
    const a = copy({ catalogItemId: "111" });
    const b = copy({ catalogItemId: "222" });
    const c = copy({ catalogItemId: "222" });
    const d = copy({ catalogItemId: "111" });
    assert.deepEqual(
      codes(
        input({
          sets: [
            { setId: "set-1", label: "A", copies: [a, b] },
            { setId: "set-2", label: "B", copies: [c, d] },
          ],
        })
      ),
      []
    );
  });

  it("refuses sets that differ in their catalog items, naming the ones that differ", () => {
    const blockers = evaluateListingPreconditions(
      input({
        sets: [
          { setId: "set-1", label: "Mi·PL 1", copies: [copy({ catalogItemId: "111" })] },
          { setId: "set-2", label: "Mi·PL 2", copies: [copy({ catalogItemId: "222" })] },
        ],
      })
    );
    assert.deepEqual(
      blockers.map((b) => b.code),
      ["mixed-sets"]
    );
    assert.deepEqual(blockers[0].subjects, ["Mi·PL 2"]);
    assert.match(blockers[0].message, /Mi·PL 1/);
  });

  it("refuses sets that differ only in condition — the same stamps in two grades are two goods", () => {
    assert.deepEqual(
      codes(
        input({
          sets: [
            { setId: "set-1", label: "A", copies: [copy({ catalogItemId: "111" })] },
            {
              setId: "set-2",
              label: "B",
              copies: [
                copy({
                  catalogItemId: "111",
                  conditionId: "cond-u",
                  conditionName: "Used",
                  platformCondition: "4",
                }),
              ],
            },
          ],
        })
      ),
      ["mixed-sets"]
    );
  });

  it("refuses sets of different size", () => {
    assert.deepEqual(
      codes(
        input({
          sets: [
            { setId: "set-1", label: "A", copies: [copy({ catalogItemId: "111" })] },
            {
              setId: "set-2",
              label: "B",
              copies: [copy({ catalogItemId: "111" }), copy({ catalogItemId: "111" })],
            },
          ],
        })
      ),
      ["mixed-sets"]
    );
  });

  it("never calls two unmatched sets interchangeable on the strength of two nulls", () => {
    assert.deepEqual(
      codes(
        input({
          sets: [
            { setId: "set-1", label: "A", copies: [copy({ catalogItemId: null })] },
            { setId: "set-2", label: "B", copies: [copy({ catalogItemId: null })] },
          ],
        })
      ),
      ["missing-catalog-id", "mixed-sets"]
    );
  });

  it("ignores an empty set when comparing — it lists nothing and quantity does not count it", () => {
    assert.deepEqual(
      codes(
        input({
          sets: [
            { setId: "set-1", label: "A", copies: [copy({ catalogItemId: "111" })] },
            { setId: "set-2", label: "B", copies: [] },
          ],
        })
      ),
      []
    );
  });

  it("reports every failing precondition at once — they are fixed in different places", () => {
    assert.deepEqual(
      codes(
        input({
          sets: [
            {
              setId: "set-1",
              label: "A",
              copies: [copy({ catalogItemId: null, platformCondition: null })],
            },
            { setId: "set-2", label: "B", copies: [copy({ catalogItemId: "222" })] },
          ],
        })
      ),
      ["missing-catalog-id", "unmapped-condition", "mixed-sets"]
    );
  });
});
