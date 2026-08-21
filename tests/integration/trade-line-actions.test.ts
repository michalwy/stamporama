import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import { createTrade, setTradeStatus } from "../../src/lib/trades";
import {
  addTradeGiveLines,
  addTradeReceiveLines,
  listTradeLinePage,
} from "../../src/lib/trade-lines";
import { setTradeLineFulfillment } from "../../src/lib/trade-realisation";
import { setTradeLineValue } from "../../src/lib/trade-valuation";
import {
  createTradeShareToken,
  verifyTradeShareToken,
  type TradeShareAccess,
} from "../../src/lib/trade-share";
import { readTradeFeedback, savePartnerTradeFeedback } from "../../src/lib/trade-feedback";
import { readTradeActions } from "../../src/lib/trade-line-actions";
import { tradeSideActionKey } from "../../src/lib/trade-line-signals";

// **What is waiting for the collector on a trade** (#663).
//
// What only a database can answer, and so what is checked here: that the set is assembled out of the
// four records that already hold it — a remark, a marketplace collision, a missing figure, a missing
// verdict — that the count is kept **per column** so the two sides of a section never share one
// number, that the two window-dependent conditions appear and disappear with the trade's status, and
// above all that the filter on the list and the count on the toggle are one answer: narrowing a side
// leaves exactly the lines the count promised, with its headings and totals counted over the
// narrowed side and `unfiltered` still describing the whole one.

interface Fixtures {
  userId: string;
  collectionId: string;
  partnerId: string;
  platformId: string;
  /** Priced, so a line naming it passes the valuation gate. */
  stampId: string;
  /** Priced too — what the receive side asks for. */
  otherStampId: string;
  /** No catalogue price anywhere: a line naming it has no own value and is waiting for one. */
  unpricedStampId: string;
  conditionId: string;
}

let f: Fixtures;
let seq = 0;

async function seed(): Promise<Fixtures> {
  const ts = Date.now();
  const userId = `test-user-actions-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User actions-${ts}`,
      email: `test-actions-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-actions-${ts}`,
      name: `Collection actions-${ts}`,
      baseCurrency: "EUR",
      ownerId: userId,
    },
  });
  const collectionId = collection.id;
  const partner = await prisma.contact.create({
    data: { collectionId, name: "Karel", exchangePartner: true },
  });
  // Listed by hand, so advancing an offer asks nothing of the goods: the only gate in play here is
  // the collision this file is about.
  const platform = await prisma.contact.create({
    data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
  });
  const condition = await prisma.stampCondition.create({
    data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
  });

  const area = await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } });
  const vendor = await prisma.catalogVendor.create({
    data: { collectionId, name: "Fischer", abbreviation: "Fi" },
  });
  const catalogName = await prisma.catalogName.create({
    data: { vendorId: vendor.id, name: "Fischer Polska", currency: "EUR" },
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

  const stampIds: string[] = [];
  for (const [name, number, priced] of [
    ["Chopin", "700", true],
    ["Copernicus", "701", true],
    ["Sobieski", "702", false],
  ] as const) {
    const stamp = await prisma.stamp.create({ data: { collectionId, name } });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: area.id, isPrimary: true },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: stamp.id, catalogVendorId: vendor.id, number },
    });
    if (priced) {
      await prisma.stampCatalogPrice.create({
        data: {
          stampId: stamp.id,
          catalogEditionId: edition.id,
          conditionId: condition.id,
          price: "10.00",
          currency: "EUR",
        },
      });
    }
    stampIds.push(stamp.id);
  }

  return {
    userId,
    collectionId,
    partnerId: partner.id,
    platformId: platform.id,
    stampId: stampIds[0],
    otherStampId: stampIds[1],
    unpricedStampId: stampIds[2],
    conditionId: condition.id,
  };
}

async function cleanup(): Promise<void> {
  await prisma.purchase.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.trade.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.sale.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
  await prisma.user.deleteMany({ where: { id: f.userId } });
}

async function copy(stampId = f.stampId): Promise<string> {
  return (
    await createItem(f.userId, f.collectionId, {
      stampId,
      conditionId: f.conditionId,
      forTrade: true,
    })
  ).id;
}

interface Trade {
  tradeId: string;
  sectionId: string;
  giveLineId: string;
  giveItemId: string;
  receiveLineId: string;
}

/** A trade with one copy promised and one line asked for, both priced, left in `preparing` — so
 *  nothing is waiting on it until a test makes something so. */
async function trade(): Promise<Trade> {
  seq += 1;
  const created = await createTrade(f.userId, f.collectionId, {
    partnerId: f.partnerId,
    partnerName: null,
    currency: "EUR",
    notes: `actions ${seq}`,
    catalogVendorId: null,
    balanceByValue: false,
    countTolerance: 0,
    valueTolerancePct: 0,
    ownValueWarnPct: 25,
  });
  const sectionId = created.sections[0].id;
  const giveItemId = await copy();
  const { refused } = await addTradeGiveLines(f.userId, sectionId, [giveItemId]);
  assert.deepEqual(refused, [], "the fixture's copy should be promisable");
  await addTradeReceiveLines(f.userId, sectionId, {
    stampId: f.otherStampId,
    conditionId: f.conditionId,
    certificateStatusId: null,
    formatId: null,
    quantity: 3,
  });
  const lines = await prisma.tradeLine.findMany({
    where: { tradeId: created.id },
    select: { id: true, side: true },
  });
  return {
    tradeId: created.id,
    sectionId,
    giveLineId: lines.find((l) => l.side === "give")!.id,
    giveItemId,
    receiveLineId: lines.find((l) => l.side === "receive")!.id,
  };
}

async function agree(tradeId: string): Promise<void> {
  await setTradeStatus(f.userId, tradeId, "shared");
  await setTradeStatus(f.userId, tradeId, "agreed");
}

async function accessFor(tradeId: string): Promise<TradeShareAccess> {
  const { token } = await createTradeShareToken(f.userId, tradeId, {
    showValues: false,
    expiresAt: null,
  });
  const verified = await verifyTradeShareToken(token);
  assert.equal(verified.ok, true, "the token should verify");
  return (verified as { ok: true; access: TradeShareAccess }).access;
}

/** A live listing over `itemId`, which is what a marketplace collision is. */
async function listOnMarketplace(itemId: string): Promise<void> {
  const offerId = await createOffer(f.userId, f.collectionId, {
    platformId: f.platformId,
    url: null,
    price: "12.50",
    currency: "EUR",
    listingDate: null,
    state: "preparing",
  });
  await addOfferSet(f.userId, offerId, [itemId]);
  await setOfferState(f.userId, offerId, "ready");
  await setOfferState(f.userId, offerId, "active");
}

/** The line ids one side is narrowed to, in the order the column draws them. */
async function waitingOn(t: Trade, side: "give" | "receive"): Promise<string[]> {
  const page = await listTradeLinePage(f.userId, t.tradeId, {
    sectionId: t.sectionId,
    side,
    filters: { needsAction: true },
  });
  return page.items.map((item) => item.lineId);
}

describe("what is waiting on a trade (#663)", () => {
  before(async () => {
    f = await seed();
  });
  after(cleanup);

  it("says nothing is waiting on a trade with nothing wrong with it", async () => {
    const t = await trade();
    const actions = await readTradeActions(f.userId, t.tradeId);
    assert.deepEqual(actions.lines, {});
    assert.equal(actions.total, 0);
    assert.deepEqual(await waitingOn(t, "give"), []);
    assert.deepEqual(await waitingOn(t, "receive"), []);
  });

  it("waits on a line the partner has remarked on, until the collector deals with it", async () => {
    const t = await trade();
    const access = await accessFor(t.tradeId);
    await savePartnerTradeFeedback(access, t.giveLineId, { note: "already have this" });

    assert.deepEqual((await readTradeActions(f.userId, t.tradeId)).lines[t.giveLineId], ["remark"]);
    assert.deepEqual(await waitingOn(t, "give"), [t.giveLineId]);
    // The partner's note about the whole exchange has no line to wait on, and must not put every
    // line of the trade into the filter.
    await savePartnerTradeFeedback(access, null, { note: "I can post on Friday" });
    assert.equal((await readTradeActions(f.userId, t.tradeId)).total, 1);
  });

  it("stops waiting once the remark is resolved", async () => {
    const t = await trade();
    const access = await accessFor(t.tradeId);
    await savePartnerTradeFeedback(access, t.receiveLineId, { note: "cannot send this one" });
    assert.deepEqual(await waitingOn(t, "receive"), [t.receiveLineId]);

    const { items } = await readTradeFeedback(f.userId, t.tradeId);
    await prisma.tradeFeedback.update({
      where: { id: items[0].id },
      data: { resolvedAt: new Date(), resolution: "dismissed" },
    });
    assert.deepEqual(await waitingOn(t, "receive"), []);
  });

  it("waits on a promised copy that is live on a marketplace", async () => {
    const t = await trade();
    await listOnMarketplace(t.giveItemId);
    assert.deepEqual((await readTradeActions(f.userId, t.tradeId)).lines[t.giveLineId], ["listed"]);
    assert.deepEqual(await waitingOn(t, "give"), [t.giveLineId]);
    // The collision is about a copy, and the partner's material is in nobody's inventory.
    assert.deepEqual(await waitingOn(t, "receive"), []);
  });

  it("waits on a line with no value, and only while one can still be typed", async () => {
    const t = await trade();
    await addTradeReceiveLines(f.userId, t.sectionId, {
      stampId: f.unpricedStampId,
      conditionId: f.conditionId,
      certificateStatusId: null,
      formatId: null,
      quantity: 1,
    });
    const unvaluedId = (await prisma.tradeLine.findFirst({
      where: { tradeId: t.tradeId, stampId: f.unpricedStampId },
      select: { id: true },
    }))!.id;

    assert.deepEqual((await readTradeActions(f.userId, t.tradeId)).lines[unvaluedId], ["unvalued"]);
    assert.deepEqual(await waitingOn(t, "receive"), [unvaluedId]);

    // Typing the figure is what resolves it — the same gate that refuses `preparing → shared`.
    await setTradeLineValue(f.userId, unvaluedId, { manualValue: 4 });
    assert.deepEqual(await waitingOn(t, "receive"), []);
  });

  it("waits for a verdict only on a trade being closed", async () => {
    const t = await trade();
    // Before the agreement every line is pending by construction, so counting them would put a
    // number on every trade being composed.
    assert.equal((await readTradeActions(f.userId, t.tradeId)).total, 0);

    await agree(t.tradeId);
    const agreed = await readTradeActions(f.userId, t.tradeId);
    assert.deepEqual(agreed.lines[t.giveLineId], ["verdict"]);
    assert.deepEqual(agreed.lines[t.receiveLineId], ["verdict"]);
    assert.equal(agreed.total, 2);

    await setTradeLineFulfillment(f.userId, t.giveLineId, { fulfillment: "fulfilled", note: null });
    assert.deepEqual(await waitingOn(t, "give"), []);
    assert.deepEqual(await waitingOn(t, "receive"), [t.receiveLineId]);
  });

  it("counts each column of each section on its own", async () => {
    const t = await trade();
    const access = await accessFor(t.tradeId);
    await savePartnerTradeFeedback(access, t.giveLineId, { note: "already have this" });
    await savePartnerTradeFeedback(access, t.receiveLineId, { note: "cannot send this one" });
    await listOnMarketplace(t.giveItemId);

    const actions = await readTradeActions(f.userId, t.tradeId);
    // Two things are waiting on the give line and one on the receive line, but a line is one row to
    // go and look at however many of them there are.
    assert.deepEqual(actions.lines[t.giveLineId], ["listed", "remark"]);
    assert.equal(actions.counts[tradeSideActionKey(t.sectionId, "give")], 1);
    assert.equal(actions.counts[tradeSideActionKey(t.sectionId, "receive")], 1);
    assert.equal(actions.total, 2);
  });

  it("narrows a side to exactly what the count promised, over the whole side", async () => {
    const t = await trade();
    // Nine more promisable copies, so the narrowed side is a real minority of a real list.
    const extra: string[] = [];
    for (let i = 0; i < 9; i += 1) extra.push(await copy());
    await addTradeGiveLines(f.userId, t.sectionId, extra);
    const access = await accessFor(t.tradeId);
    await savePartnerTradeFeedback(access, t.giveLineId, { note: "already have this" });

    const actions = await readTradeActions(f.userId, t.tradeId);
    const counted = actions.counts[tradeSideActionKey(t.sectionId, "give")];
    const page = await listTradeLinePage(f.userId, t.tradeId, {
      sectionId: t.sectionId,
      side: "give",
      filters: { needsAction: true },
    });
    assert.equal(counted, 1);
    assert.equal(page.total, counted, "the list and the count are one answer");
    assert.deepEqual(
      page.items.map((i) => i.lineId),
      [t.giveLineId]
    );
    // The figures are counted over the narrowed side; `unfiltered` still describes the whole one, so
    // the toolbar can say *1 of 10* rather than presenting a filtered list as the list.
    assert.equal(page.pieces, 1);
    assert.equal(page.unfiltered, 10);
  });

  it("narrows within the other filters rather than beside them", async () => {
    const t = await trade();
    const other = await copy(f.otherStampId);
    await addTradeGiveLines(f.userId, t.sectionId, [other]);
    const otherLineId = (await prisma.tradeLine.findFirst({
      where: { tradeId: t.tradeId, itemId: other },
      select: { id: true },
    }))!.id;
    const access = await accessFor(t.tradeId);
    await savePartnerTradeFeedback(access, t.giveLineId, { note: "already have this" });
    await savePartnerTradeFeedback(access, otherLineId, { note: "and this" });

    const page = await listTradeLinePage(f.userId, t.tradeId, {
      sectionId: t.sectionId,
      side: "give",
      filters: { needsAction: true, search: "Copernicus" },
    });
    assert.deepEqual(
      page.items.map((i) => i.lineId),
      [otherLineId]
    );
    assert.equal(page.total, 1);
  });

  it("groups the narrowed side over what the filter left", async () => {
    const t = await trade();
    const access = await accessFor(t.tradeId);
    await savePartnerTradeFeedback(access, t.giveLineId, { note: "already have this" });

    const page = await listTradeLinePage(f.userId, t.tradeId, {
      sectionId: t.sectionId,
      side: "give",
      levels: ["condition"],
      filters: { needsAction: true },
    });
    // One heading over one row: a heading counted over the unfiltered side would say 10 and send
    // the collector looking for nine rows that are not there.
    const headings = Object.values(page.headings);
    assert.equal(headings.length, 1);
    assert.equal(headings[0].count, 1);
  });

  it("refuses a trade in somebody else's collection", async () => {
    const t = await trade();
    await assert.rejects(() => readTradeActions("someone-else", t.tradeId));
  });
});
