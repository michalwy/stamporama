import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buyerMaterialLanguage,
  isLanguageCode,
  languageChoices,
  normalizeLanguage,
  languageLabel,
  COMMON_LANGUAGES,
} from "../../src/lib/languages";

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

describe("a material's language choice (#2603)", () => {
  it("offers the collection's default language first, then the ones it uses by name, each once", () => {
    assert.deepEqual(languageChoices("pl", ["de", "en", "DE-at", null, "pl"]), ["pl", "en", "de"]);
  });

  it("keeps a language already chosen that the collection no longer uses", () => {
    assert.deepEqual(languageChoices("pl", ["de"], ["fr", null]), ["pl", "fr", "de"]);
  });

  it("opens in the contact's language, else in the material's own", () => {
    assert.equal(buyerMaterialLanguage("de-DE", "pl", "en"), "de");
    assert.equal(buyerMaterialLanguage(null, null, "en"), "en");
    assert.equal(buyerMaterialLanguage(" ", "pl", "en"), "pl");
    assert.equal(buyerMaterialLanguage(null, null, null), null);
  });

  it("takes two or three letters as a language code", () => {
    assert.equal(isLanguageCode("de"), true);
    assert.equal(isLanguageCode("ces"), true);
    assert.equal(isLanguageCode("german"), false);
    assert.equal(isLanguageCode("d1"), false);
    assert.equal(isLanguageCode(null), false);
  });
});
