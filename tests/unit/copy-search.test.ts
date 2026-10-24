import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { copyMatchesSearch } from "../../src/lib/copy-search";
import { copyBehindFiltersHref } from "../../src/app/c/[collectionSlug]/inventory/copies-list-filters";

// #2136: a copy picker's search — `#809` is copy 809 alone, a bare `809` the copy and its catalogue
// matches — and where the Copies list sends a collector whose `#809` the filters hid.

const copy = (itemNo: number, extra: Record<string, string | null> = {}) => ({
  itemNo,
  stampName: "Chopin",
  issueName: "Composers",
  locationRef: "A234",
  ...extra,
});
const keys = (...k: string[]) => () => k;
const noKeys = () => {
  throw new Error("catalogue keys must not be built for a #N search");
};

describe("copyMatchesSearch", () => {
  it("reads #N as that copy alone, leading zeros ignored", () => {
    assert.equal(copyMatchesSearch(copy(809), "#809", noKeys), true);
    assert.equal(copyMatchesSearch(copy(809), "#00809", noKeys), true);
    assert.equal(copyMatchesSearch(copy(12), "#809", noKeys), false);
  });

  it("matches a bare number as the copy's own number and as a catalogue number", () => {
    assert.equal(copyMatchesSearch(copy(809), "809", keys()), true);
    assert.equal(copyMatchesSearch(copy(12), "809", keys("mi809")), true);
    assert.equal(copyMatchesSearch(copy(12), "809", keys("mi200")), false);
  });

  it("still matches the stamp, issue and location ref", () => {
    assert.equal(copyMatchesSearch(copy(1), "chop", keys()), true);
    assert.equal(copyMatchesSearch(copy(1), "composers", keys()), true);
    assert.equal(copyMatchesSearch(copy(1), "a234", keys()), true);
    assert.equal(copyMatchesSearch(copy(1), "", noKeys), true);
  });
});

describe("copyBehindFiltersHref", () => {
  const read = (href: string) => new URL(href, "http://x").searchParams;

  it("clears every filter and keeps the #N search", () => {
    const sp = read(copyBehindFiltersHref("/c/mine", { itemNo: 809, sold: false, tradedAway: null, disposedAt: null }));
    assert.equal(sp.get("search"), "#809");
    assert.equal(sp.get("conditionIds"), "");
    assert.equal(sp.get("includeGone"), "");
    assert.equal(sp.get("includeDisposed"), "");
  });

  it("switches on the Include a copy that has left needs", () => {
    const sold = read(copyBehindFiltersHref("/c/mine", { itemNo: 1, sold: true, tradedAway: null, disposedAt: null }));
    assert.equal(sold.get("includeGone"), "true");
    const traded = read(copyBehindFiltersHref("/c/mine", { itemNo: 1, sold: false, tradedAway: { id: "t" }, disposedAt: null }));
    assert.equal(traded.get("includeGone"), "true");
    const disposed = read(copyBehindFiltersHref("/c/mine", { itemNo: 1, sold: false, tradedAway: null, disposedAt: new Date() }));
    assert.equal(disposed.get("includeDisposed"), "true");
    assert.equal(disposed.get("includeGone"), "");
  });
});
