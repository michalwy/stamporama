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
import {
  listTradeLinePage,
  listOfferableCopies,
  addTradeGiveLines,
  addTradeReceiveLines,
  updateTradeReceiveLine,
  deleteTradeLine,
} from "../../src/lib/trade-lines";
import {
  readTradeBalance,
  refreshTradeRates,
  setTradeLineValue,
} from "../../src/lib/trade-valuation";
import { createItem } from "../../src/lib/items";
import { closeWant, createWant } from "../../src/lib/wants";
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
  /** The area the stamp is filed under, and the publisher whose book prices it (#638). */
  areaId: string;
  vendorId: string;
  catalogNameId: string;
  editionId: string;
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

  // A priced stamp, filed in an area with a primary catalogue (#638). Every trade in this file has
  // valued lines by construction, because that is the ordinary case — a trade whose lines cannot be
  // valued is refused at `preparing → shared`, and a fixture that could not get past it would be
  // testing the gate rather than everything else.
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
  await prisma.stampCollectionArea.create({
    data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
  });
  await prisma.stampCatalogNumber.create({
    data: { stampId: stamp.id, catalogVendorId: vendor.id, number: "309" },
  });
  await prisma.stampCatalogPrice.create({
    data: {
      stampId: stamp.id,
      catalogEditionId: edition.id,
      conditionId: condition.id,
      price: "10.00",
      currency: "EUR",
    },
  });

  return {
    userId: user.id,
    collectionId,
    collectionSlug: collection.slug,
    partnerId: partner.id,
    stampId: stamp.id,
    conditionId: condition.id,
    itemId: item.id,
    areaId: area.id,
    vendorId: vendor.id,
    catalogNameId: catalogName.id,
    editionId: edition.id,
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

  it("lands a `t 2` jump on the trade's own screen (#637)", async () => {
    const { items } = await listTradesPaginated(f.userId, f.collectionId, { tradeNo: 2 });
    const hit = await resolveQuickJump(f.userId, f.collectionId, { entity: "trade", no: 2 });
    assert.equal(hit?.href, `/c/${f.collectionSlug}/trades/${items[0].id}`);
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

describe("trade lines — composing both sides (#637)", () => {
  let f: Fixtures;
  let tradeId: string;
  let sectionId: string;
  /** A second copy, marked for trade, which is what the picker opens on. */
  let markedItemId: string;

  /** One page of one side, with the defaults the screen uses. */
  const give = (opts: Parameters<typeof listTradeLinePage>[2]["filters"] = {}) =>
    listTradeLinePage(f.userId, tradeId, { sectionId, side: "give", filters: opts });
  const receive = (opts: Parameters<typeof listTradeLinePage>[2]["filters"] = {}) =>
    listTradeLinePage(f.userId, tradeId, { sectionId, side: "receive", filters: opts });

  before(async () => {
    f = await seedFixtures(`compose-${Date.now()}`);
    const trade = await createTrade(f.userId, f.collectionId, {
      partnerId: f.partnerId,
      currency: "EUR",
    });
    tradeId = trade.id;
    sectionId = trade.sections[0].id;
    markedItemId = (
      await createItem(f.userId, f.collectionId, {
        stampId: f.stampId,
        conditionId: f.conditionId,
        forTrade: true,
      })
    ).id;
  });
  // The trade goes first: `TradeLine.itemId` is `Restrict`, so a copy cannot be deleted while a
  // trade still names it — which is the guard #646 put there, and it applies to the teardown too.
  after(async () => {
    await prisma.trade.deleteMany({ where: { collectionId: f.collectionId } });
    await cleanup(f.userId);
  });

  it("opens on the for-trade copies and widens to everything held", async () => {
    const marked = await listOfferableCopies(f.userId, tradeId, { forTradeOnly: true });
    assert.deepEqual(
      marked.map((i) => i.id),
      [markedItemId]
    );
    // The disposition is a default, not a rule: a partner asks by name for things never marked.
    const all = await listOfferableCopies(f.userId, tradeId, { forTradeOnly: false });
    assert.equal(all.length, 2);
    assert.ok(all.some((i) => i.id === f.itemId));
  });

  it("promises copies in bulk and stops offering them afterwards", async () => {
    const result = await addTradeGiveLines(f.userId, sectionId, [markedItemId, f.itemId]);
    assert.equal(result.added, 2);
    assert.deepEqual(result.refused, []);

    const page = await give();
    assert.equal(page.total, 2);
    assert.equal(page.items.length, 2);
    // The page carries the copies enriched, so the screen draws them as copy rows.
    assert.ok(page.items.every((i) => i.side === "give" && !!i.copy.itemNo));

    assert.deepEqual(await listOfferableCopies(f.userId, tradeId, { forTradeOnly: false }), []);
  });

  it("treats a copy already on this trade as a no-op, not a refusal", async () => {
    const result = await addTradeGiveLines(f.userId, sectionId, [markedItemId]);
    assert.equal(result.added, 0);
    assert.deepEqual(result.refused, []);
    assert.equal((await give()).total, 2);
  });

  it("refuses a copy already promised to another live trade, by name", async () => {
    const other = await createTrade(f.userId, f.collectionId, {
      partnerId: f.partnerId,
      currency: "EUR",
    });
    const result = await addTradeGiveLines(f.userId, other.sections[0].id, [markedItemId]);
    assert.equal(result.added, 0);
    assert.equal(result.refused.length, 1);
    assert.match(result.refused[0].reason, /already promised to trade #1/);
    await deleteTrade(f.userId, other.id);
  });

  it("refuses a copy that has not arrived", async () => {
    const inTransit = await createItem(f.userId, f.collectionId, {
      stampId: f.stampId,
      conditionId: f.conditionId,
      deliveryState: "in_transit",
    });
    // Not offered in the first place…
    const offerable = await listOfferableCopies(f.userId, tradeId, { forTradeOnly: false });
    assert.ok(!offerable.some((i) => i.id === inTransit.id));
    // …and refused by name if one is submitted anyway.
    const result = await addTradeGiveLines(f.userId, sectionId, [inTransit.id]);
    assert.equal(result.added, 0);
    assert.match(result.refused[0].reason, /has not arrived/);
  });

  it("takes a receive line at the want key, and reads its stamp identity back", async () => {
    await addTradeReceiveLines(f.userId, sectionId, {
      stampId: f.stampId,
      conditionId: f.conditionId,
      // Null on both is a **value** on each axis: no certificate, and a single.
      certificateStatusId: null,
      formatId: null,
      quantity: 3,
    });
    const page = await receive();
    assert.equal(page.total, 1);
    // Three stamps on one line — the piece count is not the line count.
    assert.equal(page.pieces, 3);
    const [item] = page.items;
    assert.ok(item.side === "receive");
    assert.equal(item.line.stampName, "Stamp 309");
    assert.equal(item.line.conditionAbbreviation, "U");
    assert.equal(item.line.certificateStatusId, null);
    assert.equal(item.line.formatId, null);
  });

  it("marks a receive line against the open wants for its stamp, and drops a closed one (#664)", async () => {
    const {
      ids: [wantId],
    } = await createWant(f.userId, f.collectionId, {
      stampId: f.stampId,
      conditionIds: [f.conditionId],
      certificateStatusIds: [],
      formatIds: [],
      priority: "high",
      notes: null,
    });

    const wanted = (await receive()).items.find(
      (i) => i.side === "receive" && i.line.stampId === f.stampId
    );
    assert.ok(wanted?.side === "receive");
    // The line names the whole want key by construction, so the row can say more than "this stamp
    // is wanted" — and the priority is what a want list is for.
    assert.equal(wanted.line.wants?.openCount, 1);
    assert.equal(wanted.line.wants?.topPriority, "high");
    assert.deepEqual(wanted.line.wants?.entries[0].acceptance.conditionIds, [f.conditionId]);

    // **A closed want is not a signal** — the rule every other want reader follows.
    await closeWant(f.userId, wantId);
    const after = (await receive()).items.find(
      (i) => i.side === "receive" && i.line.stampId === f.stampId
    );
    assert.ok(after?.side === "receive");
    assert.equal(after.line.wants, null);
  });

  it("values a receive line at its own key, so both columns carry the same figure (#638)", async () => {
    const page = await receive();
    const line = page.items.find(
      (i) => i.side === "receive" && i.line.stampId === f.stampId
    );
    // The same `CopyValuation` a give line carries, per piece — the quantity is on the row beside
    // it, and a figure silently multiplied by it would not be the catalogue's.
    assert.equal(line?.side, "receive");
    assert.equal(line!.side === "receive" ? line!.line.value.unpriced : true, false);
    assert.equal(line!.side === "receive" ? line!.line.value.baseAmount : null, 10);
  });

  it("expands a whole checklist into one line per stamp on it", async () => {
    const second = await prisma.stamp.create({
      data: { collectionId: f.collectionId, name: "Stamp 310" },
    });
    const checklist = await prisma.checklist.create({
      data: {
        collectionId: f.collectionId,
        name: "Complete set",
        stamps: { create: [{ stampId: f.stampId }, { stampId: second.id }] },
      },
    });

    const before = (await receive()).total;
    const added = await addTradeReceiveLines(f.userId, sectionId, {
      checklistId: checklist.id,
      stampId: "",
      conditionId: f.conditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    assert.equal(added, 2);
    assert.equal((await receive()).total, before + 2);

    // A shortcut for *entering*, never a thing that is stored: what came out is stamps.
    const stored = await prisma.tradeLine.findMany({
      where: { sectionId, side: "receive", stampId: second.id },
      select: { stampId: true },
    });
    assert.equal(stored.length, 1);
  });

  it("restates a receive line whole, and refuses to restate a give one", async () => {
    const receiveLine = (await receive()).items[0];
    const giveLine = (await give()).items[0];
    await updateTradeReceiveLine(f.userId, receiveLine.lineId, {
      stampId: f.stampId,
      conditionId: f.conditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: 7,
    });
    const after = (await receive()).items.find((i) => i.lineId === receiveLine.lineId);
    assert.ok(after?.side === "receive");
    assert.equal(after.line.quantity, 7);

    await assert.rejects(
      () =>
        updateTradeReceiveLine(f.userId, giveLine.lineId, {
          stampId: f.stampId,
          conditionId: f.conditionId,
          certificateStatusId: null,
          formatId: null,
          quantity: 1,
        }),
      /names a copy/
    );
  });

  it("searches a side without touching the other, and says what it narrowed from", async () => {
    const hit = await receive({ search: "Stamp 310" });
    assert.equal(hit.total, 1);
    // The unfiltered figure is what lets the column read "1 of 4" rather than pretending to be whole.
    assert.ok(hit.unfiltered > hit.total);

    const miss = await receive({ search: "nothing like this" });
    assert.equal(miss.total, 0);
    assert.equal(miss.items.length, 0);

    // The give side is a separate list and a search on one says nothing about the other.
    assert.equal((await give()).total, 2);
  });

  it("filters a side by condition, and the give side by having no photo", async () => {
    const other = await prisma.stampCondition.create({
      data: { collectionId: f.collectionId, name: "Mint", abbreviation: "**", sortOrder: 1 },
    });
    assert.equal((await give({ conditionIds: [f.conditionId] })).total, 2);
    assert.equal((await give({ conditionIds: [other.id] })).total, 0);
    // Nothing in these fixtures has a photograph, so the filter is the whole side — what matters is
    // that it is asked of the give side at all, which is where copies actually exist.
    assert.equal((await give({ noPhotos: true })).total, 2);
  });

  it("arranges a side by the levels it is given, counting over the whole side", async () => {
    const flat = await give();
    assert.deepEqual(flat.items[0].path, []);
    assert.deepEqual(flat.headings, {});

    const byCondition = await listTradeLinePage(f.userId, tradeId, {
      sectionId,
      side: "give",
      levels: ["condition"],
    });
    // Both copies are Used, so one heading over the pair — and it counts the pair, not the page.
    const headings = Object.values(byCondition.headings);
    assert.equal(headings.length, 1);
    assert.equal(headings[0].label, "U");
    assert.equal(headings[0].count, 2);
    assert.ok(byCondition.items.every((i) => i.path.length === 1));
  });

  it("pages a side, and the next page carries on where the last left off", async () => {
    const first = await listTradeLinePage(f.userId, tradeId, {
      sectionId,
      side: "give",
      pageSize: 1,
    });
    assert.equal(first.items.length, 1);
    assert.equal(first.total, 2);
    assert.equal(first.nextCursor, "1");

    const second = await listTradeLinePage(f.userId, tradeId, {
      sectionId,
      side: "give",
      pageSize: 1,
      offset: 1,
    });
    assert.equal(second.items.length, 1);
    assert.equal(second.nextCursor, null);
    assert.notEqual(first.items[0].lineId, second.items[0].lineId);
  });

  it("takes a line off and leaves the copy where it was", async () => {
    const item = (await give()).items[0];
    assert.ok(item.side === "give");
    const itemId = item.copy.id;
    await deleteTradeLine(f.userId, item.lineId);
    assert.equal((await give()).total, 1);
    assert.ok(await prisma.item.findUnique({ where: { id: itemId } }));
    // Released, so it is offerable again: a give line is a promise, never a claim.
    const offerable = await listOfferableCopies(f.userId, tradeId, { forTradeOnly: false });
    assert.ok(offerable.some((i) => i.id === itemId));
  });

  it("locks every line write once the trade is agreed", async () => {
    const giveLine = (await give()).items[0];
    // The lifecycle gate (#638) is not what this test is about: this trade holds receive lines for
    // stamps nothing prices, so give every line a figure of its own and get on with the lock.
    for (const line of await prisma.tradeLine.findMany({ where: { tradeId }, select: { id: true } })) {
      await setTradeLineValue(f.userId, line.id, { manualValue: 1 });
    }
    await setTradeStatus(f.userId, tradeId, "shared");
    await setTradeStatus(f.userId, tradeId, "agreed");

    await assert.rejects(() => addTradeGiveLines(f.userId, sectionId, [f.itemId]), /cannot be changed/);
    await assert.rejects(
      () =>
        addTradeReceiveLines(f.userId, sectionId, {
          stampId: f.stampId,
          conditionId: f.conditionId,
          certificateStatusId: null,
          formatId: null,
          quantity: 1,
        }),
      /cannot be changed/
    );
    await assert.rejects(() => deleteTradeLine(f.userId, giveLine.lineId), /cannot be changed/);
    // Reading it is untouched — the partner's copy of the list is exactly what is being shown.
    assert.equal((await give()).total, 1);
  });

  it("refuses a trade that is not the caller's", async () => {
    await assert.rejects(() =>
      listTradeLinePage("someone-else", tradeId, { sectionId, side: "give" })
    );
    await assert.rejects(() => listOfferableCopies("someone-else", tradeId));
  });
});

describe("balancing — the two valuations (#638)", () => {
  let f: Fixtures;
  let tradeId: string;
  let sectionId: string;

  before(async () => {
    f = await seedFixtures(`balance-${Date.now()}`);
    const trade = await createTrade(f.userId, f.collectionId, {
      partnerId: f.partnerId,
      currency: "EUR",
      catalogVendorId: f.vendorId,
    });
    tradeId = trade.id;
    sectionId = trade.sections[0].id;
  });
  // The trades go first: `TradeLine.itemId` is `Restrict`, so a copy cannot be deleted while one
  // still names it — the guard applies to the teardown as much as to the app.
  after(async () => {
    await prisma.trade.deleteMany({ where: { collectionId: f.collectionId } });
    await cleanup(f.userId);
  });

  /** A second copy of the priced stamp, so a side can be given weight without new fixtures. */
  async function addGiveCopy(): Promise<string> {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.stampId,
      conditionId: f.conditionId,
    });
    await addTradeGiveLines(f.userId, sectionId, [item.id]);
    return item.id;
  }

  it("values both sides from the catalogue, and keeps the two valuations apart", async () => {
    await addGiveCopy();
    await addTradeReceiveLines(f.userId, sectionId, {
      stampId: f.stampId,
      conditionId: f.conditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: 3,
    });

    const balance = (await readTradeBalance(f.userId, tradeId))!;
    assert.equal(balance.baseCurrency, "EUR");
    assert.equal(balance.tradeCurrency, "EUR");
    // One copy out at 10, three stamps in at 10 each — pieces are counted, not lines.
    assert.equal(balance.trade.give.pieces, 1);
    assert.equal(balance.trade.receive.pieces, 3);
    assert.equal(balance.trade.give.own, 10);
    assert.equal(balance.trade.receive.own, 30);
    // The agreed catalogue is the same publisher here, so it agrees — but it is its own figure,
    // summed in the trade's currency, never folded into the one above.
    assert.equal(balance.trade.give.agreed, 10);
    assert.equal(balance.trade.receive.agreed, 30);
    assert.equal(balance.blockers.length, 0);
  });

  it("counts a line no catalogue prices as unvalued, and refuses to share while it is", async () => {
    // Numbered rather than named, which is how stamps actually arrive: a name is optional and
    // usually blank, so the gate has to name a line by its catalogue number or say nothing useful.
    const unpriced = await prisma.stamp.create({
      data: {
        collectionId: f.collectionId,
        catalogNumbers: {
          create: { catalogVendorId: f.vendorId, number: "412" },
        },
        stampAreaLinks: { create: { collectionAreaId: f.areaId, isPrimary: true } },
      },
    });
    await addTradeReceiveLines(f.userId, sectionId, {
      stampId: unpriced.id,
      conditionId: f.conditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    const line = (await prisma.tradeLine.findFirstOrThrow({
      where: { tradeId, stampId: unpriced.id },
      select: { id: true },
    })).id;

    const blocked = (await readTradeBalance(f.userId, tradeId))!;
    assert.equal(blocked.trade.receive.ownMissing, 1);
    assert.equal(blocked.blockers[0].kind, "own-unvalued");
    // Named by its **catalogue number**, never merely counted: a refusal that says "1 line" — or
    // "Unnamed stamp" eight times — sends the collector hunting through both sides of every section.
    assert.match(blocked.blockers[0].message, /Mi 412 \(U\)/);
    await assert.rejects(() => setTradeStatus(f.userId, tradeId, "shared"), /Mi 412/);

    // The escape hatch: the collector's own figure, in the base currency, marked as theirs.
    await setTradeLineValue(f.userId, line, { manualValue: 4.5 });
    const rescued = (await readTradeBalance(f.userId, tradeId))!;
    assert.equal(rescued.blockers.length, 0);
    assert.equal(rescued.trade.receive.ownMissing, 0);
    assert.equal(rescued.trade.receive.ownManual, 1);
    assert.equal(rescued.trade.receive.own, 34.5);
  });

  it("names both sides the same way — the catalogue number, and nothing else", async () => {
    const balance = (await readTradeBalance(f.userId, tradeId))!;
    // No copy number in front of the give side: that is an internal handle, and it would make the
    // two sides of one refusal look like two different kinds of thing.
    assert.equal(balance.lines.find((l) => l.side === "give")!.label, "Mi 309 (U)");
    assert.equal(
      balance.lines.find((l) => l.side === "receive" && l.label.startsWith("Mi 309"))!.label,
      "Mi 309 (U)"
    );
  });

  it("refuses a negative manual value rather than clamping it", async () => {
    const line = await prisma.tradeLine.findFirstOrThrow({
      where: { tradeId },
      select: { id: true },
    });
    await assert.rejects(
      () => setTradeLineValue(f.userId, line.id, { manualValue: -5 }),
      /cannot be negative/
    );
  });

  it("warns on the own-value skew without ever blocking on it", async () => {
    await updateTrade(f.userId, tradeId, {
      partnerId: f.partnerId,
      currency: "EUR",
      catalogVendorId: f.vendorId,
      ownValueWarnPct: 5,
    });
    const balance = (await readTradeBalance(f.userId, tradeId))!;
    assert.equal(balance.trade.ownWarn, true);
    // And it still shares: an uneven trade is a normal thing.
    await setTradeStatus(f.userId, tradeId, "shared");
    assert.equal((await getTrade(f.userId, tradeId))!.status, "shared");
  });

  it("freezes the rates at the first share, and refuses to refresh them once agreed", async () => {
    const shared = (await readTradeBalance(f.userId, tradeId))!;
    assert.equal(shared.ratesFrozen, true);
    // Refreshing is the deliberate act, and it is allowed exactly while the negotiation runs.
    await refreshTradeRates(f.userId, tradeId);

    await setTradeStatus(f.userId, tradeId, "agreed");
    await assert.rejects(() => refreshTradeRates(f.userId, tradeId), /frozen/);
  });

  it("snapshots both valuations onto the lines when both sides commit", async () => {
    const frozen = (await readTradeBalance(f.userId, tradeId))!;
    assert.equal(frozen.frozen, true);
    const rows = await prisma.tradeLineValuation.findMany({
      where: { line: { tradeId } },
      select: { kind: true, targetCurrency: true, value: true, manual: true },
    });
    // Two per line and never one: the two valuations are the same shape asked of two books.
    const lineCount = await prisma.tradeLine.count({ where: { tradeId } });
    assert.equal(rows.length, lineCount * 2);
    assert.deepEqual([...new Set(rows.map((r) => r.kind))].sort(), ["agreed", "own"]);
    assert.equal(rows.some((r) => r.manual), true);
  });

  it("keeps the frozen figure when the catalogue moves under it", async () => {
    const before = (await readTradeBalance(f.userId, tradeId))!.trade.give.own;
    const edition = await prisma.catalogEdition.create({
      data: { catalogNameId: f.catalogNameId, year: 2027 },
    });
    await prisma.stampCatalogPrice.create({
      data: {
        stampId: f.stampId,
        catalogEditionId: edition.id,
        conditionId: f.conditionId,
        price: "99.00",
        currency: "EUR",
      },
    });
    // The partner is holding a printout: a new edition loaded now must not restate the agreement.
    assert.equal((await readTradeBalance(f.userId, tradeId))!.trade.give.own, before);
  });

  it("releases the freeze when the trade goes back to a status its list can be edited in", async () => {
    await setTradeStatus(f.userId, tradeId, "shared");
    assert.equal(await prisma.tradeLineValuation.count({ where: { line: { tradeId } } }), 0);
    // And the live read now sees the new edition, because a list being edited is valued live.
    const live = (await readTradeBalance(f.userId, tradeId))!;
    assert.equal(live.frozen, false);
    assert.equal(live.trade.give.own, 99);
  });

  it("asks for the agreed figure only where value balancing decides", async () => {
    const bare = await createTrade(f.userId, f.collectionId, {
      partnerId: f.partnerId,
      currency: "EUR",
      balanceByValue: true,
      valueTolerancePct: 5,
    });
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.stampId,
      conditionId: f.conditionId,
    });
    await addTradeGiveLines(f.userId, bare.sections[0].id, [item.id]);

    // Balanced by value with no agreed catalogue named: refused as the one fault it is — the
    // missing catalogue — rather than as every line being blamed for a figure nothing was asked for.
    const balance = (await readTradeBalance(f.userId, bare.id))!;
    assert.equal(balance.trade.byValue, true);
    assert.deepEqual(balance.blockers.map((b) => b.kind), ["agreed-no-catalog"]);
    assert.deepEqual(balance.blockers[0].lines, []);
    await assert.rejects(
      () => setTradeStatus(f.userId, bare.id, "shared"),
      /names no agreed catalogue/
    );

    // Naming one is all it needed — the lines were priced the whole time.
    await updateTrade(f.userId, bare.id, {
      partnerId: f.partnerId,
      currency: "EUR",
      balanceByValue: true,
      valueTolerancePct: 5,
      catalogVendorId: f.vendorId,
    });
    assert.equal((await readTradeBalance(f.userId, bare.id))!.blockers.length, 0);
    await setTradeStatus(f.userId, bare.id, "shared");
  });
});
