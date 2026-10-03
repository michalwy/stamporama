import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addFaultEntry,
  findFaultByName,
  parseFaultEntries,
  suggestFaults,
} from "../../src/lib/fault-entry";

// Choosing a copy's faults in its dialog (#1557). A fault name carries spaces, so unlike a tag it is
// never split on one; a typed name the dictionary holds in another casing attaches that fault rather
// than becoming a near-duplicate.

const dictionary = [
  { id: "f1", name: "Thin" },
  { id: "f2", name: "Thinned gum" },
  { id: "f3", name: "Crease" },
  { id: "f4", name: "Hinge remnant" },
];

describe("findFaultByName", () => {
  it("prefers the exact spelling, then ignores case", () => {
    const both = [...dictionary, { id: "f5", name: "thin" }];
    assert.equal(findFaultByName(both, "thin")?.id, "f5");
    assert.equal(findFaultByName(dictionary, "THINNED GUM")?.id, "f2");
    assert.equal(findFaultByName(dictionary, "Tear"), null);
  });
});

describe("addFaultEntry", () => {
  it("keeps a name with spaces whole", () => {
    assert.deepEqual(addFaultEntry([], "  Short perforation ", dictionary), [
      { id: null, name: "Short perforation" },
    ]);
  });

  it("attaches the dictionary's fault for a name in any casing", () => {
    assert.deepEqual(addFaultEntry([], "hinge REMNANT", dictionary), [
      { id: "f4", name: "Hinge remnant" },
    ]);
  });

  it("changes nothing for a blank name or one already chosen", () => {
    const chosen = [{ id: "f3", name: "Crease" }, { id: null, name: "Tear" }];
    assert.deepEqual(addFaultEntry(chosen, " ", dictionary), chosen);
    assert.deepEqual(addFaultEntry(chosen, "crease", dictionary), chosen);
    assert.deepEqual(addFaultEntry(chosen, "TEAR", dictionary), chosen);
  });
});

describe("suggestFaults", () => {
  it("offers every fault not yet chosen, in the dictionary's order, with no text", () => {
    assert.deepEqual(
      suggestFaults(dictionary, "", [{ id: "f2", name: "Thinned gum" }]).map((f) => f.id),
      ["f1", "f3", "f4"]
    );
  });

  it("puts names starting with the text first, then those containing it", () => {
    assert.deepEqual(suggestFaults(dictionary, "re", []).map((f) => f.id), ["f3", "f4"]);
    assert.deepEqual(suggestFaults(dictionary, "in", []).map((f) => f.id), ["f1", "f2", "f4"]);
    assert.deepEqual(suggestFaults(dictionary, "hin", []).map((f) => f.id), ["f4", "f1", "f2"]);
  });
});

describe("parseFaultEntries", () => {
  it("is undefined when the field was not submitted or is malformed", () => {
    assert.equal(parseFaultEntries(null), undefined);
    assert.equal(parseFaultEntries(""), undefined);
    assert.equal(parseFaultEntries("{"), undefined);
    assert.equal(parseFaultEntries('{"id":"f1"}'), undefined);
  });

  it("is an empty list for an empty set — every fault taken off", () => {
    assert.deepEqual(parseFaultEntries("[]"), []);
  });

  it("keeps ids and trimmed names, and drops rows with neither", () => {
    assert.deepEqual(
      parseFaultEntries(
        JSON.stringify([{ id: "f1", name: "Thin" }, { id: null, name: "  Tear " }, { name: " " }, 7])
      ),
      [
        { id: "f1", name: "Thin" },
        { id: null, name: "Tear" },
      ]
    );
  });
});
