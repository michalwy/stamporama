import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  listTradesPaginated,
  getTrade,
  createTrade,
  updateTrade,
  setTradeStatus,
  setTradeShipping,
  deleteTrade,
  createTradeSection,
  updateTradeSection,
  reorderTradeSections,
  deleteTradeSection,
  DEFAULT_TRADE_SECTION_NAME,
} from "../../src/lib/trades";
import { createItem } from "../../src/lib/items";
import { resolveQuickJump } from "../../src/lib/quick-jump-server";

// The trade model and its lifecycle (#646; ADR-0039). What is checked here is what only a database
// can answer: the number sequence, the give/receive asymmetry the CHECK constraints enforce, the
// restrict guards, and the one-section invariant.

interface Fixtures {
  userId: string;
  collectionId: string;
  collectionSlug: string;
  partnerId: string;
  stampId: string;
  conditionId: string;
  itemId: string;
}

async function seedFixtures(suffix: string): Promise<Fixtures> {
  const user = await prisma.user.create({
    data: {
      id: `test-user-trade-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-trade-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-trade-${suffix}`,
      name: `Collection ${suffix}`,
      baseCurrency: "EUR",
      ownerId: user.id,
    },
  });
  const collectionId = collection.id;
  const partner = await prisma.contact.create({
    data: { collectionId, name: `Karel ${suffix}`, exchangePartner: true },
  });
  const stamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp 309" } });
  const condition = await prisma.stampCondition.create({
    data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
  });
  const item = await createItem(user.id, collectionId, {
    stampId: stamp.id,
    conditionId: condition.id,
  });

  return {
    userId: user.id,
    collectionId,
    collectionSlug: collection.slug,
    partnerId: partner.id,
    stampId: stamp.id,
    conditionId: condition.id,
    itemId: item.id,
  };
}

async function cleanup(userId: string) {
  await prisma.collection.deleteMany({ where: { ownerId: userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("createTrade (#646)", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures(`create-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("allocates a per-collection number and starts in preparing with one section", async () => {
    const trade = await createTrade(f.userId, f.collectionId, {
      partnerId: f.partnerId,
      currency: "EUR",
    });
    assert.equal(trade.tradeNo, 1);
    assert.equal(trade.status, "preparing");
    assert.equal(trade.partnerName.startsWith("Karel"), true);
    // A trade always has somewhere to put a line: `TradeLine.sectionId` is required.
    assert.equal(trade.sections.length, 1);
    assert.equal(trade.sections[0].name, DEFAULT_TRADE_SECTION_NAME);
    // The default rule is piece count with no tolerance, and no agreed catalog.
    assert.equal(trade.balanceByValue, false);
    assert.equal(trade.countTolerance, 0);
    assert.equal(trade.ownValueWarnPct, 25);
    assert.equal(trade.catalogVendorId, null);
  });

  it("hands out the next number, and never reuses a deleted one (#432)", async () => {
    const second = await createTrade(f.userId, f.collectionId, {
      partnerId: f.partnerId,
      currency: "EUR",
    });
    assert.equal(second.tradeNo, 2);
    await deleteTrade(f.userId, second.id);
    const third = await createTrade(f.userId, f.collectionId, {
      partnerId: f.partnerId,
      currency: "EUR",
    });
    assert.equal(third.tradeNo, 3);
  });

  it("agrees on a catalog **vendor**, not one of its books", async () => {
    // Michel Deutschland prices nothing Polish, and a trade routinely spans several areas — so what
    // is agreed is the publisher, and which volume a line is read in follows from its stamp's area.
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId: f.collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const trade = await createTrade(f.userId, f.collectionId, {
      partnerId: f.partnerId,
      currency: "EUR",
      catalogVendorId: vendor.id,
    });
    assert.equal(trade.catalogVendorId, vendor.id);
    assert.equal(trade.catalogVendorName, "Mi");
    // And a vendor named on a trade cannot be deleted out from under it.
    await assert.rejects(() => prisma.catalogVendor.delete({ where: { id: vendor.id } }));
  });

  it("drops a catalog vendor belonging to another collection", async () => {
    const other = await prisma.collection.create({
      data: {
        slug: `col-trade-other-${Date.now()}`,
        name: "Somebody else's",
        baseCurrency: "EUR",
        ownerId: f.userId,
      },
    });
    const foreign = await prisma.catalogVendor.create({
      data: { collectionId: other.id, name: "Scott", abbreviation: "Sc" },
    });
    const trade = await createTrade(f.userId, f.collectionId, {
      partnerId: f.partnerId,
      currency: "EUR",
      catalogVendorId: foreign.id,
    });
    assert.equal(trade.catalogVendorId, null);
  });

  it("creates the partner on the fly, carrying the exchangePartner role", async () => {
    const trade = await createTrade(f.userId, f.collectionId, {
      partnerName: "Someone New",
      currency: "CZK",
    });
    const partner = await prisma.contact.findUniqueOrThrow({ where: { id: trade.partnerId } });
    assert.equal(partner.name, "Someone New");
    assert.equal(partner.exchangePartner, true);
  });

  it("refuses a trade with no partner at all", async () => {
    await assert.rejects(
      () => createTrade(f.userId, f.collectionId, { currency: "EUR" }),
      /partner is required/
    );
  });

  it("refuses a collection that is not the caller's", async () => {
    await assert.rejects(
      () => createTrade("somebody-else", f.collectionId, { partnerId: f.partnerId, currency: "EUR" }),
      /access denied/
    );
  });
});

describe("trade lifecycle and shipping (#646)", () => {
  let f: Fixtures;
  let tradeId: string;
  before(async () => {
    f = await seedFixtures(`life-${Date.now()}`);
    tradeId = (
      await createTrade(f.userId, f.collectionId, { partnerId: f.partnerId, currency: "EUR" })
    ).id;
  });
  after(() => cleanup(f.userId));

  it("walks the line, and refuses a jump over a stage", async () => {
    await assert.rejects(() => setTradeStatus(f.userId, tradeId, "closed"), /cannot become closed/);
    await setTradeStatus(f.userId, tradeId, "shared");
    await setTradeStatus(f.userId, tradeId, "agreed");
    assert.equal((await getTrade(f.userId, tradeId))!.status, "agreed");
  });

  it("records the two parcels independently, in either order", async () => {
    // The partner's parcel arrives before mine goes out — which is exactly why these are two
    // timestamps and not two states.
    await setTradeShipping(f.userId, tradeId, { receivedAt: new Date("2026-03-02") });
    let trade = (await getTrade(f.userId, tradeId))!;
    assert.equal(trade.sentAt, null);
    assert.equal(trade.receivedAt?.slice(0, 10), "2026-03-02");

    await setTradeShipping(f.userId, tradeId, { sentAt: new Date("2026-03-05") });
    trade = (await getTrade(f.userId, tradeId))!;
    assert.equal(trade.sentAt?.slice(0, 10), "2026-03-05");
    assert.equal(trade.receivedAt?.slice(0, 10), "2026-03-02");

    // A mark can be taken back; leaving the other field out must not touch it.
    await setTradeShipping(f.userId, tradeId, { sentAt: null });
    trade = (await getTrade(f.userId, tradeId))!;
    assert.equal(trade.sentAt, null);
    assert.equal(trade.receivedAt?.slice(0, 10), "2026-03-02");
  });

  it("closes, and then goes nowhere", async () => {
    await setTradeStatus(f.userId, tradeId, "closed");
    await assert.rejects(() => setTradeStatus(f.userId, tradeId, "agreed"), /cannot become agreed/);
    await assert.rejects(
      () => setTradeStatus(f.userId, tradeId, "cancelled"),
      /cannot become cancelled/
    );
  });
});

describe("trade sections (#646)", () => {
  let f: Fixtures;
  let tradeId: string;
  before(async () => {
    f = await seedFixtures(`section-${Date.now()}`);
    tradeId = (
      await createTrade(f.userId, f.collectionId, {
        partnerId: f.partnerId,
        currency: "EUR",
        balanceByValue: true,
        valueTolerancePct: 5,
      })
    ).id;
  });
  after(() => cleanup(f.userId));

  it("appends sections and reorders them", async () => {
    const mint = await createTradeSection(f.userId, tradeId, { name: "Mint" });
    const used = await createTradeSection(f.userId, tradeId, { name: "Used" });
    assert.equal(mint.position, 1);
    assert.equal(used.position, 2);

    const first = (await getTrade(f.userId, tradeId))!.sections[0];
    await reorderTradeSections(f.userId, tradeId, [used.id, mint.id, first.id]);
    const names = (await getTrade(f.userId, tradeId))!.sections.map((s) => s.name);
    assert.deepEqual(names, ["Used", "Mint", DEFAULT_TRADE_SECTION_NAME]);
  });

  it("states a balance rule whole, and clears it whole", async () => {
    const section = await createTradeSection(f.userId, tradeId, {
      name: "By the piece",
      balanceByValue: false,
      countTolerance: 3,
    });
    assert.equal(section.balanceByValue, false);
    assert.equal(section.countTolerance, 3);

    // Clearing the discriminator nulls the whole override — no half-inherited rule can exist.
    const cleared = await updateTradeSection(f.userId, section.id, {
      name: "By the piece",
      balanceByValue: null,
      countTolerance: 3,
    });
    assert.deepEqual(
      [
        cleared.balanceByValue,
        cleared.countTolerance,
        cleared.valueTolerancePct,
        cleared.ownValueWarnPct,
      ],
      [null, null, null, null]
    );
  });

  it("refuses to delete a section that still holds lines", async () => {
    const section = await createTradeSection(f.userId, tradeId, { name: "Holding one" });
    await prisma.tradeLine.create({
      data: { tradeId, sectionId: section.id, side: "give", itemId: f.itemId },
    });
    await assert.rejects(() => deleteTradeSection(f.userId, section.id), /empty section/);
    await prisma.tradeLine.deleteMany({ where: { sectionId: section.id } });
    await deleteTradeSection(f.userId, section.id);
  });

  it("refuses to delete the last section, because a line needs somewhere to go", async () => {
    const soloTrade = await createTrade(f.userId, f.collectionId, {
      partnerId: f.partnerId,
      currency: "EUR",
    });
    await assert.rejects(
      () => deleteTradeSection(f.userId, soloTrade.sections[0].id),
      /at least one section/
    );
  });

  it("locks the sections once the trade is agreed", async () => {
    const locked = await createTrade(f.userId, f.collectionId, {
      partnerId: f.partnerId,
      currency: "EUR",
    });
    await setTradeStatus(f.userId, locked.id, "shared");
    // Still editable while shared — negotiation is exactly when a list changes.
    await createTradeSection(f.userId, locked.id, { name: "Added while shared" });
    await setTradeStatus(f.userId, locked.id, "agreed");
    await assert.rejects(
      () => createTradeSection(f.userId, locked.id, { name: "Too late" }),
      /cannot be changed/
    );
  });
});

describe("trade lines — the give/receive asymmetry (#646)", () => {
  let f: Fixtures;
  let tradeId: string;
  let sectionId: string;
  before(async () => {
    f = await seedFixtures(`line-${Date.now()}`);
    const trade = await createTrade(f.userId, f.collectionId, {
      partnerId: f.partnerId,
      currency: "EUR",
    });
    tradeId = trade.id;
    sectionId = trade.sections[0].id;
  });
  after(() => cleanup(f.userId));

  it("takes a give line naming a copy, and a receive line naming a want's key", async () => {
    await prisma.tradeLine.create({
      data: { tradeId, sectionId, side: "give", itemId: f.itemId },
    });
    await prisma.tradeLine.create({
      data: {
        tradeId,
        sectionId,
        side: "receive",
        stampId: f.stampId,
        conditionId: f.conditionId,
        quantity: 4,
      },
    });
    const [row] = (await listTradesPaginated(f.userId, f.collectionId)).items;
    assert.equal(row.giveCount, 1);
    assert.equal(row.receiveCount, 1);
    // Four stamps on one line — a piece count is not a line count.
    assert.equal(row.receiveQuantity, 4);
  });

  it("refuses a give line that names a stamp instead of a copy", async () => {
    await assert.rejects(() =>
      prisma.tradeLine.create({
        data: { tradeId, sectionId, side: "give", stampId: f.stampId, conditionId: f.conditionId },
      })
    );
  });

  it("refuses a receive line that names a copy", async () => {
    await assert.rejects(() =>
      prisma.tradeLine.create({
        data: {
          tradeId,
          sectionId,
          side: "receive",
          itemId: f.itemId,
          stampId: f.stampId,
          conditionId: f.conditionId,
        },
      })
    );
  });

  it("refuses a give line with a quantity — a copy is a copy", async () => {
    const other = await createItem(f.userId, f.collectionId, {
      stampId: f.stampId,
      conditionId: f.conditionId,
    });
    await assert.rejects(() =>
      prisma.tradeLine.create({
        data: { tradeId, sectionId, side: "give", itemId: other.id, quantity: 2 },
      })
    );
  });

  it("refuses the same copy twice on one trade", async () => {
    await assert.rejects(() =>
      prisma.tradeLine.create({
        data: { tradeId, sectionId, side: "give", itemId: f.itemId },
      })
    );
  });

  it("will not let a copy be deleted out from under a trade", async () => {
    await assert.rejects(() => prisma.item.delete({ where: { id: f.itemId } }));
  });

  it("takes the lines with it when the trade goes, and leaves the copies alone", async () => {
    await deleteTrade(f.userId, tradeId);
    assert.equal(await prisma.tradeLine.count({ where: { tradeId } }), 0);
    assert.equal(await prisma.tradeSection.count({ where: { tradeId } }), 0);
    assert.ok(await prisma.item.findUnique({ where: { id: f.itemId } }));
  });
});

describe("trade list and quick jump (#646)", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures(`list-${Date.now()}`);
    await createTrade(f.userId, f.collectionId, { partnerId: f.partnerId, currency: "EUR" });
    const second = await createTrade(f.userId, f.collectionId, {
      partnerName: "Zdeněk Novák",
      currency: "CZK",
    });
    await setTradeStatus(f.userId, second.id, "shared");
  });
  after(() => cleanup(f.userId));

  it("filters by status and by partner name", async () => {
    const shared = await listTradesPaginated(f.userId, f.collectionId, { status: "shared" });
    assert.equal(shared.items.length, 1);
    assert.equal(shared.items[0].partnerName, "Zdeněk Novák");

    const byName = await listTradesPaginated(f.userId, f.collectionId, { partnerSearch: "novák" });
    assert.equal(byName.items.length, 1);

    const byNumber = await listTradesPaginated(f.userId, f.collectionId, { tradeNo: 1 });
    assert.equal(byNumber.items.length, 1);
    assert.equal(byNumber.items[0].tradeNo, 1);
  });

  it("sorts newest first by default", async () => {
    const { items } = await listTradesPaginated(f.userId, f.collectionId);
    assert.deepEqual(
      items.map((t) => t.tradeNo),
      [2, 1]
    );
  });

  it("lands a `t 2` jump on the list, filtered to that number", async () => {
    const hit = await resolveQuickJump(f.userId, f.collectionId, { entity: "trade", no: 2 });
    assert.equal(hit?.href, `/c/${f.collectionSlug}/trades?search=%232`);
    assert.equal(await resolveQuickJump(f.userId, f.collectionId, { entity: "trade", no: 99 }), null);
  });

  it("updates the header without touching the sections or the status", async () => {
    const { items } = await listTradesPaginated(f.userId, f.collectionId, { tradeNo: 2 });
    const before = items[0];
    const after = await updateTrade(f.userId, before.id, {
      partnerId: f.partnerId,
      currency: "PLN",
      notes: "swap agreed at the Brno fair",
      balanceByValue: true,
      valueTolerancePct: 7.5,
    });
    assert.equal(after.currency, "PLN");
    assert.equal(after.notes, "swap agreed at the Brno fair");
    assert.equal(after.balanceByValue, true);
    assert.equal(after.valueTolerancePct, 7.5);
    assert.equal(after.status, "shared");
    assert.equal(after.sections.length, 1);
  });

  it("will not let a partner be deleted while a trade names them", async () => {
    await assert.rejects(() => prisma.contact.delete({ where: { id: f.partnerId } }));
  });
});
