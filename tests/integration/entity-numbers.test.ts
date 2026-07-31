import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createIssue, deleteIssue } from "../../src/lib/issues";
import { createPurchase, deletePurchase } from "../../src/lib/purchases";
import { createSale, deleteSale } from "../../src/lib/sales";
import { createAuctionSale, createAuctionLot, deleteAuctionLot } from "../../src/lib/auctions";
import { resolveQuickJump } from "../../src/lib/quick-jump-server";
import { parseQuickJump } from "../../src/lib/quick-jump";

// The short per-collection numbers for the remaining major entities (#432) and the quick-jump box
// that consumes them (#431).
//
// The rules under test are the copy number's (#268), because they are the reason the numbers exist:
// allocated from a counter and never `max + 1`, so a deleted row retires its number; counted per
// collection, so two collections both start at 1. And a jump is scoped: a number is meaningless
// outside the collection that handed it out, so resolving one for a stranger must find nothing.

describe("entity short numbers + quick jump (#431/#432)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let collectionSlug: string;
  let otherCollectionId: string;
  let areaId: string;
  let platformId: string;
  let sellerId: string;
  let auctionSaleId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-entityno-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User entityno-${ts}`,
        email: `test-entityno-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    strangerId = `test-user-entityno-stranger-${ts}`;
    await prisma.user.create({
      data: {
        id: strangerId,
        name: `Stranger entityno-${ts}`,
        email: `test-entityno-stranger-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    collectionSlug = `col-entityno-${ts}`;
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: collectionSlug,
          name: `Collection entityno-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-entityno-other-${ts}`,
          name: `Other entityno-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;

    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: `EntityNoMarket-${ts}`,
          platform: true,
          platformCurrency: "EUR",
          seller: true,
        },
      })
    ).id;
    sellerId = platformId;

    auctionSaleId = await createAuctionSale(userId, collectionId, {
      sellerId,
      platformId,
      name: "Köhler 385",
      url: null,
      endsAt: null,
      currency: "EUR",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  // ── allocation ────────────────────────────────────────────────────────────

  async function newIssue(): Promise<{ id: string; no: number }> {
    const { id } = await createIssue(userId, collectionId, areaId, { name: "An issue" });
    const row = await prisma.issue.findUniqueOrThrow({ where: { id }, select: { issueNo: true } });
    return { id, no: row.issueNo };
  }

  async function newPurchase(): Promise<{ id: string; no: number }> {
    const created = await createPurchase(userId, collectionId, {
      purchasedAt: "2026-01-15",
      currency: "EUR",
    });
    const row = await prisma.purchase.findUniqueOrThrow({
      where: { id: created.id },
      select: { purchaseNo: true },
    });
    return { id: created.id, no: row.purchaseNo };
  }

  async function newSale(): Promise<{ id: string; no: number }> {
    const id = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-01-20"),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    const row = await prisma.sale.findUniqueOrThrow({ where: { id }, select: { saleNo: true } });
    return { id, no: row.saleNo };
  }

  async function newLot(): Promise<{ id: string; no: number }> {
    const id = await createAuctionLot(userId, collectionId, {
      auctionSaleId,
      lotNo: null,
      url: null,
      title: "A lot",
      endsAt: new Date(Date.now() + 3_600_000),
      startingPrice: null,
      currentBid: null,
      myBid: null,
      maxBid: null,
      notes: null,
    });
    const row = await prisma.auctionLot.findUniqueOrThrow({
      where: { id },
      select: { auctionLotNo: true },
    });
    return { id, no: row.auctionLotNo };
  }

  it("hands out consecutive numbers within a collection, per entity", async () => {
    for (const make of [newIssue, newPurchase, newSale, newLot]) {
      const first = await make();
      const second = await make();
      assert.equal(second.no, first.no + 1, `${make.name} numbers must be consecutive`);
    }
  });

  it("counts each entity separately — an issue does not move the purchase counter", async () => {
    const before = await prisma.collection.findUniqueOrThrow({
      where: { id: collectionId },
      select: { nextPurchaseNo: true },
    });
    await newIssue();
    const after = await prisma.collection.findUniqueOrThrow({
      where: { id: collectionId },
      select: { nextPurchaseNo: true },
    });
    assert.equal(after.nextPurchaseNo, before.nextPurchaseNo);
  });

  it("does not reuse the number of a deleted row", async () => {
    const doomedIssue = await newIssue();
    await deleteIssue(userId, collectionId, doomedIssue.id);
    assert.ok((await newIssue()).no > doomedIssue.no);

    const doomedPurchase = await newPurchase();
    await deletePurchase(userId, doomedPurchase.id);
    assert.ok((await newPurchase()).no > doomedPurchase.no);

    const doomedSale = await newSale();
    await deleteSale(userId, doomedSale.id);
    assert.ok((await newSale()).no > doomedSale.no);

    const doomedLot = await newLot();
    await deleteAuctionLot(userId, doomedLot.id);
    assert.ok((await newLot()).no > doomedLot.no);
  });

  it("counts per collection — a sibling collection's counters are untouched", async () => {
    const other = await prisma.collection.findUniqueOrThrow({
      where: { id: otherCollectionId },
      select: {
        nextIssueNo: true,
        nextPurchaseNo: true,
        nextSaleNo: true,
        nextAuctionLotNo: true,
      },
    });
    assert.deepEqual(other, {
      nextIssueNo: 1,
      nextPurchaseNo: 1,
      nextSaleNo: 1,
      nextAuctionLotNo: 1,
    });
  });

  // ── quick jump ────────────────────────────────────────────────────────────

  async function jump(typed: string): Promise<string | null> {
    const target = parseQuickJump(typed);
    assert.ok(target, `"${typed}" should parse as a jump`);
    const result = await resolveQuickJump(userId, collectionId, target);
    return result?.href ?? null;
  }

  it("resolves each prefix to the screen that shows the entity", async () => {
    const issue = await newIssue();
    assert.equal(
      await jump(`iss ${issue.no}`),
      `/c/${collectionSlug}/issues?search=${encodeURIComponent(`#${issue.no}`)}`
    );

    const purchase = await newPurchase();
    assert.equal(await jump(`p ${purchase.no}`), `/c/${collectionSlug}/purchases/${purchase.id}`);

    const sale = await newSale();
    assert.equal(await jump(`s ${sale.no}`), `/c/${collectionSlug}/sales/${sale.id}`);

    // A lot is read in the company of its parcel, highlighted there (#374).
    const lot = await newLot();
    assert.equal(
      await jump(`lot ${lot.no}`),
      `/c/${collectionSlug}/auctions/sales/${auctionSaleId}?lot=${lot.id}`
    );
  });

  it("sends an offer to its short address, the same one a marketplace note carries (#416)", async () => {
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Jump Stamp" } });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    const { createItem } = await import("../../src/lib/items");
    const { createOffer } = await import("../../src/lib/offers");
    const item = await createItem(userId, collectionId, {
      stampId: stamp.id,
      conditionId: condition.id,
      forSale: true,
    });
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId,
        url: null,
        price: "5.00",
        currency: "EUR",
        listingDate: null,
        state: "preparing",
      },
      { seedItemIds: [item.id] }
    );
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { offerNo: true },
    });
    assert.equal(await jump(`o ${offer.offerNo}`), `/o/${collectionSlug}/${offer.offerNo}`);

    // …and the copy lands on its own list, filtered to the number the row shows.
    const copy = await prisma.item.findUniqueOrThrow({
      where: { id: item.id },
      select: { itemNo: true },
    });
    assert.equal(
      await jump(`i ${copy.itemNo}`),
      `/c/${collectionSlug}/inventory?search=${encodeURIComponent(`#${copy.itemNo}`)}`
    );
  });

  it("finds nothing for a number this collection has not handed out", async () => {
    const target = parseQuickJump("p 999999");
    assert.ok(target);
    assert.equal(await resolveQuickJump(userId, collectionId, target), null);
  });

  it("refuses to resolve for anyone but the collection's owner", async () => {
    const purchase = await newPurchase();
    const target = parseQuickJump(`p ${purchase.no}`);
    assert.ok(target);
    assert.equal(await resolveQuickJump(strangerId, collectionId, target), null);
  });
});
