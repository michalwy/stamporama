import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, patchOffer, type OfferInput } from "../../src/lib/offers";
import {
  changeLotGroupTitleWords,
  getLotGroupPhotoSettings,
  regenerateLotGroupTexts,
  reorderLotGroup,
  setLotGroupTitleTemplate,
  updateLotGroupPhotoSettings,
} from "../../src/lib/offer-lot-groups";
import type { LotGroup } from "../../src/lib/offer-lot-group-rules";
import {
  addProposalLots,
  createProposal,
  getDirectPlatform,
  getProposalLot,
  getProposalScreen,
  moveProposal,
} from "../../src/lib/proposals";

// A proposal's screen works like a Facebook post's (#2313): the tools a post's lots are worked on with
// — every lot's photo settings at once, their texts and titles at once, their order — work on a
// proposal's lots through the same implementation, while the proposal is being prepared, and one lot
// is read alone for its row. Each case makes copies and proposals of its own.

const ts = Date.now();

describe("A proposal's lots are worked on as a post's are (#2313)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let directId: string;
  let buyerId: string;
  let nextStamp = 0;

  async function copy(): Promise<string> {
    nextStamp += 1;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: `Stamp ${nextStamp}` } })).id;
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" })).id;
  }

  function input(price: string): OfferInput {
    return { platformId: directId, url: null, price, startingPrice: null, currency: "EUR", listingDate: null, state: "preparing" };
  }

  async function lot(name: string, price = "5.00"): Promise<string> {
    const offerId = await createOffer(userId, collectionId, input(price), { seedItemIds: [await copy()] });
    await patchOffer(userId, offerId, { name });
    return offerId;
  }

  /** A proposal being prepared with the lots named, in that order. */
  async function proposal(...names: string[]): Promise<{ group: LotGroup; proposalId: string; lots: string[] }> {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const lots: string[] = [];
    for (const name of names) {
      const offerId = await lot(name);
      await addProposalLots(userId, proposalId, [offerId]);
      lots.push(offerId);
    }
    return { group: { kind: "proposal", id: proposalId }, proposalId, lots };
  }

  const names = async (ids: readonly string[]) =>
    (await prisma.offer.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }))
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      .map((o) => o.name);

  before(async () => {
    userId = `test-user-proposal-lot-tools-${ts}`;
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
        data: { slug: `col-proposal-lot-tools-${ts}`, name: "Proposal lot tools", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    directId = (await getDirectPlatform(collectionId)).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Anna Nowak", buyer: true } })).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("sets every lot's photo settings at once, writing only the lots the change changes", async () => {
    const { group, lots } = await proposal("Mercury", "Venus");
    const opened = await getLotGroupPhotoSettings(userId, group);
    assert.equal(opened.lotCount, 2);
    assert.equal(opened.platformName, (await getDirectPlatform(collectionId)).name);

    assert.deepEqual(await updateLotGroupPhotoSettings(userId, group, { photoSides: "both" }), lots);
    const after = await getLotGroupPhotoSettings(userId, group);
    assert.deepEqual(after.settings.photoSides, { same: true, value: "both" });
    assert.deepEqual(await updateLotGroupPhotoSettings(userId, group, { photoSides: "both" }), [], "nothing left to change");
  });

  it("changes every lot's title at once, and gives them one title template", async () => {
    const { group, lots } = await proposal("Mars", "Jupiter");
    assert.equal(await changeLotGroupTitleWords(userId, group, "RARE", "end", "add"), 2);
    assert.deepEqual(await names(lots), ["Mars RARE", "Jupiter RARE"]);
    assert.equal(await changeLotGroupTitleWords(userId, group, "RARE", "end", "remove"), 2);
    assert.deepEqual(await names(lots), ["Mars", "Jupiter"]);

    // Both titles are hand-written now, so the template writes neither unless ticked.
    assert.equal(await setLotGroupTitleTemplate(userId, group, "Lot of {name}", [lots[0]]), 1);
    const templates = await prisma.offer.findMany({ where: { id: { in: lots } }, select: { nameTemplate: true } });
    assert.deepEqual(
      templates.map((t) => t.nameTemplate),
      ["Lot of {name}", "Lot of {name}"]
    );
    assert.equal((await names([lots[1]]))[0], "Jupiter");
  });

  it("regenerates the lots' texts, and only its own lots", async () => {
    const { group, lots } = await proposal("Saturn", "Uranus");
    const { lots: other } = await proposal("Neptune");
    assert.equal(await regenerateLotGroupTexts(userId, group, lots, []), 2);
    await assert.rejects(regenerateLotGroupTexts(userId, group, [], other), /this proposal's own lots/);
  });

  it("puts the lots in a new order, the lot numbers following, and refuses a stale one", async () => {
    const { group, proposalId, lots } = await proposal("Ceres", "Vesta", "Pallas");
    await reorderLotGroup(userId, group, [lots[2], lots[0], lots[1]]);
    const screen = (await getProposalScreen(userId, proposalId))!;
    assert.deepEqual(
      screen.lots.map((l) => [l.offerId, l.lotNo]),
      [
        [lots[2], 1],
        [lots[0], 2],
        [lots[1], 3],
      ]
    );
    await assert.rejects(reorderLotGroup(userId, group, [lots[0], lots[1]]), /lots have changed/);
  });

  it("refuses every tool once the proposal is sent, and a stranger's proposal", async () => {
    const { group, proposalId, lots } = await proposal("Io", "Europa");
    await assert.rejects(getLotGroupPhotoSettings("someone-else", group), /Proposal not found/);
    await moveProposal(userId, proposalId, "send");
    await assert.rejects(getLotGroupPhotoSettings(userId, group), /has been sent/);
    await assert.rejects(updateLotGroupPhotoSettings(userId, group, { photoSides: "both" }), /has been sent/);
    await assert.rejects(regenerateLotGroupTexts(userId, group, lots, []), /has been sent/);
    await assert.rejects(setLotGroupTitleTemplate(userId, group, "{name}", []), /has been sent/);
    await assert.rejects(changeLotGroupTitleWords(userId, group, "RARE", "start", "add"), /has been sent/);
    await assert.rejects(reorderLotGroup(userId, group, [lots[1], lots[0]]), /has been sent/);

    const screen = (await getProposalScreen(userId, proposalId))!;
    assert.equal(screen.lotTexts, null, "a sent proposal's texts are not worked on");
    assert.equal(screen.lotTitles, null);
  });

  it("shows each lot's texts, titles and sales on the screen while it is being prepared", async () => {
    const { proposalId, lots } = await proposal("Titan", "Rhea");
    const screen = (await getProposalScreen(userId, proposalId))!;
    assert.deepEqual(Object.keys(screen.lotTexts ?? {}).sort(), [...lots].sort());
    assert.deepEqual(screen.lotTitles?.handWritten, lots, "both were named by hand");
    assert.deepEqual(screen.sales, {});
    assert.deepEqual(
      screen.lots.map((l) => l.copyPhotoId),
      [null, null],
      "no copy has a photo"
    );
  });

  it("reads one lot alone for its row, with the proposal's total", async () => {
    const { proposalId, lots } = await proposal("Phobos", "Deimos");
    await patchOffer(userId, lots[1], { price: "7.50" });
    const update = (await getProposalLot(userId, collectionId, proposalId, lots[1]))!;
    assert.equal(update.lot.offerId, lots[1]);
    assert.equal(update.lot.lotNo, 2);
    assert.equal(update.lot.price, "7.50");
    assert.equal(update.prepare?.id, lots[1]);
    assert.equal(update.handWritten, true);
    assert.equal(update.total, "12.50");
    assert.equal(update.unpriced, 0);

    const { lots: other } = await proposal("Triton");
    assert.equal(await getProposalLot(userId, collectionId, proposalId, other[0]), null, "not a lot of this proposal");
  });
});
