import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, readPrepareOffers } from "../../src/lib/offers";
import { createFacebookPost } from "../../src/lib/facebook-posts";
import { getLotGroupSummary } from "../../src/lib/lot-group-summary";
import {
  addProposalLots,
  convertProposalToSale,
  createProposal,
  getDirectPlatform,
  moveProposal,
} from "../../src/lib/proposals";

// The summary of a proposal's or a post's lots (#2326), in every state: the lots' price tables summed —
// the Prepare rows' figures — withdrawn lots left out, and once lots have sold, what they brought in.

const ts = Date.now();

describe("A summary of a group's lots (#2326)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let areaId: string;
  let conditionId: string;
  let directId: string;
  let facebookId: string;
  let groupId: string;
  let nextStamp = 0;

  /** A fresh copy, costing `cost` when given. */
  async function copy(cost: string | null): Promise<string> {
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
    const id = (await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" }))
      .id;
    if (cost !== null) await prisma.item.update({ where: { id }, data: { costBasis: cost } });
    return id;
  }

  async function offer(platformId: string, price: string, cost: string | null): Promise<string> {
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
        ...(platformId === facebookId ? { facebookGroupId: groupId, listingType: "fixed" as const } : {}),
      },
      { seedItemIds: [await copy(cost)], seedPerCopy: true }
    );
  }

  before(async () => {
    userId = `test-user-lot-group-summary-${ts}`;
    otherUserId = `${userId}-other`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: "Test User", email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-lot-group-summary-${ts}`, name: "Lot summaries", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Germany" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    directId = (await getDirectPlatform(collectionId)).id;
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
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("sums a proposal's lots as their price tables show them, and says what the sold ones brought in", async () => {
    const contactId = (await prisma.contact.create({ data: { collectionId, name: "Jan Kowalski" } })).id;
    const { proposalId } = await createProposal(userId, collectionId, contactId);
    const lots = [await offer(directId, "10.00", "4.00"), await offer(directId, "20.00", "4.00"), await offer(directId, "30.00", null)];
    await addProposalLots(userId, proposalId, lots);

    const preparing = await getLotGroupSummary(userId, collectionId, { kind: "proposal", id: proposalId });
    assert.equal(preparing.baseCurrency, "EUR");
    assert.equal(preparing.asking.price, "60.00");
    assert.equal(preparing.asking.lotCount, 3);
    assert.equal(preparing.unpriced, 0);
    assert.equal(preparing.sets, 3);
    assert.equal(preparing.copies, 3);
    const cost = preparing.asking.columns.find((c) => c.key === "cost")!;
    assert.equal(cost.amount, "8.00");
    assert.equal(cost.lots, 2);
    // Profit over the two lots with both a price and a cost.
    assert.deepEqual(cost.margin, { amount: "22.00", percent: 275 });
    assert.equal(preparing.sold, null);

    // Every figure is the lots' Prepare rows' summed — the rows their price tables are drawn from.
    const rows = await readPrepareOffers(userId, collectionId, lots);
    for (const [key, field] of [
      ["catalogue", "catalogPrice"],
      ["estimated", "suggestedPrice"],
      ["cost", "costPrice"],
    ] as const) {
      const figures = rows.map((r) => r[field]).filter((v): v is string => v !== null);
      const column = preparing.asking.columns.find((c) => c.key === key)!;
      assert.equal(column.amount, figures.length === 0 ? null : figures.reduce((s, v) => s + Number(v), 0).toFixed(2), key);
    }

    // Sent, then sold: two lots taken — one haggled down — and the third withdrawn, so left out.
    await moveProposal(userId, proposalId, "send");
    await convertProposalToSale(userId, proposalId, {
      lots: [
        { offerId: lots[0]!, price: "10.00" },
        { offerId: lots[1]!, price: "15.00" },
      ],
      target: { newSale: true },
    });
    const sold = await getLotGroupSummary(userId, collectionId, { kind: "proposal", id: proposalId });
    assert.equal(sold.asking.lotCount, 2);
    assert.equal(sold.asking.price, "30.00");
    assert.deepEqual(sold.sold, {
      lots: 2,
      amount: "25.00",
      unconvertible: 0,
      cost: "8.00",
      costLots: 2,
      profit: { amount: "17.00", percent: 213 },
      profitLots: 2,
    });
  });

  it("sums a post's lots, a lot with no price yet counted apart", async () => {
    const lots = [await offer(facebookId, "12.00", "5.00"), await offer(facebookId, "0.00", "1.00")];
    const { postId } = await createFacebookPost(userId, collectionId, lots, "Two lots");
    const summary = await getLotGroupSummary(userId, collectionId, { kind: "post", id: postId });
    assert.equal(summary.asking.price, "12.00");
    assert.equal(summary.asking.priced, 1);
    assert.equal(summary.unpriced, 1);
    const cost = summary.asking.columns.find((c) => c.key === "cost")!;
    assert.equal(cost.amount, "6.00");
    assert.deepEqual(cost.margin, { amount: "7.00", percent: 140 });
  });

  it("is refused for a group outside the owner's collection", async () => {
    const contactId = (await prisma.contact.create({ data: { collectionId, name: "Anna Nowak" } })).id;
    const { proposalId } = await createProposal(userId, collectionId, contactId);
    await assert.rejects(
      getLotGroupSummary(otherUserId, collectionId, { kind: "proposal", id: proposalId }),
      /Proposal not found/
    );
    await assert.rejects(getLotGroupSummary(userId, collectionId, { kind: "post", id: "no-such-post" }), /Post not found/);
  });
});
