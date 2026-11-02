import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createItem,
  getHoldingsValuation,
  getItemListItem,
  updateItem,
  valuateItemsByIds,
} from "../../src/lib/items";
import { bulkUpdateLotItems } from "../../src/lib/lots";

// A copy's catalogue value adjusted on the copy (#2357), against a real database. The arithmetic is
// pinned in `tests/unit/value-modifier.test.ts`; what only a database can show is that the modifier is
// stored and refused where it should be, applied before the fault reduction, and that it reaches the
// readers — the list row, the copy-id valuation the weights read, the holdings total and bulk edit.

const ts = Date.now();

describe("a copy's value modifier (#2357)", () => {
  let userId: string;
  let collectionId: string;
  let mnhId: string;
  let mi100: string;
  let unpricedStamp: string;
  let modifiedId: string;
  let plainId: string;
  let unpricedId: string;

  before(async () => {
    userId = `test-user-valmod-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User valmod-${ts}`,
        email: `test-valmod-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-valmod-${ts}`, name: "Modifiers", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const catalogName = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Europa", currency: "EUR" },
    });
    const editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2026 } })
    ).id;
    const areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Danzig", primaryCatalogNameId: catalogName.id },
      })
    ).id;
    await prisma.collectionAreaCatalog.create({
      data: { collectionAreaId: areaId, catalogNameId: catalogName.id },
    });
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    const stamp = async (name: string, price: string | null) => {
      const row = await prisma.stamp.create({
        data: {
          collectionId,
          name,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      });
      if (price) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: row.id,
            catalogEditionId: editionId,
            conditionId: mnhId,
            certificateStatusId: null,
            formatId: null,
            price,
            currency: "EUR",
          },
        });
      }
      return row.id;
    };
    mi100 = await stamp("Mi 100", "10.00");
    unpricedStamp = await stamp("Mi 101", null);

    modifiedId = (
      await createItem(userId, collectionId, {
        stampId: mi100,
        conditionId: mnhId,
        valueModifier: { percent: 200, amount: "5.00", note: "Stempel Danzig" },
        faultReductionPercent: 40,
      })
    ).id;
    plainId = (await createItem(userId, collectionId, { stampId: mi100, conditionId: mnhId })).id;
    unpricedId = (
      await createItem(userId, collectionId, {
        stampId: unpricedStamp,
        conditionId: mnhId,
        valueModifier: { percent: null, amount: "50.00", note: null },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("stores the modifier and applies it before the fault reduction on the list row", async () => {
    const row = await getItemListItem(userId, modifiedId);
    assert.deepEqual(row.valueModifier, { percent: 200, amount: "5.00", note: "Stempel Danzig" });
    // 10 × 3 + 5 = 35, then −40 % = 21.
    assert.equal(row.value.amount, "21.00");
    assert.equal(row.value.valueModifier?.fullAmount, "10.00");
    assert.equal(row.value.valueModifier?.note, "Stempel Danzig");
    assert.equal(row.value.faultReduction?.fullAmount, "35.00");
  });

  it("gives a copy with no catalogue value no value from the modifier alone", async () => {
    const row = await getItemListItem(userId, unpricedId);
    assert.equal(row.valueModifier?.amount, "50.00");
    assert.equal(row.value.unpriced, true);
    assert.equal(row.value.amount, null);
    assert.equal(row.value.valueModifier, null);
  });

  it("reaches the copy-id valuation and the holdings total", async () => {
    const byId = await valuateItemsByIds(collectionId, [modifiedId, plainId]);
    assert.equal(byId.get(modifiedId)!.baseAmountDisplay, "21.00");
    assert.equal(byId.get(plainId)!.baseAmountDisplay, "10.00");
    const holdings = await getHoldingsValuation(userId, collectionId, {});
    assert.equal(holdings.totalBaseAmount, "31.00");
    assert.equal(holdings.unpricedCount, 1);
    // The fault reduction's own figure is taken off the modified one.
    assert.equal(holdings.faultReductionBaseAmount, "14.00");
  });

  it("floors a negative amount at zero", async () => {
    await updateItem(userId, plainId, { valueModifier: { percent: null, amount: "-25.00", note: null } });
    const row = await getItemListItem(userId, plainId);
    assert.equal(row.value.amount, "0.00");
    assert.equal(row.value.unpriced, false);
  });

  it("is edited on the copy, left alone when absent and cleared with null", async () => {
    await updateItem(userId, plainId, { valueModifier: { percent: -50, amount: null, note: "thin" } });
    assert.equal((await getItemListItem(userId, plainId)).value.amount, "5.00");
    await updateItem(userId, plainId, { notes: "on piece" });
    assert.equal((await getItemListItem(userId, plainId)).valueModifier?.percent, -50);
    await updateItem(userId, plainId, { valueModifier: null });
    const cleared = await getItemListItem(userId, plainId);
    assert.equal(cleared.valueModifier, null);
    assert.equal(cleared.value.amount, "10.00");
    const stored = await prisma.item.findUniqueOrThrow({
      where: { id: plainId },
      select: { valueModifierPercent: true, valueModifierAmount: true, valueModifierNote: true },
    });
    assert.deepEqual(stored, {
      valueModifierPercent: null,
      valueModifierAmount: null,
      valueModifierNote: null,
    });
  });

  it("refuses a modifier the rule does not allow, in the domain and at the database", async () => {
    await assert.rejects(
      () => updateItem(userId, plainId, { valueModifier: { percent: -101, amount: null, note: null } }),
      /from −100 up/
    );
    await assert.rejects(() =>
      prisma.item.update({ where: { id: plainId }, data: { valueModifierPercent: 0 } })
    );
    await assert.rejects(() =>
      prisma.item.update({ where: { id: plainId }, data: { valueModifierPercent: -150 } })
    );
    await assert.rejects(() =>
      prisma.item.update({ where: { id: plainId }, data: { valueModifierAmount: "0" } })
    );
    await assert.rejects(() =>
      prisma.item.update({ where: { id: plainId }, data: { valueModifierNote: "orphan note" } })
    );
  });

  it("is set and cleared in bulk, leaving copies it was not asked about alone", async () => {
    await bulkUpdateLotItems(userId, [plainId], {
      valueModifier: { percent: 100, amount: null, note: "rare usage" },
    });
    assert.equal((await getItemListItem(userId, plainId)).value.amount, "20.00");
    await bulkUpdateLotItems(userId, [plainId, modifiedId], { forSale: true });
    assert.equal((await getItemListItem(userId, plainId)).valueModifier?.note, "rare usage");
    assert.equal((await getItemListItem(userId, modifiedId)).valueModifier?.percent, 200);

    await bulkUpdateLotItems(userId, [plainId], { valueModifier: null });
    const cleared = await getItemListItem(userId, plainId);
    assert.equal(cleared.valueModifier, null);
    assert.equal(cleared.value.amount, "10.00");
  });
});
