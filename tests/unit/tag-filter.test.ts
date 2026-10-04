import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TAG_FILTER_MODE,
  TAG_FILTER_MODES,
  appendTagFilterParams,
  isTagFilterMode,
  tagFilterFromParams,
  tagFilterTriggerLabel,
  tagFilterWhere,
  tagsMatchFilter,
  NO_TAGS,
} from "../../src/lib/tag-filter";
import {
  readAreaFacetFilters,
  readItemFilters,
  readYearFacetFilters,
} from "../../src/app/api/collections/[collectionId]/items/item-filters";

// The tag filter's two readings (#1182). Everything here is the half that goes wrong silently: an
// `all` that is really an `any` returns a *superset*, which looks like a working filter until the
// day the collector counts, and a URL round trip that drops the mode shows the wrong list through a
// link that looks right. Neither has a type that could catch it.

describe("isTagFilterMode", () => {
  it("accepts the vocabulary and nothing else", () => {
    for (const mode of TAG_FILTER_MODES) assert.equal(isTagFilterMode(mode), true);
    assert.equal(isTagFilterMode("none"), false);
    assert.equal(isTagFilterMode("ALL"), false);
    assert.equal(isTagFilterMode(""), false);
    assert.equal(isTagFilterMode(null), false);
    assert.equal(isTagFilterMode(undefined), false);
  });
});

describe("tagFilterFromParams", () => {
  const read = (qs: string) => tagFilterFromParams(new URLSearchParams(qs));

  it("is the absence of a filter when no tag is named", () => {
    assert.deepEqual(read(""), {});
    assert.deepEqual(read("tagIds="), {});
    // A mode on its own narrows nothing — it is a reading of a selection that is not there.
    assert.deepEqual(read("tagMode=all"), {});
  });

  it("reads a comma-joined list, trimming blanks", () => {
    assert.deepEqual(read("tagIds=a,b"), { tagIds: ["a", "b"], tagMode: "any" });
    assert.deepEqual(read("tagIds=a,,%20b%20,"), { tagIds: ["a", "b"], tagMode: "any" });
  });

  it("defaults the mode, and falls back to the default rather than failing on a stale word", () => {
    assert.equal(read("tagIds=a,b").tagMode, DEFAULT_TAG_FILTER_MODE);
    assert.equal(read("tagIds=a,b&tagMode=all").tagMode, "all");
    // A hand-edited or outdated link must narrow rather than break.
    assert.equal(read("tagIds=a,b&tagMode=every").tagMode, DEFAULT_TAG_FILTER_MODE);
  });
});

describe("appendTagFilterParams", () => {
  const write = (filter: Parameters<typeof appendTagFilterParams>[1]) => {
    const params = new URLSearchParams();
    appendTagFilterParams(params, filter);
    return params.toString();
  };

  it("writes nothing at all when no tag is ticked", () => {
    assert.equal(write({}), "");
    assert.equal(write({ tagIds: [] }), "");
    // The mode never travels on its own, so an untouched filter keys one cache entry whichever
    // reading the control was last left in.
    assert.equal(write({ tagIds: [], tagMode: "all" }), "");
  });

  it("leaves the default mode unspelled and names only the other one", () => {
    assert.equal(write({ tagIds: ["a", "b"] }), "tagIds=a%2Cb");
    assert.equal(write({ tagIds: ["a", "b"], tagMode: "any" }), "tagIds=a%2Cb");
    assert.equal(write({ tagIds: ["a", "b"], tagMode: "all" }), "tagIds=a%2Cb&tagMode=all");
  });

  it("round-trips through the parser it mirrors", () => {
    for (const filter of [
      { tagIds: ["a"], tagMode: "any" as const },
      { tagIds: ["a", "b"], tagMode: "any" as const },
      { tagIds: ["a", "b", "c"], tagMode: "all" as const },
    ]) {
      const params = new URLSearchParams();
      appendTagFilterParams(params, filter);
      assert.deepEqual(tagFilterFromParams(params), filter);
    }
  });
});

describe("tagFilterWhere", () => {
  it("is null when the filter is off, so a caller can tell that from a narrowing", () => {
    assert.equal(tagFilterWhere({}), null);
    assert.equal(tagFilterWhere({ tagIds: [] }), null);
    assert.equal(tagFilterWhere({ tagIds: [], tagMode: "all" }), null);
  });

  it("matches any of the ticked tags by default", () => {
    assert.deepEqual(tagFilterWhere({ tagIds: ["a", "b"] }), {
      tags: { some: { tagId: { in: ["a", "b"] } } },
    });
    assert.deepEqual(tagFilterWhere({ tagIds: ["a", "b"], tagMode: "any" }), {
      tags: { some: { tagId: { in: ["a", "b"] } } },
    });
  });

  it("demands a row per tag under *all* — never one `some` over an `in`", () => {
    // This is the assertion the whole module exists for. One join row carries exactly one `tagId`,
    // so `some: { tagId: { in: [a, b] } }` asks whether *one* row matches either — which is `any`
    // wearing the other word, and it answers with a superset that looks like a working filter.
    assert.deepEqual(tagFilterWhere({ tagIds: ["a", "b"], tagMode: "all" }), {
      AND: [{ tags: { some: { tagId: "a" } } }, { tags: { some: { tagId: "b" } } }],
    });
    assert.deepEqual(tagFilterWhere({ tagIds: ["a", "b", "c"], tagMode: "all" }), {
      AND: [
        { tags: { some: { tagId: "a" } } },
        { tags: { some: { tagId: "b" } } },
        { tags: { some: { tagId: "c" } } },
      ],
    });
  });

  it("is the same clause for one tag under either reading", () => {
    const one = { tags: { some: { tagId: "a" } } };
    assert.deepEqual(tagFilterWhere({ tagIds: ["a"] }), one);
    assert.deepEqual(tagFilterWhere({ tagIds: ["a"], tagMode: "all" }), one);
  });

  it("collapses a repeated id rather than paying for a second join", () => {
    assert.deepEqual(tagFilterWhere({ tagIds: ["a", "a"] }), { tags: { some: { tagId: "a" } } });
    assert.deepEqual(tagFilterWhere({ tagIds: ["a", "a"], tagMode: "all" }), {
      tags: { some: { tagId: "a" } },
    });
  });
});

describe("tagsMatchFilter — the same question asked in memory (#1625)", () => {
  it("lets everything through when the filter is off", () => {
    assert.equal(tagsMatchFilter([], {}), true);
    assert.equal(tagsMatchFilter(["a"], { tagIds: [] }), true);
  });

  it("matches any of the ticked tags by default", () => {
    assert.equal(tagsMatchFilter(["a"], { tagIds: ["a", "b"] }), true);
    assert.equal(tagsMatchFilter(["c"], { tagIds: ["a", "b"] }), false);
    assert.equal(tagsMatchFilter([], { tagIds: ["a"] }), false);
  });

  it("demands every ticked tag under *all*", () => {
    assert.equal(tagsMatchFilter(["a", "b", "c"], { tagIds: ["a", "b"], tagMode: "all" }), true);
    assert.equal(tagsMatchFilter(["a"], { tagIds: ["a", "b"], tagMode: "all" }), false);
  });

  it("reads *no tags* as the untagged, ORed beside the tags as the `where` reads it", () => {
    assert.equal(tagsMatchFilter([], { tagIds: [NO_TAGS] }), true);
    assert.equal(tagsMatchFilter(["a"], { tagIds: [NO_TAGS] }), false);
    assert.equal(tagsMatchFilter(["a"], { tagIds: [NO_TAGS, "a"] }), true);
    assert.equal(tagsMatchFilter([], { tagIds: [NO_TAGS, "a", "b"], tagMode: "all" }), true);
  });
});

describe("tagFilterTriggerLabel", () => {
  it("says what no selection means", () => {
    assert.equal(tagFilterTriggerLabel([], "any"), "All tags");
    assert.equal(tagFilterTriggerLabel([], "all"), "All tags");
  });

  it("lets one tag name itself, the mode having no say over it", () => {
    assert.equal(tagFilterTriggerLabel(["Birds"], "any"), "Birds");
    assert.equal(tagFilterTriggerLabel(["Birds"], "all"), "Birds");
  });

  it("names the mode once it has one, since the list cannot", () => {
    assert.equal(tagFilterTriggerLabel(["Birds", "To check"], "any"), "Any of 2 tags");
    assert.equal(tagFilterTriggerLabel(["Birds", "To check"], "all"), "All of 2 tags");
  });
});

describe("the Copies list's rails read the list's own filters (#1404)", () => {
  // The area and year rails each had a parser of their own beside the list's, and neither learned the
  // tag filter: a tagged list's rails kept counting every copy. Each rail is now the list's filter set
  // less its own axis, and nothing else — held here as equality, so a filter the list learns later
  // cannot miss the rails.
  const sp = new URLSearchParams(
    "tagIds=a,none,b&tagMode=all&areaIds=x,y&year=1950s&conditionIds=c" +
      "&locationId=l&locationExact=true&forSale=true&multiStamp=only&includeGone=true"
  );

  it("the area rail is the list less the area selection", () => {
    const expected = readItemFilters(sp);
    delete expected.areaIds;
    const got = readAreaFacetFilters(sp);
    assert.deepEqual(got, expected);
    assert.deepEqual(got.tagIds, ["a", "none", "b"]);
    assert.equal(got.tagMode, "all");
    assert.equal(got.yearFrom, 1950);
  });

  it("the year rail is the list less the year, a decade's span included", () => {
    const expected = readItemFilters(sp);
    delete expected.year;
    delete expected.yearFrom;
    delete expected.yearTo;
    const got = readYearFacetFilters(sp);
    assert.deepEqual(got, expected);
    assert.deepEqual(got.tagIds, ["a", "none", "b"]);
    assert.deepEqual(got.areaIds, ["x", "y"]);
    assert.equal("yearFrom" in got, false);
    assert.equal("year" in readYearFacetFilters(new URLSearchParams("year=1920")), false);
  });
});
