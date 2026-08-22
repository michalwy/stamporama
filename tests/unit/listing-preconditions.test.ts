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
    certificateStatusId: null,
    formatId: null,
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
    // A module carrying capture alone (#355) posts no sale form, so its offers are not judged by
    // anyone's listing rules.
    const blockers = evaluateListingPreconditions(
      input({
        platformModule: "captures-only",
        sets: [{ setId: "set-1", label: "A", copies: [copy({ catalogItemId: null })] }],
      })
    );
    assert.deepEqual(
      blockers.map((b) => b.code),
      ["no-platform-module"]
    );
  });

  it("names the screen its own module maps grades on", () => {
    const blockers = evaluateListingPreconditions(
      input({
        sets: [{ setId: "set-1", label: "A", copies: [copy({ platformCondition: null })] }],
      })
    );
    assert.match(blockers[0].message, /Settings → Colnect/);
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

  // #617 — the two ways an unknown-variant umbrella fails to resolve an item-ID through the price
  // rollup (#616). Each is fixed on a different screen, so each has to be its own line.
  describe("an umbrella whose item-ID could not be derived", () => {
    it("names the cheapest variant, not the umbrella, when that variant is unmatched", () => {
      const umbrella = copy({
        label: "865",
        stampId: "stamp-865",
        catalogItemId: null,
        catalogRollup: { kind: "unmatched-variant", stampId: "stamp-865a", label: "Mi·PL 865a" },
      });
      const blockers = evaluateListingPreconditions(
        input({ sets: [{ setId: "set-1", label: "A", copies: [umbrella] }] })
      );
      assert.deepEqual(
        blockers.map((b) => b.code),
        ["missing-catalog-id"]
      );
      // The variant is the stamp an item-ID would be recorded on, so it is what the match window has
      // to be pointed at — the umbrella never gets one written to it (#616).
      assert.deepEqual(blockers[0].subjects, ["Mi·PL 865a"]);
      assert.deepEqual(blockers[0].stampIds, ["stamp-865a"]);
      assert.deepEqual(blockers[0].stampSubjects, [
        { stampId: "stamp-865a", label: "Mi·PL 865a" },
      ]);
    });

    it("names the unpriced variants, which is what wants a price and what links away", () => {
      const umbrella = () =>
        copy({
          label: "870",
          stampId: "stamp-870",
          catalogItemId: null,
          catalogRollup: {
            kind: "unpriced-variants",
            variants: [
              { stampId: "stamp-870a", label: "Mi\u00b7PL 870a" },
              { stampId: "stamp-870c", label: "Mi\u00b7PL 870c" },
            ],
          },
        });
      const blockers = evaluateListingPreconditions(
        input({ sets: [{ setId: "set-1", label: "A", copies: [umbrella(), umbrella()] }] })
      );
      assert.deepEqual(
        blockers.map((b) => b.code),
        ["no-variant-price"]
      );
      // The umbrella is not named: it is not what a price is recorded on, and each variant has a
      // price grid of its own to go to. Named once however many copies carry it.
      assert.deepEqual(blockers[0].subjects, ["Mi\u00b7PL 870a", "Mi\u00b7PL 870c"]);
      assert.deepEqual(blockers[0].stampIds, ["stamp-870a", "stamp-870c"]);
      // Each variant carries the axes of the copy it was reported for (#633) — the cell the listing
      // is blocked on, which is what the price grid behind the link opens narrowed to — and the
      // **umbrella** it is a variant of (#679), which is the tree that grid draws: a grid holding
      // this one variant's row could not close the fault, the cheapest variant being unknowable
      // until its siblings are priced too.
      assert.deepEqual(blockers[0].stampSubjects, [
        {
          stampId: "stamp-870a",
          label: "Mi\u00b7PL 870a",
          axes: { conditionId: "cond-mnh", certificateStatusId: null, formatId: null },
          treeStampId: "stamp-870",
        },
        {
          stampId: "stamp-870c",
          label: "Mi\u00b7PL 870c",
          axes: { conditionId: "cond-mnh", certificateStatusId: null, formatId: null },
          treeStampId: "stamp-870",
        },
      ]);
      assert.match(blockers[0].message, /cheapest variant/);
    });

    it("reports each unpriced variant at the axes of the copy that raised it (#633)", () => {
      const blockers = evaluateListingPreconditions(
        input({
          sets: [
            {
              setId: "set-1",
              label: "A",
              copies: [
                copy({
                  stampId: "stamp-870",
                  catalogItemId: null,
                  conditionId: "cond-u",
                  conditionName: "Used",
                  certificateStatusId: "cert-1",
                  formatId: "fmt-block",
                  catalogRollup: {
                    kind: "unpriced-variants",
                    variants: [{ stampId: "stamp-870a", label: "Mi\u00b7PL 870a" }],
                  },
                }),
                // The same variant at a second grade: the first copy's answer stands, exactly as it
                // does for the label the variant is named under.
                copy({
                  catalogItemId: null,
                  catalogRollup: {
                    kind: "unpriced-variants",
                    variants: [{ stampId: "stamp-870a", label: "Mi\u00b7PL 870a" }],
                  },
                }),
              ],
            },
          ],
        })
      );
      assert.deepEqual(blockers[0].stampSubjects, [
        {
          stampId: "stamp-870a",
          label: "Mi\u00b7PL 870a",
          axes: {
            conditionId: "cond-u",
            certificateStatusId: "cert-1",
            formatId: "fmt-block",
          },
          // The first copy's umbrella too, deduplicated on the same first-seen rule (#679).
          treeStampId: "stamp-870",
        },
      ]);
    });

    it("states the two apart rather than as one line — they are fixed in different places", () => {
      const unmatched = copy({
        catalogItemId: null,
        catalogRollup: { kind: "unmatched-variant", stampId: "stamp-865a", label: "Mi·PL 865a" },
      });
      const unpriced = copy({
        catalogItemId: null,
        catalogRollup: {
          kind: "unpriced-variants",
          variants: [{ stampId: "stamp-870a", label: "Mi\u00b7PL 870a" }],
        },
      });
      assert.deepEqual(
        codes(input({ sets: [{ setId: "set-1", label: "A", copies: [unmatched, unpriced] }] })),
        ["missing-catalog-id", "no-variant-price"]
      );
    });

    it("reports a plain unmatched stamp against itself, rollup or no rollup", () => {
      // An umbrella whose own catalogue price won the valuation was never rolled up (#616's
      // precedence), so there is no gap to report and the umbrella is what wants matching.
      const blockers = evaluateListingPreconditions(
        input({
          sets: [
            {
              setId: "set-1",
              label: "A",
              copies: [copy({ label: "880", stampId: "stamp-880", catalogItemId: null })],
            },
          ],
        })
      );
      assert.deepEqual(
        blockers.map((b) => b.code),
        ["missing-catalog-id"]
      );
      assert.deepEqual(blockers[0].stampIds, ["stamp-880"]);
    });

    it("asks neither of a module that lists against no catalogue (#493)", () => {
      assert.deepEqual(
        codes(
          input({
            platformModule: "allegro",
            sets: [
              {
                setId: "set-1",
                label: "A",
                copies: [
                  copy({
                    catalogItemId: null,
                    catalogRollup: {
                      kind: "unpriced-variants",
                      variants: [{ stampId: "stamp-870a", label: "Mi\u00b7PL 870a" }],
                    },
                  }),
                ],
              },
            ],
          })
        ),
        []
      );
    });
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

  it("asks an Allegro offer none of Colnect's questions, and still asks its own (#493)", () => {
    // Nothing on an Allegro listing points at a Colnect item-ID or carries a Colnect grade, so an
    // offer with neither is perfectly listable there — while the sets still have to be
    // interchangeable, that being a fact about the offer rather than about anyone's form.
    const bare = () => copy({ catalogItemId: null, platformCondition: null });
    assert.deepEqual(
      codes(
        input({
          platformModule: "allegro",
          sets: [{ setId: "set-1", label: "A", copies: [bare(), bare()] }],
        })
      ),
      []
    );
    assert.deepEqual(
      codes(
        input({
          platformModule: "allegro",
          sets: [
            { setId: "set-1", label: "A", copies: [copy({ catalogItemId: null })] },
            { setId: "set-2", label: "B", copies: [copy({ catalogItemId: null }), copy()] },
          ],
        })
      ),
      ["mixed-sets"]
    );
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

  // #462 — the update mode. It differs from the create mode in the leading state check and in
  // nothing else, which is the whole reason there is one evaluation rather than two.
  describe("updating a listing that is already live", () => {
    const live = (over: Partial<PreconditionInput> = {}) =>
      input({
        mode: "update",
        state: "active",
        listingUrl: "https://colnect.com/en/market/sale/h5pxfc",
        ...over,
      });

    it("passes an Active offer that carries the listing's address", () => {
      assert.deepEqual(evaluateListingPreconditions(live()), []);
    });

    it("refuses an offer that is not live, and says nothing else about it", () => {
      // A Ready offer has a listing to *post*, not one to correct — and `not-ready` would be the
      // wrong sentence entirely.
      assert.deepEqual(codes(live({ state: "ready" })), ["not-active"]);
      assert.deepEqual(codes(live({ state: "sold" })), ["not-active"]);
    });

    it("refuses an Active offer with no listing URL, there being nothing to go back to", () => {
      assert.deepEqual(codes(live({ listingUrl: null })), ["no-listing-url"]);
      assert.deepEqual(codes(live({ listingUrl: "   " })), ["no-listing-url"]);
    });

    it("refuses a module that can post a listing but not edit one", () => {
      // Allegro's Assistant form is entered on the way to a *new* listing (#493) and has no edit path.
      assert.deepEqual(codes(live({ platformModule: "allegro" })), ["no-update-support"]);
    });

    it("asks every question about the goods exactly as the create mode does", () => {
      assert.deepEqual(
        codes(
          live({
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

    it("is the create mode when nothing says otherwise", () => {
      // Every caller predating the update flow omits the field, and must keep the rules it had.
      assert.deepEqual(codes(input({ state: "active" })), ["not-ready"]);
    });
  });
});
