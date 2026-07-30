import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LISTING_TEXT_LENGTH_LIMIT,
  listingTextLength,
  parsePlatformTextLimits,
  textLengthState,
} from "../../src/lib/listing-text-limits";

const NO_LIMITS = { maxDescriptionLength: "", maxPrivateNoteLength: "" };

describe("parsePlatformTextLimits", () => {
  it("reads blank fields as no limit stated", () => {
    const parsed = parsePlatformTextLimits(NO_LIMITS);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, { maxDescriptionLength: null, maxPrivateNoteLength: null });
  });

  it("reads the two limits independently", () => {
    const parsed = parsePlatformTextLimits({
      maxDescriptionLength: "100",
      maxPrivateNoteLength: " 250 ",
    });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, { maxDescriptionLength: 100, maxPrivateNoteLength: 250 });
  });

  it("allows one limit without the other — Colnect caps both, other platforms cap one", () => {
    const parsed = parsePlatformTextLimits({ ...NO_LIMITS, maxDescriptionLength: "100" });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, { maxDescriptionLength: 100, maxPrivateNoteLength: null });
  });

  it("rejects a non-integer", () => {
    const parsed = parsePlatformTextLimits({ ...NO_LIMITS, maxDescriptionLength: "12.5" });
    assert.ok(!parsed.ok);
    assert.match(parsed.message, /whole number/);
  });

  it("rejects zero and negative caps — a zero-length field is not a limit, it is a broken one", () => {
    for (const raw of ["0", "-1"]) {
      const parsed = parsePlatformTextLimits({ ...NO_LIMITS, maxPrivateNoteLength: raw });
      assert.ok(!parsed.ok);
      assert.match(parsed.message, /Max private note length/);
    }
  });

  it("rejects a value past the sanity rail", () => {
    const parsed = parsePlatformTextLimits({
      ...NO_LIMITS,
      maxDescriptionLength: String(MAX_LISTING_TEXT_LENGTH_LIMIT + 1),
    });
    assert.ok(!parsed.ok);
  });
});

describe("listingTextLength", () => {
  it("counts UTF-16 code units, the unit an HTML maxlength enforces", () => {
    assert.equal(listingTextLength("Mi 1-12"), 7);
    // An astral character costs two units in the platform's own field, so it costs two here.
    assert.equal(listingTextLength("🇵🇱"), 4);
  });

  it("treats a missing text as empty", () => {
    assert.equal(listingTextLength(null), 0);
    assert.equal(listingTextLength(undefined), 0);
  });
});

describe("textLengthState", () => {
  it("renders nothing when the platform states no limit", () => {
    assert.equal(textLengthState("anything", null), null);
    assert.equal(textLengthState("anything", undefined), null);
  });

  it("reports a text that fits", () => {
    assert.deepEqual(textLengthState("abc", 100), { length: 3, limit: 100, over: 0 });
  });

  it("reports exactly at the limit as fitting", () => {
    assert.deepEqual(textLengthState("a".repeat(100), 100), { length: 100, limit: 100, over: 0 });
  });

  it("reports how far a text runs over", () => {
    assert.deepEqual(textLengthState("a".repeat(103), 100), { length: 103, limit: 100, over: 3 });
  });

  it("counts an empty text against a limit rather than hiding the counter", () => {
    assert.deepEqual(textLengthState(null, 100), { length: 0, limit: 100, over: 0 });
  });
});
