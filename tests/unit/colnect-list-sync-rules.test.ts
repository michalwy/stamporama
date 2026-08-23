import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLNECT_LIST_BUCKETS,
  COLNECT_LIST_SOURCES,
  COLNECT_LIST_SOURCES_OF_TRUTH,
  COLNECT_STANDARD_LISTS,
  colnectListBucketLabel,
  colnectListSourceLabel,
  colnectListSourceShape,
  colnectStandardList,
  isColnectListBucket,
  isColnectListDifferenceKind,
  isColnectListSource,
  isColnectListSourceOfTruth,
} from "../../src/lib/colnect-list-sync-rules";

// The vocabulary Colnect list sync is configured in (#684). What is worth asserting here is not
// that the constants exist but that the *defaults* are the ones the design settled on — Wish being
// the odd one out is the whole reason the table has a `sourceOfTruth` column at all.

describe("COLNECT_STANDARD_LISTS", () => {
  it("carries Colnect's own four list ids, in its own order", () => {
    assert.deepEqual(
      COLNECT_STANDARD_LISTS.map((l) => [l.lt, l.label]),
      [
        [2, "Collection"],
        [3, "Swap"],
        [4, "Wish"],
        [5, "Sell"],
      ]
    );
  });

  it("mirrors each list with the predicate it is about", () => {
    assert.deepEqual(
      COLNECT_STANDARD_LISTS.map((l) => [l.lt, l.defaultSource]),
      [
        [2, "items_in_collection"],
        [3, "items_for_trade"],
        [4, "wants_open"],
        [5, "items_for_sale"],
      ]
    );
  });

  it("trusts Colnect for Wish and this collection for everything else (#688)", () => {
    assert.deepEqual(
      COLNECT_STANDARD_LISTS.map((l) => [l.label, l.defaultSourceOfTruth]),
      [
        ["Collection", "local"],
        ["Swap", "local"],
        ["Wish", "colnect"],
        ["Sell", "local"],
      ]
    );
  });

  it("proposes every default out of the vocabularies that can be stored", () => {
    for (const list of COLNECT_STANDARD_LISTS) {
      assert.ok(isColnectListSource(list.defaultSource));
      assert.ok(isColnectListSourceOfTruth(list.defaultSourceOfTruth));
    }
  });
});

describe("colnectStandardList", () => {
  it("finds a standard list by its Colnect id", () => {
    assert.equal(colnectStandardList(3)?.label, "Swap");
  });

  it("answers null for a custom list, which Settings does not offer", () => {
    assert.equal(colnectStandardList(16), null);
    assert.equal(colnectStandardList(0), null);
  });
});

describe("the write-side guards", () => {
  it("accept every offered value and nothing else", () => {
    for (const source of COLNECT_LIST_SOURCES) assert.ok(isColnectListSource(source.value));
    for (const side of COLNECT_LIST_SOURCES_OF_TRUTH) assert.ok(isColnectListSourceOfTruth(side.value));
    assert.equal(isColnectListSource("items"), false);
    assert.equal(isColnectListSource(""), false);
    assert.equal(isColnectListSourceOfTruth("Colnect"), false);
  });

  it("know the difference kinds an acceptance can be filed against", () => {
    assert.ok(isColnectListDifferenceKind("only-colnect"));
    assert.ok(isColnectListDifferenceKind("only-local"));
    // Added by the report (#686) — a plain string in the database is what made that free.
    assert.ok(isColnectListDifferenceKind("quantity"));
    assert.ok(isColnectListDifferenceKind("grade"));
    // A bucket, but never a decision: it is keyed by a Colnect id these rows do not have.
    assert.equal(isColnectListDifferenceKind("not-comparable"), false);
    assert.equal(isColnectListDifferenceKind("in-sync"), false);
  });
});

describe("COLNECT_LIST_BUCKETS (#686)", () => {
  it("holds the report's five buckets, membership first", () => {
    assert.deepEqual(
      COLNECT_LIST_BUCKETS.map((b) => b.value),
      ["only-local", "only-colnect", "quantity", "grade", "not-comparable"]
    );
  });

  it("marks every bucket decidable except the one with no Colnect id to key by", () => {
    assert.deepEqual(
      COLNECT_LIST_BUCKETS.filter((b) => !b.decidable).map((b) => b.value),
      ["not-comparable"]
    );
  });

  it("recognises its own values and nothing else", () => {
    assert.ok(isColnectListBucket("not-comparable"));
    assert.equal(isColnectListBucket("in-sync"), false);
  });

  it("names a bucket the way the chip does, and prints an unknown one rather than a blank", () => {
    assert.equal(colnectListBucketLabel("only-local"), "Missing on Colnect");
    assert.equal(colnectListBucketLabel("only-there"), "only-there");
  });
});

describe("colnectListSourceShape (#686)", () => {
  it("resolves the three copy predicates to their own flag", () => {
    assert.deepEqual(colnectListSourceShape("items_in_collection"), {
      kind: "copies",
      flag: "inCollection",
    });
    assert.deepEqual(colnectListSourceShape("items_for_trade"), {
      kind: "copies",
      flag: "forTrade",
    });
    assert.deepEqual(colnectListSourceShape("items_for_sale"), {
      kind: "copies",
      flag: "forSale",
    });
  });

  it("keeps wants apart, because they are not copies at all", () => {
    assert.deepEqual(colnectListSourceShape("wants_open"), { kind: "wants" });
  });
});

describe("colnectListSourceLabel", () => {
  it("names a predicate the way the picker does", () => {
    assert.equal(colnectListSourceLabel("wants_open"), "Open wants");
  });

  it("prints a value it no longer offers rather than a blank", () => {
    assert.equal(colnectListSourceLabel("items_on_loan"), "items_on_loan");
  });
});
