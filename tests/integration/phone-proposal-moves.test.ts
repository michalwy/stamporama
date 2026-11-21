import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { addSaleLines, createSale, listSalesAwaitingFulfilment, listSellableOffers } from "../../src/lib/sales";
import {
  addProposalLots,
  convertProposalToSale,
  createProposal,
  getDirectPlatform,
  getProposalSaleOptions,
  moveProposal,
} from "../../src/lib/proposals";
import { getPhoneProposal } from "../../src/lib/phone-proposals";
import { phoneProposalMoves } from "../../src/lib/phone-proposal-rules";
import { proposalBuyerPickTicks, proposalConversionWithdrawn } from "../../src/lib/proposal-rules";

// Closing a proposal from the phone (#2627): the phone offers the desk's moves in each state, read off
// the proposal its screen reads, and makes them through the desk's own writes — the conversion into a
// new sale or the contact's open one, Decline and Reopen — so the proposal ends as the desk leaves it,
// and a converted sale waits in Sales to do.

const ts = Date.now();

describe("closing a proposal from the phone (#2627)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let conditionId: string;
  let directId: string;
  let nextStamp = 0;

  async function offer(price: string, state: "preparing" | "active" = "preparing"): Promise<string> {
    nextStamp += 1;
    const stampId = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp ${nextStamp}`,
          issuedYear: 1960,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      })
    ).id;
    const itemId = (await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" })).id;
    const offerId = await createOffer(
      userId,
      collectionId,
      { platformId: directId, url: null, price, startingPrice: null, currency: "PLN", listingDate: null },
      { seedItemIds: [itemId] }
    );
    if (state === "active") {
      await setOfferState(userId, offerId, "ready");
      await setOfferState(userId, offerId, "active");
    }
    return offerId;
  }

  /** A Sent proposal of `count` lots for a new contact, each priced 10.00, 11.00, … */
  async function sentProposal(name: string, count: number) {
    const contactId = (await prisma.contact.create({ data: { collectionId, name, buyer: true } })).id;
    const { proposalId, proposalNo } = await createProposal(userId, collectionId, contactId);
    const lots: string[] = [];
    for (let i = 0; i < count; i++) lots.push(await offer(`${10 + i}.00`));
    await addProposalLots(userId, proposalId, lots);
    await moveProposal(userId, proposalId, "send");
    return { contactId, proposalId, proposalNo, lots };
  }

  async function states(ids: string[]): Promise<string[]> {
    const rows = await prisma.offer.findMany({ where: { id: { in: ids } }, select: { id: true, state: true } });
    return ids.map((id) => rows.find((r) => r.id === id)!.state);
  }

  before(async () => {
    userId = `test-user-phone-proposal-moves-${ts}`;
    await prisma.user.create({
      data: { id: userId, name: "Test User", email: `${userId}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-phone-proposal-moves-${ts}`, name: "Moves", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    directId = (await getDirectPlatform(collectionId)).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("converts lots 2 and 5 of six into a new sale: two sold, four withdrawn, the sale in Sales to do", async () => {
    const { proposalId, proposalNo, lots } = await sentProposal("Anna Nowak", 6);
    const phone = (await getPhoneProposal(userId, collectionId, proposalNo))!;
    assert.deepEqual(phoneProposalMoves(phone.status, phone.lots), { convert: true, reopen: true, decline: true });

    const options = await getProposalSaleOptions(userId, proposalId);
    const took = options.lots.filter((lot) => lot.lotNo === 2 || lot.lotNo === 5);
    assert.equal(proposalConversionWithdrawn(options.lots, new Set(took.map((lot) => lot.offerId))), 4);

    const { saleId, saleNo, created } = await convertProposalToSale(userId, proposalId, {
      lots: took.map((lot) => ({ offerId: lot.offerId, price: lot.price! })),
      target: { newSale: true },
    });
    assert.equal(created, true);
    assert.deepEqual(await states(lots), ["withdrawn", "sold", "withdrawn", "withdrawn", "sold", "withdrawn"]);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, select: { lines: { select: { price: true } } } });
    assert.deepEqual(sale.lines.map((l) => l.price.toFixed(2)).sort(), ["11.00", "14.00"]);

    const toDo = await listSalesAwaitingFulfilment(userId, collectionId);
    assert.ok(toDo.some((s) => s.id === saleId && s.saleNo === saleNo));

    const after = (await getPhoneProposal(userId, collectionId, proposalNo))!;
    assert.equal(after.status, "sold");
    assert.equal(after.sale?.saleNo, saleNo);
    assert.deepEqual(phoneProposalMoves(after.status, after.lots), { convert: false, reopen: false, decline: false });
  });

  it("adds the two lines to the contact's sale not yet sent", async () => {
    const { contactId, proposalId, lots } = await sentProposal("Piotr Zieliński", 6);
    const saleId = await createSale(userId, collectionId, {
      platformId: directId,
      buyerId: contactId,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-11-20T00:00:00.000Z"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    const earlier = await offer("8.00", "active");
    const [sellable] = await listSellableOffers(userId, collectionId, { offerId: earlier });
    await addSaleLines(userId, saleId, [
      { offerId: earlier, offerSetId: sellable!.sets[0]!.offerSetId, price: "8.00", itemIds: sellable!.sets[0]!.itemIds },
    ]);

    const options = await getProposalSaleOptions(userId, proposalId);
    assert.ok(options.sales.some((s) => s.saleId === saleId));
    const took = options.lots.filter((lot) => lot.lotNo === 2 || lot.lotNo === 5);
    const result = await convertProposalToSale(userId, proposalId, {
      lots: took.map((lot) => ({ offerId: lot.offerId, price: lot.price! })),
      target: { saleId },
    });
    assert.equal(result.created, false);
    assert.equal(result.saleId, saleId);
    assert.equal(await prisma.saleLine.count({ where: { saleId } }), 3);
    assert.deepEqual(await states(lots), ["withdrawn", "sold", "withdrawn", "withdrawn", "sold", "withdrawn"]);
  });

  it("starts the ticks from the buyer's picks", async () => {
    const { proposalId, lots } = await sentProposal("Ewa Lis", 3);
    await prisma.offer.update({ where: { id: lots[1]! }, data: { proposalPickedAt: new Date() } });
    const options = await getProposalSaleOptions(userId, proposalId);
    assert.deepEqual(proposalBuyerPickTicks(options.lots), { [lots[1]!]: "11.00" });
  });

  it("reopens a Sent proposal to Preparing, and then offers no Reopen", async () => {
    const { proposalId, proposalNo, lots } = await sentProposal("Marek Wójcik", 2);
    await moveProposal(userId, proposalId, "reopen");
    const phone = (await getPhoneProposal(userId, collectionId, proposalNo))!;
    assert.equal(phone.status, "preparing");
    assert.deepEqual(phoneProposalMoves(phone.status, phone.lots), { convert: true, reopen: false, decline: true });
    assert.deepEqual(await states(lots), ["preparing", "preparing"]);
  });

  it("declines: the proposal closed and its open lots withdrawn, nothing left to do", async () => {
    const { proposalId, proposalNo, lots } = await sentProposal("Olga Kaczmarek", 3);
    await moveProposal(userId, proposalId, "decline");
    const phone = (await getPhoneProposal(userId, collectionId, proposalNo))!;
    assert.equal(phone.status, "declined");
    assert.deepEqual(await states(lots), ["withdrawn", "withdrawn", "withdrawn"]);
    assert.deepEqual(phoneProposalMoves(phone.status, phone.lots), { convert: false, reopen: false, decline: false });
  });
});
