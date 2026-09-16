import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  closeLot,
  createLot,
  getPurchaseDetail,
  intakeStamps,
  markPurchaseArrived,
  reopenLot,
  updateLot,
} from "../../src/lib/lots";
import {
  createPurchase,
  listPurchasesPaginated,
  setPurchaseStatus,
  updatePurchase,
} from "../../src/lib/purchases";
import { getLotIntakePage } from "../../src/lib/items";
import { resolveCostBasis } from "../../src/lib/cost-basis";

// The opening balance (#1323, ADR-0054): a purchase-order type that brings copies in without buying
// them. It is the purchase document underneath, so what is pinned here is exactly where it differs —
// the header it has, the list type it is filed under, copies landing *to sort*, and a lot whose
// opening value is optional: one with a value closes into shares as a purchase lot does, one without
// closes with every copy's cost *not applicable*, and both refuse while a copy is unpriced.

describe("opening balance", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let pricedStampId: string;
  let otherPricedStampId: string;
  let unpricedStampId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-opening-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User opening-${ts}`,
        email: `test-opening-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-opening-${ts}`, name: `Opening ${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    const edition = await prisma.catalogEdition.create({
      data: { catalogNameId: catalogName.id, year: 2024 },
    });
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
    });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    conditionId = condition.id;

    async function stamp(name: string, price: string | null) {
      const s = await prisma.stamp.create({ data: { collectionId, name } });
      await prisma.stampCollectionArea.create({
        data: { stampId: s.id, collectionAreaId: area.id, isPrimary: true },
      });
      if (price) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: s.id,
            catalogEditionId: edition.id,
            conditionId,
            certificateStatusId: null,
            price,
            currency: "EUR",
          },
        });
      }
      return s.id;
    }
    pricedStampId = await stamp("Priced", "3.00");
    otherPricedStampId = await stamp("Also priced", "1.00");
    unpricedStampId = await stamp("Unpriced", null);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function openingBalance(title: string) {
    return createPurchase(userId, collectionId, {
      kind: "opening_balance",
      title,
      purchasedAt: "2026-09-16",
      currency: "EUR",
    });
  }

  async function costStates(lotId: string) {
    const page = await getLotIntakePage(userId, collectionId, lotId);
    return page.items.map((item) => resolveCostBasis(item).state);
  }

  it("is created with a title, date and currency, and none of a purchase's own fields", async () => {
    const created = await createPurchase(userId, collectionId, {
      kind: "opening_balance",
      title: "  Stockbook Poland 1 ",
      purchasedAt: "2026-09-16",
      currency: "EUR",
      // A stale form sending purchase fields must not put them on the document.
      contactName: "Some dealer",
      shippingCost: 5,
      status: "preparing",
    });
    assert.equal(created.kind, "opening_balance");
    assert.equal(created.title, "Stockbook Poland 1");
    assert.equal(created.contactId, null);
    assert.equal(created.platformId, null);
    assert.equal(created.shippingCost, null);
    assert.equal(created.status, "arrived");
  });

  it("refuses an opening balance without a title", async () => {
    await assert.rejects(
      createPurchase(userId, collectionId, {
        kind: "opening_balance",
        title: "   ",
        purchasedAt: "2026-09-16",
        currency: "EUR",
      }),
      /needs a title/
    );
  });

  it("keeps its type on an edit, and has no delivery status to set or arrive", async () => {
    const doc = await openingBalance("Inheritance");
    const edited = await updatePurchase(userId, doc.id, {
      kind: "opening_balance",
      title: "Inheritance from grandfather",
      purchasedAt: "2026-09-10",
      currency: "EUR",
    });
    assert.equal(edited.title, "Inheritance from grandfather");
    assert.equal(edited.purchasedAt, "2026-09-10");

    await assert.rejects(
      updatePurchase(userId, doc.id, { kind: "purchase", purchasedAt: "2026-09-10", currency: "EUR" }),
      /cannot be changed/
    );
    await assert.rejects(setPurchaseStatus(userId, doc.id, "in_transit"), /no delivery status/);
    await assert.rejects(markPurchaseArrived(userId, doc.id), /no delivery status/);
  });

  it("the database refuses an opening balance carrying a supplier's shipping", async () => {
    const doc = await openingBalance("Shape check");
    await assert.rejects(
      prisma.purchase.update({ where: { id: doc.id }, data: { shippingCost: "1.00" } }),
      /purchase_kind_shape/
    );
  });

  it("is listed with purchases and filtered by type", async () => {
    const ts = Date.now();
    const doc = await openingBalance(`Listed ${ts}`);
    const purchase = await createPurchase(userId, collectionId, {
      purchasedAt: "2026-09-16",
      currency: "EUR",
      status: "arrived",
    });

    const all = await listPurchasesPaginated(userId, collectionId, { pageSize: 200 });
    const ids = all.items.map((p) => p.id);
    assert.ok(ids.includes(doc.id) && ids.includes(purchase.id));

    const opening = await listPurchasesPaginated(userId, collectionId, { type: "opening_balance", pageSize: 200 });
    assert.ok(opening.items.every((p) => p.kind === "opening_balance"));
    assert.ok(opening.items.some((p) => p.id === doc.id));
    const row = opening.items.find((p) => p.id === doc.id)!;
    assert.equal(row.type, "opening_balance");
    assert.equal(row.title, `Listed ${ts}`);

    const purchases = await listPurchasesPaginated(userId, collectionId, { type: "purchase", pageSize: 200 });
    assert.ok(purchases.items.some((p) => p.id === purchase.id));
    assert.ok(!purchases.items.some((p) => p.id === doc.id));

    // *Arrived* is a purchase's delivery status; an opening balance is stored arrived and must not
    // answer the chip.
    const arrived = await listPurchasesPaginated(userId, collectionId, { status: "arrived", pageSize: 200 });
    assert.ok(arrived.items.some((p) => p.id === purchase.id));
    assert.ok(!arrived.items.some((p) => p.id === doc.id));
  });

  it("states the opening value on its row, and no value in words rather than as 0.00", async () => {
    const doc = await openingBalance("Row totals");
    const read = async () =>
      (await listPurchasesPaginated(userId, collectionId, { type: "opening_balance", pageSize: 200 })).items.find(
        (p) => p.id === doc.id
      )!;

    await createLot(userId, doc.id, null, "No value");
    let row = await read();
    assert.equal(row.total, null);
    assert.equal(row.unvaluedLotCount, 1);

    await createLot(userId, doc.id, 12.5, "Valued");
    row = await read();
    assert.equal(row.total, "12.50");
    assert.equal(row.unvaluedLotCount, 1);
  });

  it("lands identified copies to sort, never ordered", async () => {
    const doc = await openingBalance("To sort");
    const lotId = await createLot(userId, doc.id, null, null);
    const [copy] = await intakeStamps(userId, { lotId }, { stampId: pricedStampId, conditionId });
    const item = await prisma.item.findUniqueOrThrow({
      where: { id: copy.itemId },
      select: { deliveryState: true, costBasis: true },
    });
    assert.equal(item.deliveryState, "to_sort");
    assert.equal(item.costBasis, null);
  });

  it("closes a valued lot into per-copy shares, as a purchase lot does", async () => {
    const doc = await openingBalance("Valued lot");
    const lotId = await createLot(userId, doc.id, 40, "Valued");
    await intakeStamps(userId, { lotId }, { stampId: pricedStampId, conditionId });
    await intakeStamps(userId, { lotId }, { stampId: otherPricedStampId, conditionId });
    assert.deepEqual(await costStates(lotId), ["pending", "pending"]);

    const result = await closeLot(userId, lotId);
    assert.deepEqual(result, { ok: true, snapshotCount: 2 });
    const bases = await prisma.item.findMany({ where: { lotId }, select: { stampId: true, costBasis: true } });
    const byStamp = new Map(bases.map((b) => [b.stampId, b.costBasis?.toFixed(2)]));
    // 40 split 3:1 by catalogue price.
    assert.equal(byStamp.get(pricedStampId), "30.00");
    assert.equal(byStamp.get(otherPricedStampId), "10.00");

    const detail = await getPurchaseDetail(userId, doc.id);
    const lot = detail!.lots.find((l) => l.id === lotId)!;
    assert.equal(lot.price, "40.00");
    assert.equal(lot.poolBase, "40.00");
  });

  it("closes a lot without a value with every copy's cost not applicable — open or closed", async () => {
    const doc = await openingBalance("Unvalued lot");
    const lotId = await createLot(userId, doc.id, null, "No value");
    await intakeStamps(userId, { lotId }, { stampId: pricedStampId, conditionId });
    await intakeStamps(userId, { lotId }, { stampId: otherPricedStampId, conditionId });

    // Open: never pending.
    assert.deepEqual(await costStates(lotId), ["none", "none"]);
    const detail = await getPurchaseDetail(userId, doc.id);
    const lot = detail!.lots.find((l) => l.id === lotId)!;
    assert.equal(lot.price, null);
    assert.equal(lot.poolTx, null);
    assert.equal(lot.poolBase, null);

    const result = await closeLot(userId, lotId);
    assert.deepEqual(result, { ok: true, snapshotCount: 0 });
    const closed = await prisma.purchaseLot.findUniqueOrThrow({ where: { id: lotId }, select: { status: true } });
    assert.equal(closed.status, "closed");
    const bases = await prisma.item.findMany({ where: { lotId }, select: { costBasis: true } });
    // Never `0`: nothing is frozen at all.
    assert.ok(bases.every((b) => b.costBasis === null));
    assert.deepEqual(await costStates(lotId), ["none", "none"]);

    await reopenLot(userId, lotId);
    assert.deepEqual(await costStates(lotId), ["none", "none"]);
  });

  it("refuses to close while a copy lacks a primary-catalogue price — valued or not", async () => {
    for (const price of [25, null]) {
      const doc = await openingBalance(`Unpriced ${price ?? "none"}`);
      const lotId = await createLot(userId, doc.id, price, null);
      await intakeStamps(userId, { lotId }, { stampId: pricedStampId, conditionId });
      const [unpriced] = await intakeStamps(userId, { lotId }, { stampId: unpricedStampId, conditionId });

      const result = await closeLot(userId, lotId);
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.reason === "missing-price");
      assert.ok(!result.ok && result.itemIds.includes(unpriced.itemId));
      const lot = await prisma.purchaseLot.findUniqueOrThrow({ where: { id: lotId }, select: { status: true } });
      assert.equal(lot.status, "open");
    }
  });

  it("keeps a zero opening value as a value, distinct from none", async () => {
    const doc = await openingBalance("Zero value");
    const lotId = await createLot(userId, doc.id, 0, null);
    await intakeStamps(userId, { lotId }, { stampId: pricedStampId, conditionId });
    const lot = await prisma.purchaseLot.findUniqueOrThrow({ where: { id: lotId }, select: { price: true } });
    assert.equal(lot.price?.toFixed(2), "0.00");
    assert.deepEqual(await costStates(lotId), ["pending"]);
    await closeLot(userId, lotId);
    assert.deepEqual(await costStates(lotId), ["known"]);
  });

  it("allows clearing a lot's opening value, and never a purchase lot's price", async () => {
    const doc = await openingBalance("Clear value");
    const lotId = await createLot(userId, doc.id, 10, null);
    await updateLot(userId, lotId, { price: null });
    const lot = await prisma.purchaseLot.findUniqueOrThrow({ where: { id: lotId }, select: { price: true } });
    assert.equal(lot.price, null);

    const purchase = await createPurchase(userId, collectionId, { purchasedAt: "2026-09-16", currency: "EUR" });
    await assert.rejects(createLot(userId, purchase.id, null, null), /price is required/);
    const purchaseLotId = await createLot(userId, purchase.id, 5, null);
    await assert.rejects(updateLot(userId, purchaseLotId, { price: null }), /price is required/);
  });
});
