import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nameToSlugBase } from "../../src/lib/slug";

describe("nameToSlugBase", () => {
  it("lowercases and hyphenates words", () => {
    assert.equal(nameToSlugBase("My Collection"), "my-collection");
  });

  it("handles multiple spaces", () => {
    assert.equal(nameToSlugBase("a  b"), "a-b");
  });

  it("strips special characters", () => {
    assert.equal(nameToSlugBase("Stamps & Coins!"), "stamps-coins");
  });

  it("trims leading and trailing whitespace", () => {
    assert.equal(nameToSlugBase("  hello  "), "hello");
  });

  it("preserves existing hyphens", () => {
    assert.equal(nameToSlugBase("pre-war"), "pre-war");
  });

  it("returns empty string for a name with only special chars", () => {
    assert.equal(nameToSlugBase("!!!"), "");
  });

  it("passes through an already-valid slug", () => {
    assert.equal(nameToSlugBase("airmail"), "airmail");
  });

  it("converts underscores to hyphens", () => {
    assert.equal(nameToSlugBase("hello_world"), "hello-world");
  });
});
