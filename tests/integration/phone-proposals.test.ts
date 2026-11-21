import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer } from "../../src/lib/offers";
import { updatePlatform } from "../../src/lib/platforms";
import {
  addProposalLots,
  createProposal,
  getDirectPlatform,
  listProposalsPaginated,
  moveProposal,
} from "../../src/lib/proposals";
import {
  createProposalShareToken,
  readProposalMessage,
  saveProposalBuyerPick,
  setProposalLanguage,
  verifyProposalShareToken,
} from "../../src/lib/proposal-handout";
import { getPhoneProposal } from "../../src/lib/phone-proposals";
import { secretKeyConfigured } from "../../src/lib/secret-box";

// A proposal on the phone (#2625): the desk's reads gathered for one screen — its lots with one picture
// each, the message in the proposal's language, the live link as it stands — and nothing to send once
// it is closed. Sharing it marks it Sent through the desk's own move, which `proposals.test.ts` covers.

const ts = Date.now();

describe("a proposal on the phone (#2625)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let areaId: string;
  let conditionId: string;
  let directId: string;
  let buyerId: string;
  let nextStamp = 0;

  async function lot(name: string, price: string): Promise<{ offerId: string; itemId: string }> {
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
    await prisma.offer.update({ where: { id: offerId }, data: { name, nameEdited: true } });
    return { offerId, itemId };
  }

  before(async () => {
    userId = `test-user-phone-proposals-${ts}`;
    otherUserId = `test-user-phone-proposals-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: `Test User ${id}`, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-phone-proposals-${ts}`, name: "Proposals", baseCurrency: "PLN", defaultLanguage: "pl", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    directId = (await getDirectPlatform(collectionId)).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Jan Kowalski", buyer: true } })).id;
    const direct = await prisma.platform.findUniqueOrThrow({ where: { id: directId } });
    await updatePlatform(userId, directId, {
      name: direct.name,
      platformCurrency: "PLN",
      proposalMessageTemplates: { pl: "Hi {buyer}\n{lots}\nTotal {total}" },
    });
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("reads the proposal, its lots, its message and its link as the desk reads them", async () => {
    const { proposalId, proposalNo } = await createProposal(userId, collectionId, buyerId);
    const a = await lot("Austria", "25.00");
    const b = await lot("Belgium", "10.00");
    await addProposalLots(userId, proposalId, [a.offerId, b.offerId]);
    const photoId = (
      await prisma.photo.create({
        data: {
          itemId: a.itemId,
          role: "front",
          storageKey: `phone-proposals-${Math.random()}.jpg`,
          mime: "image/jpeg",
          width: 10,
          height: 10,
          sizeBytes: 100,
        },
      })
    ).id;

    const phone = (await getPhoneProposal(userId, collectionId, proposalNo))!;
    assert.equal(phone.proposalId, proposalId);
    assert.equal(phone.status, "preparing");
    assert.equal(phone.contact.name, "Jan Kowalski");
    assert.deepEqual(
      phone.lots.map((l) => [l.lotNo, l.title, l.price, l.picture]),
      [
        [1, "Austria", "25.00", { photoId, copy: true }],
        [2, "Belgium", "10.00", null],
      ]
    );
    assert.equal(phone.total, "35.00");
    assert.equal(phone.message?.text, (await readProposalMessage(userId, proposalId)).text);
    assert.equal(phone.message?.language, "pl");
    assert.equal(phone.link, null);

    // The link the share menu hands over is the desk's own link — its address readable only where the
    // install has a key to open it with, which the suite's environment may not set.
    const { token } = await createProposalShareToken(userId, proposalId);
    const withLink = (await getPhoneProposal(userId, collectionId, proposalNo))!;
    assert.deepEqual(withLink.link, secretKeyConfigured() ? { token } : { unreadable: "unconfigured" });
  });

  it("shows the buyer's picks on the list and the screen, timed from their last change (#2628)", async () => {
    const { proposalId, proposalNo } = await createProposal(userId, collectionId, buyerId);
    for (const name of ["One", "Two", "Three", "Four"]) {
      await addProposalLots(userId, proposalId, [(await lot(name, "5.00")).offerId]);
    }
    const unpicked = (await getPhoneProposal(userId, collectionId, proposalNo))!;
    assert.equal(unpicked.buyerPicks, null);

    const access = (await verifyProposalShareToken((await createProposalShareToken(userId, proposalId)).token))!;
    await saveProposalBuyerPick(access, 1, true, new Date("2026-11-21T09:00:00Z"));
    const last = new Date("2026-11-21T09:05:00Z");
    await saveProposalBuyerPick(access, 4, true, last);

    const { items } = await listProposalsPaginated(userId, collectionId);
    const row = items.find((p) => p.proposalId === proposalId)!;
    assert.equal(row.pickedLotCount, 2);
    assert.equal(row.picksChangedAt, last.toISOString());

    const phone = (await getPhoneProposal(userId, collectionId, proposalNo))!;
    assert.deepEqual(phone.buyerPicks, { count: 2, changedAt: last.toISOString() });
    assert.deepEqual(
      phone.lots.filter((l) => l.pick === "picked").map((l) => l.lotNo),
      [1, 4]
    );
  });

  it("reads the message in the language chosen, saved on the contact", async () => {
    const { proposalId, proposalNo } = await createProposal(userId, collectionId, buyerId);
    await addProposalLots(userId, proposalId, [(await lot("Czechia", "5.00")).offerId]);
    await setProposalLanguage(userId, proposalId, "pl");
    const phone = (await getPhoneProposal(userId, collectionId, proposalNo))!;
    assert.equal(phone.message?.language, "pl");
    assert.ok(phone.message?.languages.includes("pl"));
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: buyerId } })).language, "pl");
  });

  it("has nothing to send once the proposal is closed", async () => {
    const { proposalId, proposalNo } = await createProposal(userId, collectionId, buyerId);
    await addProposalLots(userId, proposalId, [(await lot("Denmark", "7.00")).offerId]);
    await moveProposal(userId, proposalId, "decline");
    const phone = (await getPhoneProposal(userId, collectionId, proposalNo))!;
    assert.equal(phone.status, "declined");
    assert.equal(phone.message, null);
    assert.equal(phone.link, null);
    assert.equal(phone.lots.length, 1);
  });

  it("is another collector's to nobody else, and a number that is no proposal is none", async () => {
    const { proposalNo } = await createProposal(userId, collectionId, buyerId);
    await assert.rejects(getPhoneProposal(otherUserId, collectionId, proposalNo));
    assert.equal(await getPhoneProposal(userId, collectionId, 999_999), null);
  });
});
