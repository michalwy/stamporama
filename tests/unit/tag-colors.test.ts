import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NEUTRAL_TAG_TOKENS,
  TAG_COLORS,
  TAG_COLOR_LABELS,
  isTagColor,
  nextTagColor,
  tagColorTokens,
} from "../../src/lib/tag-colors";

describe("isTagColor", () => {
  it("accepts every hue in the vocabulary", () => {
    for (const hue of TAG_COLORS) assert.equal(isTagColor(hue), true);
  });

  it("rejects anything else, including empty and absent values", () => {
    assert.equal(isTagColor("chartreuse"), false);
    assert.equal(isTagColor("#ff0000"), false);
    assert.equal(isTagColor(""), false);
    assert.equal(isTagColor(null), false);
    assert.equal(isTagColor(undefined), false);
  });
});

describe("TAG_COLOR_LABELS", () => {
  it("names every hue", () => {
    for (const hue of TAG_COLORS) assert.ok(TAG_COLOR_LABELS[hue]);
  });
});

describe("tagColorTokens", () => {
  it("resolves a hue to its three custom properties", () => {
    assert.deepEqual(tagColorTokens("green"), {
      color: "var(--color-tag-green)",
      border: "var(--color-tag-green-border)",
      background: "var(--color-tag-green-soft)",
    });
  });

  it("falls back to the neutral chip for no colour and for a value outside the vocabulary", () => {
    assert.deepEqual(tagColorTokens(null), NEUTRAL_TAG_TOKENS);
    assert.deepEqual(tagColorTokens(undefined), NEUTRAL_TAG_TOKENS);
    // A hex written before this vocabulary must not reach a `var()` that does not exist.
    assert.deepEqual(tagColorTokens("#ff0000"), NEUTRAL_TAG_TOKENS);
  });
});

describe("nextTagColor", () => {
  it("offers the first hue on an empty dictionary", () => {
    assert.equal(nextTagColor([]), TAG_COLORS[0]);
  });

  it("skips hues already in use", () => {
    assert.equal(nextTagColor([TAG_COLORS[0], TAG_COLORS[1]]), TAG_COLORS[2]);
  });

  it("ignores entries with no colour and values outside the vocabulary", () => {
    assert.equal(nextTagColor([null, undefined, "#ff0000"]), TAG_COLORS[0]);
  });

  it("still answers once every hue is taken", () => {
    const used = [...TAG_COLORS];
    assert.equal(isTagColor(nextTagColor(used)), true);
  });
});
