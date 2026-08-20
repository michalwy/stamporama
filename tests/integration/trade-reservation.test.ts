import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, disposeItem, listItemsPaginated } from "../../src/lib/items";
import {
  addItemsToOfferSet,
  addOfferSet,
  createOffer,
  getOfferDetail,
  setOfferState,
} from "../../src/lib/offers";
import { createTrade, setTradeStatus } from "../../src/lib/trades";
import { addTradeGiveLines } from "../../src/lib/trade-lines";
import { readTradeReservation } from "../../src/lib/trade-reservations";

// Reservation of committed copies, and the marketplace collision gate (#639).
//
// What only a database can answer, and so what is checked here: that the two gates are **symmetric**
// (an agreed trade stops a listing going live, a live listing stops a trade being agreed), that they
// bite at `agreed` / `active` and **nowhere earlier** — a negotiation reserves nothing and a draft
// listing competes for nothing — that a cancelled trade releases what it held, and that a promised
// copy which sells or is disposed of raises a warning on its trade without ever blocking it.

interface Fixtures {
  userId: string;
  collectionId: string;
  partnerId: string;
  platformId: string;
  stampId: string;
  conditionId: string;
}

let f: Fixtures;
let seq = 0;

async function seed(): Promise<Fixtures> {
  const ts = Date.now();
  const userId = `test-user-reserve-${ts}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: `Test User reserve-${ts}`,
      email: `test-reserve-${ts}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: {
      slug: `col-reserve-${ts}`,
      name: `Collection reserve-${ts}`,
      baseCurrency: "EUR",
      ownerId: userId,
    },
  });
  const collectionId = collection.id;
  const partner = await prisma.contact.create({
    data: { collectionId, name: "Karel", exchangePartner: true },
  });
  // A platform listed by hand: no Assistant module, so `preparing → ready` asks nothing of the
  // goods and the only gate in play on this file's offers is the one being tested.
  const platform = await prisma.contact.create({
    data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
  });
  const condition = await prisma.stampCondition.create({
    data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
  });
  const stamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp 309" } });

  // A priced stamp in an area with a primary catalogue, so every give line this file writes carries
  // a value: an unvalued line is refused at `preparing → shared` (#638), which is a different gate
  // and not the one under test.
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
    userId,
    collectionId,
    partnerId: partner.id,
    platformId: platform.id,
    stampId: stamp.id,
    conditionId: condition.id,
  };
}

/** A fresh copy of the priced stamp. */
async function copy(): Promise<string> {
  return (
    await createItem(f.userId, f.collectionId, {
      stampId: f.stampId,
      conditionId: f.conditionId,
      forTrade: true,
    })
  ).id;
}

/** A trade promising `itemIds`, left in `preparing`. Returns the trade and its only section. */
async function tradePromising(itemIds: string[]): Promise<{ tradeId: string; sectionId: string }> {
  seq += 1;
  const trade = await createTrade(f.userId, f.collectionId, {
    partnerId: f.partnerId,
    partnerName: null,
    currency: "EUR",
    notes: `reserve ${seq}`,
    catalogVendorId: null,
    balanceByValue: false,
    countTolerance: 0,
    valueTolerancePct: 0,
    ownValueWarnPct: 25,
  });
  const sectionId = trade.sections[0].id;
  const { refused } = await addTradeGiveLines(f.userId, sectionId, itemIds);
  assert.deepEqual(refused, [], "the fixture's copies should all be promisable");
  return { tradeId: trade.id, sectionId };
}

async function agree(tradeId: string): Promise<void> {
  await setTradeStatus(f.userId, tradeId, "shared");
  await setTradeStatus(f.userId, tradeId, "agreed");
}

/** An offer over `itemIds`, in `preparing` and priced so it can be advanced. */
async function offerOver(itemIds: string[]): Promise<string> {
  const offerId = await createOffer(f.userId, f.collectionId, {
    platformId: f.platformId,
    url: null,
    price: "12.50",
    currency: "EUR",
    listingDate: null,
    state: "preparing",
  });
  await addOfferSet(f.userId, offerId, itemIds);
  return offerId;
}

async function activate(offerId: string): Promise<void> {
  await setOfferState(f.userId, offerId, "ready");
  await setOfferState(f.userId, offerId, "active");
}

/** Both `TradeLine.itemId` and `SaleLineItem.itemId` are `Restrict`, so a collection holding a copy
 *  that a trade promises or a sale records cannot be dropped in one statement — the trades and sales
 *  go first, taking their lines with them. A property of those guards rather than of these tests: a
 *  copy promised to a partner must not vanish from under the agreement, and neither may one a sale
 *  is the record of. */
async function cleanup(): Promise<void> {
  await prisma.trade.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.sale.deleteMany({ where: { collection: { ownerId: f.userId } } });
  await prisma.collection.deleteMany({ where: { ownerId: f.userId } });
  await prisma.user.deleteMany({ where: { id: f.userId } });
}

const stateOf = async (offerId: string) =>
  (await prisma.offer.findUnique({ where: { id: offerId }, select: { state: true } }))?.state;

const statusOf = async (tradeId: string) =>
  (await prisma.trade.findUnique({ where: { id: tradeId }, select: { status: true } }))?.status;

describe("reserving committed copies (#639)", () => {
  before(async () => {
    f = await seed();
  });
  after(cleanup);

  it("refuses to activate an offer holding a copy promised in an agreed trade, by name", async () => {
    const itemId = await copy();
    const { tradeId } = await tradePromising([itemId]);
    await agree(tradeId);

    const offerId = await offerOver([itemId]);
    // The prepared state is untouched: what is refused is going live, not getting ready to.
    await setOfferState(f.userId, offerId, "ready");
    assert.equal(await stateOf(offerId), "ready");

    const tradeNo = (await prisma.trade.findUnique({
      where: { id: tradeId },
      select: { tradeNo: true },
    }))!.tradeNo;
    await assert.rejects(
      () => setOfferState(f.userId, offerId, "active"),
      (err: Error) => {
        assert.match(err.message, /promised in an agreed trade/);
        assert.match(err.message, new RegExp(`#${tradeNo} \\(Karel\\)`));
        return true;
      }
    );
    assert.equal(await stateOf(offerId), "ready");
  });

  it("lets a copy promised in a trade that is only being negotiated go live", async () => {
    const itemId = await copy();
    const { tradeId } = await tradePromising([itemId]);
    await setTradeStatus(f.userId, tradeId, "shared");

    const offerId = await offerOver([itemId]);
    await activate(offerId);
    assert.equal(await stateOf(offerId), "active");
  });

  it("refuses to create an offer straight as active around a committed copy", async () => {
    const itemId = await copy();
    const { tradeId } = await tradePromising([itemId]);
    await agree(tradeId);

    await assert.rejects(
      () =>
        createOffer(
          f.userId,
          f.collectionId,
          {
            platformId: f.platformId,
            url: null,
            price: "9.00",
            currency: "EUR",
            listingDate: null,
            state: "active",
          },
          { seedItemIds: [itemId] }
        ),
      /promised in an agreed trade/
    );
  });

  it("refuses a committed copy joining a listing that is already live, and allows it on a draft", async () => {
    const listed = await copy();
    const promised = await copy();
    const { tradeId } = await tradePromising([promised]);
    await agree(tradeId);

    const liveOffer = await offerOver([listed]);
    await activate(liveOffer);
    const liveSet = (await prisma.offerSet.findFirst({
      where: { offerId: liveOffer },
      select: { id: true },
    }))!.id;
    await assert.rejects(
      () => addItemsToOfferSet(f.userId, liveSet, [promised]),
      /promised in an agreed trade/
    );

    // The same copy on a listing still being composed is fine: a draft competes for nothing, and a
    // collector may well be preparing what they will post if the trade falls through.
    const draftOffer = await offerOver([listed]);
    const draftSet = (await prisma.offerSet.findFirst({
      where: { offerId: draftOffer },
      select: { id: true },
    }))!.id;
    assert.equal(await addItemsToOfferSet(f.userId, draftSet, [promised]), 1);
  });

  it("states the commitment on the offer's own screen, before anything is pressed", async () => {
    const itemId = await copy();
    const { tradeId } = await tradePromising([itemId]);
    await agree(tradeId);
    const offerId = await offerOver([itemId]);

    const detail = (await getOfferDetail(f.userId, offerId))!;
    assert.equal(detail.tradeCommitments.length, 1);
    assert.equal(detail.tradeCommitments[0].trade.partnerName, "Karel");
  });

  it("chips the commitment on the copy, from the trade and not from a flag", async () => {
    const itemId = await copy();
    const { tradeId } = await tradePromising([itemId]);

    const before = await listItemsPaginated(f.userId, f.collectionId, { pageSize: 500 });
    assert.equal(before.items.find((i) => i.id === itemId)?.promisedTo, null);

    await agree(tradeId);
    const after = await listItemsPaginated(f.userId, f.collectionId, { pageSize: 500 });
    const promised = after.items.find((i) => i.id === itemId)?.promisedTo;
    assert.equal(promised?.tradeId, tradeId);
    assert.equal(promised?.partnerName, "Karel");
  });

  it("releases the copy when the trade is cancelled", async () => {
    const itemId = await copy();
    const { tradeId } = await tradePromising([itemId]);
    await agree(tradeId);
    const offerId = await offerOver([itemId]);
    await assert.rejects(() => activate(offerId), /promised in an agreed trade/);

    await setTradeStatus(f.userId, tradeId, "cancelled");
    await setOfferState(f.userId, offerId, "active");
    assert.equal(await stateOf(offerId), "active");
  });
});

describe("gating a trade on live listings (#639)", () => {
  before(async () => {
    f = await seed();
  });
  after(cleanup);

  it("refuses to agree a trade whose give side is live on a marketplace, by name", async () => {
    const itemId = await copy();
    const offerId = await offerOver([itemId]);
    await activate(offerId);

    const { tradeId } = await tradePromising([itemId]);
    // Sharing is showing someone what you have, not committing it — so it is not gated.
    await setTradeStatus(f.userId, tradeId, "shared");
    assert.equal(await statusOf(tradeId), "shared");

    const offerNo = (await prisma.offer.findUnique({
      where: { id: offerId },
      select: { offerNo: true },
    }))!.offerNo;
    await assert.rejects(
      () => setTradeStatus(f.userId, tradeId, "agreed"),
      (err: Error) => {
        assert.match(err.message, /live on a marketplace/);
        assert.match(err.message, new RegExp(`#${offerNo} .* on Delcampe`));
        return true;
      }
    );
    assert.equal(await statusOf(tradeId), "shared");
  });

  it("lets the trade through once the listing is paused", async () => {
    const itemId = await copy();
    const offerId = await offerOver([itemId]);
    await activate(offerId);
    const { tradeId } = await tradePromising([itemId]);
    await setTradeStatus(f.userId, tradeId, "shared");
    await assert.rejects(() => setTradeStatus(f.userId, tradeId, "agreed"), /live on a marketplace/);

    await setOfferState(f.userId, offerId, "paused");
    await setTradeStatus(f.userId, tradeId, "agreed");
    assert.equal(await statusOf(tradeId), "agreed");
  });

  it("reports the collision on the trade's own read, so the refusal is met before the button", async () => {
    const itemId = await copy();
    const offerId = await offerOver([itemId]);
    await activate(offerId);
    const { tradeId } = await tradePromising([itemId]);

    const reservation = await readTradeReservation(tradeId);
    assert.equal(reservation.listed.length, 1);
    assert.equal(reservation.listed[0].offer.platformName, "Delcampe");
    assert.match(reservation.messages.listed ?? "", /live on a marketplace/);
  });
});

describe("a promise resting on a copy that has left (#639)", () => {
  before(async () => {
    f = await seed();
  });
  after(cleanup);

  it("warns when a promised copy is disposed of, and never blocks", async () => {
    const itemId = await copy();
    const { tradeId } = await tradePromising([itemId]);
    await disposeItem(f.userId, itemId, { reason: "lost", note: null });

    const reservation = await readTradeReservation(tradeId);
    assert.deepEqual(
      reservation.departed.map((d) => d.reason),
      ["disposed"]
    );
    assert.match(reservation.messages.departed[0], /no longer held/);

    // A warning and nothing more: the trade still moves. What resolves it is a withdrawal (#642).
    await setTradeStatus(f.userId, tradeId, "shared");
    await setTradeStatus(f.userId, tradeId, "agreed");
    assert.equal(await statusOf(tradeId), "agreed");
  });

  it("warns when a promised copy sells elsewhere", async () => {
    const itemId = await copy();
    const { tradeId } = await tradePromising([itemId]);

    // Sold through a listing of its own — the ordinary way a promise gets undercut.
    const offerId = await offerOver([itemId]);
    const offerSetId = (await prisma.offerSet.findFirst({
      where: { offerId },
      select: { id: true },
    }))!.id;
    const sale = await prisma.sale.create({
      data: {
        collectionId: f.collectionId,
        saleNo: 1,
        platformId: f.platformId,
        soldAt: new Date(),
        currency: "EUR",
      },
    });
    const line = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId, offerSetId, price: "12.50" },
    });
    await prisma.saleLineItem.create({ data: { saleLineId: line.id, itemId } });

    const reservation = await readTradeReservation(tradeId);
    assert.deepEqual(
      reservation.departed.map((d) => d.reason),
      ["sold"]
    );
    assert.match(reservation.messages.departed[0], /sold elsewhere/);
  });

  it("says nothing about a trade that is over", async () => {
    const itemId = await copy();
    const { tradeId } = await tradePromising([itemId]);
    await disposeItem(f.userId, itemId, { reason: "lost", note: null });
    await setTradeStatus(f.userId, tradeId, "cancelled");

    const reservation = await readTradeReservation(tradeId);
    assert.deepEqual(reservation.departed, []);
    assert.deepEqual(reservation.messages.departed, []);
  });
});
