import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseSearchFields,
  searchFieldsLabel,
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
