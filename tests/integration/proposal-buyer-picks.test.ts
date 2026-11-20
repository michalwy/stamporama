import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import {
  addProposalLots,
  createProposal,
  getDirectPlatform,
  getProposalSaleOptions,
  getProposalScreen,
  listProposalsPaginated,
  moveProposal,
  removeProposalLot,
} from "../../src/lib/proposals";
import {
  createProposalShareToken,
  readSharedProposalDocument,
  saveProposalBuyerPick,
  verifyProposalShareToken,
  type ProposalShareAccess,
} from "../../src/lib/proposal-handout";

// The buyer ticks the lots they want on the proposal's live page (#2601): each tick saved at once,
// kept on reload, shown to the collector on the proposal's screen and the list, and what *Convert to
// sale…* opens with. Each case makes copies and proposals of its own.

const ts = Date.now();

describe("the buyer's picks on a proposal's live page (#2601)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let conditionId: string;
  let directId: string;
  let buyerId: string;
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
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" })).id;
  }

  async function lot(price: string): Promise<string> {
    return createOffer(
      userId,
      collectionId,
      { platformId: directId, url: null, price, startingPrice: null, currency: "PLN", listingDate: null },
      { seedItemIds: [await copy()] }
    );
  }

  /** A proposal of `prices.length` fresh lots, numbered 1… in that order, with a live link. */
  async function proposalWith(
    ...prices: string[]
  ): Promise<{ proposalId: string; offerIds: string[]; access: ProposalShareAccess }> {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const offerIds: string[] = [];
    for (const price of prices) offerIds.push(await lot(price));
    // One at a time, so each takes the next lot number in the order given.
    for (const offerId of offerIds) await addProposalLots(userId, proposalId, [offerId]);
    const { token } = await createProposalShareToken(userId, proposalId);
    return { proposalId, offerIds, access: (await verifyProposalShareToken(token))! };
  }

  async function buyerTicks(access: ProposalShareAccess): Promise<number[]> {
    const shared = await readSharedProposalDocument(access);
    assert.equal(shared.standing, "shown");
    return shared.standing === "shown" ? shared.document.lots.filter((l) => l.picked).map((l) => l.lotNo) : [];
  }

  before(async () => {
    userId = `test-user-proposal-picks-${ts}`;
    await prisma.user.create({
      data: { id: userId, name: "Picks", email: `${userId}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-proposal-picks-${ts}`, name: "Picks", baseCurrency: "PLN", defaultLanguage: "en", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    directId = (await getDirectPlatform(collectionId)).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Ewa", buyer: true } })).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("keeps lots 2, 5 and 7 ticked, and shows them on the screen, the list and Convert to sale", async () => {
    const { proposalId, offerIds, access } = await proposalWith("1.00", "10.00", "3.00", "4.00", "15.00", "6.00", "20.00");
    const at = new Date("2026-11-21T10:00:00Z");
    await saveProposalBuyerPick(access, 2, true, at);
    await saveProposalBuyerPick(access, 5, true, at);
    const last = await saveProposalBuyerPick(access, 7, true, at);
    assert.deepEqual(last.picked, [2, 5, 7]);

    // Reloading the page keeps the ticks.
    assert.deepEqual(await buyerTicks(access), [2, 5, 7]);

    const screen = (await getProposalScreen(userId, proposalId))!;
    assert.deepEqual(
      screen.lots.filter((l) => l.pick === "picked").map((l) => l.lotNo),
      [2, 5, 7]
    );
    assert.deepEqual(screen.buyerPicks, { count: 3, changedAt: at.toISOString() });

    const { items } = await listProposalsPaginated(userId, collectionId);
    assert.equal(items.find((p) => p.proposalId === proposalId)!.pickedLotCount, 3);

    const options = await getProposalSaleOptions(userId, proposalId);
    assert.deepEqual(
      options.lots.filter((l) => l.picked).map((l) => l.offerId),
      [offerIds[1], offerIds[4], offerIds[6]]
    );
  });

  it("unticks, times the summary from the last change, and keeps when a lot was first ticked", async () => {
    const { proposalId, offerIds, access } = await proposalWith("5.00", "6.00");
    const first = new Date("2026-11-21T08:00:00Z");
    await saveProposalBuyerPick(access, 1, true, first);
    await saveProposalBuyerPick(access, 1, true, new Date("2026-11-21T08:30:00Z"));
    const pickedAt = (await prisma.offer.findUniqueOrThrow({ where: { id: offerIds[0] } })).proposalPickedAt;
    assert.equal(pickedAt?.toISOString(), first.toISOString());

    await saveProposalBuyerPick(access, 2, true, first);
    const later = new Date("2026-11-21T09:00:00Z");
    assert.deepEqual((await saveProposalBuyerPick(access, 1, false, later)).picked, [2]);
    assert.deepEqual((await getProposalScreen(userId, proposalId))!.buyerPicks, { count: 1, changedAt: later.toISOString() });

    await saveProposalBuyerPick(access, 2, false, later);
    assert.equal((await getProposalScreen(userId, proposalId))!.buyerPicks, null);
  });

  it("takes ticks while the proposal is Sent, keeps them when it is reopened, and refuses them once it is closed", async () => {
    const { proposalId, access } = await proposalWith("5.00", "6.00");
    await moveProposal(userId, proposalId, "send");
    await saveProposalBuyerPick(access, 1, true);
    await moveProposal(userId, proposalId, "reopen");
    assert.deepEqual(await buyerTicks(access), [1]);

    await moveProposal(userId, proposalId, "decline");
    await assert.rejects(saveProposalBuyerPick(access, 2, true), /closed/);
    await assert.rejects(saveProposalBuyerPick(access, 1, false), /closed/);
    assert.equal((await readSharedProposalDocument(access)).standing, "closed");
  });

  it("gives a lot no longer offered no tick box, and the collector reads its pick as no longer available", async () => {
    const { proposalId, offerIds, access } = await proposalWith("5.00", "6.00");
    await saveProposalBuyerPick(access, 1, true);
    await setOfferState(userId, offerIds[0], "withdrawn");
    await setOfferState(userId, offerIds[1], "withdrawn");

    await assert.rejects(saveProposalBuyerPick(access, 2, true), /no longer available/);
    const shared = await readSharedProposalDocument(access);
    assert.ok(shared.standing === "shown");
    assert.deepEqual(
      shared.document.lots.map((l) => [l.lotNo, l.pickable, l.picked]),
      [
        [1, false, false],
        [2, false, false],
      ]
    );

    const screen = (await getProposalScreen(userId, proposalId))!;
    assert.deepEqual(
      screen.lots.map((l) => l.pick),
      ["unavailable", null]
    );
    assert.equal(screen.buyerPicks?.count, 1);
  });

  it("takes the pick off a lot taken out of the proposal, so it follows the offer nowhere", async () => {
    const { proposalId, offerIds, access } = await proposalWith("5.00", "6.00");
    await saveProposalBuyerPick(access, 1, true);
    await removeProposalLot(userId, proposalId, offerIds[0]);
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offerIds[0] } })).proposalPickedAt, null);

    // Back in, it is not ticked.
    await addProposalLots(userId, proposalId, [offerIds[0]]);
    assert.equal((await getProposalScreen(userId, proposalId))!.buyerPicks, null);
  });

  it("refuses a lot number the proposal does not have", async () => {
    const { access } = await proposalWith("5.00");
    await assert.rejects(saveProposalBuyerPick(access, 9, true), /no such lot/);
  });
});
