import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, patchOffer, updateOffer, type NewOfferInput, type OfferInput } from "../../src/lib/offers";
import {
  addProposalLots,
  convertProposalToSale,
  createProposal,
  createProposalLot,
  getDirectPlatform,
  getProposalLotsPrepare,
  getProposalScreen,
  listPreparingProposals,
  makeProposalLots,
  markProposalHandedOut,
  moveProposal,
  removeProposalLot,
} from "../../src/lib/proposals";

// A sent proposal is fixed (#2307), and New offer makes an offer straight into a proposal (#2304).
//
// Sent, a proposal takes no lots and none of its lots' titles or prices change — not on its screen,
// and not by way of the offer's own; Reopen puts it back to Preparing, where it changes and is sent
// again. *New offer* with a proposal chosen makes the offer on Direct as that proposal's next lot, and
// only a proposal being prepared takes one. Each case makes copies and proposals of its own.

const ts = Date.now();

describe("A sent proposal is fixed (#2307); New offer makes a lot (#2304)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let directId: string;
  let shopId: string;
  let buyerId: string;
  let nextStamp = 0;

  async function copy(): Promise<string> {
    nextStamp += 1;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: `Stamp ${nextStamp}` } })).id;
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" })).id;
  }

  function input(platformId: string, price: string): OfferInput & NewOfferInput {
    return { platformId, url: null, price, startingPrice: null, currency: "EUR", listingDate: null };
  }

  async function offer(platformId: string, price: string): Promise<string> {
    return createOffer(userId, collectionId, input(platformId, price), { seedItemIds: [await copy()] });
  }

  /** A proposal with one lot priced at 5.00, marked sent. */
  async function sentProposal(): Promise<{ proposalId: string; lot: string }> {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const lot = await offer(directId, "5.00");
    await addProposalLots(userId, proposalId, [lot]);
    await moveProposal(userId, proposalId, "send");
    return { proposalId, lot };
  }

  before(async () => {
    userId = `test-user-proposal-fixed-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-proposal-fixed-${ts}`, name: "Fixed proposals", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    directId = (await getDirectPlatform(collectionId)).id;
    shopId = (await prisma.platform.create({ data: { collectionId, name: "Stamp shop", platformCurrency: "EUR" } })).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Jan Kowalski", buyer: true } })).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("takes no lots and no lot changes once sent, and says why", async () => {
    const { proposalId, lot } = await sentProposal();
    await assert.rejects(addProposalLots(userId, proposalId, [await offer(directId, "1.00")]), /has been sent.*Reopen/);
    await assert.rejects(makeProposalLots(userId, proposalId, [await copy()], "each"), /has been sent/);
    await assert.rejects(removeProposalLot(userId, proposalId, lot), /has been sent/);
    await assert.rejects(
      createProposalLot(userId, collectionId, proposalId, input(directId, "2.00"), { seedItemIds: [await copy()] }),
      /has been sent/
    );
    assert.deepEqual(await getProposalLotsPrepare(userId, collectionId, proposalId), {});
    assert.equal(await prisma.offer.count({ where: { proposalId } }), 1);
  });

  it("refuses a sent lot's title, price and platform on the offer's own screen, but not its note", async () => {
    const { lot } = await sentProposal();
    for (const patch of [{ price: "9.00" }, { name: "A new title" }]) {
      await assert.rejects(patchOffer(userId, lot, patch), /is lot 1 of proposal #\d+, which has been sent/);
    }
    await assert.rejects(updateOffer(userId, lot, input(directId, "9.00")), /which has been sent/);
    await assert.rejects(updateOffer(userId, lot, input(shopId, "5.00")), /which has been sent/);
    // What does not change what the buyer was sent still saves.
    await patchOffer(userId, lot, { privateNote: "Asked about the perforation" });
    await updateOffer(userId, lot, { ...input(directId, "5.00"), url: "https://example.com/lot" });
    const row = await prisma.offer.findUniqueOrThrow({ where: { id: lot }, select: { price: true, name: true, url: true } });
    assert.equal(row.price.toFixed(2), "5.00");
    assert.equal(row.url, "https://example.com/lot");
  });

  it("reopens to Preparing, keeping the time it was sent, changes and is sent again", async () => {
    const { proposalId, lot } = await sentProposal();
    const sentOn = (await getProposalScreen(userId, proposalId))!.sentOn;
    await assert.rejects(moveProposal(userId, (await createProposal(userId, collectionId, buyerId)).proposalId, "reopen"), /already being prepared/);

    await moveProposal(userId, proposalId, "reopen");
    const reopened = (await getProposalScreen(userId, proposalId))!;
    assert.equal(reopened.status, "preparing");
    // The buyer has seen an earlier version: the screen says so from this.
    assert.equal(reopened.sentOn, sentOn);
    assert.ok((await getProposalLotsPrepare(userId, collectionId, proposalId))[lot]);
    await patchOffer(userId, lot, { price: "7.00" });
    await addProposalLots(userId, proposalId, [await offer(directId, "3.00")]);

    await prisma.proposal.update({ where: { id: proposalId }, data: { sentAt: new Date("2026-01-02T00:00:00Z") } });
    // Sending again — here by handing something out — marks it Sent with the new time.
    assert.equal(await markProposalHandedOut(userId, proposalId), true);
    const again = (await getProposalScreen(userId, proposalId))!;
    assert.equal(again.status, "sent");
    assert.notEqual(again.sentOn, "2026-01-02");
    await assert.rejects(patchOffer(userId, lot, { price: "8.00" }), /which has been sent/);
  });

  it("still sells and declines a sent proposal without reopening it", async () => {
    const sold = await sentProposal();
    await convertProposalToSale(userId, sold.proposalId, {
      lots: [{ offerId: sold.lot, price: "5.00" }],
      target: { newSale: true },
    });
    assert.equal((await getProposalScreen(userId, sold.proposalId))!.status, "sold");

    const declined = await sentProposal();
    await moveProposal(userId, declined.proposalId, "decline");
    assert.equal((await getProposalScreen(userId, declined.proposalId))!.status, "declined");
    await assert.rejects(moveProposal(userId, declined.proposalId, "reopen"), /declined/);
  });

  it("makes New offer's offer on Direct the next lot of the proposal chosen", async () => {
    const { proposalId, proposalNo } = await createProposal(userId, collectionId, buyerId);
    await addProposalLots(userId, proposalId, [await offer(directId, "1.00")]);
    const copies = [await copy(), await copy()];
    const made = await createProposalLot(userId, collectionId, proposalId, input(directId, "12.00"), {
      seedItemIds: copies,
      seedPerCopy: false,
    });
    assert.equal(made.proposalNo, proposalNo);
    assert.equal(made.lotNo, 2);
    const row = await prisma.offer.findUniqueOrThrow({
      where: { id: made.offerId },
      select: { proposalId: true, proposalLotNo: true, platformId: true, price: true, _count: { select: { sets: true } } },
    });
    assert.equal(row.proposalId, proposalId);
    assert.equal(row.proposalLotNo, 2);
    assert.equal(row.platformId, directId);
    assert.equal(row.price.toFixed(2), "12.00");
    assert.equal(row._count.sets, 1);
  });

  it("makes no offer when the proposal refuses it — off Direct, or a proposal no longer being prepared", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const before = await prisma.offer.count({ where: { collectionId } });
    await assert.rejects(
      createProposalLot(userId, collectionId, proposalId, input(shopId, "2.00"), { seedItemIds: [await copy()] }),
      /not on the Direct platform/
    );
    assert.equal(await prisma.offer.count({ where: { collectionId } }), before);
  });

  it("lists only the proposals being prepared for New offer and Generate offers", async () => {
    const preparing = await createProposal(userId, collectionId, buyerId);
    const { proposalId: sentId } = await sentProposal();
    const listed = await listPreparingProposals(userId, collectionId);
    assert.ok(listed.some((p) => p.proposalId === preparing.proposalId));
    assert.ok(!listed.some((p) => p.proposalId === sentId));
    await moveProposal(userId, sentId, "reopen");
    assert.ok((await listPreparingProposals(userId, collectionId)).some((p) => p.proposalId === sentId));
  });
});
