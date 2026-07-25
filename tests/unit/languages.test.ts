import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeLanguage, languageLabel, COMMON_LANGUAGES } from "../../src/lib/languages";

describe("normalizeLanguage", () => {
  it("lower-cases and trims a code", () => {
    assert.equal(normalizeLanguage("  PL "), "pl");
  });

  it("drops a region suffix", () => {
    assert.equal(normalizeLanguage("pl-PL"), "pl");
    assert.equal(normalizeLanguage("en_GB"), "en");
  });

  it("maps blanks and nullish values to null", () => {
    assert.equal(normalizeLanguage(""), null);
    assert.equal(normalizeLanguage("   "), null);
    assert.equal(normalizeLanguage(null), null);
    assert.equal(normalizeLanguage(undefined), null);
  });
});

describe("languageLabel", () => {
  it("names a known code", () => {
    assert.equal(languageLabel("pl"), "Polish (pl)");
  });

  it("renders an unknown code bare", () => {
    assert.equal(languageLabel("xx"), "xx");
  });
});

describe("COMMON_LANGUAGES", () => {
  it("holds unique, already-normalised codes", () => {
    const codes = COMMON_LANGUAGES.map((l) => l.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const c of codes) assert.equal(normalizeLanguage(c), c);
  });
});
