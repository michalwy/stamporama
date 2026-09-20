import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { trimTextInput, isBlankTextInput } from "@/lib/text-input";

describe("trimTextInput", () => {
  it("removes the spaces around a value", () => {
    assert.equal(trimTextInput("  Poland  "), "Poland");
    assert.equal(trimTextInput("Poland "), "Poland");
    assert.equal(trimTextInput(" Poland"), "Poland");
  });

  it("leaves the spaces inside a value alone", () => {
    assert.equal(trimTextInput("  Polska Rzeczpospolita  "), "Polska Rzeczpospolita");
    assert.equal(trimTextInput("Mi  200"), "Mi  200");
  });

  it("keeps the line breaks and indentation inside a longer text", () => {
    const template = "Heading\n\n    indented line\n  another\n\nlast";
    assert.equal(trimTextInput(`\n  ${template}\n\n  `), template);
  });

  it("counts a non-breaking space as whitespace, which is what pasting leaves behind", () => {
    assert.equal(trimTextInput(" Poland "), "Poland");
  });

  it("turns a value of nothing but whitespace into the empty string", () => {
    assert.equal(trimTextInput("   "), "");
    assert.equal(trimTextInput("\n\t  "), "");
  });

  it("leaves a value that needs no trimming as it is", () => {
    assert.equal(trimTextInput("Poland"), "Poland");
    assert.equal(trimTextInput(""), "");
  });
});

describe("isBlankTextInput", () => {
  it("does not tell typed spaces from empty", () => {
    assert.equal(isBlankTextInput(""), true);
    assert.equal(isBlankTextInput("   "), true);
    assert.equal(isBlankTextInput("\n "), true);
  });

  it("is false the moment there is anything to keep", () => {
    assert.equal(isBlankTextInput(" x "), false);
    assert.equal(isBlankTextInput("0"), false);
  });
});
