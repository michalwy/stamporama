import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../../src/lib/agent-api/errors";
import { TRANSLATABLE_ENTITY_FIELDS, type TranslatableEntity } from "../../src/lib/translations";
import {
  MAX_TRANSLATION_WRITES,
  TRANSLATION_KINDS,
  checkCollectionLanguage,
  parseTranslationEntries,
  parseTranslationKey,
  translationEntity,
  translationKey,
  translationTarget,
  translationTargets,
} from "../../src/lib/agent-api/translations";

// The pure half of the translation operations (#1452): the key naming one text, the `"key: text"`
// entries a write is spelled in, and the language check. The operations are driven end to end in
// `tests/integration/agent-api-translations.test.ts`.

const refusal = (pattern: RegExp) => (err: unknown) =>
  err instanceof ApiError && err.code === "invalid_request" && pattern.test(err.message);

describe("the kinds", () => {
  it("are exactly the app's translatable texts, no more and no fewer", () => {
    const entities = TRANSLATION_KINDS.map(translationEntity).sort();
    assert.deepEqual(entities, (Object.keys(TRANSLATABLE_ENTITY_FIELDS) as TranslatableEntity[]).sort());
    const fields = TRANSLATION_KINDS.reduce((n, kind) => n + TRANSLATABLE_ENTITY_FIELDS[translationEntity(kind)].length, 0);
    assert.equal(translationTargets().length, fields);
  });
});

describe("translation keys", () => {
  it("round-trip an entity row and column, in the agent's spelling", () => {
    const area = translationTarget("area", "titleName", "a1");
    assert.equal(translationKey(area), "area.title_name.a1");
    assert.deepEqual(parseTranslationKey("area.title_name.a1", "translations"), area);

    const cert = translationTarget("certificateStatus", "abbreviation", "c1");
    assert.equal(translationKey(cert), "certificate_status.abbreviation.c1");
    assert.deepEqual(parseTranslationKey(" certificate_status.abbreviation.c1 ", "translations"), cert);
  });

  it("refuses a kind, a field or a shape that names no text, with the pairs there are", () => {
    for (const bad of ["copy.name.x1", "stamp.abbreviation.x1", "issue.name", "issue.name.x1.extra", "x1"]) {
      assert.throws(
        () => parseTranslationKey(bad, "translations"),
        (err: unknown) =>
          refusal(/not a text's key/)(err) && (err as ApiError).accepted!.includes("area.title_name")
      );
    }
  });
});

describe("parseTranslationEntries", () => {
  it("splits each entry on its first colon, so a translation may carry colons", () => {
    const [entry] = parseTranslationEntries(["issue.name.i1: Ausgabe: 1950"], "translations");
    assert.equal(entry.key, "issue.name.i1");
    assert.equal(entry.text, "Ausgabe: 1950");
    assert.equal(entry.target.entityType, "issue");
  });

  it("refuses an empty list, too many entries, a blank translation and a key named twice", () => {
    assert.throws(() => parseTranslationEntries([], "translations"), refusal(/at least one/));
    const many = Array.from({ length: MAX_TRANSLATION_WRITES + 1 }, (_, i) => `stamp.name.s${i}: x`);
    assert.throws(() => parseTranslationEntries(many, "translations"), refusal(/at most 100/));
    assert.throws(() => parseTranslationEntries(["stamp.name.s1:  "], "translations"), refusal(/"key: value"/));
    assert.throws(
      () => parseTranslationEntries(["stamp.name.s1: a", "stamp.name.s1: b"], "translations"),
      refusal(/twice/)
    );
  });
});

describe("checkCollectionLanguage", () => {
  it("accepts a language the collection lists or prints in, normalised", () => {
    assert.equal(checkCollectionLanguage("DE", ["de", "pl"], "en"), "de");
  });

  it("refuses the collection's own language, and one it does not use, with the ones there are", () => {
    assert.throws(
      () => checkCollectionLanguage("en", ["de", "pl"], "en"),
      (err: unknown) => refusal(/own language/)(err) && (err as ApiError).accepted!.join() === "de,pl"
    );
    assert.throws(
      () => checkCollectionLanguage("fr", ["de", "pl"], "en"),
      (err: unknown) => refusal(/not a language this collection lists or prints in/)(err)
    );
    assert.throws(() => checkCollectionLanguage("de", [], "en"), refusal(/keeps no translations/));
  });
});
