import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HOLDINGS_FIGURES,
  holdingsFigureFilters,
  holdingsFigureParams,
} from "../../src/lib/overview-rules";
import {
  REMEMBERED_FILTER_KEYS,
  exactCopiesListHref,
} from "../../src/app/c/[collectionSlug]/inventory/copies-list-filters";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";

// The Overview's holdings tile (#1398): each figure is counted under one filter and links to the
// Copies list under another spelling of it — the URL. *Each count matches the Copies list filtered
// the same way* holds only if the two spellings name the same set, so the link is read back here
// through the list endpoint's own parser and compared with what was counted.

/** The filters with every absent key dropped, so `{ forSale: undefined }` and `{}` compare equal. */
function defined(filters: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined));
}

function linkParams(href: string): URLSearchParams {
  return new URLSearchParams(href.slice(href.indexOf("?") + 1));
}

describe("holdings figures (#1398)", () => {
  it("links every figure to exactly the copies it counts", () => {
    for (const figure of HOLDINGS_FIGURES) {
      const href = exactCopiesListHref("/c/mine", holdingsFigureParams(figure));
      assert.deepEqual(
        defined(readItemFilters(linkParams(href))),
        defined(holdingsFigureFilters(figure)),
        figure.key
      );
    }
  });

  it("counts over the Copies list's default scope — nothing gone, nothing disposed", () => {
    for (const figure of HOLDINGS_FIGURES) {
      const filters = holdingsFigureFilters(figure);
      assert.equal(filters.excludeGone, true, figure.key);
      assert.equal(filters.includeDisposed, undefined, figure.key);
    }
  });

  it("narrows each figure but the total by exactly one disposition or delivery state", () => {
    assert.deepEqual(
      Object.fromEntries(HOLDINGS_FIGURES.map((f) => [f.key, holdingsFigureParams(f)])),
      {
        total: {},
        inCollection: { inCollection: "true" },
        forSale: { forSale: "true" },
        forTrade: { forTrade: "true" },
        ordered: { deliveryStates: "ordered" },
        inTransit: { deliveryStates: "in_transit" },
        toSort: { deliveryStates: "to_sort" },
      }
    );
  });
});

describe("exactCopiesListHref (#1398)", () => {
  it("names every remembered filter, the platform worklist, and all areas and years", () => {
    const params = linkParams(exactCopiesListHref("/c/mine", { forSale: "true" }));
    for (const key of REMEMBERED_FILTER_KEYS) {
      assert.ok(params.has(key), key);
      assert.equal(params.get(key), key === "forSale" ? "true" : "", key);
    }
    assert.equal(params.get("notOfferedPlatform"), "");
    assert.equal(params.get("areaId"), "all");
    assert.equal(params.get("year"), "all");
  });

  it("opens the Copies list under the collection", () => {
    assert.ok(exactCopiesListHref("/c/mine", {}).startsWith("/c/mine/inventory?"));
  });
});
