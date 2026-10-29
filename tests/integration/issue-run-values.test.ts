import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getVariantPriceGrid, getVariantSubtrees } from "../../src/lib/variant-prices";
import { getRunCatalogValues } from "../../src/lib/issue-run-values";

// **A checklist run's values are one read** (#2260).
//
// The run window had read each umbrella's tree on its own, and the whole run's prices again as each
// tree came in, so a run of seven umbrella tiles filled in row by row. `getRunCatalogValues` answers
// the trees and every price field — the rows' and the umbrellas' variants' — in one round trip, and
// `getVariantSubtrees` reads several umbrellas' trees as the grid's subtree scope draws each.

describe("a checklist run's values in one read (#2260)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let conditionId: string;
  let catalogNameId: string;
  const ids: Record<string, string> = {};

  before(async () => {
    const ts = Date.now();
    userId = `test-user-runvals-${ts}`;
    otherUserId = `test-user-runvals-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-runvals-${ts}`, name: `Collection runvals-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    catalogNameId = (
      await prisma.catalogName.create({
        data: { vendorId: vendor.id, name: "Michel Polen", currency: "EUR" },
      })
    ).id;
    const edition = await prisma.catalogEdition.create({ data: { catalogNameId, year: 2024 } });
    const areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogNameId },
      })
    ).id;
    await prisma.collectionAreaCatalog.create({ data: { collectionAreaId: areaId, catalogNameId } });
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    // Two umbrellas, 1270 → { 1270a, 1270b } and 1271 → { 1271a, 1271b }, and a plain 1272 — every
    // stamp filed in the area, so each has a field.
    const make = async (name: string, parentId: string | null = null) => {
      const id = (await prisma.stamp.create({ data: { collectionId, name, parentId } })).id;
      await prisma.stampCollectionArea.create({
        data: { stampId: id, collectionAreaId: areaId, isPrimary: true },
      });
      ids[name] = id;
      return id;
    };
    const u1 = await make("1270");
    await make("1270a", u1);
    await make("1270b", u1);
    const u2 = await make("1271");
    await make("1271a", u2);
    await make("1271b", u2);
    await make("1272");

    await prisma.stampCatalogPrice.create({
      data: {
        stampId: ids["1271b"],
        catalogEditionId: edition.id,
        conditionId,
        certificateStatusId: null,
        formatId: null,
        price: 3.5,
        currency: "EUR",
      },
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("reads several subtrees exactly as the grid draws each", async () => {
    const trees = await getVariantSubtrees(userId, [ids["1270"], ids["1271"]]);
    for (const umbrella of ["1270", "1271"]) {
      const grid = await getVariantPriceGrid(userId, {
        kind: "stamp",
        stampId: ids[umbrella],
        subtree: true,
      });
      assert.deepEqual(trees[ids[umbrella]], grid.rows);
    }
  });

  it("answers every row and every umbrella's variants in one read", async () => {
    const subject = (name: string) => ({ stampId: ids[name], conditionId, certificateStatusId: null });
    const read = await getRunCatalogValues(userId, {
      subjects: [subject("1270"), subject("1271"), subject("1272")],
      umbrellaIds: [ids["1270"], ids["1271"]],
    });
    assert.deepEqual(Object.keys(read.trees).sort(), [ids["1270"], ids["1271"]].sort());
    assert.deepEqual(
      read.rows.map((r) => r.stampId).sort(),
      ["1270", "1270a", "1270b", "1271", "1271a", "1271b", "1272"].map((n) => ids[n]).sort()
    );
    assert.ok(read.rows.every((r) => r.primaryCatalogNameId === catalogNameId));
    assert.equal(read.rows.find((r) => r.stampId === ids["1271b"])?.amounts[catalogNameId], "3.50");
    assert.deepEqual(read.catalogs.map((c) => c.catalogNameId), [catalogNameId]);
  });

  it("reads no tree for an umbrella the run does not ask about", async () => {
    const read = await getRunCatalogValues(userId, {
      subjects: [{ stampId: ids["1272"], conditionId, certificateStatusId: null }],
      umbrellaIds: [ids["1270"]],
    });
    assert.deepEqual(read.trees, {});
    assert.deepEqual(read.rows.map((r) => r.stampId), [ids["1272"]]);
  });

  it("refuses another collector's stamps", async () => {
    await assert.rejects(getVariantSubtrees(otherUserId, [ids["1270"]]));
  });
});
