import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createLotBuilderPreset,
  deleteLotBuilderPreset,
  getLotBuilderPresets,
  updateLotBuilderPreset,
} from "../../src/lib/lot-builder-presets";
import { toLotRecipe, type LotRecipe } from "../../src/lib/lot-builder-criteria";

// Saved bulk-lot criteria (#773).
//
// What is pinned here is everything the pure `LotRecipe` round trip cannot reach: that a preset is
// **collection data** and is scoped and owner-checked like any other, that the money axes survive a
// `Decimal` column as the plain numbers the criteria are made of, that a name is unique within a
// collection, and that an update writes the recipe **whole** rather than merging into what the row
// used to say — the property that makes a preset mean the same thing whatever was on screen when it
// was applied.

const ts = Date.now();

function recipe(overrides: Partial<LotRecipe> = {}): LotRecipe {
  return toLotRecipe({
    yearFrom: null,
    yearTo: null,
    conditionIds: [],
    formatIds: [],
    maxCatalogValue: null,
    countMin: null,
    countMax: null,
    valueMin: null,
    valueMax: null,
    series: "neutral",
    maxPerStamp: null,
    duplicates: "neutral",
    nameTemplate: null,
    descriptionTemplate: null,
    ...overrides,
  });
}

describe("the bulk-lot builder's saved criteria (#773)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;

  before(async () => {
    userId = `test-user-lotpreset-${ts}`;
    otherUserId = `test-user-lotpreset-other-${ts}`;
    for (const [id, tag] of [
      [userId, "lotpreset"],
      [otherUserId, "lotpreset-other"],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${tag}-${ts}`,
          email: `test-${tag}-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-lotpreset-${ts}`, name: "Lots", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("keeps every axis of the recipe across the round trip through the row", async () => {
    const full = recipe({
      yearFrom: 1950,
      yearTo: 1960,
      conditionIds: ["cond-u", "cond-mnh"],
      formatIds: ["single", "fmt-block"],
      // The money axes are `Decimal` columns and come back as objects; the criteria are made of
      // plain numbers, and a fractional ceiling is an ordinary thing to want.
      maxCatalogValue: 2.5,
      countMin: 90,
      countMax: 110,
      valueMin: 40.25,
      valueMax: 80.5,
      series: "preferComplete",
      maxPerStamp: 3,
      duplicates: "preferDuplicates",
    });
    const created = await createLotBuilderPreset(userId, collectionId, `Full ${ts}`, full);
    assert.deepEqual(created.recipe, full);

    const listed = await getLotBuilderPresets(userId, collectionId);
    assert.deepEqual(listed.find((p) => p.id === created.id)?.recipe, full);

    await deleteLotBuilderPreset(userId, created.id);
  });

  it("writes an update whole, so a preset says the same thing whatever it used to say", async () => {
    const created = await createLotBuilderPreset(
      userId,
      collectionId,
      `Whole ${ts}`,
      recipe({ yearFrom: 1950, conditionIds: ["cond-u"], maxCatalogValue: 5, countMin: 100 })
    );
    const updated = await updateLotBuilderPreset(
      userId,
      created.id,
      `Whole renamed ${ts}`,
      recipe({ countMin: 20 })
    );
    assert.equal(updated.name, `Whole renamed ${ts}`, "update doubles as a rename");
    assert.equal(updated.recipe.countMin, 20);
    assert.equal(updated.recipe.yearFrom, null, "an axis the new recipe is silent about is cleared");
    assert.equal(updated.recipe.maxCatalogValue, null);
    assert.deepEqual(updated.recipe.conditionIds, []);

    await deleteLotBuilderPreset(userId, created.id);
  });

  it("refuses a second preset of the same name in one collection", async () => {
    const first = await createLotBuilderPreset(userId, collectionId, `Twice ${ts}`, recipe());
    await assert.rejects(() =>
      createLotBuilderPreset(userId, collectionId, `Twice ${ts}`, recipe())
    );
    await deleteLotBuilderPreset(userId, first.id);
  });

  it("is scoped to its collection and checked against its owner", async () => {
    const mine = await createLotBuilderPreset(userId, collectionId, `Scoped ${ts}`, recipe());

    await assert.rejects(
      () => getLotBuilderPresets(otherUserId, collectionId),
      "another user cannot read this collection's presets"
    );
    await assert.rejects(
      () => updateLotBuilderPreset(otherUserId, mine.id, "Taken", recipe()),
      "nor overwrite one"
    );
    await assert.rejects(
      () => deleteLotBuilderPreset(otherUserId, mine.id),
      "nor delete one"
    );

    await deleteLotBuilderPreset(userId, mine.id);
    assert.equal(
      (await getLotBuilderPresets(userId, collectionId)).find((p) => p.id === mine.id),
      undefined
    );
  });

  it("goes with the collection it belongs to", async () => {
    const doomedCollection = (
      await prisma.collection.create({
        data: { slug: `col-lotpreset-gone-${ts}`, name: "Gone", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const preset = await createLotBuilderPreset(userId, doomedCollection, `Cascade ${ts}`, recipe());
    await prisma.collection.delete({ where: { id: doomedCollection } });
    assert.equal(
      await prisma.lotBuilderPreset.findUnique({ where: { id: preset.id } }),
      null,
      "the FK cascades"
    );
  });
});
