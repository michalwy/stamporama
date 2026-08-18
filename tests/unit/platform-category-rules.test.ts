import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  categoryLookupTiers,
  derivePlatformCategoryKey,
  explainLearnedCategoryMatch,
  isEmptyCategoryKey,
  pickLessonForTiers,
  type PlatformCategoryKey,
  type MatchableLesson,
} from "../../src/lib/platform-category-rules";

const copy = (
  areaId: string | null,
  issuedYear: number | null,
  conditionId: string | null,
  subtypeId: string | null
) => ({ areaId, issuedYear, conditionId, subtypeId });

describe("derivePlatformCategoryKey", () => {
  it("takes every fact from a homogeneous offer", () => {
    const { key, mixedOn } = derivePlatformCategoryKey([
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
    const { key, mixedOn } = derivePlatformCategoryKey([
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
    const { key, mixedOn } = derivePlatformCategoryKey([
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
    const { mixedOn } = derivePlatformCategoryKey([
      copy("pl", 1935, "used", "definitive"),
      copy("de", 1938, "mint", "souvenir"),
    ]);
    assert.deepEqual(mixedOn, ["area", "year", "condition", "subtype"]);
  });

  it("answers an offer with no copies with an empty key", () => {
    const { key, mixedOn } = derivePlatformCategoryKey([]);
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
  const fullKey: PlatformCategoryKey = {
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
    const key: PlatformCategoryKey = {
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
    const key: PlatformCategoryKey = {
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
    const key: PlatformCategoryKey = {
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
  const key: PlatformCategoryKey = {
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

describe("explainLearnedCategoryMatch", () => {
  it("names what it matched on and how well backed it is", () => {
    assert.equal(
      explainLearnedCategoryMatch({ matchedOn: ["Poland", "1935", "used"], relaxed: [], timesUsed: 7 }),
      "Learned from Poland · 1935 · used, used 7 times."
    );
  });

  it("says which axes were widened, so a broad match is never mistaken for an exact one", () => {
    assert.equal(
      explainLearnedCategoryMatch({
        matchedOn: ["Poland", "used"],
        relaxed: ["year", "subtype"],
        timesUsed: 1,
      }),
      "Learned from Poland · used, used once — no exact match, so the year and subtype was widened."
    );
  });
});
