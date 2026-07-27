import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatItemNo,
  formatItemNoDigits,
  parseItemNoPad,
  parseItemNoSearch,
} from "../../src/lib/item-number";

describe("formatItemNo", () => {
  it("pads to the default width and prefixes with #", () => {
    assert.equal(formatItemNo(1), "#00001");
    assert.equal(formatItemNo(123), "#00123");
    assert.equal(formatItemNo(99999), "#99999");
  });

  it("pads to the collection's configured width", () => {
    assert.equal(formatItemNo(42, 2), "#42");
    assert.equal(formatItemNo(42, 8), "#00000042");
    assert.equal(formatItemNoDigits(42, 3), "042");
  });

  it("renders wider rather than truncating past the pad width", () => {
    assert.equal(formatItemNo(100000), "#100000");
    assert.equal(formatItemNo(100000, 2), "#100000");
  });

  it("falls back to the default width when the pad is unusable", () => {
    assert.equal(formatItemNo(42, 0), "#00042");
    assert.equal(formatItemNo(42, 99), "#00042");
  });

  it("can render the digits without the prefix", () => {
    assert.equal(formatItemNoDigits(42), "00042");
  });
});

describe("parseItemNoPad", () => {
  it("accepts a whole number inside the allowed range, as number or text", () => {
    assert.equal(parseItemNoPad(3), 3);
    assert.equal(parseItemNoPad("3"), 3);
    assert.equal(parseItemNoPad(" 10 "), 10);
    assert.equal(parseItemNoPad(1), 1);
  });

  it("rejects anything outside it", () => {
    assert.equal(parseItemNoPad(0), null);
    assert.equal(parseItemNoPad(11), null);
    assert.equal(parseItemNoPad(2.5), null);
    assert.equal(parseItemNoPad("wide"), null);
    assert.equal(parseItemNoPad(""), null);
    assert.equal(parseItemNoPad(null), null);
    assert.equal(parseItemNoPad(undefined), null);
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
