import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { updatePlatform } from "../../src/lib/platforms";
import {
  addProposalLots,
  createProposal,
  getDirectPlatform,
  getProposalScreen,
  markProposalHandedOut,
  moveProposal,
  removeProposalLot,
} from "../../src/lib/proposals";
import {
  buildProposalPhotoArchive,
  canServeProposalSharePhoto,
  createProposalShareToken,
  readProposalDocument,
  readProposalMessage,
  readProposalPhotos,
  readProposalShareState,
  readSharedProposalDocument,
  revokeProposalShareToken,
  verifyProposalShareToken,
} from "../../src/lib/proposal-handout";

// What a proposal's buyer is sent (#2288): its lots numbered alike everywhere, the message from the
// Direct platform's template, the photos, and the document with its live link — and handing any of
// them out marks a proposal being prepared sent. Each case makes copies and proposals of its own.

const ts = Date.now();

describe("what a proposal's buyer is sent (#2288)", () => {
  let userId: string;
  let otherUserId: string;
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

  /** A Direct offer of one fresh copy, titled and priced. */
  async function lot(name: string, price = "0.00"): Promise<string> {
    const offerId = await createOffer(
      userId,
      collectionId,
      { platformId: directId, url: null, price, startingPrice: null, currency: "PLN", listingDate: null, state: "preparing" },
      { seedItemIds: [await copy()] }
    );
    await prisma.offer.update({ where: { id: offerId }, data: { name, nameEdited: true } });
    return offerId;
  }

  /** A proposal for the buyer holding fresh lots, in that order. */
  async function proposalWith(...lots: [string, string?][]): Promise<{ proposalId: string; proposalNo: number; offerIds: string[] }> {
    const made = await createProposal(userId, collectionId, buyerId);
    const offerIds: string[] = [];
    for (const [name, price] of lots) offerIds.push(await lot(name, price));
    if (offerIds.length) await addProposalLots(userId, made.proposalId, offerIds);
    return { ...made, offerIds };
  }

  /** A generated image on `offerId`'s upload set. */
  async function generated(offerId: string): Promise<string> {
    const photo = await prisma.photo.create({
      data: {
        offerId,
        kind: "generated",
        storageKey: `proposal-handout-${Math.random()}.jpg`,
        mime: "image/jpeg",
        width: 10,
        height: 10,
        sizeBytes: 100,
      },
    });
    await prisma.offerPhotoEntry.create({ data: { offerId, photoId: photo.id, sortOrder: 0, setIds: [] } });
    return photo.id;
  }

  async function lotNos(proposalId: string): Promise<[string, number][]> {
    return (await getProposalScreen(userId, proposalId))!.lots.map((l) => [l.offerId, l.lotNo]);
  }

  async function status(proposalId: string): Promise<string> {
    return (await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })).status;
  }

  before(async () => {
    userId = `test-user-proposal-handout-${ts}`;
    otherUserId = `test-user-proposal-handout-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: `Test User ${id}`, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-proposal-handout-${ts}`, name: "Proposals", baseCurrency: "PLN", defaultLanguage: "pl", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    directId = (await getDirectPlatform(collectionId)).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Jan Kowalski", buyer: true } })).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("numbers the lots as they join, closes the gap while preparing, and keeps the numbers once sent and reopened", async () => {
    const { proposalId, offerIds } = await proposalWith(["A"], ["B"], ["C"]);
    const [a, b, c] = offerIds;
    assert.deepEqual(await lotNos(proposalId), [
      [a, 1],
      [b, 2],
      [c, 3],
    ]);

    await removeProposalLot(userId, proposalId, a);
    assert.deepEqual(await lotNos(proposalId), [
      [b, 1],
      [c, 2],
    ]);
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: a } })).proposalLotNo, null);

    await moveProposal(userId, proposalId, "send");
    // A sent proposal is fixed (#2307); reopened, the buyer still holds the numbers they were sent.
    await assert.rejects(removeProposalLot(userId, proposalId, b), /has been sent/);
    await moveProposal(userId, proposalId, "reopen");
    await removeProposalLot(userId, proposalId, b);
    const d = await lot("D");
    await addProposalLots(userId, proposalId, [d]);
    // The buyer holds *2*: it still means C, and D comes after it.
    assert.deepEqual(await lotNos(proposalId), [
      [c, 2],
      [d, 3],
    ]);
  });

  it("writes the message from the Direct platform's template, the withdrawn lots left out — and nothing without one", async () => {
    const { proposalId, offerIds } = await proposalWith(["Austria", "25.00"], ["Gone", "9.00"], ["Untitled", "0"]);
    assert.deepEqual(await readProposalMessage(userId, proposalId), { text: null, unknownPlaceholders: [] });

    const direct = await prisma.platform.findUniqueOrThrow({ where: { id: directId } });
    await updatePlatform(userId, directId, {
      name: direct.name,
      platformCurrency: "PLN",
      proposalMessageTemplate: "  Hi {buyer}\n{lots}\nTotal {total} {oops}  ",
    });
    await setOfferState(userId, offerIds[1], "withdrawn");
    assert.deepEqual(await readProposalMessage(userId, proposalId), {
      text: "Hi Jan Kowalski\n1. Austria — 25 zł\n3. Untitled\nTotal 25 zł {oops}",
      unknownPlaceholders: ["{oops}"],
    });
    await assert.rejects(readProposalMessage(otherUserId, proposalId), /not found/);
  });

  it("keeps the template on Direct alone", async () => {
    const other = await prisma.platform.create({ data: { collectionId, name: `Other ${ts}`, platformCurrency: "PLN" } });
    await updatePlatform(userId, other.id, { name: other.name, platformCurrency: "PLN", proposalMessageTemplate: "{lots}" });
    assert.equal((await prisma.platform.findUniqueOrThrow({ where: { id: other.id } })).proposalMessageTemplate, null);
  });

  it("marks a proposal being prepared sent when something is handed out — once, and only with lots", async () => {
    const empty = await createProposal(userId, collectionId, buyerId);
    assert.equal(await markProposalHandedOut(userId, empty.proposalId), false);
    assert.equal(await status(empty.proposalId), "preparing");

    const { proposalId } = await proposalWith(["A"]);
    assert.equal(await markProposalHandedOut(userId, proposalId), true);
    assert.equal(await status(proposalId), "sent");
    assert.ok((await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })).sentAt);
    assert.equal(await markProposalHandedOut(userId, proposalId), false);

    const declined = await proposalWith(["B"]);
    await moveProposal(userId, declined.proposalId, "decline");
    assert.equal(await markProposalHandedOut(userId, declined.proposalId), false);
    assert.equal(await status(declined.proposalId), "declined");

    await assert.rejects(markProposalHandedOut(otherUserId, proposalId));
  });

  it("draws the document with each lot's number, title, price and photos, and the total, in the proposal's language", async () => {
    const { proposalId, proposalNo, offerIds } = await proposalWith(["Austria", "25.00"], ["Gone", "9.00"], ["Free"]);
    const photo = await generated(offerIds[0]);
    await generated(offerIds[1]);
    await setOfferState(userId, offerIds[1], "withdrawn");

    const document = (await readProposalDocument(userId, proposalId, collectionId))!;
    assert.equal(document.proposalNo, proposalNo);
    assert.equal(document.language, "pl");
    assert.equal(document.standing, "shown");
    assert.deepEqual(
      document.lots.map((l) => [l.lotNo, l.title, l.price, l.mark, l.photoIds.length]),
      [
        [1, "Austria", "25 zł", null, 1],
        [2, "Gone", "9 zł", "unavailable", 0],
        [3, "Free", null, null, 0],
      ]
    );
    assert.deepEqual(document.lots[0].photoIds, [photo]);
    assert.equal(document.total, "25 zł");
    assert.equal(document.unpriced, 1);
    // Nothing of the collection's ids leaves for the buyer.
    assert.doesNotMatch(JSON.stringify(document), new RegExp(offerIds.join("|")));

    assert.equal(await readProposalDocument(otherUserId, proposalId), null);
  });

  it("names the lots' photos by their lot numbers, and refuses an archive with none", async () => {
    const { proposalId, offerIds } = await proposalWith(["A"], ["B"]);
    const photo = await generated(offerIds[1]);
    const photos = await readProposalPhotos(userId, proposalId);
    assert.deepEqual(
      photos.map((l) => [l.lotNo, l.images.map((i) => i.photoId)]),
      [
        [1, []],
        [2, [photo]],
      ]
    );
    assert.match(photos[1].images[0].fileName, /^lot-02-/);

    const bare = await proposalWith(["C"]);
    await assert.rejects(buildProposalPhotoArchive(userId, bare.proposalId), /generate them first/);
    await assert.rejects(buildProposalPhotoArchive(otherUserId, proposalId), /not found/);
  });

  it("gives a link that opens the document, records the visit, follows the prices and closes with the proposal", async () => {
    const { proposalId, offerIds } = await proposalWith(["A", "10.00"]);
    const { token } = await createProposalShareToken(userId, proposalId);
    assert.match(token, /^stmpd_/);

    const access = (await verifyProposalShareToken(token))!;
    assert.equal(access.proposalId, proposalId);
    const state = await readProposalShareState(userId, proposalId);
    assert.ok(state.link?.lastUsedAt);
    assert.equal(state.standing, "shown");

    await prisma.offer.update({ where: { id: offerIds[0] }, data: { price: "12.00" } });
    const shared = await readSharedProposalDocument(access);
    assert.equal(shared.standing, "shown");
    assert.equal(shared.standing === "shown" && shared.document.total, "12 zł");

    await moveProposal(userId, proposalId, "decline");
    assert.deepEqual(await readSharedProposalDocument(access), { standing: "closed", proposalNo: (await getProposalScreen(userId, proposalId))!.proposalNo, language: "pl" });
    await assert.rejects(createProposalShareToken(userId, proposalId), /closed/);
  });

  it("ends the old address on a new link, every address on a withdrawal, and says closed once the proposal is gone", async () => {
    const { proposalId } = await proposalWith(["A"]);
    const first = await createProposalShareToken(userId, proposalId);
    const second = await createProposalShareToken(userId, proposalId);
    assert.equal(await verifyProposalShareToken(first.token), null);
    assert.ok(await verifyProposalShareToken(second.token));
    await revokeProposalShareToken(userId, proposalId);
    assert.equal(await verifyProposalShareToken(second.token), null);

    const third = await createProposalShareToken(userId, proposalId);
    await prisma.proposal.delete({ where: { id: proposalId } });
    const access = (await verifyProposalShareToken(third.token))!;
    assert.equal(access.proposalId, null);
    assert.deepEqual(await readSharedProposalDocument(access), { standing: "closed", proposalNo: null, language: "pl" });

    await assert.rejects(createProposalShareToken(otherUserId, (await proposalWith(["B"])).proposalId));
    assert.equal(await verifyProposalShareToken("stmpf_whatever"), null);
  });

  it("serves the proposal's lots' generated images and nothing else", async () => {
    const { proposalId, offerIds } = await proposalWith(["A"], ["B"]);
    const other = await proposalWith(["C"]);
    const { token } = await createProposalShareToken(userId, proposalId);
    const access = (await verifyProposalShareToken(token, { touch: false }))!;

    const lotImage = await generated(offerIds[0]);
    const withdrawnImage = await generated(offerIds[1]);
    const otherImage = await generated(other.offerIds[0]);
    const itemId = (await prisma.offerSetItem.findFirstOrThrow({ where: { offerSet: { offerId: offerIds[0] } } })).itemId;
    const copyScan = (
      await prisma.photo.create({
        data: { itemId, role: "front", storageKey: `proposal-handout-${Math.random()}.jpg`, mime: "image/jpeg", width: 10, height: 10, sizeBytes: 100 },
      })
    ).id;
    await setOfferState(userId, offerIds[1], "withdrawn");

    assert.equal(await canServeProposalSharePhoto(access, lotImage), true);
    assert.equal(await canServeProposalSharePhoto(access, withdrawnImage), false);
    assert.equal(await canServeProposalSharePhoto(access, otherImage), false);
    assert.equal(await canServeProposalSharePhoto(access, copyScan), false);

    // Nothing once the page shows only that the offer is closed.
    await moveProposal(userId, proposalId, "decline");
    assert.equal(await canServeProposalSharePhoto(access, lotImage), false);
  });
});
