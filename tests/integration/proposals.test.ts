import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { commitOfferGeneration, previewOfferGeneration, type GeneratorInput } from "../../src/lib/offer-generator";
import { getContactPage } from "../../src/lib/contact-page";
import { deleteContact, mergeContacts } from "../../src/lib/contacts";
import {
  addProposalLots,
  createProposal,
  findProposalId,
  getDirectPlatform,
  getProposalLotsPrepare,
  getProposalScreen,
  listOpenProposals,
  listProposalLotCandidates,
  listProposalsPaginated,
  moveProposal,
  removeProposalLot,
} from "../../src/lib/proposals";

// Proposals (#2287; ADR-0075): an offer prepared for one contact, its lots ordinary offers on the
// collection's Direct platform. Made for a contact, given lots — existing Direct offers, or new ones
// generated from ticked copies — priced through the offers, moved Preparing → Sent, and declined,
// which withdraws its open lots. Each case makes copies of its own, so the cases never meet.

const ts = Date.now();

describe("Proposals (#2287)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let areaId: string;
  let conditionId: string;
  let directId: string;
  let colnectId: string;
  let buyerId: string;
  let otherBuyerId: string;
  let nextStamp = 0;

  /** A for-sale copy in hand, of a stamp of its own. */
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

  /** An offer of one fresh copy on `platformId`, at `price`. */
  async function offer(platformId: string, price = "0.00"): Promise<string> {
    return createOffer(
      userId,
      collectionId,
      {
        platformId,
        url: null,
        price,
        startingPrice: null,
        currency: "EUR",
        listingDate: null,
        state: "preparing",
      },
      { seedItemIds: [await copy()] }
    );
  }

  before(async () => {
    userId = `test-user-proposals-${ts}`;
    otherUserId = `test-user-proposals-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-proposals-${ts}`, name: "Proposals", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-proposals-other-${ts}`, name: "Someone else's", baseCurrency: "EUR", ownerId: otherUserId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Germany" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    colnectId = (await prisma.platform.create({ data: { collectionId, name: "Colnect", platformCurrency: "EUR" } })).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Jan Kowalski", buyer: true } })).id;
    otherBuyerId = (await prisma.contact.create({ data: { collectionId, name: "Anna Nowak", buyer: true } })).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("makes the Direct platform when a collection has none — switched on, in its currency, at a fixed price", async () => {
    const direct = await prisma.platform.findFirstOrThrow({
      where: { id: (await getDirectPlatform(collectionId)).id },
      select: { name: true, platformModule: true, enabled: true, platformCurrency: true, defaultListingType: true },
    });
    assert.deepEqual(direct, {
      name: "Direct",
      platformModule: "direct",
      enabled: true,
      platformCurrency: "EUR",
      defaultListingType: "fixed",
    });
    directId = (await getDirectPlatform(collectionId)).id;
  });

  it("makes a proposal for a contact of the collection, numbered and being prepared", async () => {
    const first = await createProposal(userId, collectionId, buyerId);
    const second = await createProposal(userId, collectionId, buyerId);
    assert.equal(second.proposalNo, first.proposalNo + 1);
    assert.equal(await findProposalId(userId, collectionId, first.proposalNo), first.proposalId);
    const screen = await getProposalScreen(userId, first.proposalId);
    assert.equal(screen?.status, "preparing");
    assert.deepEqual(screen?.contact, { id: buyerId, name: "Jan Kowalski" });
    assert.deepEqual(screen?.lots, []);
    assert.equal(screen?.platform.id, directId);
  });

  it("refuses a contact of another collection, and another owner", async () => {
    const stranger = (await prisma.contact.create({ data: { collectionId: otherCollectionId, name: "Stranger" } })).id;
    await assert.rejects(createProposal(userId, collectionId, stranger), /not in this collection/);
    await assert.rejects(createProposal(otherUserId, collectionId, buyerId), /Collection not found/);
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    await assert.rejects(addProposalLots(otherUserId, proposalId, [await offer(directId)]), /Collection not found/);
  });

  it("takes open Direct offers in no proposal as its lots, and prices and totals them", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const a = await offer(directId, "12.50");
    const b = await offer(directId);
    const candidates = (await listProposalLotCandidates(userId, proposalId)).map((c) => c.offerId);
    assert.ok(candidates.includes(a) && candidates.includes(b));
    await addProposalLots(userId, proposalId, [a, b]);
    assert.equal((await listProposalLotCandidates(userId, proposalId)).some((c) => c.offerId === a), false);

    const screen = (await getProposalScreen(userId, proposalId))!;
    assert.deepEqual(
      screen.lots.map((l) => [l.offerId, l.price]),
      [
        [a, "12.50"],
        [b, null],
      ]
    );
    assert.equal(screen.total, "12.50");
    assert.equal(screen.unpriced, 1);
    // The lots are priced as a post's are, through their Prepare rows.
    const prepare = await getProposalLotsPrepare(userId, collectionId, proposalId);
    assert.deepEqual(Object.keys(prepare).sort(), [a, b].sort());
  });

  it("refuses an offer elsewhere, closed, or in another proposal, and adds none of a refused batch", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const { proposalId: other } = await createProposal(userId, collectionId, otherBuyerId);
    const fine = await offer(directId);
    const onColnect = await offer(colnectId);
    await assert.rejects(addProposalLots(userId, proposalId, [fine, onColnect]), /not on the Direct platform/);
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: fine } })).proposalId, null);

    const withdrawn = await offer(directId);
    await setOfferState(userId, withdrawn, "withdrawn");
    await assert.rejects(addProposalLots(userId, proposalId, [withdrawn]), /withdrawn/);

    const taken = await offer(directId);
    await addProposalLots(userId, other, [taken]);
    await assert.rejects(addProposalLots(userId, proposalId, [taken]), /another proposal/);
  });

  it("takes a lot out, leaving an ordinary Direct offer", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const lot = await offer(directId);
    await addProposalLots(userId, proposalId, [lot]);
    await removeProposalLot(userId, proposalId, lot);
    const row = await prisma.offer.findUniqueOrThrow({ where: { id: lot }, select: { proposalId: true, state: true } });
    assert.deepEqual(row, { proposalId: null, state: "preparing" });
    await assert.rejects(removeProposalLot(userId, proposalId, lot), /not a lot of this proposal/);
  });

  it("is marked sent once it has a lot, prices still editable", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    await assert.rejects(moveProposal(userId, proposalId, "send"), /at least one lot/);
    const lot = await offer(directId, "5.00");
    await addProposalLots(userId, proposalId, [lot]);
    await moveProposal(userId, proposalId, "send");
    const screen = (await getProposalScreen(userId, proposalId))!;
    assert.equal(screen.status, "sent");
    assert.ok(screen.sentOn);
    await assert.rejects(moveProposal(userId, proposalId, "send"), /already been sent/);
    // Still open: its lots still have their Prepare rows, and still take more.
    assert.ok((await getProposalLotsPrepare(userId, collectionId, proposalId))[lot]);
    await addProposalLots(userId, proposalId, [await offer(directId)]);
  });

  it("declined, withdraws its open lots, keeps the closed ones, and changes no more", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const open = await offer(directId, "3.00");
    const ready = await offer(directId, "4.00");
    const already = await offer(directId);
    await addProposalLots(userId, proposalId, [open, ready, already]);
    await setOfferState(userId, ready, "ready");
    await setOfferState(userId, already, "withdrawn");
    await moveProposal(userId, proposalId, "decline");

    const states = await prisma.offer.findMany({ where: { proposalId }, select: { id: true, state: true } });
    assert.deepEqual(states.map((s) => s.state).sort(), ["withdrawn", "withdrawn", "withdrawn"]);
    const screen = (await getProposalScreen(userId, proposalId))!;
    assert.equal(screen.status, "declined");
    assert.ok(screen.closedOn);
    // Withdrawn lots count for nothing.
    assert.equal(screen.total, "0.00");
    assert.deepEqual(await getProposalLotsPrepare(userId, collectionId, proposalId), {});
    await assert.rejects(moveProposal(userId, proposalId, "send"), /declined/);
    await assert.rejects(addProposalLots(userId, proposalId, [await offer(directId)]), /declined/);
    await assert.rejects(removeProposalLot(userId, proposalId, open), /declined/);
  });

  it("lists every proposal newest first, narrowed by status, and the open ones for the generator", async () => {
    const { proposalId, proposalNo } = await createProposal(userId, collectionId, otherBuyerId);
    const { items } = await listProposalsPaginated(userId, collectionId);
    assert.equal(items[0]!.proposalId, proposalId);
    assert.deepEqual(items[0]!.contact, { id: otherBuyerId, name: "Anna Nowak" });
    assert.ok(items.every((p, i) => i === 0 || p.proposalNo < items[i - 1]!.proposalNo));
    const declined = await listProposalsPaginated(userId, collectionId, { statuses: ["declined"] });
    assert.ok(declined.items.length > 0 && declined.items.every((p) => p.status === "declined"));
    const open = await listOpenProposals(userId, collectionId);
    assert.ok(open.some((p) => p.proposalNo === proposalNo && p.contactName === "Anna Nowak"));
    assert.ok(open.every((p) => p.status === "preparing" || p.status === "sent"));
  });

  it("puts the offers a pass generates on Direct into the proposal picked", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const copies = [await copy(), await copy()];
    const input: GeneratorInput = {
      platformId: directId,
      state: "preparing",
      mode: "singles",
      packaging: "multi",
      itemIds: copies,
      filters: {},
      targets: {},
      skip: [],
      facebook: { facebookGroupId: null, endsAt: null },
    };
    const preview = await previewOfferGeneration(userId, collectionId, input);
    const result = await commitOfferGeneration(userId, collectionId, { ...input, proposalId }, preview.fingerprint);
    assert.equal(result.createdOffers, 2);
    const lots = await prisma.offer.findMany({ where: { proposalId }, select: { platformId: true } });
    assert.equal(lots.length, 2);
    assert.ok(lots.every((l) => l.platformId === directId));
  });

  it("refuses a proposal for offers generated off Direct, or into a closed proposal, writing nothing", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const colnectInput: GeneratorInput = {
      platformId: colnectId,
      state: "preparing",
      mode: "singles",
      packaging: "separate",
      itemIds: [await copy()],
      filters: {},
      targets: {},
      skip: [],
      facebook: { facebookGroupId: null, endsAt: null },
    };
    const colnectPreview = await previewOfferGeneration(userId, collectionId, colnectInput);
    await assert.rejects(
      commitOfferGeneration(userId, collectionId, { ...colnectInput, proposalId }, colnectPreview.fingerprint),
      /Only offers on the Direct platform/
    );

    await addProposalLots(userId, proposalId, [await offer(directId)]);
    await moveProposal(userId, proposalId, "decline");
    const item = await copy();
    const directInput: GeneratorInput = { ...colnectInput, platformId: directId, itemIds: [item] };
    const preview = await previewOfferGeneration(userId, collectionId, directInput);
    await assert.rejects(
      commitOfferGeneration(userId, collectionId, { ...directInput, proposalId }, preview.fingerprint),
      /declined/
    );
    assert.equal(
      await prisma.offer.count({ where: { collectionId, sets: { some: { items: { some: { itemId: item } } } } } }),
      0
    );
  });

  it("is listed on its contact's page, moves with a merged contact, and goes with a deleted one", async () => {
    const page = await getContactPage(userId, otherBuyerId, "all", "2026-11-01");
    assert.ok(page?.proposals && page.proposals.length > 0);
    assert.ok(page.proposals.every((p) => p.contact.id === otherBuyerId));

    const twin = (await prisma.contact.create({ data: { collectionId, name: "Anna N." } })).id;
    const { proposalId } = await createProposal(userId, collectionId, twin);
    await mergeContacts(userId, { remainingContactId: otherBuyerId, otherContactId: twin });
    assert.equal((await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })).contactId, otherBuyerId);

    const leaving = (await prisma.contact.create({ data: { collectionId, name: "Leaving" } })).id;
    const gone = await createProposal(userId, collectionId, leaving);
    const lot = await offer(directId);
    await addProposalLots(userId, gone.proposalId, [lot]);
    await deleteContact(userId, leaving);
    assert.equal(await prisma.proposal.findUnique({ where: { id: gone.proposalId } }), null);
    // The offer made for them stays, out of the proposal.
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: lot } })).proposalId, null);
  });
});
