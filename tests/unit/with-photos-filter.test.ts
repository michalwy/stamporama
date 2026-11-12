import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";
import {
  REMEMBERED_FILTER_KEYS,
  exclusiveSpareSelection,
} from "../../src/app/c/[collectionSlug]/inventory/copies-list-filters";

// *With photos* on the Copies list (#2491): the opposite of *No photos*, a *More filters* switch
// remembered with the list's other filters (so a filter preset carries it, #2487) and read by every
// Copies route through the one parser — the offer generator's included.

describe("With photos on the Copies list (#2491)", () => {
  it("is remembered with the list's other filters, so presets and Reset filters reach it", () => {
    assert.ok((REMEMBERED_FILTER_KEYS as readonly string[]).includes("withPhotos"));
  });

  it("narrows only on an explicit true", () => {
    assert.equal(readItemFilters(new URLSearchParams("withPhotos=true")).withPhotos, true);
    assert.equal(readItemFilters(new URLSearchParams("withPhotos=1")).withPhotos, undefined);
    assert.equal(readItemFilters(new URLSearchParams("")).withPhotos, undefined);
  });
});

describe("No photos and With photos exclude each other (#2491)", () => {
  it("ticking With photos unticks No photos", () => {
    assert.deepEqual(
      exclusiveSpareSelection(["noPhotos", "includeGone"], ["noPhotos", "includeGone", "withPhotos"]),
      ["includeGone", "withPhotos"]
    );
  });

  it("ticking No photos unticks With photos", () => {
    assert.deepEqual(
      exclusiveSpareSelection(["withPhotos"], ["withPhotos", "noPhotos"]),
      ["noPhotos"]
    );
  });

  it("leaves every other switch alone", () => {
    assert.deepEqual(
      exclusiveSpareSelection(["noPhotos"], ["noPhotos", "missingCatalogValue"]),
      ["noPhotos", "missingCatalogValue"]
    );
    assert.deepEqual(exclusiveSpareSelection(["withPhotos"], []), []);
  });

  it("keeps No photos when both arrive with neither new", () => {
    assert.deepEqual(
      exclusiveSpareSelection(["noPhotos", "withPhotos"], ["noPhotos", "withPhotos"]),
      ["noPhotos"]
    );
  });
});
