import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lotCopiesKeys,
  staleAfterWrite,
} from "../../src/app/c/[collectionSlug]/purchases/[purchaseId]/lot-copies-keys";

// What the order screen re-reads after a write on one lot (#1409). Every lot card reads its own
// summary whether it is open or not, and every write used to leave all of them stale — so an
// operation on one lot of a two-hundred-lot order cost two hundred reads. What is pinned: a write
// that names its lots leaves exactly those lots' reads stale, the order's own reads, and the rows
// of the cards that are open; the count is the same for five lots as for two hundred; and a write
// that cannot say what it touched still leaves everything stale.

const C = "col";
const P = "po";

/** The reads an order screen holds: a summary and a return per lot card, the rows and set
 *  completeness of the open ones, and the order's own bar, chips, return and selection count. */
function screenKeys(lotCount: number, openLots: string[]): (readonly unknown[])[] {
  const lots = Array.from({ length: lotCount }, (_, i) => `lot${i}`);
  const keys: (readonly unknown[])[] = [];
  for (const lot of lots) keys.push(lotCopiesKeys.summary(C, lot, {}, ["issue"]));
  for (const lot of openLots) {
    keys.push(lotCopiesKeys.list(C, lot, { sort: "added" }));
    keys.push(lotCopiesKeys.lotReturn(C, lot));
    keys.push(lotCopiesKeys.completeness(C, lot));
  }
  keys.push(lotCopiesKeys.purchaseSummary(C, P, {}, ["issue"]));
  keys.push(lotCopiesKeys.purchaseReturn(C, P));
  keys.push(["lot-copies", C, "selection-count", []]);
  return keys;
}

const staleCount = (keys: (readonly unknown[])[], touched: ReadonlySet<string> | null) =>
  keys.filter((k) => staleAfterWrite(k, C, touched)).length;

describe("what a write on one lot re-reads (#1409)", () => {
  it("does not grow with the number of lots in the order", () => {
    const touched = new Set(["lot0"]);
    const few = staleCount(screenKeys(5, ["lot0"]), touched);
    const many = staleCount(screenKeys(200, ["lot0"]), touched);
    assert.equal(many, few);
    // The touched lot's summary, rows, return and completeness, and the order's three reads.
    assert.equal(few, 7);
  });

  it("leaves an untouched lot's header alone, open or collapsed", () => {
    const touched = new Set(["lot0"]);
    assert.equal(staleAfterWrite(lotCopiesKeys.summary(C, "lot1", {}, []), C, touched), false);
    assert.equal(staleAfterWrite(lotCopiesKeys.lotReturn(C, "lot1"), C, touched), false);
    assert.equal(staleAfterWrite(lotCopiesKeys.summary(C, "lot0", {}, []), C, touched), true);
    assert.equal(staleAfterWrite(lotCopiesKeys.lotReturn(C, "lot0"), C, touched), true);
  });

  it("re-reads an open card's rows even when its lot was not touched", () => {
    // A row's want marker counts the other copies of its stamp, and its set completeness the
    // checklist's copies across the collection — both can move with a copy in another lot.
    const touched = new Set(["lot0"]);
    assert.equal(staleAfterWrite(lotCopiesKeys.list(C, "lot1", {}), C, touched), true);
    assert.equal(staleAfterWrite(lotCopiesKeys.completeness(C, "lot1"), C, touched), true);
  });

  it("always re-reads the order's own figures and the selection count", () => {
    const none = new Set<string>();
    assert.equal(staleAfterWrite(lotCopiesKeys.purchaseSummary(C, P, {}, []), C, none), true);
    assert.equal(staleAfterWrite(lotCopiesKeys.purchaseList(C, P, {}), C, none), true);
    assert.equal(staleAfterWrite(lotCopiesKeys.purchaseReturn(C, P), C, none), true);
    assert.equal(staleAfterWrite(lotCopiesKeys.purchaseCompleteness(C, P), C, none), true);
    assert.equal(staleAfterWrite(["lot-copies", C, "selection-count", []], C, none), true);
  });

  it("re-reads everything when the write cannot say what it touched", () => {
    const keys = screenKeys(200, ["lot0", "lot7"]);
    assert.equal(staleCount(keys, null), keys.length);
  });

  it("never reaches another collection's reads or another namespace", () => {
    assert.equal(staleAfterWrite(lotCopiesKeys.summary("other", "lot0", {}, []), C, null), false);
    assert.equal(staleAfterWrite(["purchases", C, "attachable"], C, null), false);
  });
});
