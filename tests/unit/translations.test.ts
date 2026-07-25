import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseTranslationValues,
  syncEntityTranslations,
  translationsByLanguage,
  resolveTranslation,
  translationFieldName,
  type TranslationValueMap,
} from "../../src/lib/translations";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

describe("parseTranslationValues", () => {
  it("reads `<field>:<lang>` inputs into a language-major map", () => {
    const values = parseTranslationValues(
      form({ name: "Mint Never Hinged", "name:pl": "Czyste", "abbreviation:pl": "**" }),
      ["name", "abbreviation"]
    );
    assert.deepEqual(values, { pl: { name: "Czyste", abbreviation: "**" } });
  });

  it("ignores the plain default-language inputs the same form carries", () => {
    const values = parseTranslationValues(form({ name: "Poland", titleName: "Poland" }), ["name"]);
    assert.deepEqual(values, {});
  });

  it("ignores fields it was not asked for", () => {
    const values = parseTranslationValues(form({ "name:pl": "Czyste", "notes:pl": "x" }), ["name"]);
    assert.deepEqual(values, { pl: { name: "Czyste" } });
  });

  it("keeps a blank value as null so a cleared input can delete the row", () => {
    const values = parseTranslationValues(form({ "name:pl": "   " }), ["name"]);
    assert.deepEqual(values, { pl: { name: null } });
  });

  it("normalises the language code", () => {
    const values = parseTranslationValues(form({ "name:PL-pl": "Czyste" }), ["name"]);
    assert.deepEqual(values, { pl: { name: "Czyste" } });
  });
});

describe("syncEntityTranslations", () => {
  /** Record the calls a sync makes, in order, instead of touching a database. */
  function recorder() {
    const upserts: [string, Record<string, string | null>][] = [];
    const removals: string[] = [];
    return {
      upserts,
      removals,
      handlers: {
        upsert: async (language: string, fields: Record<string, string | null>) => {
          upserts.push([language, fields]);
        },
        remove: async (language: string) => {
          removals.push(language);
        },
      },
    };
  }

  it("upserts a language with any non-blank field", async () => {
    const r = recorder();
    await syncEntityTranslations({ pl: { name: "Czyste", abbreviation: "" } }, r.handlers);
    assert.deepEqual(r.upserts, [["pl", { name: "Czyste", abbreviation: null }]]);
    assert.deepEqual(r.removals, []);
  });

  it("removes a language whose every field is blank", async () => {
    const r = recorder();
    await syncEntityTranslations({ pl: { name: "  ", abbreviation: null } }, r.handlers);
    assert.deepEqual(r.upserts, []);
    assert.deepEqual(r.removals, ["pl"]);
  });

  it("does nothing for undefined values — the caller does not manage translations", async () => {
    const r = recorder();
    await syncEntityTranslations(undefined, r.handlers);
    assert.deepEqual(r.upserts, []);
    assert.deepEqual(r.removals, []);
  });

  it("touches only the languages present in the record", async () => {
    const r = recorder();
    await syncEntityTranslations({ pl: { name: "Czyste" } } as TranslationValueMap, r.handlers);
    assert.deepEqual(
      r.upserts.map(([lang]) => lang),
      ["pl"]
    );
    assert.deepEqual(r.removals, []);
  });

  it("skips unusable language keys", async () => {
    const r = recorder();
    await syncEntityTranslations({ "  ": { name: "x" } }, r.handlers);
    assert.deepEqual(r.upserts, []);
    assert.deepEqual(r.removals, []);
  });
});

describe("translationsByLanguage", () => {
  it("keeps only languages with a non-blank value for the picked field", () => {
    const rows = [
      { language: "pl", name: "Czyste", abbreviation: null },
      { language: "de", name: "  ", abbreviation: "**" },
      { language: "fr", name: null, abbreviation: null },
    ];
    assert.deepEqual(translationsByLanguage(rows, (r) => r.name), { pl: "Czyste" });
    assert.deepEqual(translationsByLanguage(rows, (r) => r.abbreviation), { de: "**" });
  });
});

describe("resolveTranslation", () => {
  const rows = [
    { language: "pl", name: "Czyste", abbreviation: null },
    { language: "de", name: "", abbreviation: "**" },
  ];

  it("returns the translated value for the language", () => {
    assert.equal(resolveTranslation(rows, "pl", (r) => r.name, "Mint Never Hinged"), "Czyste");
  });

  it("falls back per field, so one field's translation does not imply the other's", () => {
    assert.equal(resolveTranslation(rows, "pl", (r) => r.abbreviation, "MNH"), "MNH");
    assert.equal(resolveTranslation(rows, "de", (r) => r.name, "Mint Never Hinged"), "Mint Never Hinged");
    assert.equal(resolveTranslation(rows, "de", (r) => r.abbreviation, "MNH"), "**");
  });

  it("falls back for a missing language, a null language, and no rows at all", () => {
    assert.equal(resolveTranslation(rows, "fr", (r) => r.name, "Mint Never Hinged"), "Mint Never Hinged");
    assert.equal(resolveTranslation(rows, null, (r) => r.name, "Mint Never Hinged"), "Mint Never Hinged");
    // No rows at all — the row type has to be named, since there is nothing to infer it from.
    assert.equal(
      resolveTranslation<(typeof rows)[number]>(undefined, "pl", (r) => r.name, "Mint Never Hinged"),
      "Mint Never Hinged"
    );
  });

  it("preserves a null fallback, so an absent entity stays absent", () => {
    assert.equal(resolveTranslation(rows, "fr", (r) => r.name, null), null);
  });
});

describe("translationFieldName", () => {
  it("matches the convention the parser reads back", () => {
    assert.equal(translationFieldName("abbreviation", "pl"), "abbreviation:pl");
    const values = parseTranslationValues(
      form({ [translationFieldName("abbreviation", "pl")]: "**" }),
      ["abbreviation"]
    );
    assert.deepEqual(values, { pl: { abbreviation: "**" } });
  });
});
