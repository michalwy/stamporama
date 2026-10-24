import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatItemNo, parseItemNoOnlySearch, parseItemNoSearch } from "../../src/lib/item-number";

describe("formatItemNo", () => {
  // No padding anywhere (#2096): a copy's number reads as every other internal number does.
  it("writes the plain number, prefixed with #", () => {
    assert.equal(formatItemNo(1), "#1");
    assert.equal(formatItemNo(123), "#123");
    assert.equal(formatItemNo(100000), "#100000");
  });
});

describe("parseItemNoSearch", () => {
  it("reads the bare, padded and prefixed forms as the same number", () => {
    assert.equal(parseItemNoSearch("123"), 123);
    assert.equal(parseItemNoSearch("00123"), 123);
    assert.equal(parseItemNoSearch("#00123"), 123);
    assert.equal(parseItemNoSearch("  #123  "), 123);
  });

  it("rejects anything that is not a plain number", () => {
    assert.equal(parseItemNoSearch("Mi 200"), null);
    assert.equal(parseItemNoSearch("A234"), null);
    assert.equal(parseItemNoSearch("12a"), null);
    assert.equal(parseItemNoSearch(""), null);
    assert.equal(parseItemNoSearch("#"), null);
    assert.equal(parseItemNoSearch("-5"), null);
    assert.equal(parseItemNoSearch("1.5"), null);
  });

  it("rejects values the sequence can never hold", () => {
    assert.equal(parseItemNoSearch("0"), null);
    assert.equal(parseItemNoSearch("00000"), null);
    assert.equal(parseItemNoSearch("9999999999"), null);
  });
});

describe("parseItemNoOnlySearch", () => {
  // #2136: the `#` says *this is a copy's number*, so only the prefixed form reads as one alone.
  it("reads only the #-prefixed form, leading zeros ignored", () => {
    assert.equal(parseItemNoOnlySearch("#809"), 809);
    assert.equal(parseItemNoOnlySearch("#00809"), 809);
    assert.equal(parseItemNoOnlySearch("  # 809 "), 809);
    assert.equal(parseItemNoOnlySearch("809"), null);
    assert.equal(parseItemNoOnlySearch("00809"), null);
    assert.equal(parseItemNoOnlySearch("#"), null);
    assert.equal(parseItemNoOnlySearch("#0"), null);
    assert.equal(parseItemNoOnlySearch("#Mi 200"), null);
  });
});
