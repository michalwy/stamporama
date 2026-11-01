import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, listComposableCopies } from "../../src/lib/offers";
import {
  createProposal,
  getDirectPlatform,
  getProposalLotsPrepare,
  getProposalScreen,
  makeProposalLots,
  moveProposal,
} from "../../src/lib/proposals";

// *New lots…* on a proposal (#2299): copies picked on the proposal's screen become new Direct offers
// that are its lots — an offer each, or one offer of them all — made as Generate offers makes them and
// priced at their estimate where there is one. Only the copies on no open Direct offer are offered, and
// only an open proposal takes them. Each case picks copies of its own, so the cases never meet.

const ts = Date.now();

describe("a proposal's new lots (#2299)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let conditionId: string;
  let editionId: string;
  let directId: string;
  let colnectId: string;
  let buyerId: string;
  let nextStamp = 0;

  /** A for-sale copy in hand, of a stamp of its own, catalogued at `catalogue` when given. */
  async function copy(catalogue: string | null = "30.00"): Promise<string> {
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
    if (catalogue) {
      await prisma.stampCatalogPrice.create({
        data: { stampId, catalogEditionId: editionId, conditionId, certificateStatusId: null, price: catalogue, currency: "EUR" },
      });
    }
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" })).id;
  }

  async function lots(proposalId: string) {
    return prisma.offer.findMany({
      where: { proposalId },
      orderBy: { proposalLotNo: "asc" },
      select: {
        id: true,
        proposalLotNo: true,
        platformId: true,
        state: true,
        price: true,
        sets: { select: { items: { select: { itemId: true } } } },
      },
    });
  }

  before(async () => {
    userId = `test-user-proposal-new-lots-${ts}`;
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
        data: { slug: `col-proposal-new-lots-${ts}`, name: "New lots", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    editionId = (await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })).id;
    areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Germany", primaryCatalogNameId: catalogName.id } })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    colnectId = (await prisma.platform.create({ data: { collectionId, name: "Colnect", platformCurrency: "EUR" } })).id;
    directId = (await getDirectPlatform(collectionId)).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Jan Kowalski", buyer: true } })).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("makes an offer of each copy picked, Direct lots in order, priced at their estimate", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const [a, b] = [await copy(), await copy("20.00")];
    const result = await makeProposalLots(userId, proposalId, [a, b], "each");
    assert.deepEqual(result, { lots: 2, unpriced: 0 });

    const made = await lots(proposalId);
    assert.deepEqual(
      made.map((lot) => ({ lotNo: lot.proposalLotNo, platformId: lot.platformId, state: lot.state, sets: lot.sets.map((s) => s.items.map((i) => i.itemId)) })),
      [
        { lotNo: 1, platformId: directId, state: "preparing", sets: [[a]] },
        { lotNo: 2, platformId: directId, state: "preparing", sets: [[b]] },
      ]
    );
    const prepare = await getProposalLotsPrepare(userId, collectionId, proposalId);
    for (const lot of made) {
      assert.ok(Number(lot.price) > 0);
      assert.equal(lot.price.toFixed(2), prepare[lot.id]?.suggestedPrice);
    }
  });

  it("makes one offer of one set holding every copy picked, as the next lot", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    await makeProposalLots(userId, proposalId, [await copy()], "each");
    const [a, b, c] = [await copy(), await copy(), await copy()];
    assert.deepEqual(await makeProposalLots(userId, proposalId, [a, b, c], "together"), { lots: 1, unpriced: 0 });

    const made = await lots(proposalId);
    assert.equal(made.length, 2);
    assert.equal(made[1]!.proposalLotNo, 2);
    assert.deepEqual(
      made[1]!.sets.map((s) => s.items.map((i) => i.itemId).sort()),
      [[a, b, c].sort()]
    );
    const screen = await getProposalScreen(userId, proposalId);
    assert.deepEqual(screen?.lots.map((lot) => lot.lotNo), [1, 2]);
  });

  it("leaves a lot with nothing to estimate unpriced, and says so", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const result = await makeProposalLots(userId, proposalId, [await copy(null), await copy()], "each");
    assert.deepEqual(result, { lots: 2, unpriced: 1 });
    assert.deepEqual(
      (await lots(proposalId)).map((lot) => Number(lot.price) > 0),
      [false, true]
    );
  });

  it("offers only copies on no open Direct offer, and refuses one put on such an offer since, making nothing", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const [free, onColnect, onDirect] = [await copy(), await copy(), await copy()];
    const offer = (platformId: string, itemId: string) =>
      createOffer(
        userId,
        collectionId,
        { platformId, url: null, price: "5.00", startingPrice: null, currency: "EUR", listingDate: null },
        { seedItemIds: [itemId] }
      );
    await offer(colnectId, onColnect);
    await offer(directId, onDirect);

    const listed = new Set(
      (await listComposableCopies(userId, collectionId, { notOfferedPlatformId: directId })).map((item) => item.id)
    );
    assert.ok(listed.has(free));
    assert.ok(listed.has(onColnect), "a copy listed elsewhere can still be a lot");
    assert.ok(!listed.has(onDirect));

    await assert.rejects(makeProposalLots(userId, proposalId, [free, onDirect], "each"), /has sold or gone onto another Direct offer/);
    assert.equal((await lots(proposalId)).length, 0);
    assert.equal(await prisma.offerSetItem.count({ where: { itemId: free } }), 0);
  });

  it("makes no lot on a closed proposal, of no copy, or for another owner", async () => {
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const a = await copy();
    await assert.rejects(makeProposalLots(userId, proposalId, [], "each"), /Pick at least one copy/);
    await assert.rejects(makeProposalLots("someone-else", proposalId, [a], "each"));
    await moveProposal(userId, proposalId, "decline");
    await assert.rejects(makeProposalLots(userId, proposalId, [a], "each"), /declined/);
    assert.equal(await prisma.offerSetItem.count({ where: { itemId: a } }), 0);
  });
});
