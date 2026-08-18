import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  explainCategoryMatch,
  isBlankParameterValue,
  parameterDraft,
  parameterValueFromDraft,
  readParameterValue,
} from "../../src/lib/allegro-category-rules";

describe("explainCategoryMatch", () => {
  it("names what an exact match was matched on, and how well backed it is", () => {
    assert.equal(
      explainCategoryMatch({
        source: "learned",
        matchedOn: ["Poland", "1935", "used"],
        relaxed: [],
        timesUsed: 7,
      }),
      "Learned from Poland · 1935 · used, used 7 times."
    );
  });

  it("says a single publish is a single publish", () => {
    assert.match(
      explainCategoryMatch({ source: "learned", matchedOn: ["Poland"], relaxed: [], timesUsed: 1 }),
      /used once\.$/
    );
  });

  it("says which axes were widened when nothing matched exactly", () => {
    assert.equal(
      explainCategoryMatch({
        source: "learned",
        matchedOn: ["Poland", "used"],
        relaxed: ["year", "area"],
        timesUsed: 2,
      }),
      "Learned from Poland · used, used 2 times — no exact match, so the year and area was widened."
    );
  });

  it("distinguishes Allegro's own guess from a learned one, and both from nothing", () => {
    assert.match(
      explainCategoryMatch({ source: "allegro", matchedOn: [], relaxed: [], timesUsed: null }),
      /Allegro's own suggestion/
    );
    assert.match(
      explainCategoryMatch({ source: "none", matchedOn: [], relaxed: [], timesUsed: null }),
      /Nothing learned yet/
    );
  });
});

describe("parameter values", () => {
  it("reads the three shapes Allegro takes", () => {
    assert.deepEqual(readParameterValue({ valuesIds: ["1"] }), { valuesIds: ["1"] });
    assert.deepEqual(readParameterValue({ values: ["1935"] }), { values: ["1935"] });
    assert.deepEqual(readParameterValue({ rangeValue: { from: "1", to: "5" } }), {
      rangeValue: { from: "1", to: "5" },
    });
  });

  it("drops anything it cannot vouch for rather than sending it", () => {
    assert.equal(readParameterValue(null), null);
    assert.equal(readParameterValue("dictionary"), null);
    assert.equal(readParameterValue({ valuesIds: [1, 2] }), null);
    assert.equal(readParameterValue({ somethingElse: true }), null);
  });

  it("treats a blank answer as nothing learned", () => {
    assert.ok(isBlankParameterValue({ values: ["   "] }));
    assert.ok(isBlankParameterValue({ valuesIds: [] }));
    assert.ok(isBlankParameterValue({ rangeValue: { from: null, to: null } }));
    assert.equal(readParameterValue({ values: [""] }), null);
    assert.ok(!isBlankParameterValue({ values: ["1935"] }));
  });
});

describe("answering a parameter", () => {
  const text = { type: "string", range: false };
  const dictionary = { type: "dictionary", range: false };
  const ranged = { type: "integer", range: true };

  it("opens a field on the value that is stored", () => {
    assert.deepEqual(parameterDraft({ valuesIds: ["7"] }), {
      valuesIds: ["7"],
      values: [],
      from: "",
      to: "",
    });
    assert.deepEqual(parameterDraft({ rangeValue: { from: "1935", to: null } }), {
      valuesIds: [],
      values: [],
      from: "1935",
      to: "",
    });
    assert.deepEqual(parameterDraft(null), { valuesIds: [], values: [], from: "", to: "" });
  });

  it("sends each type by the member it answers with", () => {
    assert.deepEqual(parameterValueFromDraft(dictionary, parameterDraft({ valuesIds: ["7"] })), {
      valuesIds: ["7"],
    });
    assert.deepEqual(parameterValueFromDraft(text, parameterDraft({ values: ["Poland"] })), {
      values: ["Poland"],
    });
    assert.deepEqual(
      parameterValueFromDraft(ranged, parameterDraft({ rangeValue: { from: "1", to: "5" } })),
      { rangeValue: { from: "1", to: "5" } }
    );
  });

  it("leaves a blank answer out rather than sending it empty", () => {
    assert.equal(parameterValueFromDraft(text, parameterDraft(null)), null);
    assert.equal(parameterValueFromDraft(text, parameterDraft({ values: ["  "] })), null);
    assert.equal(parameterValueFromDraft(dictionary, parameterDraft({ valuesIds: [] })), null);
    assert.equal(
      parameterValueFromDraft(ranged, parameterDraft({ rangeValue: { from: " ", to: null } })),
      null
    );
  });

  it("takes one end of a range on its own", () => {
    assert.deepEqual(parameterValueFromDraft(ranged, parameterDraft({ rangeValue: { from: "1935", to: null } })), {
      rangeValue: { from: "1935", to: null },
    });
  });
});
