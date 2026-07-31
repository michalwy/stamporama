import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatEntityNo,
  parseEntityNoSearch,
  parseQuickJump,
  quickJumpLabel,
  QUICK_JUMP_PREFIXES,
} from "../../src/lib/quick-jump";

// The pure half of the quick-jump box (#431). What matters here is that a prefix is never read as
// a shorter one, and that anything which is not plainly a jump is refused rather than guessed at —
// a box that silently lands somewhere else is worse than one that finds nothing.

describe("parseQuickJump (#431)", () => {
  it("reads a prefix and a number, with or without the space", () => {
    assert.deepEqual(parseQuickJump("i 100"), { entity: "item", no: 100 });
    assert.deepEqual(parseQuickJump("i100"), { entity: "item", no: 100 });
    assert.deepEqual(parseQuickJump("o 200"), { entity: "offer", no: 200 });
    assert.deepEqual(parseQuickJump("p3"), { entity: "purchase", no: 3 });
    assert.deepEqual(parseQuickJump("s 7"), { entity: "sale", no: 7 });
  });

  it("takes the longest prefix, so `iss` is never read as `i`", () => {
    assert.deepEqual(parseQuickJump("iss12"), { entity: "issue", no: 12 });
    assert.deepEqual(parseQuickJump("iss 12"), { entity: "issue", no: 12 });
    assert.deepEqual(parseQuickJump("lot 3"), { entity: "auctionLot", no: 3 });
    assert.deepEqual(parseQuickJump("lot3"), { entity: "auctionLot", no: 3 });
  });

  it("ignores case and surrounding space", () => {
    assert.deepEqual(parseQuickJump("  ISS 12  "), { entity: "issue", no: 12 });
    assert.deepEqual(parseQuickJump("O200"), { entity: "offer", no: 200 });
  });

  it("accepts the `#` the number is displayed with", () => {
    assert.deepEqual(parseQuickJump("p #4"), { entity: "purchase", no: 4 });
    assert.deepEqual(parseQuickJump("iss#12"), { entity: "issue", no: 12 });
  });

  it("refuses anything that is not plainly a jump", () => {
    assert.equal(parseQuickJump(""), null);
    assert.equal(parseQuickJump("   "), null);
    // No prefix — a bare number could be a copy, a catalog number, a year or a price.
    assert.equal(parseQuickJump("200"), null);
    // An unknown prefix.
    assert.equal(parseQuickJump("x 12"), null);
    // A prefix with nothing after it, or with something that is not a number.
    assert.equal(parseQuickJump("o"), null);
    assert.equal(parseQuickJump("o abc"), null);
    assert.equal(parseQuickJump("o 12a"), null);
    assert.equal(parseQuickJump("o 1.5"), null);
    assert.equal(parseQuickJump("o -3"), null);
    // The sequences start at 1, and the columns are 32-bit.
    assert.equal(parseQuickJump("o 0"), null);
    assert.equal(parseQuickJump("o 2147483648"), null);
  });

  it("does not read a name that merely starts with a prefix letter", () => {
    // `sweden 1950` starts with `s`, but what follows the prefix is not a number.
    assert.equal(parseQuickJump("sweden 1950"), null);
    assert.equal(parseQuickJump("poland"), null);
  });

  it("names every prefix it knows, and every entity has one", () => {
    const prefixes = QUICK_JUMP_PREFIXES.map((p) => p.prefix);
    assert.equal(new Set(prefixes).size, prefixes.length, "prefixes must be unique");
    for (const { entity, label } of QUICK_JUMP_PREFIXES) {
      assert.equal(quickJumpLabel(entity), label);
    }
  });
});

describe("entity number display + search (#432)", () => {
  it("renders unpadded, behind a #", () => {
    assert.equal(formatEntityNo(12), "#12");
    assert.equal(formatEntityNo(1), "#1");
  });

  it("reads a list-search entry as a number, with or without the #", () => {
    assert.equal(parseEntityNoSearch("12"), 12);
    assert.equal(parseEntityNoSearch("#12"), 12);
    assert.equal(parseEntityNoSearch("  #12 "), 12);
  });

  it("is not a number when it is text, zero, or out of a column's range", () => {
    assert.equal(parseEntityNoSearch("Mi 200"), null);
    assert.equal(parseEntityNoSearch(""), null);
    assert.equal(parseEntityNoSearch("0"), null);
    assert.equal(parseEntityNoSearch("2147483648"), null);
  });
});
