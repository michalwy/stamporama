import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  onlySearchField,
  parseSearchFields,
  readListSearchParams,
  readQuotedSearch,
  searchFieldsLabel,
  searchTextFilter,
  searchTextMatches,
  toggleSearchField,
  writeSearchFields,
} from "../../src/lib/search-fields";
import { COPY_SEARCH_FIELDS, COPY_SEARCH_FIELD_KEYS } from "../../src/lib/copy-search-fields";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";

// #2238: the fields a search box matches — every one by default, never none, and named on the
// control so a narrowed search reads at a glance.

const keys = COPY_SEARCH_FIELD_KEYS;

describe("parseSearchFields", () => {
  it("reads nothing, every field, and nothing recognised alike as no narrowing", () => {
    assert.equal(parseSearchFields(null, keys), undefined);
    assert.equal(parseSearchFields("", keys), undefined);
    assert.equal(parseSearchFields(keys.join(","), keys), undefined);
    assert.equal(parseSearchFields("gone,also-gone", keys), undefined);
  });

  it("keeps the fields it names, in the list's order, dropping unknown ones", () => {
    assert.deepEqual(parseSearchFields("locationRef,gone,stampName", keys), [
      "stampName",
      "locationRef",
    ]);
  });
});

describe("writeSearchFields", () => {
  it("stores every field ticked as nothing", () => {
    assert.equal(writeSearchFields(keys, keys), "");
    assert.equal(writeSearchFields(["locationRef"], keys), "locationRef");
  });
});

describe("toggleSearchField", () => {
  it("unticks and ticks, in the list's order", () => {
    assert.deepEqual(toggleSearchField(["locationRef", "stampName"], "stampName", keys), [
      "locationRef",
    ]);
    assert.deepEqual(toggleSearchField(["locationRef"], "stampName", keys), [
      "stampName",
      "locationRef",
    ]);
  });

  it("never unticks the last field", () => {
    assert.deepEqual(toggleSearchField(["locationRef"], "locationRef", keys), ["locationRef"]);
  });
});

// #2597: Only — one field ticked, every other one unticked, from any starting choice.
describe("onlySearchField", () => {
  it("ticks the one field alone, whatever was ticked before", () => {
    assert.deepEqual(onlySearchField("catalogNumber", keys), ["catalogNumber"]);
    assert.equal(
      searchFieldsLabel(onlySearchField("catalogNumber", keys), COPY_SEARCH_FIELDS),
      "Catalogue number"
    );
  });

  it("changes nothing on the field already alone", () => {
    assert.deepEqual(onlySearchField("locationRef", keys), ["locationRef"]);
  });
});

describe("searchFieldsLabel", () => {
  it("reads All fields, the one field, or a count", () => {
    assert.equal(searchFieldsLabel(keys, COPY_SEARCH_FIELDS), "All fields");
    assert.equal(searchFieldsLabel(["catalogNumber"], COPY_SEARCH_FIELDS), "Catalogue number");
    assert.equal(searchFieldsLabel(["stampName", "issueName"], COPY_SEARCH_FIELDS), "2 fields");
  });
});

describe("the Copies list's routes", () => {
  it("read the narrowed fields, and none when the parameter is absent", () => {
    assert.deepEqual(
      readItemFilters(new URLSearchParams("search=A038&searchFields=locationRef")).searchFields,
      ["locationRef"]
    );
    assert.equal(readItemFilters(new URLSearchParams("search=A038")).searchFields, undefined);
  });
});

// #2545: text typed in double quotes is matched exactly — the quotes must take the whole text.

describe("readQuotedSearch", () => {
  it("reads text wholly in double quotes as exact, without them", () => {
    assert.deepEqual(readQuotedSearch('"A111"'), { text: "A111", exact: true });
    assert.deepEqual(readQuotedSearch('  " Mi 200 "  '), { text: "Mi 200", exact: true });
    assert.deepEqual(readQuotedSearch('"#123"'), { text: "#123", exact: true });
  });

  it("leaves everything else as typed, quotes included", () => {
    for (const raw of ["A111", '"A111', 'A111"', 'say "A111"', '"A" "B"', '""', '"  "', '"']) {
      assert.deepEqual(readQuotedSearch(raw), { text: raw, exact: false }, raw);
    }
  });
});

describe("readListSearchParams", () => {
  it("unquotes an exact search and flags it", () => {
    assert.deepEqual(readListSearchParams(new URLSearchParams({ search: '"A111"' })), {
      search: "A111",
      searchExact: true,
    });
  });

  it("reads a plain search, and none, as before", () => {
    assert.deepEqual(readListSearchParams(new URLSearchParams({ search: " A111 " })), {
      search: "A111",
    });
    assert.deepEqual(readListSearchParams(new URLSearchParams({ search: '"A111' })), {
      search: '"A111',
    });
    assert.deepEqual(readListSearchParams(new URLSearchParams()), {});
    assert.deepEqual(readListSearchParams(new URLSearchParams({ search: "  " })), {});
  });

  it("reaches the Copies list's filters", () => {
    const f = readItemFilters(new URLSearchParams({ search: '"A111"', searchFields: "locationRef" }));
    assert.equal(f.search, "A111");
    assert.equal(f.searchExact, true);
    assert.equal(readItemFilters(new URLSearchParams({ search: "A111" })).searchExact, undefined);
  });
});

describe("searchTextFilter / searchTextMatches", () => {
  it("contains by default, equals when exact, case aside either way", () => {
    assert.deepEqual(searchTextFilter("A111", false), { contains: "A111", mode: "insensitive" });
    assert.deepEqual(searchTextFilter("A111", true), { equals: "A111", mode: "insensitive" });
    assert.equal(searchTextMatches("A1110", "a111", false), true);
    assert.equal(searchTextMatches("A1110", "a111", true), false);
    assert.equal(searchTextMatches("A111", "a111", true), true);
    assert.equal(searchTextMatches(null, "a111", true), false);
  });
});
