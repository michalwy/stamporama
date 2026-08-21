import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemsPaginated } from "../../src/lib/items";
import { attachItemsToLot, closeLot, createLot } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { createTrade, setTradeStatus } from "../../src/lib/trades";
import { addTradeGiveLines, addTradeReceiveLines } from "../../src/lib/trade-lines";
import { setTradeLineFulfillment } from "../../src/lib/trade-realisation";
import { readTradeIntake } from "../../src/lib/trade-intake";

// **Closing a trade turns it into inventory** (#644; ADR-0039 §12).
//
// What only a database can answer, and so what is checked here: that closing creates the purchase
// and one lot per line that actually arrived, that the lot prices are the carried-over cost basis of
// the copies that went the other way and reconcile to it exactly, that a withdrawn line carries
// nothing and a line that never arrived holds nothing, that the given copies leave every held read
// without a sale or a disposal being invented for them, and that the incoming lot stays open — by
// name — while a source copy is still waiting on an order of its own.

interface Fixtures {
  userId: string;
  collectionId: string;
  partnerId: string;
  sellerId: string;
  stampId: string;
  otherStampId: string;
  conditionId: string;
}

let f: Fixtures;
let seq = 0;

async function seed(): Promise<Fixtures> {
  const ts = Date.now();
  const userId = `test-user-tclose-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User tclose-${ts}`,
      email: `test-tclose-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-tclose-${ts}`,
      name: `Collection tclose-${ts}`,
      baseCurrency: "EUR",
      ownerId: userId,
    },
  });
  const collectionId = collection.id;
  const partner = await prisma.contact.create({
    data: { collectionId, name: "Karel", exchangePartner: true },
  });
  const seller = await prisma.contact.create({
    data: { collectionId, name: "Auction House", seller: true },
  });
  const condition = await prisma.stampCondition.create({
    data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
  });

  // Two priced stamps in an area with a primary catalogue: every line this file writes has to carry
  // a value, or the trade would be refused at `preparing → shared` by a different gate (#638), and
  // a lot cannot be closed without a catalogue price for its copies' condition (ADR-0009 §5).
  const area = await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } });
  const vendor = await prisma.catalogVendor.create({
    data: { collectionId, name: "Michel", abbreviation: "Mi" },
  });
  const catalogName = await prisma.catalogName.create({
    data: { vendorId: vendor.id, name: "Michel Europa", currency: "EUR" },
  });
  const edition = await prisma.catalogEdition.create({
    data: { catalogNameId: catalogName.id, year: 2026 },
  });
  await prisma.collectionArea.update({
    where: { id: area.id },
    data: { primaryCatalogNameId: catalogName.id },
  });
  await prisma.collectionAreaCatalog.create({
    data: { collectionAreaId: area.id, catalogNameId: catalogName.id },
  });

  const makeStamp = async (name: string, number: string, price: string): Promise<string> => {
    const stamp = await prisma.stamp.create({ data: { collectionId, name } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: stamp.id, catalogVendorId: vendor.id, number },
    });
    await prisma.stampCatalogPrice.create({
      data: {
        stampId: stamp.id,
        catalogEditionId: edition.id,
        conditionId: condition.id,
        price,
        currency: "EUR",
      },
    });
    return stamp.id;
  };

  return {
    userId,
    collectionId,
    partnerId: partner.id,
    sellerId: seller.id,
    stampId: await makeStamp("Stamp 401", "401", "10.00"),
    otherStampId: await makeStamp("Stamp 402", "402", "20.00"),
    conditionId: condition.id,
  };
}

/** A copy of the priced stamp, held and free to be promised. */
async function copy(stampId = f.stampId): Promise<string> {
  return (
    await createItem(f.userId, f.collectionId, {
      stampId,
      conditionId: f.conditionId,
      forTrade: true,
    })
  ).id;
}

/**
 * An order of one lot at `price`, holding `itemIds`. Left **open** unless asked to close, which is
 * what makes a copy's cost basis `pending` — the state the incoming lot's gate is about.
 */
async function orderHolding(
  itemIds: string[],
  price: number,
  close = true
): Promise<{ purchaseId: string; lotId: string; purchaseNo: number }> {
  seq += 1;
  const purchase = await createPurchase(f.userId, f.collectionId, {
    contactId: f.sellerId,
    contactName: null,
    platformId: null,
    platformName: null,
    purchasedAt: "2026-01-01",
    currency: "EUR",
    shippingCost: null,
    status: "arrived",
  });
  const lotId = await createLot(f.userId, purchase.id, price, `Lot ${seq}`);
  const { refused } = await attachItemsToLot(f.userId, lotId, itemIds);
  assert.deepEqual(refused, [], "the fixture's copies should all attach");
  if (close) {
    const result = await closeLot(f.userId, lotId);
    assert.ok(result.ok, `the source lot should close: ${JSON.stringify(result)}`);
  }
  const row = await prisma.purchase.findUniqueOrThrow({
    where: { id: purchase.id },
    select: { purchaseNo: true },
  });
  return { purchaseId: purchase.id, lotId, purchaseNo: row.purchaseNo };
}

/** A trade giving `itemIds` and asking for `receive` lines, left in `preparing`. */
async function trade(
  itemIds: string[],
  receive: { stampId: string; quantity: number }[]
): Promise<{ tradeId: string; sectionId: string }> {
  seq += 1;
  const created = await createTrade(f.userId, f.collectionId, {
    partnerId: f.partnerId,
    partnerName: null,
    currency: "EUR",
    notes: `close ${seq}`,
    catalogVendorId: null,
    balanceByValue: false,
    countTolerance: 0,
    valueTolerancePct: 0,
    ownValueWarnPct: 25,
  });
  const sectionId = created.sections[0].id;
  if (itemIds.length > 0) {
    const { refused } = await addTradeGiveLines(f.userId, sectionId, itemIds);
    assert.deepEqual(refused, [], "the fixture's copies should all be promisable");
  }
  for (const line of receive) {
    await addTradeReceiveLines(f.userId, sectionId, {
      stampId: line.stampId,
      conditionId: f.conditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: line.quantity,
    });
  }
  return { tradeId: created.id, sectionId };
}

async function linesOf(tradeId: string, side: "give" | "receive") {
  return prisma.tradeLine.findMany({
    where: { tradeId, side },
    orderBy: [{ position: "asc" }],
    select: { id: true, itemId: true, stampId: true },
  });
}

/** Agree, answer for every line with `verdict`, and close. */
async function closeWith(
  tradeId: string,
  verdicts: Record<string, "fulfilled" | "missing" | "withdrawn"> = {}
): Promise<void> {
  await setTradeStatus(f.userId, tradeId, "shared");
  await setTradeStatus(f.userId, tradeId, "agreed");
  const lines = await prisma.tradeLine.findMany({ where: { tradeId }, select: { id: true } });
  for (const line of lines) {
    await setTradeLineFulfillment(f.userId, line.id, {
      fulfillment: verdicts[line.id] ?? "fulfilled",
    });
  }
  await setTradeStatus(f.userId, tradeId, "closed");
}

async function cleanup(): Promise<void> {
  // Every FK along this chain is `Restrict`, and each of them is a guard worth having: a copy must
  // not vanish from under the agreement that promised it (`TradeLine.itemId`), a stored copy must
  // not vanish from under its lot (`Item.lotId`), a lot must not vanish from under the line it was
  // for (`PurchaseLot.tradeLineId`), and a trade must not vanish from under the purchase holding its
  // carried-over cost (`Purchase.tradeId`). So the fixture unwinds them in order rather than
  // deleting anything out from under anything else.
  await prisma.item.updateMany({ where: { collection: { ownerId: f.userId } }, data: { lotId: null } });
  await prisma.purchase.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.trade.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
  await prisma.user.deleteMany({ where: { id: f.userId } });
}

describe("closing a trade into a purchase (#644)", () => {
  before(async () => {
    f = await seed();
  });
  after(cleanup);

  it("creates an order carrying the trade, one lot per line that arrived, priced at what left", async () => {
    const given = [await copy(), await copy()];
    await orderHolding(given, 30);
    const { tradeId } = await trade(given, [
      { stampId: f.stampId, quantity: 1 },
      { stampId: f.otherStampId, quantity: 1 },
    ]);
    await closeWith(tradeId);

    const purchase = await prisma.purchase.findUniqueOrThrow({
      where: { tradeId },
      select: {
        contactId: true,
        currency: true,
        fxRateToBase: true,
        shippingCost: true,
        lots: { select: { price: true, status: true, tradeLineId: true, title: true } },
      },
    });
    assert.equal(purchase.contactId, f.partnerId, "the partner is the supplier");
    assert.equal(purchase.currency, "EUR", "a carried-over pool is already in the base currency");
    assert.equal(purchase.fxRateToBase, null, "and so needs no rate anybody could check");
    assert.equal(purchase.shippingCost, null, "postage is real cash and is typed on the order");

    const receive = await linesOf(tradeId, "receive");
    assert.equal(purchase.lots.length, 2);
    assert.deepEqual(
      purchase.lots.map((l) => l.tradeLineId).sort(),
      receive.map((l) => l.id).sort(),
      "one lot per receive line, each naming its line"
    );
    assert.ok(
      purchase.lots.every((l) => l.status === "open"),
      "the lots open, waiting for the material to be identified"
    );
    // 30 split by own value: the two stamps are catalogued at 10 and 20.
    assert.deepEqual(
      purchase.lots
        .map((l) => Number(l.price))
        .sort((a, b) => a - b),
      [10, 20]
    );
    assert.ok(
      purchase.lots.every((l) => (l.title ?? "").length > 0),
      "each lot is named as the trade named its line"
    );
  });

  it("carries a withdrawn copy's cost nowhere, and gives a line that never arrived no lot", async () => {
    const kept = await copy();
    const sent = await copy();
    await orderHolding([kept, sent], 40);
    const { tradeId } = await trade([kept, sent], [
      { stampId: f.stampId, quantity: 1 },
      { stampId: f.otherStampId, quantity: 1 },
    ]);
    const give = await linesOf(tradeId, "give");
    const receive = await linesOf(tradeId, "receive");
    const keptLine = give.find((l) => l.itemId === kept)!;
    await closeWith(tradeId, {
      [keptLine.id]: "withdrawn",
      [receive[1].id]: "missing",
    });

    const purchase = await prisma.purchase.findUniqueOrThrow({
      where: { tradeId },
      select: { lots: { select: { price: true, tradeLineId: true } } },
    });
    assert.equal(purchase.lots.length, 1, "only what arrived has anything to hold");
    assert.equal(purchase.lots[0].tradeLineId, receive[0].id);
    // Half the order's 40 went with the copy that was actually sent; the withdrawn one stayed.
    assert.equal(Number(purchase.lots[0].price), 20);
  });

  it("leaves the given copies out of the collection, with no sale and no disposal", async () => {
    const given = await copy();
    await orderHolding([given], 12);
    const { tradeId } = await trade([given], [{ stampId: f.otherStampId, quantity: 1 }]);
    await closeWith(tradeId);

    // `excludeGone` is what every "what do I still have" read passes (#207, widened by #644); the
    // Copies list turns it on unless the collector asks for what has left.
    const held = await listItemsPaginated(f.userId, f.collectionId, {
      ids: [given],
      excludeGone: true,
    });
    assert.equal(held.items.length, 0, "gone from what the collection has");

    const shown = await listItemsPaginated(f.userId, f.collectionId, { ids: [given] });
    assert.equal(shown.items.length, 1);
    assert.equal(shown.items[0].sold, false, "no sale was invented");
    assert.equal(shown.items[0].tradedAway?.partnerName, "Karel");

    const row = await prisma.item.findUniqueOrThrow({
      where: { id: given },
      select: { disposedAt: true, saleLineItems: { select: { itemId: true } } },
    });
    assert.equal(row.disposedAt, null, "and no disposal either — a trade is neither");
    assert.deepEqual(row.saleLineItems, []);
  });

  it("holds the incoming lot open, by name, while a source copy is still waiting on its own order", async () => {
    const given = await copy();
    const { purchaseNo } = await orderHolding([given], 25, false);
    const { tradeId } = await trade([given], [{ stampId: f.stampId, quantity: 1 }]);
    await closeWith(tradeId);

    const intake = await readTradeIntake(tradeId);
    assert.equal(intake.settled, false);
    assert.match(intake.pendingMessage ?? "", new RegExp(`order #${purchaseNo}`));

    const lot = await prisma.purchaseLot.findFirstOrThrow({
      where: { purchase: { tradeId } },
      select: { id: true },
    });
    // A copy has to be on the lot, or the refusal under test would be hidden behind the empty one.
    const arrived = await copy();
    await attachItemsToLot(f.userId, lot.id, [arrived]);

    const blocked = await closeLot(f.userId, lot.id);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.ok === false && blocked.reason, "trade-cost-pending");
    assert.match(
      (blocked.ok === false && blocked.message) || "",
      new RegExp(`order #${purchaseNo}`)
    );

    // Close the source lot and the pool settles; the incoming copy then takes the whole of it.
    const source = await prisma.purchaseLot.findFirstOrThrow({
      where: { purchaseId: (await prisma.item.findUniqueOrThrow({
        where: { id: given },
        select: { lot: { select: { purchaseId: true } } },
      })).lot!.purchaseId },
      select: { id: true },
    });
    const closed = await closeLot(f.userId, source.id);
    assert.ok(closed.ok);

    assert.equal((await readTradeIntake(tradeId)).settled, true);
    const ok = await closeLot(f.userId, lot.id);
    assert.ok(ok.ok, `the incoming lot should close once its source has: ${JSON.stringify(ok)}`);
    const basis = await prisma.item.findUniqueOrThrow({
      where: { id: arrived },
      select: { costBasis: true },
    });
    assert.equal(Number(basis.costBasis), 25, "what the copy that left cost is what this one cost");
  });

  it("creates no order when nothing arrived", async () => {
    const given = await copy();
    await orderHolding([given], 8);
    const { tradeId } = await trade([given], [{ stampId: f.stampId, quantity: 1 }]);
    const receive = await linesOf(tradeId, "receive");
    await closeWith(tradeId, { [receive[0].id]: "missing" });

    assert.equal(await prisma.purchase.findUnique({ where: { tradeId } }), null);
  });

  it("reads a substitution off the line and the copy, without storing one", async () => {
    const given = await copy();
    await orderHolding([given], 15);
    const { tradeId } = await trade([given], [{ stampId: f.stampId, quantity: 1 }]);
    await closeWith(tradeId);

    const lot = await prisma.purchaseLot.findFirstOrThrow({
      where: { purchase: { tradeId } },
      select: { id: true },
    });
    // What turned up was the other stamp — the line says one thing, the copy another.
    const arrived = await copy(f.otherStampId);
    await attachItemsToLot(f.userId, lot.id, [arrived]);

    const intake = await readTradeIntake(tradeId);
    assert.equal(intake.substitutions.length, 1);
    assert.equal(intake.substitutions[0].arrivedStampId, f.otherStampId);
    assert.equal(intake.substitutions[0].promisedStampId, f.stampId);
    assert.match(intake.substitutions[0].arrivedLabel, /402/);
  });

  it("refuses to promise a copy that has already gone to a partner", async () => {
    const given = await copy();
    await orderHolding([given], 9);
    const { tradeId } = await trade([given], [{ stampId: f.stampId, quantity: 1 }]);
    await closeWith(tradeId);

    const next = await trade([], []);
    const { added, refused } = await addTradeGiveLines(f.userId, next.sectionId, [given]);
    assert.equal(added, 0);
    assert.match(refused[0]?.reason ?? "", /already gone to a partner/);
  });
});
