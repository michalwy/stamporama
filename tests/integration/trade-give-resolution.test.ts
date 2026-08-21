import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createTrade, setTradeStatus } from "../../src/lib/trades";
import { addTradeGiveLines } from "../../src/lib/trade-lines";
import { setTradeCopyBlock } from "../../src/lib/trade-candidates";
import {
  addTradeGiveLinesForRequirements,
  addTradeGiveLinesFromRequirement,
  resolveTradeGiveRequirements,
} from "../../src/lib/trade-give-resolution";
import type { GiveRequirement } from "../../src/lib/trade-give-resolution-rules";

// **A requirement becomes a copy** (#659).
//
// What only a database can answer, and so what is checked here: that the pool the resolver picks out
// of really is #657's — a sold, disposed, in-transit, otherwise-promised or held-back copy is never
// chosen — that the stated order holds against real rows, that a quantity takes that many distinct
// copies and says so when it cannot, that a gap survives all the way out as an outcome rather than
// an exception, and that a copy sold between resolving and writing comes back as a named refusal
// with the shortfall restated around it.

interface Fixtures {
  userId: string;
  collectionId: string;
  partnerId: string;
  platformId: string;
  stampId: string;
  otherStampId: string;
  conditionId: string;
  otherConditionId: string;
  certificateStatusId: string;
  formatId: string;
  checklistId: string;
}

let f: Fixtures;
let seq = 0;

async function seed(): Promise<Fixtures> {
  const ts = Date.now();
  const userId = `test-user-give-res-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User give-res-${ts}`,
      email: `test-give-res-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-give-res-${ts}`,
      name: `Collection give-res-${ts}`,
      baseCurrency: "EUR",
      ownerId: userId,
    },
  });
  const collectionId = collection.id;
  const partner = await prisma.contact.create({
    data: { collectionId, name: "Karel", exchangePartner: true },
  });
  const platform = await prisma.contact.create({
    data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
  });
  const condition = await prisma.stampCondition.create({
    data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
  });
  const otherCondition = await prisma.stampCondition.create({
    data: { collectionId, name: "Mint", abbreviation: "**", sortOrder: 1 },
  });
  const certificate = await prisma.certificateStatus.create({
    data: { collectionId, name: "Expertised", abbreviation: "cert", sortOrder: 0 },
  });
  const format = await prisma.stampFormat.create({
    data: { collectionId, name: "Block of four", abbreviation: "bl4", sortOrder: 0 },
  });
  const stamp = await prisma.stamp.create({ data: { collectionId, name: "Chopin" } });
  const otherStamp = await prisma.stamp.create({ data: { collectionId, name: "Copernicus" } });
  const checklist = await prisma.checklist.create({
    data: {
      collectionId,
      name: "Wish list",
      stamps: { create: [{ stampId: stamp.id }, { stampId: otherStamp.id }] },
    },
  });

  return {
    userId,
    collectionId,
    partnerId: partner.id,
    platformId: platform.id,
    stampId: stamp.id,
    otherStampId: otherStamp.id,
    conditionId: condition.id,
    otherConditionId: otherCondition.id,
    certificateStatusId: certificate.id,
    formatId: format.id,
    checklistId: checklist.id,
  };
}

async function cleanup(): Promise<void> {
  await prisma.trade.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.sale.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
  await prisma.user.deleteMany({ where: { id: f.userId } });
}

async function copy(
  over: Parameters<typeof createItem>[2] extends infer T ? Partial<T> : never = {}
): Promise<{ id: string; itemNo: number }> {
  const item = await createItem(f.userId, f.collectionId, {
    stampId: f.stampId,
    conditionId: f.conditionId,
    ...over,
  });
  return { id: item.id, itemNo: item.itemNo };
}

/** A photo row straight in the database: the preference only reads whether one exists, and putting
 *  bytes through storage would test the storage layer instead. */
async function photograph(itemId: string): Promise<void> {
  await prisma.photo.create({
    data: {
      itemId,
      storageKey: `test/${itemId}.jpg`,
      mime: "image/jpeg",
      width: 10,
      height: 10,
      sizeBytes: 100,
    },
  });
}

/** Sell a copy, the long way round, because that is the only way a copy is sold: an offer, a set, a
 *  sale and the line that names the piece (ADR-0013). What the pool reads is the last of those. */
let saleNo = 9000;
async function sell(itemId: string): Promise<void> {
  saleNo += 1;
  const offer = await prisma.offer.create({
    data: {
      collectionId: f.collectionId,
      offerNo: saleNo,
      platformId: f.platformId,
      currency: "EUR",
      price: "5.00",
      state: "active",
    },
  });
  const offerSet = await prisma.offerSet.create({ data: { offerId: offer.id } });
  const sale = await prisma.sale.create({
    data: {
      collectionId: f.collectionId,
      saleNo,
      platformId: f.platformId,
      soldAt: new Date(),
      currency: "EUR",
    },
  });
  const line = await prisma.saleLine.create({
    data: { saleId: sale.id, offerId: offer.id, offerSetId: offerSet.id, price: "5.00" },
  });
  await prisma.saleLineItem.create({ data: { saleLineId: line.id, itemId } });
}

async function trade(): Promise<{ tradeId: string; sectionId: string }> {
  seq += 1;
  const created = await createTrade(f.userId, f.collectionId, {
    partnerId: f.partnerId,
    partnerName: null,
    currency: "EUR",
    notes: `give-res ${seq}`,
    catalogVendorId: null,
    balanceByValue: false,
    countTolerance: 0,
    valueTolerancePct: 0,
    ownValueWarnPct: 25,
  });
  return { tradeId: created.id, sectionId: created.sections[0].id };
}

function want(over: Partial<GiveRequirement> = {}): GiveRequirement {
  return { stampId: f.stampId, conditionId: f.conditionId, quantity: 1, ...over };
}

/** Run `act`, disposing of `itemId` the first time anything reads the copies — which puts the copy
 *  on the resolution and out of the collection before the write re-checks it. */
async function disposingAfterTheShelfIsRead<T>(
  itemId: string,
  act: () => Promise<T>
): Promise<T> {
  const model = prisma.item as unknown as { findMany: (args?: unknown) => Promise<unknown> };
  const original = model.findMany;
  let fired = false;
  model.findMany = async (args?: unknown) => {
    const rows = await original.call(prisma.item, args);
    if (!fired) {
      fired = true;
      await prisma.item.update({
        where: { id: itemId },
        data: { disposedAt: new Date(), disposalReason: "lost" },
      });
    }
    return rows;
  };
  try {
    return await act();
  } finally {
    model.findMany = original;
  }
}

before(async () => {
  f = await seed();
});

// A clean shelf per test. The pool is the whole collection narrowed by the requirement, so a copy
// left over from the previous test is a copy this one would resolve to — trades first, since their
// lines name the copies.
beforeEach(async () => {
  await prisma.trade.deleteMany({ where: { collectionId: f.collectionId } });
  await prisma.sale.deleteMany({ where: { collectionId: f.collectionId } });
  await prisma.offer.deleteMany({ where: { collectionId: f.collectionId } });
  await prisma.item.deleteMany({ where: { collectionId: f.collectionId } });
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("resolveTradeGiveRequirements", () => {
  it("picks the for-trade copy over the album one, and the lowest number to settle it", async () => {
    const { tradeId } = await trade();
    const album = await copy();
    const marked = await copy({ forTrade: true });
    const alsoMarked = await copy({ forTrade: true });

    const [resolution] = await resolveTradeGiveRequirements(f.userId, tradeId, [
      want({ quantity: 2 }),
    ]);
    assert.deepEqual(resolution?.itemIds, [marked.id, alsoMarked.id]);
    assert.equal(resolution?.itemIds.includes(album.id), false);
  });

  it("prefers the plain single to a certified copy or a multiple, then the one with a photo", async () => {
    const { tradeId } = await trade();
    const certified = await copy({ forTrade: true, certificateStatusId: f.certificateStatusId });
    const block = await copy({ forTrade: true, formatId: f.formatId });
    const plain = await copy({ forTrade: true });
    const shown = await copy({ forTrade: true });
    await photograph(shown.id);

    const [resolution] = await resolveTradeGiveRequirements(f.userId, tradeId, [
      want({ quantity: 4 }),
    ]);
    // The photographed plain single leads, then the other plain single, and the two copies that
    // differ on a valuation axis come last.
    assert.deepEqual(resolution?.itemIds.slice(0, 2), [shown.id, plain.id]);
    assert.deepEqual(new Set(resolution?.itemIds.slice(2)), new Set([certified.id, block.id]));
  });

  it("narrows to a certificate or a format only when asked to", async () => {
    const { tradeId } = await trade();
    const plain = await copy({ forTrade: true });
    const certified = await copy({ forTrade: true, certificateStatusId: f.certificateStatusId });

    const [any] = await resolveTradeGiveRequirements(f.userId, tradeId, [want()]);
    assert.deepEqual(any?.itemIds, [plain.id]);

    const [asked] = await resolveTradeGiveRequirements(f.userId, tradeId, [
      want({ certificateStatusId: f.certificateStatusId }),
    ]);
    assert.deepEqual(asked?.itemIds, [certified.id]);

    const [none] = await resolveTradeGiveRequirements(f.userId, tradeId, [
      want({ certificateStatusId: null }),
    ]);
    assert.deepEqual(none?.itemIds, [plain.id]);
  });

  it("never picks a copy that is sold, gone, still in the post, promised or held back", async () => {
    const { tradeId, sectionId } = await trade();
    const promised = await copy({ forTrade: true });
    await addTradeGiveLines(f.userId, sectionId, [promised.id]);
    const held = await copy({ forTrade: true });
    await setTradeCopyBlock(f.userId, tradeId, held.id, true);
    const posted = await copy({ forTrade: true, deliveryState: "in_transit" });
    const sold = await copy({ forTrade: true });
    await sell(sold.id);
    const gone = await copy({ forTrade: true });
    await prisma.item.update({
      where: { id: gone.id },
      data: { disposedAt: new Date(), disposalReason: "lost" },
    });
    const free = await copy({ forTrade: true });

    const [resolution] = await resolveTradeGiveRequirements(f.userId, tradeId, [
      want({ quantity: 6 }),
    ]);
    assert.deepEqual(resolution?.itemIds, [free.id]);
    assert.equal(resolution?.missing, 5);
    for (const { id } of [promised, held, posted, sold, gone]) {
      assert.equal(resolution?.itemIds.includes(id), false);
    }
  });

  it("keeps a copy off a second live trade but frees it once that trade is a draft again", async () => {
    const first = await trade();
    const second = await trade();
    const only = await copy({ forTrade: true });
    await addTradeGiveLines(f.userId, first.sectionId, [only.id]);

    const [taken] = await resolveTradeGiveRequirements(f.userId, second.tradeId, [want()]);
    assert.deepEqual(taken?.itemIds, []);

    await prisma.tradeLine.deleteMany({ where: { tradeId: first.tradeId } });
    const [freed] = await resolveTradeGiveRequirements(f.userId, second.tradeId, [want()]);
    assert.deepEqual(freed?.itemIds, [only.id]);
  });

  it("serves no copy twice across a batch, and reports the gap", async () => {
    const { tradeId } = await trade();
    const one = await copy({ forTrade: true });

    const resolutions = await resolveTradeGiveRequirements(f.userId, tradeId, [want(), want()]);
    assert.deepEqual(resolutions[0]?.itemIds, [one.id]);
    assert.deepEqual(resolutions[1]?.itemIds, []);
    assert.equal(resolutions[1]?.missing, 1);
  });

  it("resolves the same list to the same copies on a second run", async () => {
    const { tradeId } = await trade();
    await copy({ forTrade: true });
    await copy({ forTrade: true });
    await copy({ forTrade: true });
    const requirements = [want({ quantity: 2 }), want({ conditionId: f.otherConditionId })];

    const first = await resolveTradeGiveRequirements(f.userId, tradeId, requirements);
    const second = await resolveTradeGiveRequirements(f.userId, tradeId, requirements);
    assert.deepEqual(
      first.map((r) => r.itemIds),
      second.map((r) => r.itemIds)
    );
  });

  it("refuses a stamp or a condition that is not this collection's", async () => {
    const { tradeId } = await trade();
    await assert.rejects(
      () => resolveTradeGiveRequirements(f.userId, tradeId, [want({ stampId: "not-a-stamp" })]),
      /stamp/i
    );
    await assert.rejects(
      () => resolveTradeGiveRequirements(f.userId, tradeId, [want({ conditionId: "nope" })]),
      /condition/i
    );
  });
});

describe("addTradeGiveLinesForRequirements", () => {
  it("promises the chosen copies and leaves the gap as an outcome", async () => {
    const { sectionId } = await trade();
    const only = await copy({ forTrade: true });

    const report = await addTradeGiveLinesForRequirements(f.userId, sectionId, [
      want({ quantity: 2 }),
      want({ conditionId: f.otherConditionId }),
    ]);
    assert.equal(report.added, 1);
    assert.deepEqual(report.refused, []);
    assert.equal(report.outcomes[0]?.served, 1);
    assert.equal(report.outcomes[0]?.missing, 1);
    assert.equal(report.outcomes[1]?.served, 0);
    assert.ok(report.outcomes[1]?.stampLabel.includes("Chopin"));

    const lines = await prisma.tradeLine.findMany({
      where: { sectionId, side: "give" },
      select: { itemId: true, quantity: true },
    });
    assert.deepEqual(lines, [{ itemId: only.id, quantity: 1 }]);
  });

  it("names the copy the write refused and restates the shortfall around it", async () => {
    const { sectionId } = await trade();
    const first = await copy({ forTrade: true });
    const second = await copy({ forTrade: true });

    // The race the re-check on write exists for: the shelf is read, and by the time the lines are
    // written one of the copies has gone. Only reachable from outside by cutting in on the read —
    // both of the resolver's reads happen before the write, so the first one is the seam.
    const report = await disposingAfterTheShelfIsRead(second.id, () =>
      addTradeGiveLinesForRequirements(f.userId, sectionId, [want({ quantity: 2 })])
    );

    assert.equal(report.added, 1);
    assert.equal(report.refused.length, 1);
    assert.equal(report.refused[0]?.itemId, second.id);
    assert.match(report.refused[0]?.reason ?? "", /no longer held/i);
    assert.deepEqual(report.outcomes[0]?.itemIds, [first.id]);
    assert.equal(report.outcomes[0]?.served, 1);
    assert.equal(report.outcomes[0]?.missing, 1);
  });

  it("refuses to touch an agreed trade's list", async () => {
    const { tradeId, sectionId } = await trade();
    await copy({ forTrade: true });
    await setTradeStatus(f.userId, tradeId, "shared");
    await setTradeStatus(f.userId, tradeId, "agreed");
    await assert.rejects(
      () => addTradeGiveLinesForRequirements(f.userId, sectionId, [want()]),
      /cannot be changed/i
    );
  });
});

describe("a whole checklist", () => {
  it("becomes one requirement per stamp, served or reported", async () => {
    const { sectionId } = await trade();
    const held = await copy({ forTrade: true });

    const report = await addTradeGiveLinesFromRequirement(f.userId, sectionId, {
      checklistId: f.checklistId,
      conditionId: f.conditionId,
      quantity: 1,
    });
    assert.equal(report.outcomes.length, 2);
    assert.equal(report.added, 1);
    assert.deepEqual(report.outcomes[0]?.itemIds, [held.id]);
    assert.deepEqual(report.outcomes[1]?.itemIds, []);
    assert.ok(report.outcomes[1]?.stampLabel.includes("Copernicus"));
  });
});
