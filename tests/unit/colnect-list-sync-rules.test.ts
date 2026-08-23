import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLNECT_LIST_SOURCES,
  COLNECT_LIST_SOURCES_OF_TRUTH,
  COLNECT_STANDARD_LISTS,
  colnectListSourceLabel,
  colnectStandardList,
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

  it("know the two difference kinds an acceptance can be filed against", () => {
    assert.ok(isColnectListDifferenceKind("only-colnect"));
    assert.ok(isColnectListDifferenceKind("only-local"));
    assert.equal(isColnectListDifferenceKind("quantity"), false);
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
