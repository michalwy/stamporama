import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addTagEntry,
  commitTagInput,
  findTagByName,
  parseTagEntries,
  splitTagInput,
  suggestTags,
  type TagEntry,
} from "../../src/lib/tag-entry";

// Typing tags into an edit dialog (#1192). What is pinned here is what the issue's decisions say
// and the types cannot: a space ends a name, an existing name in any casing attaches that tag rather
// than a second one, a new tag is coloured the moment it is a chip, and a tag carrying a space is
// still reachable from the suggestions.

const dictionary = [
  { id: "t-birds", name: "Birds", color: "red" },
  { id: "t-check", name: "to-check", color: "amber" },
  { id: "t-box", name: "from grandfather's box", color: null },
];

describe("splitTagInput", () => {
  it("commits every name followed by a space and keeps the unfinished one", () => {
    assert.deepEqual(splitTagInput("birds to-check exp"), { names: ["birds", "to-check"], rest: "exp" });
  });

  it("commits the last name too once a space follows it, and ignores repeated spaces", () => {
    assert.deepEqual(splitTagInput("birds  to-check "), { names: ["birds", "to-check"], rest: "" });
  });

  it("commits nothing while the first word is still being typed", () => {
    assert.deepEqual(splitTagInput("bir"), { names: [], rest: "bir" });
  });
});

describe("findTagByName", () => {
  it("ignores case", () => {
    assert.equal(findTagByName(dictionary, "BIRDS")?.id, "t-birds");
  });

  it("prefers the exact spelling when two tags differ only by case", () => {
    const both = [...dictionary, { id: "t-birds-lower", name: "birds", color: null }];
    assert.equal(findTagByName(both, "birds")?.id, "t-birds-lower");
    assert.equal(findTagByName(both, "Birds")?.id, "t-birds");
  });

  it("does not fold accents — two words that differ by one are two tags", () => {
    assert.equal(findTagByName([{ id: "a", name: "żółw", color: null }], "zolw"), null);
  });
});

describe("addTagEntry", () => {
  it("attaches the existing tag, in the dictionary's spelling, for a name typed in another case", () => {
    const next = addTagEntry([], "bIrDs", dictionary);
    assert.deepEqual(next, [{ id: "t-birds", name: "Birds", color: "red" }]);
  });

  it("creates a new chip with no id, already coloured with the first hue nobody uses", () => {
    const next = addTagEntry([], "expertise", dictionary);
    // red and amber are taken by the dictionary; orange is the first free hue.
    assert.deepEqual(next, [{ id: null, name: "expertise", color: "orange" }]);
  });

  it("counts the other new chips when picking a colour, so two new tags do not share one", () => {
    const one = addTagEntry([], "expertise", dictionary);
    const two = addTagEntry(one, "swap", dictionary);
    assert.equal(two[1].color, "green");
  });

  it("changes nothing for a tag already on the thing, existing or new, in any casing", () => {
    const start: TagEntry[] = [
      { id: "t-birds", name: "Birds", color: "red" },
      { id: null, name: "expertise", color: "orange" },
    ];
    assert.deepEqual(addTagEntry(start, "birds", dictionary), start);
    assert.deepEqual(addTagEntry(start, "EXPERTISE", dictionary), start);
    assert.deepEqual(addTagEntry(start, "   ", dictionary), start);
  });
});

describe("commitTagInput", () => {
  it("turns every typed name into its own chip, the unfinished last one included", () => {
    const next = commitTagInput([], "birds expertise swap", dictionary);
    assert.deepEqual(
      next.map((e) => [e.id, e.name]),
      [
        ["t-birds", "Birds"],
        [null, "expertise"],
        [null, "swap"],
      ]
    );
  });
});

describe("suggestTags", () => {
  it("offers nothing for an empty query", () => {
    assert.deepEqual(suggestTags(dictionary, "  ", []), []);
  });

  it("matches anywhere in the name, so a tag with a space in it can still be picked", () => {
    assert.deepEqual(
      suggestTags(dictionary, "grand", []).map((t) => t.id),
      ["t-box"]
    );
  });

  it("puts names starting with the query first, and leaves out tags already on the thing", () => {
    const dict = [
      { id: "1", name: "Rebirds", color: null },
      { id: "2", name: "birds", color: null },
      { id: "3", name: "Birdsong", color: null },
    ];
    assert.deepEqual(
      suggestTags(dict, "bird", []).map((t) => t.id),
      ["2", "3", "1"]
    );
    assert.deepEqual(
      suggestTags(dict, "bird", [{ id: "2", name: "birds", color: null }]).map((t) => t.id),
      ["3", "1"]
    );
  });
});

describe("parseTagEntries", () => {
  it("is undefined when the field was not submitted or cannot be read — leave the tags alone", () => {
    assert.equal(parseTagEntries(null), undefined);
    assert.equal(parseTagEntries(""), undefined);
    assert.equal(parseTagEntries("{not json"), undefined);
    assert.equal(parseTagEntries("{}"), undefined);
  });

  it("is an empty list for an empty set — take every tag off", () => {
    assert.deepEqual(parseTagEntries("[]"), []);
  });

  it("keeps ids and names, trims names, drops empty rows and unknown colours", () => {
    const raw = JSON.stringify([
      { id: "t-birds", name: "Birds", color: "red" },
      { id: null, name: "  swap ", color: "chartreuse" },
      { id: null, name: "   " },
      42,
    ]);
    assert.deepEqual(parseTagEntries(raw), [
      { id: "t-birds", name: "Birds", color: "red" },
      { id: null, name: "swap", color: null },
    ]);
  });
});
