import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_PURCHASE_UI_STATE,
  forgetEntry,
  isEmptyPurchaseUiState,
  parsePurchaseUiState,
  storedBytes,
  touchAndEvict,
  type PurchaseUiState,
  type UiStateIndexEntry,
} from "../../src/lib/purchase-ui-state";

const CAPS = { maxEntries: 3, maxBytes: 1000 };

function entry(key: string, at: number, bytes = 100): UiStateIndexEntry {
  return { key, at, bytes };
}

function state(over: Partial<PurchaseUiState> = {}): PurchaseUiState {
  return { ...EMPTY_PURCHASE_UI_STATE, ...over };
}

describe("touchAndEvict", () => {
  it("puts the written entry at the front so recency is by use, not by creation", () => {
    const index = [entry("c", 30), entry("b", 20), entry("a", 10)];
    const { index: next, evicted } = touchAndEvict(index, "a", 40, 100, CAPS);
    assert.deepEqual(
      next.map((e) => e.key),
      ["a", "c", "b"]
    );
    assert.deepEqual(evicted, []);
  });

  it("replaces an existing entry rather than duplicating it", () => {
    const index = [entry("a", 10, 100)];
    const { index: next } = touchAndEvict(index, "a", 20, 250, CAPS);
    assert.equal(next.length, 1);
    assert.deepEqual(next[0], { key: "a", at: 20, bytes: 250 });
  });

  it("evicts the least-recently-used once the count cap is passed", () => {
    const index = [entry("c", 30), entry("b", 20), entry("a", 10)];
    const { index: next, evicted } = touchAndEvict(index, "d", 40, 100, CAPS);
    assert.deepEqual(evicted, ["a"]);
    assert.deepEqual(
      next.map((e) => e.key),
      ["d", "c", "b"]
    );
  });

  it("evicts on the byte budget while still inside the count cap", () => {
    const index = [entry("b", 20, 400), entry("a", 10, 400)];
    const { index: next, evicted } = touchAndEvict(index, "c", 30, 400, CAPS);
    // 3 entries is within maxEntries, but 1200 bytes is over maxBytes.
    assert.deepEqual(evicted, ["a"]);
    assert.equal(
      next.reduce((sum, e) => sum + e.bytes, 0),
      800
    );
  });

  it("keeps evicting until both caps hold", () => {
    const index = [entry("c", 30, 500), entry("b", 20, 500), entry("a", 10, 500)];
    const { index: next, evicted } = touchAndEvict(index, "d", 40, 400, CAPS);
    assert.deepEqual(evicted, ["a", "b"]);
    assert.deepEqual(
      next.map((e) => e.key),
      ["d", "c"]
    );
  });

  it("never evicts the entry being written, even when it alone exceeds the budget", () => {
    const index = [entry("a", 10, 100)];
    const { index: next, evicted } = touchAndEvict(index, "big", 20, 5000, CAPS);
    assert.deepEqual(evicted, ["a"]);
    assert.deepEqual(
      next.map((e) => e.key),
      ["big"]
    );
  });
});

describe("forgetEntry", () => {
  it("drops just the named entry", () => {
    const index = [entry("b", 20), entry("a", 10)];
    assert.deepEqual(
      forgetEntry(index, "b").map((e) => e.key),
      ["a"]
    );
  });

  it("is a no-op for a key that is not there", () => {
    const index = [entry("a", 10)];
    assert.deepEqual(forgetEntry(index, "zz"), index);
  });
});

describe("parsePurchaseUiState", () => {
  it("reads a full entry back", () => {
    const written: PurchaseUiState = {
      lots: ["lot1", "lot2"],
      groups: { lot1: ["iss1"], order: ["iss2"] },
      filter: "to-sort",
      disposition: "for-sale",
      scans: { open: true, filter: "unidentified", showDone: true, batches: { "3": false } },
    };
    assert.deepEqual(parsePurchaseUiState(JSON.stringify(written)), written);
  });

  it("falls back to the defaults for missing, malformed and non-object input", () => {
    for (const raw of [null, "", "{", "[]", "null", '"nope"', "7"]) {
      assert.deepEqual(parsePurchaseUiState(raw), EMPTY_PURCHASE_UI_STATE);
    }
  });

  it("drops fields of the wrong type instead of throwing", () => {
    const parsed = parsePurchaseUiState(
      JSON.stringify({
        lots: ["ok", 5, null],
        groups: { lot1: ["a", 2], lot2: "nope", lot3: [] },
        filter: 9,
        disposition: 42,
        scans: { open: "yes", filter: 3, showDone: true, batches: { "1": true, "2": "no" } },
      })
    );
    assert.deepEqual(parsed.lots, ["ok"]);
    // lot3's empty list carries nothing, so it is not kept as a key.
    assert.deepEqual(parsed.groups, { lot1: ["a"] });
    assert.equal(parsed.filter, null);
    assert.equal(parsed.disposition, null);
    assert.equal(parsed.scans.open, false);
    assert.equal(parsed.scans.filter, "all");
    assert.equal(parsed.scans.showDone, true);
    assert.deepEqual(parsed.scans.batches, { "1": true });
  });
});

describe("isEmptyPurchaseUiState", () => {
  it("is true for the screen at its defaults", () => {
    assert.equal(isEmptyPurchaseUiState(EMPTY_PURCHASE_UI_STATE), true);
    assert.equal(isEmptyPurchaseUiState(parsePurchaseUiState(null)), true);
  });

  it("is false as soon as any one slice holds a choice", () => {
    assert.equal(isEmptyPurchaseUiState(state({ lots: ["lot1"] })), false);
    assert.equal(isEmptyPurchaseUiState(state({ groups: { lot1: ["iss"] } })), false);
    assert.equal(isEmptyPurchaseUiState(state({ filter: "unpriced" })), false);
    assert.equal(isEmptyPurchaseUiState(state({ disposition: "for-sale" })), false);
    assert.equal(
      isEmptyPurchaseUiState(state({ scans: { ...EMPTY_PURCHASE_UI_STATE.scans, open: true } })),
      false
    );
    assert.equal(
      isEmptyPurchaseUiState(
        state({ scans: { ...EMPTY_PURCHASE_UI_STATE.scans, batches: { "1": false } } })
      ),
      false
    );
  });
});

describe("storedBytes", () => {
  it("counts UTF-16 code units, which is what localStorage charges for", () => {
    assert.equal(storedBytes(""), 0);
    assert.equal(storedBytes("abc"), 6);
  });
});
