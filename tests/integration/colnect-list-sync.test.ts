import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  ColnectListMappingValueError,
  getColnectListMappings,
  setColnectListMapping,
} from "../../src/lib/colnect-list-sync";

// The configuration half of Colnect list sync (#684): all four standard lists are always listed,
// mapped or not; a row appears on first touch carrying the built-in defaults plus whatever was
// changed; and the tables the rest of the track needs hang off that row and go with it.

describe("Colnect list mapping (#684)", () => {
  let userId: string;
  let collectionId: string;
  let otherUserId: string;

  before(async () => {
    const suffix = `list-sync-${Date.now()}`;
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
    otherUserId = (
      await prisma.user.create({
        data: {
          id: `test-other-colnect-${suffix}`,
          name: "Other User",
          email: `test-other-colnect-${suffix}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-colnect-${suffix}`,
          name: "Colnect lists",
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("lists every standard list before anything is configured, on its defaults", async () => {
    const rows = await getColnectListMappings(userId, collectionId);
    assert.deepEqual(
      rows.map((r) => [r.lt, r.label, r.source, r.sourceOfTruth, r.enabled, r.configured]),
      [
        [2, "Collection", "items_in_collection", "local", false, false],
        [3, "Swap", "items_for_trade", "local", false, false],
        [4, "Wish", "wants_open", "colnect", false, false],
        [5, "Sell", "items_for_sale", "local", false, false],
      ]
    );
  });

  it("creates the row on first touch, with the defaults under the change", async () => {
    await setColnectListMapping(userId, collectionId, 3, { enabled: true });
    const swap = (await getColnectListMappings(userId, collectionId)).find((r) => r.lt === 3);
    assert.deepEqual(
      [swap?.label, swap?.source, swap?.sourceOfTruth, swap?.enabled, swap?.configured],
      ["Swap", "items_for_trade", "local", true, true]
    );
    // Only the list that was touched exists — the other three are still answers, not rows.
    assert.equal(await prisma.colnectListMapping.count({ where: { collectionId } }), 1);
  });

  it("changes one field without carrying an opinion about the others", async () => {
    await setColnectListMapping(userId, collectionId, 3, { sourceOfTruth: "colnect" });
    const swap = (await getColnectListMappings(userId, collectionId)).find((r) => r.lt === 3);
    assert.equal(swap?.sourceOfTruth, "colnect");
    assert.equal(swap?.enabled, true, "enabling it earlier survives a change to another field");
    assert.equal(swap?.source, "items_for_trade");

    await setColnectListMapping(userId, collectionId, 3, { sourceOfTruth: "local" });
  });

  it("keeps the Wish default even when the row is created by enabling it", async () => {
    await setColnectListMapping(userId, collectionId, 4, { enabled: true });
    const wish = (await getColnectListMappings(userId, collectionId)).find((r) => r.lt === 4);
    assert.equal(wish?.sourceOfTruth, "colnect");
    assert.equal(wish?.source, "wants_open");
  });

  it("refuses a list it does not sync, and a value outside the vocabulary", async () => {
    await assert.rejects(
      () => setColnectListMapping(userId, collectionId, 16, { enabled: true }),
      ColnectListMappingValueError
    );
    await assert.rejects(
      () =>
        setColnectListMapping(userId, collectionId, 2, {
          source: "items_on_loan" as never,
        }),
      ColnectListMappingValueError
    );
    await assert.rejects(
      () =>
        setColnectListMapping(userId, collectionId, 2, {
          sourceOfTruth: "whoever" as never,
        }),
      ColnectListMappingValueError
    );
    assert.equal(
      (await getColnectListMappings(userId, collectionId)).find((r) => r.lt === 2)?.configured,
      false,
      "a refused write leaves no row behind"
    );
  });

  it("answers nothing to somebody else's session", async () => {
    await assert.rejects(() => getColnectListMappings(otherUserId, collectionId));
    await assert.rejects(() =>
      setColnectListMapping(otherUserId, collectionId, 5, { enabled: true })
    );
  });

  it("carries a snapshot and its rows off the mapping, and drops them with it", async () => {
    const mapping = await prisma.colnectListMapping.findUniqueOrThrow({
      where: { collectionId_lt: { collectionId, lt: 3 } },
    });
    const snapshot = await prisma.colnectListSnapshot.create({
      data: {
        mappingId: mapping.id,
        fileName: "colnect-swap.csv",
        exportedAt: new Date("2026-08-22T10:00:00Z"),
        declaredCount: 2,
        rows: {
          create: [
            {
              colnectId: "1153885",
              name: "Iguazú Falls",
              country: "Argentina",
              catalogCodes: "Mi:AR BL176, Sn:AR 2949",
              quantity: 2,
              conditionAbbrev: "MNH",
            },
            // A blank quantity and a blank grade are a real row, not a broken one.
            {
              colnectId: "1153886",
              name: "Perito Moreno",
              country: "Argentina",
              catalogCodes: "Mi:AR 3001",
              quantity: null,
              conditionAbbrev: null,
            },
          ],
        },
      },
      include: { rows: true },
    });
    assert.equal(snapshot.rows.length, 2);

    // A standing acceptance hangs off the mapping and survives the snapshot being replaced (#686).
    await prisma.colnectListDecision.create({
      data: { mappingId: mapping.id, colnectId: "1153885", kind: "only-colnect", note: "sold off" },
    });
    await prisma.colnectListSnapshot.delete({ where: { id: snapshot.id } });
    assert.equal(await prisma.colnectListSnapshotRow.count({ where: { snapshotId: snapshot.id } }), 0);
    assert.equal(await prisma.colnectListDecision.count({ where: { mappingId: mapping.id } }), 1);

    // The same item accepted in both directions is two decisions, not a conflict — the direction can
    // flip between imports, and one acceptance must not swallow the other.
    await prisma.colnectListDecision.create({
      data: { mappingId: mapping.id, colnectId: "1153885", kind: "only-local" },
    });
    await assert.rejects(() =>
      prisma.colnectListDecision.create({
        data: { mappingId: mapping.id, colnectId: "1153885", kind: "only-local" },
      })
    );

    await prisma.colnectListMapping.delete({ where: { id: mapping.id } });
    assert.equal(await prisma.colnectListDecision.count({ where: { mappingId: mapping.id } }), 0);
  });
});
