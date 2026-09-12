import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  asMultiStampFilter,
  MULTI_STAMP,
  multiStampFilterWhere,
  NOT_MULTI_STAMP,
} from "../../src/lib/multi-stamp";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";

// The Copies list's multi-stamp filter (#748; ADR-0044 §7) — the pure half: what a query-string value
// reads as, and which `where` fragment each reading narrows to.

describe("asMultiStampFilter", () => {
  it("reads the two values the filter has", () => {
    assert.equal(asMultiStampFilter("only"), "only");
    assert.equal(asMultiStampFilter("exclude"), "exclude");
  });

  it("reads anything else as no filter, never as an unmatchable one", () => {
    // Absent is *both*, the list's default — so a stale or hand-edited link shows the list.
    for (const value of [null, undefined, "", "both", "ONLY", "true"]) {
      assert.equal(asMultiStampFilter(value), undefined, String(value));
    }
  });
});

describe("multiStampFilterWhere", () => {
  it("narrows through the very fragments the counts spread", () => {
    // Identity, not merely equal shape: the list filter and `heldCopiesWhere` must be one sentence.
    assert.equal(multiStampFilterWhere("only"), MULTI_STAMP);
    assert.equal(multiStampFilterWhere("exclude"), NOT_MULTI_STAMP);
  });

  it("adds nothing when the filter is off", () => {
    assert.deepEqual(multiStampFilterWhere(undefined), {});
  });
});

describe("the filter round-trips through the URL", () => {
  it("reaches the server's filter set from the query string the list writes", () => {
    assert.equal(readItemFilters(new URLSearchParams("multiStamp=only")).multiStamp, "only");
    assert.equal(readItemFilters(new URLSearchParams("multiStamp=exclude")).multiStamp, "exclude");
  });

  it("is absent from a link that does not name it, or names nonsense", () => {
    assert.equal(readItemFilters(new URLSearchParams("")).multiStamp, undefined);
    assert.equal(readItemFilters(new URLSearchParams("multiStamp=both")).multiStamp, undefined);
  });
});
