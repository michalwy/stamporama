import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer } from "../../src/lib/offers";
import {
  addSaleLines,
  createSale,
  getSaleDetail,
  listSellableOffers,
  markSaleCopiesPacked,
  mergeSales,
  setSaleStatus,
  type SaleHeaderInput,
} from "../../src/lib/sales";
import {
  addProposalLots,
  convertProposalToSale,
  createProposal,
  getDirectPlatform,
  getProposalSaleOptions,
  getProposalScreen,
  moveProposal,
} from "../../src/lib/proposals";

// A proposal becomes a sale (#2289; ADR-0075 §6): the lots the buyer took are sold — into a new
// Direct sale for the contact, or into one of their open sales on any platform, which stays on its
// platform — the rest withdrawn and the proposal closed as Sold, the sale and the proposal naming each
// other. Each case makes copies, offers and a proposal of its own, so the cases never meet.

const ts = Date.now();

describe("A proposal becomes a sale (#2289)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let conditionId: string;
  let directId: string;
  let facebookId: string;
  let groupId: string;
  let usdShopId: string;
  let nextStamp = 0;

  async function copy(): Promise<string> {
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
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" }))
      .id;
  }

  /** An offer of `copies` fresh copies — one set each — on `platformId`. */
  async function offer(
    platformId: string,
    price: string,
    opts: { state?: "preparing" | "active"; currency?: string; copies?: number } = {}
  ): Promise<string> {
    const seedItemIds: string[] = [];
    for (let i = 0; i < (opts.copies ?? 1); i++) seedItemIds.push(await copy());
    return createOffer(
      userId,
      collectionId,
      {
        platformId,
        url: null,
        price,
        startingPrice: null,
        currency: opts.currency ?? "EUR",
        listingDate: null,
        state: opts.state ?? "preparing",
        ...(platformId === facebookId ? { facebookGroupId: groupId, listingType: "fixed" as const } : {}),
      },
      { seedItemIds, seedPerCopy: true }
    );
  }

  /** A contact with a proposal of `lots` lots on Direct, each at its price. */
  async function proposalFor(name: string, prices: string[]) {
    const contactId = (await prisma.contact.create({ data: { collectionId, name } })).id;
    const { proposalId, proposalNo } = await createProposal(userId, collectionId, contactId);
    const lots: string[] = [];
    for (const price of prices) lots.push(await offer(directId, price));
    await addProposalLots(userId, proposalId, lots);
    return { contactId, proposalId, proposalNo, lots };
  }

  function header(platformId: string, buyerId: string, currency = "EUR"): SaleHeaderInput {
    return {
      platformId,
      buyerId,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-10-30T00:00:00.000Z"),
      currency,
      buyerHandling: "5.00",
      buyerPaidTotal: null,
      commission: null,
    };
  }

  /** A sale on `platformId` for the contact, with one active offer of that platform sold on it. */
  async function saleWithOneLine(platformId: string, contactId: string, currency = "EUR"): Promise<string> {
    await prisma.contact.update({ where: { id: contactId }, data: { buyer: true } });
    const saleId = await createSale(userId, collectionId, header(platformId, contactId, currency));
    const offerId = await offer(platformId, "12.00", { state: "active", currency });
    const [sellable] = await listSellableOffers(userId, collectionId, { offerId });
    await addSaleLines(userId, saleId, [
      { offerId, offerSetId: sellable!.sets[0]!.offerSetId, price: "12.00", itemIds: sellable!.sets[0]!.itemIds },
    ]);
    return saleId;
  }

  async function offerStates(ids: string[]): Promise<string[]> {
    const rows = await prisma.offer.findMany({ where: { id: { in: ids } }, select: { id: true, state: true } });
    return ids.map((id) => rows.find((r) => r.id === id)!.state);
  }

  before(async () => {
    userId = `test-user-proposal-sale-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Test User",
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-proposal-sale-${ts}`, name: "Proposal sales", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Germany" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    directId = (await getDirectPlatform(collectionId)).id;
    // Made with Direct's, as every module platform is; switched on, in the collection's currency.
    facebookId = (
      await prisma.platform.update({
        where: { collectionId_platformModule: { collectionId, platformModule: "facebook" } },
        data: { enabled: true, platformCurrency: "EUR" },
      })
    ).id;
    groupId = (
      await prisma.facebookGroup.create({
        data: { collectionId, platformId: facebookId, name: "Stamps for sale", url: "https://www.facebook.com/groups/1" },
      })
    ).id;
    usdShopId = (await prisma.platform.create({ data: { collectionId, name: "US shop", platformCurrency: "USD" } })).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("sells the ticked lots into a new Direct sale for the contact, withdraws the rest and closes the proposal", async () => {
    const { contactId, proposalId, proposalNo, lots } = await proposalFor("Jan Kowalski", ["10.00", "20.00", "30.00"]);
    await moveProposal(userId, proposalId, "send");

    const result = await convertProposalToSale(userId, proposalId, {
      // The second lot haggled down from 20 to 15.
      lots: [
        { offerId: lots[0]!, price: "10.00" },
        { offerId: lots[1]!, price: "15" },
      ],
      target: { newSale: true },
    });
    assert.equal(result.created, true);

    const sale = await getSaleDetail(userId, result.saleId);
    assert.equal(sale?.platformId, directId);
    assert.equal(sale?.buyerId, contactId);
    assert.equal(sale?.currency, "EUR");
    assert.equal(sale?.soldAt.toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
    assert.equal(sale?.grossProceeds, "25.00");
    assert.deepEqual(sale?.proposals, [{ proposalId, proposalNo }]);

    assert.deepEqual(await offerStates(lots), ["sold", "sold", "withdrawn"]);
    // The haggled price is the sale's; the offer keeps what it was offered at.
    const lot1 = await prisma.offer.findUniqueOrThrow({ where: { id: lots[1]! }, select: { price: true } });
    assert.equal(lot1.price.toFixed(2), "20.00");

    const screen = await getProposalScreen(userId, proposalId);
    assert.equal(screen?.status, "sold");
    assert.ok(screen?.closedOn);
    assert.deepEqual(screen?.sale, { saleId: result.saleId, saleNo: result.saleNo, platformName: "Direct" });
    // Sold to, the contact is a buyer now.
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId }, select: { buyer: true } });
    assert.equal(contact.buyer, true);
  });

  it("joins the contact's open sale on another platform, which stays on its platform and goes through to delivery", async () => {
    const { contactId, proposalId, proposalNo, lots } = await proposalFor("Anna Nowak", ["8.00", "9.00"]);
    const facebookSale = await saleWithOneLine(facebookId, contactId);

    const options = await getProposalSaleOptions(userId, proposalId);
    assert.deepEqual(
      options.sales.map((s) => [s.saleId, s.platformName, s.lineCount]),
      [[facebookSale, "Facebook", 1]]
    );
    assert.deepEqual(
      options.lots.map((l) => [l.offerId, l.price, l.setsToSell]),
      [
        [lots[0], "8.00", 1],
        [lots[1], "9.00", 1],
      ]
    );

    const result = await convertProposalToSale(userId, proposalId, {
      lots: [{ offerId: lots[1]!, price: "9.00" }],
      target: { saleId: facebookSale },
    });
    assert.deepEqual(result, { saleId: facebookSale, saleNo: result.saleNo, created: false });

    const sale = await getSaleDetail(userId, facebookSale);
    assert.equal(sale?.platformName, "Facebook");
    assert.equal(sale?.buyerHandling, "5.00");
    assert.equal(sale?.grossProceeds, "21.00");
    assert.deepEqual(sale?.proposals, [{ proposalId, proposalNo }]);
    assert.deepEqual(await offerStates(lots), ["withdrawn", "sold"]);

    // Packing, sending and delivery as before.
    await setSaleStatus(userId, facebookSale, "paid");
    assert.equal(await markSaleCopiesPacked(userId, facebookSale), 2);
    await setSaleStatus(userId, facebookSale, "packed");
    await setSaleStatus(userId, facebookSale, "sent");
    await setSaleStatus(userId, facebookSale, "received");
    const delivered = await prisma.sale.findUniqueOrThrow({
      where: { id: facebookSale },
      select: { status: true, platformId: true },
    });
    assert.deepEqual(delivered, { status: "received", platformId: facebookId });
  });

  it("sells every set a lot still has, each at the lot's price", async () => {
    const contactId = (await prisma.contact.create({ data: { collectionId, name: "Piotr Zieliński" } })).id;
    const { proposalId } = await createProposal(userId, collectionId, contactId);
    const lot = await offer(directId, "4.00", { copies: 3 });
    await addProposalLots(userId, proposalId, [lot]);
    const [listed] = (await getProposalSaleOptions(userId, proposalId)).lots;
    assert.equal(listed?.setsToSell, 3);

    const { saleId } = await convertProposalToSale(userId, proposalId, {
      lots: [{ offerId: lot, price: "4.00" }],
      target: { newSale: true },
    });
    const sale = await getSaleDetail(userId, saleId);
    assert.equal(sale?.grossProceeds, "12.00");
  });

  it("refuses a sale in another currency, a sent sale and another contact's, selling nothing", async () => {
    const { contactId, proposalId, lots } = await proposalFor("Ewa Wójcik", ["5.00"]);
    const usdSale = await saleWithOneLine(usdShopId, contactId, "USD");
    const sentSale = await saleWithOneLine(facebookId, contactId);
    await setSaleStatus(userId, sentSale, "sent");
    const stranger = (await prisma.contact.create({ data: { collectionId, name: "Someone", buyer: true } })).id;
    const strangersSale = await saleWithOneLine(facebookId, stranger);

    const options = await getProposalSaleOptions(userId, proposalId);
    assert.deepEqual(
      options.sales.map((s) => s.saleId),
      [usdSale],
      "only the contact's sales not yet sent are offered"
    );

    const lotsInput = [{ offerId: lots[0]!, price: "5.00" }];
    await assert.rejects(
      convertProposalToSale(userId, proposalId, { lots: lotsInput, target: { saleId: usdSale } }),
      /is in USD, but the lots are in EUR/
    );
    await assert.rejects(
      convertProposalToSale(userId, proposalId, { lots: lotsInput, target: { saleId: sentSale } }),
      /has already been sent/
    );
    await assert.rejects(
      convertProposalToSale(userId, proposalId, { lots: lotsInput, target: { saleId: strangersSale } }),
      /is not this contact's/
    );
    assert.deepEqual(await offerStates(lots), ["preparing"]);
    assert.equal((await getProposalScreen(userId, proposalId))?.status, "preparing");
  });

  it("refuses ticking nothing, a lot of another proposal, a missing price and a closed proposal", async () => {
    const mine = await proposalFor("Tomasz Lewandowski", ["6.00"]);
    const theirs = await proposalFor("Maria Dąbrowska", ["7.00"]);

    await assert.rejects(
      convertProposalToSale(userId, mine.proposalId, { lots: [], target: { newSale: true } }),
      /decline the proposal instead/
    );
    await assert.rejects(
      convertProposalToSale(userId, mine.proposalId, {
        lots: [{ offerId: theirs.lots[0]!, price: "7.00" }],
        target: { newSale: true },
      }),
      /is not a lot of this proposal/
    );
    await assert.rejects(
      convertProposalToSale(userId, mine.proposalId, {
        lots: [{ offerId: mine.lots[0]!, price: "" }],
        target: { newSale: true },
      }),
      /Enter a sale price/
    );

    await moveProposal(userId, mine.proposalId, "decline");
    await assert.rejects(
      convertProposalToSale(userId, mine.proposalId, {
        lots: [{ offerId: mine.lots[0]!, price: "6.00" }],
        target: { newSale: true },
      }),
      /declined — it does not change any more/
    );
  });

  it("leaves no sale behind when the lot's copy has already sold elsewhere", async () => {
    const { proposalId, lots } = await proposalFor("Krzysztof Wiśniewski", ["3.00"]);
    // The lot's copy goes on another offer, and that one sells first.
    const lotCopy = await prisma.offerSetItem.findFirstOrThrow({
      where: { offerSet: { offerId: lots[0]! } },
      select: { itemId: true },
    });
    const elsewhere = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        facebookGroupId: groupId,
        listingType: "fixed",
        url: null,
        price: "3.00",
        startingPrice: null,
        currency: "EUR",
        listingDate: null,
        state: "active",
      },
      { seedItemIds: [lotCopy.itemId] }
    );
    const buyer = (await prisma.contact.create({ data: { collectionId, name: "Other buyer", buyer: true } })).id;
    const saleId = await createSale(userId, collectionId, header(facebookId, buyer));
    const [sellable] = await listSellableOffers(userId, collectionId, { offerId: elsewhere });
    await addSaleLines(userId, saleId, [
      { offerId: elsewhere, offerSetId: sellable!.sets[0]!.offerSetId, price: "3.00", itemIds: [lotCopy.itemId] },
    ]);

    const before = await prisma.sale.count({ where: { collectionId } });
    await assert.rejects(
      convertProposalToSale(userId, proposalId, {
        lots: [{ offerId: lots[0]!, price: "3.00" }],
        target: { newSale: true },
      }),
      /has nothing left to sell/
    );
    assert.equal(await prisma.sale.count({ where: { collectionId } }), before);
    assert.equal((await getProposalScreen(userId, proposalId))?.status, "preparing");
  });

  it("keeps the link when the sale it went into is merged into another", async () => {
    const { contactId, proposalId, proposalNo, lots } = await proposalFor("Agnieszka Kamińska", ["2.00"]);
    const { saleId } = await convertProposalToSale(userId, proposalId, {
      lots: [{ offerId: lots[0]!, price: "2.00" }],
      target: { newSale: true },
    });
    const remaining = await createSale(userId, collectionId, header(directId, contactId));
    await mergeSales(userId, {
      remainingSaleId: remaining,
      otherSaleId: saleId,
      choices: { buyer: "remaining", commission: "remaining", postage: "remaining" },
    });
    assert.deepEqual((await getSaleDetail(userId, remaining))?.proposals, [{ proposalId, proposalNo }]);
    assert.equal((await getProposalScreen(userId, proposalId))?.sale?.saleId, remaining);
  });

  it("an ordinary offer on Direct still cannot join a sale on another platform", async () => {
    const contactId = (await prisma.contact.create({ data: { collectionId, name: "Plain buyer", buyer: true } })).id;
    const facebookSale = await saleWithOneLine(facebookId, contactId);
    const plain = await offer(directId, "1.00", { state: "active" });
    const [sellable] = await listSellableOffers(userId, collectionId, { offerId: plain });
    await assert.rejects(
      addSaleLines(userId, facebookSale, [
        { offerId: plain, offerSetId: sellable!.sets[0]!.offerSetId, price: "1.00", itemIds: sellable!.sets[0]!.itemIds },
      ]),
      /different platform than this sale/
    );
  });
});
