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
import { setItemStamps } from "../../src/lib/item-stamps";
import { setCarrierValue } from "../../src/lib/carrier-values";
import { createTrade } from "../../src/lib/trades";
import { addTradeGiveLines } from "../../src/lib/trade-lines";
import { readTradeBalance } from "../../src/lib/trade-valuation";

// A copy's value lowered by a percentage typed on it, for its faults (#1560), against a real
// database. The arithmetic is pinned in `tests/unit/valuation.test.ts`; what only a database can show
// is that the percentage is stored and refused where it should be, and that it reaches the readers
// the issue names — the list row, the copy-id valuation the lot and sale weights read, the holdings
// total, bulk edit, and a trade's own valuation but not its agreed one.

const ts = Date.now();

describe("a copy's value lowered for its faults (#1560)", () => {
  let userId: string;
  let collectionId: string;
  let vendorId: string;
  let mnhId: string;
  let mi100: string;
  let mi101: string;
  let faultyId: string;
  let plainId: string;

  before(async () => {
    userId = `test-user-faultred-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User faultred-${ts}`,
        email: `test-faultred-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-faultred-${ts}`, name: "Faults", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    vendorId = (
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
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
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
    const stamp = async (name: string, price: string) => {
      const row = await prisma.stamp.create({
        data: {
          collectionId,
          name,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      });
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
      return row.id;
    };
    mi100 = await stamp("Mi 100", "45.00");
    mi101 = await stamp("Mi 101", "10.00");

    faultyId = (
      await createItem(userId, collectionId, {
        stampId: mi100,
        conditionId: mnhId,
        faultReductionPercent: 40,
      })
    ).id;
    plainId = (await createItem(userId, collectionId, { stampId: mi101, conditionId: mnhId })).id;
  });

  after(async () => {
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("stores the percentage on the copy and lowers its list row, naming the full figure", async () => {
    const row = await getItemListItem(userId, faultyId);
    assert.equal(row.faultReductionPercent, 40);
    assert.equal(row.value.amount, "27.00");
    assert.equal(row.value.baseAmountDisplay, "27.00");
    assert.deepEqual(row.value.faultReduction, {
      percent: 40,
      fullAmount: "45.00",
      fullBaseAmount: 45,
      fullBaseAmountDisplay: "45.00",
    });
  });

  it("values a copy without a reduction as before", async () => {
    const row = await getItemListItem(userId, plainId);
    assert.equal(row.faultReductionPercent, null);
    assert.equal(row.value.amount, "10.00");
    assert.equal(row.value.faultReduction, null);
  });

  it("lowers the copy-id valuation the lot, sale and lot-builder weights read", async () => {
    const byId = await valuateItemsByIds(collectionId, [faultyId, plainId]);
    assert.equal(byId.get(faultyId)!.baseAmountDisplay, "27.00");
    assert.equal(byId.get(plainId)!.baseAmountDisplay, "10.00");
  });

  it("totals the lowered figure, and says how many copies were lowered and by how much", async () => {
    const holdings = await getHoldingsValuation(userId, collectionId, {});
    assert.equal(holdings.totalBaseAmount, "37.00");
    assert.equal(holdings.pricedCount, 2);
    assert.equal(holdings.faultReducedCount, 1);
    assert.equal(holdings.faultReductionBaseAmount, "18.00");
  });

  it("leaves the stamp's catalogue price untouched", async () => {
    const price = await prisma.stampCatalogPrice.findFirstOrThrow({ where: { stampId: mi100 } });
    assert.equal(price.price.toString(), "45");
  });

  it("is edited on the copy, and cleared with null", async () => {
    await updateItem(userId, faultyId, { faultReductionPercent: 10 });
    assert.equal((await getItemListItem(userId, faultyId)).value.amount, "40.50");
    await updateItem(userId, faultyId, { faultReductionPercent: null });
    const cleared = await getItemListItem(userId, faultyId);
    assert.equal(cleared.value.amount, "45.00");
    assert.equal(cleared.value.faultReduction, null);
    // Absent leaves it alone.
    await updateItem(userId, faultyId, { faultReductionPercent: 40 });
    await updateItem(userId, faultyId, { notes: "thin spot" });
    assert.equal((await getItemListItem(userId, faultyId)).faultReductionPercent, 40);
  });

  it("refuses a percentage outside 1–100, in the domain and at the database", async () => {
    await assert.rejects(
      () => updateItem(userId, faultyId, { faultReductionPercent: 120 }),
      /whole percentage from 1 to 100/
    );
    await assert.rejects(
      () => updateItem(userId, faultyId, { faultReductionPercent: 12.5 }),
      /whole percentage/
    );
    await assert.rejects(() =>
      prisma.item.update({ where: { id: faultyId }, data: { faultReductionPercent: 0 } })
    );
    await assert.rejects(() =>
      prisma.item.update({ where: { id: faultyId }, data: { faultReductionPercent: 101 } })
    );
  });

  it("is set and cleared in bulk, leaving copies it was not asked about alone", async () => {
    await bulkUpdateLotItems(userId, [plainId], { faultReductionPercent: 50 });
    assert.equal((await getItemListItem(userId, plainId)).value.amount, "5.00");
    // Another field in the same pass does not touch the percentage.
    await bulkUpdateLotItems(userId, [plainId, faultyId], { forSale: true });
    assert.equal((await getItemListItem(userId, plainId)).faultReductionPercent, 50);
    assert.equal((await getItemListItem(userId, faultyId)).faultReductionPercent, 40);

    await bulkUpdateLotItems(userId, [plainId], { faultReductionPercent: null });
    const cleared = await getItemListItem(userId, plainId);
    assert.equal(cleared.faultReductionPercent, null);
    assert.equal(cleared.value.amount, "10.00");

    await assert.rejects(() => bulkUpdateLotItems(userId, [plainId], { faultReductionPercent: 0 }));
  });

  it("lowers a multi-stamp copy's recorded value too (decided with the user)", async () => {
    const carrierId = (
      await createItem(userId, collectionId, {
        stampId: mi100,
        conditionId: mnhId,
        faultReductionPercent: 25,
      })
    ).id;
    await setItemStamps(userId, carrierId, [{ stampId: mi100 }, { stampId: mi101 }]);
    await setCarrierValue(userId, carrierId, { amount: "80.00", currency: "EUR" });
    try {
      const row = await getItemListItem(userId, carrierId);
      assert.equal(row.value.explicit, true);
      assert.equal(row.value.amount, "60.00");
      assert.equal(row.value.faultReduction?.fullAmount, "80.00");
    } finally {
      await prisma.item.delete({ where: { id: carrierId } });
    }
  });

  it("lowers a give line's own valuation, and leaves the partner's agreed catalogue at full", async () => {
    const partnerId = (
      await prisma.contact.create({ data: { collectionId, name: "Karel", exchangePartner: true } })
    ).id;
    const trade = await createTrade(userId, collectionId, {
      partnerId,
      currency: "EUR",
      catalogVendorId: vendorId,
    });
    await addTradeGiveLines(userId, trade.sections[0].id, [faultyId]);
    try {
      const balance = (await readTradeBalance(userId, trade.id))!;
      const [line] = balance.lines.filter((l) => l.side === "give");
      assert.equal(line.own, 27);
      assert.equal(line.ownFaultReductionPercent, 40);
      // The agreed figure is the partner's book, which knows nothing of this piece's faults.
      assert.equal(line.agreed, 45);
    } finally {
      await prisma.trade.delete({ where: { id: trade.id } });
    }
  });
});
