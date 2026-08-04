import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  categoryLookupTiers,
  deriveAllegroCategoryKey,
  explainCategoryMatch,
  isBlankParameterValue,
  isEmptyCategoryKey,
  pickLessonForTiers,
  readParameterValue,
  type AllegroCategoryKey,
  type MatchableLesson,
} from "../../src/lib/allegro-category-rules";

const copy = (
  areaId: string | null,
  issuedYear: number | null,
  conditionId: string | null,
  subtypeId: string | null
) => ({ areaId, issuedYear, conditionId, subtypeId });

describe("deriveAllegroCategoryKey", () => {
  it("takes every fact from a homogeneous offer", () => {
    const { key, mixedOn } = deriveAllegroCategoryKey([
      copy("pl", 1935, "used", "definitive"),
      copy("pl", 1935, "used", "definitive"),
    ]);
    assert.deepEqual(key, {
      areaId: "pl",
      issuedYear: 1935,
      conditionId: "used",
      subtypeId: "definitive",
    });
    assert.deepEqual(mixedOn, []);
  });

  it("drops only the axis the copies disagree about", () => {
    // The whole point of the partial key: a bundle spanning two years still asks about its area,
    // condition and subtype.
    const { key, mixedOn } = deriveAllegroCategoryKey([
      copy("pl", 1935, "used", "definitive"),
      copy("pl", 1938, "used", "definitive"),
    ]);
    assert.equal(key.issuedYear, null);
    assert.equal(key.areaId, "pl");
    assert.equal(key.conditionId, "used");
    assert.deepEqual(mixedOn, ["year"]);
  });

  it("counts a missing value as a disagreement with a present one", () => {
    // "Some of them have a year" is not a year.
    const { key, mixedOn } = deriveAllegroCategoryKey([
      copy("pl", 1935, "used", null),
      copy("pl", null, "used", null),
    ]);
    assert.equal(key.issuedYear, null);
    assert.deepEqual(mixedOn, ["year"]);
    // A fact absent from *every* copy is not a disagreement — it is simply absent.
    assert.equal(key.subtypeId, null);
    assert.ok(!mixedOn.includes("subtype"));
  });

  it("reports every mixed axis, in key order", () => {
    const { mixedOn } = deriveAllegroCategoryKey([
      copy("pl", 1935, "used", "definitive"),
      copy("de", 1938, "mint", "souvenir"),
    ]);
    assert.deepEqual(mixedOn, ["area", "year", "condition", "subtype"]);
  });

  it("answers an offer with no copies with an empty key", () => {
    const { key, mixedOn } = deriveAllegroCategoryKey([]);
    assert.ok(isEmptyCategoryKey(key));
    assert.deepEqual(mixedOn, []);
  });
});

describe("categoryLookupTiers", () => {
  // Poland → Second Republic, with the sibling branch below Poland so a descendant match is visible.
  const descendants: Record<string, string[]> = {
    republic: ["republic"],
    poland: ["poland", "republic", "provinces"],
    europe: ["europe", "poland", "republic", "provinces", "germany"],
  };
  const descendantsOf = (areaId: string) => descendants[areaId] ?? [areaId];
  const fullKey: AllegroCategoryKey = {
    areaId: "republic",
    issuedYear: 1935,
    conditionId: "used",
    subtypeId: "definitive",
  };

  it("relaxes the year, then the subtype, then the area — in that order", () => {
    const tiers = categoryLookupTiers(fullKey, ["republic", "poland", "europe"], descendantsOf);
    assert.deepEqual(
      tiers.map((t) => `${t.areaId}:${t.relaxed.join("+") || "exact"}`),
      [
        "republic:exact",
        "republic:year",
        "republic:year+subtype",
        "poland:area",
        "poland:year+area",
        "poland:year+subtype+area",
        "europe:area",
        "europe:year+area",
        "europe:year+subtype+area",
      ]
    );
  });

  it("never drops the condition", () => {
    const tiers = categoryLookupTiers(fullKey, ["republic", "poland"], descendantsOf);
    assert.ok(tiers.every((t) => t.conditionId === "used"));
  });

  it("asks each area rung about that node and everything below it", () => {
    const tiers = categoryLookupTiers(fullKey, ["republic", "poland"], descendantsOf);
    assert.deepEqual(tiers[0].areaIds, ["republic"]);
    // The rung above reaches the sibling branch, which is the point of walking up.
    assert.deepEqual(tiers[3].areaIds, ["poland", "republic", "provinces"]);
    assert.equal(tiers[3].areaDistance, 1);
  });

  it("does not repeat a rung for a part the key never had", () => {
    // Nothing to give up on either axis, so one area rung is one question rather than three.
    const key: AllegroCategoryKey = {
      areaId: "republic",
      issuedYear: null,
      conditionId: "used",
      subtypeId: null,
    };
    const tiers = categoryLookupTiers(key, ["republic", "poland"], descendantsOf);
    assert.equal(tiers.length, 2);
    assert.deepEqual(tiers[0].relaxed, []);
    assert.deepEqual(tiers[1].relaxed, ["area"]);
  });

  it("keeps the subtype rung when only the year is absent", () => {
    const key: AllegroCategoryKey = {
      areaId: "republic",
      issuedYear: null,
      conditionId: "used",
      subtypeId: "definitive",
    };
    const tiers = categoryLookupTiers(key, ["republic"], descendantsOf);
    assert.deepEqual(
      tiers.map((t) => t.relaxed.join("+") || "exact"),
      ["exact", "subtype"]
    );
  });

  it("still asks about a key with no area, and has nothing to walk", () => {
    const key: AllegroCategoryKey = {
      areaId: null,
      issuedYear: 1935,
      conditionId: "used",
      subtypeId: "definitive",
    };
    const tiers = categoryLookupTiers(key, [], descendantsOf);
    assert.equal(tiers.length, 3);
    assert.ok(tiers.every((t) => t.areaId === null && t.areaIds.length === 0));
  });
});

describe("pickLessonForTiers", () => {
  const descendants: Record<string, string[]> = {
    republic: ["republic"],
    poland: ["poland", "republic", "provinces"],
  };
  const descendantsOf = (areaId: string) => descendants[areaId] ?? [areaId];
  const key: AllegroCategoryKey = {
    areaId: "republic",
    issuedYear: 1935,
    conditionId: "used",
    subtypeId: "definitive",
  };
  const tiers = categoryLookupTiers(key, ["republic", "poland"], descendantsOf);

  const lesson = (over: Partial<MatchableLesson> & { id: string }): MatchableLesson => ({
    areaId: "republic",
    issuedYear: 1935,
    conditionId: "used",
    subtypeId: "definitive",
    categoryId: "cat",
    timesUsed: 1,
    lastUsedAt: 0,
    ...over,
  });

  it("prefers a narrower rung over a better-backed row on a broader one", () => {
    const picked = pickLessonForTiers(
      [
        lesson({ id: "exact", categoryId: "exact-cat" }),
        lesson({ id: "loose", issuedYear: 1938, timesUsed: 99, categoryId: "loose-cat" }),
      ],
      tiers
    );
    assert.equal(picked?.lesson.id, "exact");
    assert.deepEqual(picked?.tier.relaxed, []);
  });

  it("falls to the year-relaxed rung when nothing matches exactly", () => {
    const picked = pickLessonForTiers([lesson({ id: "loose", issuedYear: 1938 })], tiers);
    assert.equal(picked?.lesson.id, "loose");
    assert.deepEqual(picked?.tier.relaxed, ["year"]);
  });

  it("reaches a sibling branch by walking up the area tree", () => {
    const picked = pickLessonForTiers([lesson({ id: "sibling", areaId: "provinces" })], tiers);
    assert.equal(picked?.lesson.id, "sibling");
    assert.equal(picked?.tier.areaId, "poland");
    assert.ok(picked?.tier.relaxed.includes("area"));
  });

  it("puts this branch's own row ahead of a sibling's on the same rung", () => {
    const picked = pickLessonForTiers(
      [
        lesson({ id: "sibling", areaId: "provinces", issuedYear: 1938, timesUsed: 50 }),
        lesson({ id: "here", areaId: "poland", issuedYear: 1938, timesUsed: 1 }),
      ],
      tiers
    );
    assert.equal(picked?.lesson.id, "here");
  });

  it("ranks by support, then by which choice was the more recent", () => {
    const picked = pickLessonForTiers(
      [
        lesson({ id: "old", timesUsed: 3, lastUsedAt: 100 }),
        lesson({ id: "backed", timesUsed: 4, lastUsedAt: 1 }),
      ],
      tiers
    );
    assert.equal(picked?.lesson.id, "backed");

    const tie = pickLessonForTiers(
      [
        lesson({ id: "older", timesUsed: 3, lastUsedAt: 100 }),
        lesson({ id: "newer", timesUsed: 3, lastUsedAt: 200 }),
      ],
      tiers
    );
    assert.equal(tie?.lesson.id, "newer");
  });

  it("never answers a stamp's year with a row that was recorded off a mixed offer", () => {
    // The row says nothing about a year, so it cannot be the answer to a rung that asks about one —
    // but the year-relaxed rung reaches it.
    const rows = [lesson({ id: "mixed", issuedYear: null })];
    assert.deepEqual(pickLessonForTiers(rows, tiers)?.tier.relaxed, ["year"]);
  });

  it("answers nothing when no rung matches", () => {
    assert.equal(pickLessonForTiers([lesson({ id: "mint", conditionId: "mint" })], tiers), null);
  });
});

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
