import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkDatePart,
  checkTranslationLanguage,
  duplicateCatalogNumbers,
  parseIssuePrefixes,
  parseKeyedEntries,
  parseTranslatedNames,
  prefixCollisions,
} from "../../src/lib/agent-api/catalog-edits";
import { ApiError } from "../../src/lib/agent-api/errors";

// The pure half of the catalogue writes (#1438): the `"key: value"` spelling, translated names, the
// forms' date bounds, and the duplicate refusal. The operations themselves are driven end to end in
// `tests/integration/agent-api-catalog-edits.test.ts`.

function refusal(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ApiError, `expected an ApiError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected a refusal");
}

describe("parseKeyedEntries", () => {
  it("splits on the first colon only, trimming both sides", () => {
    assert.deepEqual(parseKeyedEntries(["Mi: 100-105", " Fi :1:2 "], "catalog_numbers", "catalogue", "Mi: 1"), [
      { key: "Mi", value: "100-105" },
      { key: "Fi", value: "1:2" },
    ]);
  });

  it("refuses an entry with no colon or an empty side", () => {
    for (const entry of ["Mi 100", ": 100", "Mi:  "]) {
      const err = refusal(() => parseKeyedEntries([entry], "catalog_numbers", "catalogue", "Mi: 1"));
      assert.equal(err.code, "invalid_request");
      assert.match(err.message, /is not "catalogue: value"/);
    }
  });

  it("refuses a key named twice, whatever its case", () => {
    const err = refusal(() => parseKeyedEntries(["Mi: 1", "mi: 2"], "catalog_numbers", "catalogue", "Mi: 1"));
    assert.match(err.message, /twice/);
  });
});

describe("translated names", () => {
  it("keys names by normalised language", () => {
    const names = parseTranslatedNames(["DE-at: Freimarken", "pl: Znaczki"], "names", ["de", "pl"], "en");
    assert.deepEqual([...names], [
      ["de", "Freimarken"],
      ["pl", "Znaczki"],
    ]);
  });

  it("refuses a language the collection keeps no translations in, naming the ones it does", () => {
    const err = refusal(() => checkTranslationLanguage("fr", "names", ["de", "pl"], "en"));
    assert.deepEqual(err.accepted, ["de", "pl"]);
  });

  it("refuses the collection's own language, which is the plain name", () => {
    const err = refusal(() => checkTranslationLanguage("en", "names", ["de"], "en"));
    assert.match(err.message, /plain "name"/);
  });

  it("says so when the collection keeps no translations at all", () => {
    const err = refusal(() => checkTranslationLanguage("de", "names", [], "en"));
    assert.match(err.message, /keeps no translations/);
  });

  it("refuses two spellings of one language", () => {
    const err = refusal(() => parseTranslatedNames(["de: A", "de-DE: B"], "names", ["de"], "en"));
    assert.match(err.message, /twice/);
  });
});

describe("checkDatePart", () => {
  it("holds the forms' bounds", () => {
    assert.equal(checkDatePart(1840, "year", "year"), 1840);
    assert.equal(checkDatePart(2100, "year", "year"), 2100);
    assert.equal(checkDatePart(12, "issued_month", "month"), 12);
    assert.equal(checkDatePart(31, "issued_day", "day"), 31);
    for (const [value, part] of [[1839, "year"], [2101, "year"], [0, "month"], [13, "month"], [0, "day"], [32, "day"]] as const) {
      assert.equal(refusal(() => checkDatePart(value, "x", part)).code, "invalid_request");
    }
  });
});

describe("duplicateCatalogNumbers", () => {
  it("names every existing stamp and hands their ids back", () => {
    const err = duplicateCatalogNumbers([
      {
        label: "Mi·PL 200",
        stamps: [{ stampId: "s1", name: "Eagle", issueName: "Definitives", issueYear: 1924 }],
      },
      {
        label: "Mi·PL 201",
        stamps: [
          { stampId: "s2", name: null, issueName: null, issueYear: null },
          { stampId: "s1", name: "Eagle", issueName: "Definitives", issueYear: 1924 },
        ],
      },
      { label: "Mi·PL 202", stamps: [] },
    ]);
    assert.equal(err.code, "invalid_request");
    assert.match(err.message, /Mi·PL 200 is already "Eagle" in Definitives, 1924 \(id s1\)/);
    assert.match(err.message, /Mi·PL 201 is already a stamp \(id s2\) and "Eagle"/);
    assert.doesNotMatch(err.message, /202/);
    assert.match(err.message, /Nothing was written/);
    assert.deepEqual(err.accepted, ["s1", "s2"]);
  });
});

describe("an issue's own prefixes (#1606)", () => {
  it("reads a prefix of its own and a hand-back to the area", () => {
    assert.deepEqual(parseIssuePrefixes(["Mi: GG", " Fi "], "prefixes"), [
      { key: "Mi", prefix: "GG" },
      { key: "Fi", prefix: null },
    ]);
  });

  it("refuses *no prefix*, which an issue cannot state, and says where it can be said", () => {
    const err = refusal(() => parseIssuePrefixes(["Mi: -"], "prefixes"));
    assert.equal(err.code, "invalid_request");
    assert.match(err.message, /an issue cannot state that/);
    assert.match(err.message, /update_area/);
  });

  it("refuses a catalogue named twice", () => {
    const err = refusal(() => parseIssuePrefixes(["Mi: GG", "mi"], "prefixes"));
    assert.match(err.message, /twice/);
  });

  it("names the issue's stamp and the stamp already holding the number, and hands the holders back", () => {
    const err = prefixCollisions([
      {
        label: "Mi·GG 5",
        issueStampIds: ["own1"],
        holders: [{ stampId: "h1", name: "Krakow", issueName: "Views", issueYear: 1940 }],
      },
      { label: "Mi·GG 6", issueStampIds: ["own2"], holders: [] },
    ]);
    assert.equal(err.code, "invalid_request");
    assert.match(err.message, /Mi·GG 5 would be this issue's stamp \(id own1\) and is already "Krakow" in Views, 1940 \(id h1\)/);
    assert.doesNotMatch(err.message, /Mi·GG 6/);
    assert.match(err.message, /Nothing was written/);
    assert.deepEqual(err.accepted, ["h1"]);
  });
});
