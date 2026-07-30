import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getColnectConditionMappings,
  setColnectConditionMapping,
  loadColnectConditionMap,
  ColnectConditionValueError,
} from "../../src/lib/colnect";

// The condition side of the Colnect vocabulary translation (#404): every condition is listed
// whether or not it is mapped, only values Colnect actually offers can be stored, and clearing a
// mapping is a delete so "unmapped" has one representation.

describe("Colnect condition mapping (#404)", () => {
  let userId: string;
  let collectionId: string;
  let mnhId: string;
  let usedId: string;
  let fdcId: string;

  before(async () => {
    const suffix = `cond-${Date.now()}`;
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-colnect-${suffix}`,
          name: "Test User",
          email: `test-colnect-${suffix}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-colnect-${suffix}`, name: "Colnect", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const make = async (name: string, abbreviation: string, sortOrder: number) =>
      (
        await prisma.stampCondition.create({
          data: { collectionId, name, abbreviation, sortOrder },
        })
      ).id;
    mnhId = await make("Mint Never Hinged", "MNH", 0);
    usedId = await make("Used", "U", 1);
    fdcId = await make("First Day Cover", "FDC", 2);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("lists every condition in its own order, mapped or not", async () => {
    const rows = await getColnectConditionMappings(userId, collectionId);
    assert.deepEqual(
      rows.map((r) => [r.conditionAbbreviation, r.colnectValue]),
      [
        ["MNH", null],
        ["U", null],
        ["FDC", null],
      ]
    );
  });

  it("stores a grade and reports the label it renders as", async () => {
    await setColnectConditionMapping(userId, mnhId, "1");
    await setColnectConditionMapping(userId, usedId, "4");
    const rows = await getColnectConditionMappings(userId, collectionId);
    const mnh = rows.find((r) => r.stampConditionId === mnhId);
    assert.equal(mnh?.colnectValue, "1");
    assert.equal(mnh?.colnectLabel, "MNH - Mint Never Hinged");
    assert.deepEqual(
      [...(await loadColnectConditionMap(collectionId)).entries()].sort(),
      [
        [mnhId, "1"],
        [usedId, "4"],
      ].sort()
    );
  });

  it("replaces a grade rather than adding a second one", async () => {
    await setColnectConditionMapping(userId, mnhId, "2");
    assert.equal((await loadColnectConditionMap(collectionId)).get(mnhId), "2");
    assert.equal(await prisma.colnectConditionMapping.count({ where: { stampConditionId: mnhId } }), 1);
  });

  it("unmaps by deleting the row, so unmapped has one representation", async () => {
    await setColnectConditionMapping(userId, mnhId, "");
    assert.equal((await loadColnectConditionMap(collectionId)).has(mnhId), false);
    assert.equal(await prisma.colnectConditionMapping.count({ where: { stampConditionId: mnhId } }), 0);
    // Unmapping something that was never mapped is a no-op, not an error.
    await setColnectConditionMapping(userId, fdcId, null);
  });

  it("refuses a value Colnect does not offer", async () => {
    await assert.rejects(
      () => setColnectConditionMapping(userId, fdcId, "9"),
      (err) => err instanceof ColnectConditionValueError
    );
    assert.equal((await loadColnectConditionMap(collectionId)).has(fdcId), false);
  });

  it("refuses a condition in a collection the caller does not own", async () => {
    await assert.rejects(() => setColnectConditionMapping("wrong-user", usedId, "1"), /access denied/i);
    await assert.rejects(() => getColnectConditionMappings("wrong-user", collectionId), /access denied/i);
  });

  it("goes away with the condition it maps", async () => {
    await setColnectConditionMapping(userId, fdcId, "5");
    await prisma.stampCondition.delete({ where: { id: fdcId } });
    assert.equal((await loadColnectConditionMap(collectionId)).has(fdcId), false);
  });
});
