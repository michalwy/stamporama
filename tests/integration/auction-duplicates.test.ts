import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  auctionLotFilterCounts,
  createAuctionLot,
  createAuctionLotLine,
  createAuctionSale,
  listAtRiskLotLines,
  listAuctionLots,
} from "../../src/lib/auctions";
import { getActionItems, type ActionItemGroupId } from "../../src/lib/action-items";

// The duplicate warning against a real database (#369).
//
// The pure rules are pinned in `tests/unit/auction-duplicates.test.ts`; what earns a database here
// is everything those rules are *fed*: which lots count as being won (the `leading` / `won-pending`
// arithmetic, over two tables), and the variant family resolved by walking `parentId` — neither of
// which a unit test can stand in for.

describe("auction duplicate warning (#369)", () => {
  let userId: string;
  let collectionId: string;
  let saleId: string;
  let mnhId: string;
  let usedId: string;
  let plainStampId: string;
  let umbrellaStampId: string;
  let variantStampId: string;
  let otherStampId: string;

  const hourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);
  const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

  /** A lot with the figures that decide its signal, plus one line saying what it holds. */
  async function lotHolding(
    stampId: string,
    conditionId: string,
    bids: { currentBid: string | null; myBid: string | null; endsAt?: Date },
    formatId: string | null = null
  ): Promise<string> {
    const lotId = await createAuctionLot(userId, collectionId, {
      auctionSaleId: saleId,
      lotNo: null,
      url: null,
      title: null,
      endsAt: bids.endsAt ?? hourFromNow(),
      startingPrice: null,
      currentBid: bids.currentBid,
      myBid: bids.myBid,
      maxBid: null,
      notes: null,
    });
    await createAuctionLotLine(userId, lotId, {
      stampId,
      conditionId,
      certificateStatusId: null,
      formatId,
      quantity: 1,
    });
    return lotId;
  }

  /** Every lot the duplicate filter admits, as a set — order is the list's business, not this. */
  async function duplicates(): Promise<Set<string>> {
    const page = await listAuctionLots(userId, collectionId, { duplicate: true });
    return new Set(page.items.map((i) => i.id));
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-aucdup-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User aucdup-${ts}`,
        email: `test-aucdup-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-aucdup-${ts}`,
        name: `Collection aucdup-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;
    const areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })
    ).id;
    const variantSubtype = await prisma.stampSubtype.create({
      data: { collectionId, name: "Variant", actsAsVariant: true, isDefault: true, sortOrder: 0 },
    });

    async function stamp(name: string, parentId?: string, subtypeId?: string): Promise<string> {
      const s = await prisma.stamp.create({ data: { collectionId, name, parentId, subtypeId } });
      await prisma.stampCollectionArea.create({
        data: { stampId: s.id, collectionAreaId: areaId, isPrimary: true },
      });
      return s.id;
    }

    plainStampId = await stamp("Plain");
    otherStampId = await stamp("Other");
    umbrellaStampId = await stamp("Umbrella");
    variantStampId = await stamp("Umbrella II", umbrellaStampId, variantSubtype.id);

    const sellerId = (
      await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })
    ).id;
    const platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
    saleId = await createAuctionSale(userId, collectionId, {
      sellerId,
      platformId,
      name: "Parcel",
      url: null,
      endsAt: null,
      currency: "EUR",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
  });

  after(async () => {
    // Sales first: `AuctionLotLine.stampId` is `Restrict`, so dropping the collection would race its
    // own cascades. Deleting the sales takes the lots and their lines and leaves nothing pointing at
    // a stamp.
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("only reads lots that are being won", async () => {
    // Leading: my bid still covers the price.
    await lotHolding(plainStampId, mnhId, { currentBid: "40.00", myBid: "60.00" });
    // Outbid, and watched without a bid: neither costs anything to bid on again, and neither is
    // therefore anybody's duplicate.
    await lotHolding(plainStampId, mnhId, { currentBid: "80.00", myBid: "60.00" });
    await lotHolding(plainStampId, mnhId, { currentBid: "10.00", myBid: null });

    const lines = await listAtRiskLotLines(userId, collectionId);
    assert.equal(lines.length, 1, "only the leading lot is in play");
    assert.equal(lines[0].stampId, plainStampId);
    // The label falls back to the stamp's name when it carries no catalog number.
    assert.equal(lines[0].stampLabel, "Plain");

    // …and one lot alone collides with nothing.
    assert.deepEqual([...(await duplicates())], []);
  });

  it("reports both sides once a second winning lot holds the same stamp", async () => {
    const second = await lotHolding(plainStampId, mnhId, { currentBid: "30.00", myBid: "45.00" });
    const found = await duplicates();
    assert.equal(found.size, 2, "the lot that was already leading, and the new one");
    assert.ok(found.has(second));

    const counts = await auctionLotFilterCounts(userId, collectionId);
    assert.equal(counts.duplicate, 2, "the chip's badge is the same set");
  });

  it("counts a lot that closed with me ahead but is not confirmed yet", async () => {
    // `won-pending`: past its close, still open, my bid was in front.
    const pending = await lotHolding(plainStampId, mnhId, {
      currentBid: "20.00",
      myBid: "50.00",
      endsAt: hourAgo(),
    });
    const found = await duplicates();
    assert.equal(found.size, 3);
    assert.ok(found.has(pending), "an unconfirmed win is still a stamp on its way to me");
  });

  it("collides an unknown-variant umbrella with one of its variants", async () => {
    const umbrella = await lotHolding(umbrellaStampId, mnhId, {
      currentBid: "10.00",
      myBid: "20.00",
    });
    const variant = await lotHolding(variantStampId, mnhId, {
      currentBid: "10.00",
      myBid: "20.00",
    });
    const found = await duplicates();
    assert.ok(found.has(umbrella) && found.has(variant), "two ways of tracking one stamp");
  });

  it("leaves a different condition and an unrelated stamp out", async () => {
    const before = await duplicates();
    // Same stamp, other condition — a remark in the dialog, never the standing chip.
    await lotHolding(plainStampId, usedId, { currentBid: "10.00", myBid: "20.00" });
    // A stamp nothing else holds.
    await lotHolding(otherStampId, mnhId, { currentBid: "10.00", myBid: "20.00" });
    assert.deepEqual(await duplicates(), before, "neither lot joins the set");
  });

  it("reports the set to the notification centre, linked at the chip that holds it", async () => {
    const result = await getActionItems(userId, collectionId);
    const group = result.groups.find(
      (g) => g.id === ("auction-duplicate" satisfies ActionItemGroupId)
    );
    assert.ok(group, "the duplicate group is reported");
    assert.equal(group.count, (await duplicates()).size, "the panel and the list agree");
    assert.equal(group.severity, "warning", "money at stake, but the bid can still be pulled");
    assert.equal(group.href, "auctions?duplicate=1");
    for (const item of group.items) {
      assert.ok(item.href.includes(`?lot=${item.key}`), "each row opens its own lot");
    }
  });
});
