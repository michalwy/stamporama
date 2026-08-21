import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createTrade, listTradesPaginated, setTradeStatus } from "../../src/lib/trades";
import { addTradeGiveLines, addTradeReceiveLines } from "../../src/lib/trade-lines";
import { setTradeLineFulfillment } from "../../src/lib/trade-realisation";
import {
  createTradeShareToken,
  verifyTradeShareToken,
  type TradeShareAccess,
} from "../../src/lib/trade-share";
import {
  readPartnerTradeFeedback,
  readTradeFeedback,
  resolveTradeFeedback,
  savePartnerTradeFeedback,
} from "../../src/lib/trade-feedback";

// Partner feedback (#641).
//
// What only a database can answer, and so what is checked here: that a note lands against the one
// trade the token names and can reach nothing else, that saying something again replaces what was
// said rather than stacking up, that clearing it removes the row, that a closed exchange takes
// nothing more, that accepting a rejection really does take the line off the list — and refuses to
// while the list is locked — and that *Partner has responded* follows unresolved feedback on both
// the trade's own read and the list row.

interface Fixtures {
  userId: string;
  collectionId: string;
  partnerId: string;
  stampId: string;
  otherStampId: string;
  conditionId: string;
}

let f: Fixtures;
let seq = 0;

async function seed(): Promise<Fixtures> {
  const ts = Date.now();
  const userId = `test-user-feedback-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User feedback-${ts}`,
      email: `test-feedback-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-feedback-${ts}`,
      name: `Anna's collection ${ts}`,
      baseCurrency: "EUR",
      ownerId: userId,
    },
  });
  const collectionId = collection.id;
  const partner = await prisma.contact.create({
    data: { collectionId, name: "Karel", exchangePartner: true },
  });
  const condition = await prisma.stampCondition.create({
    data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
  });

  // Priced stamps in an area with a primary catalogue, so the trade can pass the valuation gate and
  // reach `shared` and `agreed` — which is where half of these rules only start to apply.
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
  for (const [name, number] of [
    ["Chopin", "700"],
    ["Copernicus", "701"],
  ] as const) {
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
        price: "10.00",
        currency: "EUR",
      },
    });
    stampIds.push(stamp.id);
  }

  return {
    userId,
    collectionId,
    partnerId: partner.id,
    stampId: stampIds[0],
    otherStampId: stampIds[1],
    conditionId: condition.id,
  };
}

async function cleanup(): Promise<void> {
  await prisma.trade.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
  await prisma.user.deleteMany({ where: { id: f.userId } });
}

async function copy(): Promise<string> {
  return (
    await createItem(f.userId, f.collectionId, {
      stampId: f.stampId,
      conditionId: f.conditionId,
      forTrade: true,
    })
  ).id;
}

/** A trade with one copy promised and one line asked for, plus a link, left in `preparing`. */
async function trade(): Promise<{
  tradeId: string;
  giveLineId: string;
  receiveLineId: string;
  token: string;
}> {
  seq += 1;
  const created = await createTrade(f.userId, f.collectionId, {
    partnerId: f.partnerId,
    partnerName: null,
    currency: "CZK",
    notes: `feedback ${seq}`,
    catalogVendorId: null,
    balanceByValue: false,
    countTolerance: 0,
    valueTolerancePct: 0,
    ownValueWarnPct: 25,
  });
  const sectionId = created.sections[0].id;
  const { refused } = await addTradeGiveLines(f.userId, sectionId, [await copy()]);
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
  const { token } = await createTradeShareToken(f.userId, created.id, {
    showValues: false,
    expiresAt: null,
  });
  return {
    tradeId: created.id,
    giveLineId: lines.find((l) => l.side === "give")!.id,
    receiveLineId: lines.find((l) => l.side === "receive")!.id,
    token,
  };
}

async function accessFor(token: string): Promise<TradeShareAccess> {
  const verified = await verifyTradeShareToken(token);
  assert.equal(verified.ok, true, "the token should verify");
  return (verified as { ok: true; access: TradeShareAccess }).access;
}

describe("partner feedback (#641)", () => {
  before(async () => {
    f = await seed();
  });
  after(cleanup);

  it("lands a note against the line and names it by its catalogue number in the inbox", async () => {
    const { tradeId, giveLineId, token } = await trade();
    const access = await accessFor(token);

    await savePartnerTradeFeedback(access, giveLineId, { note: "  already have this  " });

    const inbox = await readTradeFeedback(f.userId, tradeId);
    assert.equal(inbox.open, 1);
    assert.equal(inbox.items[0].lineId, giveLineId);
    assert.equal(inbox.items[0].note, "already have this");
    assert.equal(inbox.items[0].rejected, false);
    assert.equal(inbox.items[0].side, "give");
    assert.match(inbox.items[0].lineLabel ?? "", /700/);
  });

  it("replaces what was said rather than stacking a second row on the line", async () => {
    const { tradeId, giveLineId, token } = await trade();
    const access = await accessFor(token);

    await savePartnerTradeFeedback(access, giveLineId, { note: "first thought" });
    await savePartnerTradeFeedback(access, giveLineId, { note: "second thought", rejected: true });

    const inbox = await readTradeFeedback(f.userId, tradeId);
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0].note, "second thought");
    assert.equal(inbox.items[0].rejected, true);
  });

  it("deletes the row when the partner clears both the mark and the words", async () => {
    const { tradeId, giveLineId, token } = await trade();
    const access = await accessFor(token);

    await savePartnerTradeFeedback(access, giveLineId, { note: "on second thoughts, no" });
    const cleared = await savePartnerTradeFeedback(access, giveLineId, { note: "  " });

    assert.equal(cleared, null);
    assert.deepEqual(await readTradeFeedback(f.userId, tradeId), { open: 0, items: [] });
  });

  it("keeps one note about the whole exchange, however many times it is saved", async () => {
    const { tradeId, token } = await trade();
    const access = await accessFor(token);

    await savePartnerTradeFeedback(access, null, { note: "can we add something mint?" });
    await savePartnerTradeFeedback(access, null, { note: "I can post on Friday" });

    const inbox = await readTradeFeedback(f.userId, tradeId);
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0].lineId, null);
    assert.equal(inbox.items[0].note, "I can post on Friday");
  });

  it("refuses a line that is not on the trade the token names", async () => {
    const mine = await trade();
    const other = await trade();
    const access = await accessFor(mine.token);

    await assert.rejects(
      () => savePartnerTradeFeedback(access, other.giveLineId, { note: "not mine to comment on" }),
      /not on this exchange/i
    );
    assert.equal((await readTradeFeedback(f.userId, other.tradeId)).items.length, 0);
  });

  it("still takes feedback once the trade is agreed — there it is a request to reopen", async () => {
    const { tradeId, giveLineId, token } = await trade();
    await setTradeStatus(f.userId, tradeId, "shared");
    await setTradeStatus(f.userId, tradeId, "agreed");
    const access = await accessFor(token);

    await savePartnerTradeFeedback(access, giveLineId, { rejected: true });
    assert.equal((await readTradeFeedback(f.userId, tradeId)).open, 1);
  });

  it("takes nothing more once the exchange is closed, and says so", async () => {
    const { tradeId, giveLineId, token } = await trade();
    await setTradeStatus(f.userId, tradeId, "shared");
    await setTradeStatus(f.userId, tradeId, "agreed");
    // Closing requires a verdict on every line (#642) — the parcels are the point of closing, and a
    // trade closed with lines nobody ever answered for is a record that says nothing about them.
    for (const line of await prisma.tradeLine.findMany({ where: { tradeId }, select: { id: true } })) {
      await setTradeLineFulfillment(f.userId, line.id, { fulfillment: "fulfilled" });
    }
    await setTradeStatus(f.userId, tradeId, "closed");
    const access = await accessFor(token);

    const read = await readPartnerTradeFeedback(access);
    assert.equal(read.canLeave, false);
    assert.match(read.closedMessage ?? "", /finished/i);
    await assert.rejects(() => savePartnerTradeFeedback(access, giveLineId, { note: "one more" }));
  });

  it("takes the line off the list when the collector accepts a rejection", async () => {
    const { tradeId, giveLineId, token } = await trade();
    const access = await accessFor(token);
    await savePartnerTradeFeedback(access, giveLineId, { rejected: true, note: "have it" });

    const inbox = await readTradeFeedback(f.userId, tradeId);
    await resolveTradeFeedback(f.userId, inbox.items[0].id, "accept");

    assert.equal(await prisma.tradeLine.count({ where: { id: giveLineId } }), 0);
    // The request leaves with the thing it was about: the inbox states what is outstanding.
    assert.deepEqual(await readTradeFeedback(f.userId, tradeId), { open: 0, items: [] });
  });

  it("leaves the copy itself alone — a give line is a promise about a copy, not a claim on it", async () => {
    const { tradeId, giveLineId, token } = await trade();
    const itemId = (await prisma.tradeLine.findUniqueOrThrow({
      where: { id: giveLineId },
      select: { itemId: true },
    })).itemId!;
    const access = await accessFor(token);
    await savePartnerTradeFeedback(access, giveLineId, { rejected: true });

    const inbox = await readTradeFeedback(f.userId, tradeId);
    await resolveTradeFeedback(f.userId, inbox.items[0].id, "accept");

    assert.equal(await prisma.item.count({ where: { id: itemId } }), 1);
  });

  it("refuses to remove a line while the list is locked, and names the way out", async () => {
    const { tradeId, giveLineId, token } = await trade();
    await setTradeStatus(f.userId, tradeId, "shared");
    await setTradeStatus(f.userId, tradeId, "agreed");
    const access = await accessFor(token);
    await savePartnerTradeFeedback(access, giveLineId, { rejected: true });

    const inbox = await readTradeFeedback(f.userId, tradeId);
    await assert.rejects(
      () => resolveTradeFeedback(f.userId, inbox.items[0].id, "accept"),
      /step the trade back to shared/i
    );
    assert.equal(await prisma.tradeLine.count({ where: { id: giveLineId } }), 1);
  });

  it("keeps the line when the collector dismisses, and takes the item out of the inbox", async () => {
    const { tradeId, receiveLineId, token } = await trade();
    const access = await accessFor(token);
    await savePartnerTradeFeedback(access, receiveLineId, { rejected: true });

    const inbox = await readTradeFeedback(f.userId, tradeId);
    await resolveTradeFeedback(f.userId, inbox.items[0].id, "dismiss");

    const after = await readTradeFeedback(f.userId, tradeId);
    assert.equal(after.open, 0);
    assert.equal(after.items.length, 1, "handled feedback is kept, not deleted");
    assert.equal(after.items[0].resolution, "dismissed");
    assert.equal(await prisma.tradeLine.count({ where: { id: receiveLineId } }), 1);
  });

  it("puts a handled item back in the inbox when the partner says something new", async () => {
    const { tradeId, giveLineId, token } = await trade();
    const access = await accessFor(token);
    await savePartnerTradeFeedback(access, giveLineId, { note: "have it" });
    const inbox = await readTradeFeedback(f.userId, tradeId);
    await resolveTradeFeedback(f.userId, inbox.items[0].id, "dismiss");
    assert.equal((await readTradeFeedback(f.userId, tradeId)).open, 0);

    await savePartnerTradeFeedback(access, giveLineId, { note: "actually, I do want it" });
    assert.equal((await readTradeFeedback(f.userId, tradeId)).open, 1);
  });

  it("flags the list row from unresolved feedback and clears it when the inbox is emptied", async () => {
    const { tradeId, giveLineId, token } = await trade();
    const access = await accessFor(token);

    const before = await listTradesPaginated(f.userId, f.collectionId, { tradeNo: undefined });
    assert.equal(before.items.find((t) => t.id === tradeId)?.hasPartnerFeedback, false);

    await savePartnerTradeFeedback(access, giveLineId, { note: "one question" });
    const flagged = await listTradesPaginated(f.userId, f.collectionId, {});
    assert.equal(flagged.items.find((t) => t.id === tradeId)?.hasPartnerFeedback, true);

    const inbox = await readTradeFeedback(f.userId, tradeId);
    await resolveTradeFeedback(f.userId, inbox.items[0].id, "dismiss");
    const cleared = await listTradesPaginated(f.userId, f.collectionId, {});
    assert.equal(cleared.items.find((t) => t.id === tradeId)?.hasPartnerFeedback, false);
  });

  it("shows the partner what they already said, keyed by line", async () => {
    const { giveLineId, token } = await trade();
    const access = await accessFor(token);
    await savePartnerTradeFeedback(access, giveLineId, { note: "swap for something mint?" });
    await savePartnerTradeFeedback(access, null, { note: "posting Friday" });

    const read = await readPartnerTradeFeedback(access);
    assert.equal(read.canLeave, true);
    assert.equal(read.byLine[giveLineId].note, "swap for something mint?");
    assert.equal(read.trade?.note, "posting Friday");
  });

  it("refuses a rejection on the note about the whole exchange", async () => {
    const { token } = await trade();
    const access = await accessFor(token);
    await assert.rejects(
      () => savePartnerTradeFeedback(access, null, { note: "no thanks", rejected: true }),
      /cannot reject/i
    );
  });
});
