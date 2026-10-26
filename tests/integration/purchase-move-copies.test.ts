import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { closeLot, listCopiesMoveTargets, moveCopiesToDocument } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";

// *Move copies to…* (#2123): every copy of a purchase, or of one lot, to a lot of another purchase or
// opening balance. #388's attach over a whole source: only `lotId` changes, sold and written-off
// copies move too, both ends must be open (ADR-0009 §3) — here a precondition of the whole move —
// and the source keeps its lots, empty.

describe("moveCopiesToDocument (#2123)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let locationId: string;
  let platformId: string;
  let nextNo = 1;

  async function addCopy(lotId: string, extra: { deliveryState?: string; disposedAt?: Date } = {}) {
    const item = await prisma.item.create({
      data: {
        collectionId,
        itemNo: nextNo++,
        stampId,
        conditionId,
        lotId,
        locationId,
        deliveryState: extra.deliveryState ?? "delivered",
        inCollection: true,
        forSale: true,
        disposedAt: extra.disposedAt ?? null,
        disposalReason: extra.disposedAt ? "lost" : null,
      },
      select: { id: true },
    });
    return item.id;
  }

  async function sell(itemId: string) {
    const no = nextNo++;
    const offer = await prisma.offer.create({
      data: { collectionId, offerNo: no, platformId, currency: "EUR", price: "5.00" },
    });
    const offerSet = await prisma.offerSet.create({ data: { offerId: offer.id } });
    const sale = await prisma.sale.create({
      data: { collectionId, saleNo: no, platformId, soldAt: new Date("2026-03-01"), currency: "EUR" },
    });
    const line = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId: offer.id, offerSetId: offerSet.id, price: "5.00" },
    });
    await prisma.saleLineItem.create({ data: { saleLineId: line.id, itemId } });
    return sale.id;
  }

  async function purchaseWithLots(titles: (string | null)[], status = "open") {
    const p = await createPurchase(userId, collectionId, { currency: "EUR", purchasedAt: "2026-01-01" });
    const lots: string[] = [];
    for (const title of titles) {
      lots.push(
        (
          await prisma.purchaseLot.create({
            data: { purchaseId: p.id, title, price: "10.00", status },
            select: { id: true },
          })
        ).id
      );
    }
    return { purchaseId: p.id, lots };
  }

  async function openingBalance() {
    const p = await createPurchase(userId, collectionId, {
      kind: "opening_balance",
      title: "Klaser Polska",
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    return p.id;
  }

  const lotOf = async (id: string) =>
    (await prisma.item.findUniqueOrThrow({ where: { id }, select: { lotId: true } })).lotId;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-move-doc-${ts}`;
    strangerId = `test-user-move-doc-x-${ts}`;
    for (const id of [userId, strangerId]) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-move-doc-${ts}`, name: "Move doc", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Chopin 1949" } })).id;
    locationId = (await prisma.location.create({ data: { collectionId, code: "L1", name: "Box 1" } })).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Delcampe" } })).id;
  });

  after(async () => {
    await prisma.saleLineItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.saleLine.deleteMany({ where: { sale: { collectionId } } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offerSet.deleteMany({ where: { offer: { collectionId } } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("moves every copy of a purchase, sold and written-off ones too, changing only the lot", async () => {
    const source = await purchaseWithLots(["A", null]);
    const held = await addCopy(source.lots[0]);
    const sorting = await addCopy(source.lots[0], { deliveryState: "to_sort" });
    const sold = await addCopy(source.lots[1]);
    const saleId = await sell(sold);
    const written = await addCopy(source.lots[1], { disposedAt: new Date("2026-02-01") });
    const target = await purchaseWithLots(["Target"]);
    const before = await prisma.item.findMany({
      where: { id: { in: [held, sorting, sold, written] } },
      orderBy: { id: "asc" },
    });

    const result = await moveCopiesToDocument(
      userId,
      { purchaseId: source.purchaseId },
      { lotId: target.lots[0] }
    );
    assert.equal(result.moved, 4);
    assert.deepEqual(new Set(result.fromLotIds), new Set(source.lots));
    assert.equal(result.lotId, target.lots[0]);
    assert.equal(result.purchaseId, target.purchaseId);

    const after = await prisma.item.findMany({
      where: { id: { in: [held, sorting, sold, written] } },
      orderBy: { id: "asc" },
    });
    for (const [i, a] of after.entries()) {
      const b = before[i];
      assert.equal(a.lotId, target.lots[0]);
      for (const key of ["deliveryState", "locationId", "conditionId", "itemNo", "disposedAt", "forSale", "inCollection"] as const) {
        assert.deepEqual(a[key], b[key], `${key} stays`);
      }
    }
    const sale = await prisma.saleLineItem.findFirstOrThrow({ where: { itemId: sold }, include: { saleLine: true } });
    assert.equal(sale.saleLine.saleId, saleId, "the sale stays");

    // The source keeps its lots, empty, with their prices.
    const lots = await prisma.purchaseLot.findMany({ where: { purchaseId: source.purchaseId }, include: { _count: { select: { items: true } } } });
    assert.equal(lots.length, 2);
    for (const l of lots) {
      assert.equal(l._count.items, 0);
      assert.equal(l.price?.toFixed(2), "10.00");
    }
  });

  it("moves one lot's copies only, into a new lot whose close weighs them", async () => {
    const source = await purchaseWithLots(["Stays", "Leaves"]);
    const stays = await addCopy(source.lots[0]);
    const leaves = await addCopy(source.lots[1]);
    const opening = await openingBalance();

    const result = await moveCopiesToDocument(
      userId,
      { lotId: source.lots[1] },
      { purchaseId: opening, title: "Moved in", price: null }
    );
    assert.equal(result.moved, 1);
    assert.deepEqual(result.fromLotIds, [source.lots[1]]);
    assert.equal(await lotOf(stays), source.lots[0]);
    assert.equal(await lotOf(leaves), result.lotId);
    const newLot = await prisma.purchaseLot.findUniqueOrThrow({ where: { id: result.lotId } });
    assert.equal(newLot.purchaseId, opening);
    assert.equal(newLot.title, "Moved in");
    assert.equal(newLot.price, null, "an opening balance's new lot may have no opening value");
    assert.equal(newLot.status, "open");

    // Closing the target lot weighs the moved copy into its split: this fixture's stamp has no
    // catalogue price, so the close names exactly that copy as the one it cannot weigh.
    const closed = await closeLot(userId, result.lotId);
    assert.equal(closed.ok, false);
    if (!closed.ok) {
      assert.equal(closed.reason, "missing-price");
      assert.deepEqual(closed.itemIds, [leaves]);
    }
  });

  it("refuses the whole move while a source lot holding copies is closed, naming it, and leaves no new lot", async () => {
    const source = await purchaseWithLots(["Open one", null]);
    const a = await addCopy(source.lots[0]);
    const b = await addCopy(source.lots[1]);
    await prisma.purchaseLot.update({ where: { id: source.lots[1] }, data: { status: "closed" } });
    const target = await purchaseWithLots([]);

    await assert.rejects(
      moveCopiesToDocument(
        userId,
        { purchaseId: source.purchaseId },
        { purchaseId: target.purchaseId, title: null, price: 5 }
      ),
      /Lot 2 is closed.*Reopen it/
    );
    assert.equal(await lotOf(a), source.lots[0]);
    assert.equal(await lotOf(b), source.lots[1]);
    assert.equal(await prisma.purchaseLot.count({ where: { purchaseId: target.purchaseId } }), 0);
  });

  it("ignores an empty closed lot of the source", async () => {
    const source = await purchaseWithLots(["Full"]);
    await prisma.purchaseLot.create({
      data: { purchaseId: source.purchaseId, title: "Empty", price: "1.00", status: "closed" },
    });
    const copy = await addCopy(source.lots[0]);
    const target = await purchaseWithLots(["T"]);
    const result = await moveCopiesToDocument(userId, { purchaseId: source.purchaseId }, { lotId: target.lots[0] });
    assert.equal(result.moved, 1);
    assert.equal(await lotOf(copy), target.lots[0]);
  });

  it("refuses a closed target, the source's own document, a new purchase lot with no price, and nothing to move", async () => {
    const source = await purchaseWithLots(["S", "S2"]);
    await addCopy(source.lots[0]);
    const closedTarget = await purchaseWithLots(["Shut"], "closed");

    await assert.rejects(
      moveCopiesToDocument(userId, { purchaseId: source.purchaseId }, { lotId: closedTarget.lots[0] }),
      /closed\. Reopen it/
    );
    await assert.rejects(
      moveCopiesToDocument(userId, { lotId: source.lots[0] }, { lotId: source.lots[1] }),
      /Move to lot/
    );
    await assert.rejects(
      moveCopiesToDocument(
        userId,
        { purchaseId: source.purchaseId },
        { purchaseId: source.purchaseId, title: null, price: 1 }
      ),
      /another purchase/
    );
    await assert.rejects(
      moveCopiesToDocument(
        userId,
        { purchaseId: source.purchaseId },
        { purchaseId: closedTarget.purchaseId, title: null, price: null }
      ),
      /price is required/
    );
    await assert.rejects(
      moveCopiesToDocument(userId, { lotId: source.lots[1] }, { lotId: closedTarget.lots[0] }),
      /no copies to move/
    );
    await assert.rejects(
      moveCopiesToDocument(strangerId, { purchaseId: source.purchaseId }, { lotId: closedTarget.lots[0] }),
      /access denied/
    );
  });

  it("lists every other document with its lots as targets", async () => {
    const source = await purchaseWithLots(["Mine"]);
    const opening = await openingBalance();
    const targets = await listCopiesMoveTargets(userId, source.purchaseId);
    assert.ok(!targets.some((t) => t.id === source.purchaseId), "never the source itself");
    const ob = targets.find((t) => t.id === opening);
    assert.ok(ob);
    assert.equal(ob.kind, "opening_balance");
    assert.equal(ob.name, "Klaser Polska");
    assert.match(ob.ref, /^Opening balance #\d+$/);
    await assert.rejects(listCopiesMoveTargets(strangerId, source.purchaseId), /access denied/);
  });
});
