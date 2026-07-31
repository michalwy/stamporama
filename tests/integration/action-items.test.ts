import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getActionItems, SEVERITY_ORDER, type ActionItemGroupId } from "../../src/lib/action-items";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  listOffersPaginated,
  offersNeedingAction,
  setOfferInActiveBidding,
  setOfferState,
} from "../../src/lib/offers";
import { addSaleLines, createSale } from "../../src/lib/sales";
import {
  createAuctionLot,
  createAuctionSale,
  recordAuctionLotTransition,
} from "../../src/lib/auctions";

// The notification centre's aggregation (#367). What earns a real database here is that every group
// is a *read of an existing derivation*, so the things worth asserting are the ones a unit test
// cannot reach: that the needs-action flag really does split into its two reasons (#167 vs #215),
// that the two auction windows come off the same clock the lots screen filters on, and that a lot
// whose outcome has been recorded stops being reported.

describe("action items notification centre (#367)", () => {
  let userId: string;
  let collectionId: string;
  let delcampeId: string;
  let allegroId: string;
  let sellerId: string;
  let auctionSaleId: string;
  let offerBid: string;
  let offerTwin: string;
  let offerSold: string;
  let offerOrphaned: string;

  const inHours = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

  /** The groups by id, so an assertion names the source rather than a position. */
  async function groups(): Promise<
    Record<string, { count: number; items: { key: string }[]; href: string; severity: string }>
  > {
    const result = await getActionItems(userId, collectionId);
    // The badge is the rows under it, added up — an offer flagged twice is two things to deal with.
    assert.equal(
      result.total,
      result.groups.reduce((sum, g) => sum + g.count, 0),
      "the total is the groups' counts"
    );
    // Worst first, and the badge graded by the worst — never by the count.
    const ranks = result.groups.map((g) => SEVERITY_ORDER.indexOf(g.severity));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "groups read most severe first");
    assert.equal(result.severity, result.groups[0]?.severity ?? null);
    return Object.fromEntries(result.groups.map((g) => [g.id, g]));
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-actions-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User actions-${ts}`,
        email: `test-actions-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-actions-${ts}`,
        name: `Collection actions-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp A" } });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    delcampeId = (await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })).id;
    allegroId = (await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })).id;
    sellerId = (await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } })).id;

    const mk = async () =>
      (await createItem(userId, collectionId, { stampId: stamp.id, conditionId: condition.id, forSale: true })).id;
    const shared = await mk();
    const selling = await mk();

    const newOffer = (platformId: string, price: string) =>
      createOffer(userId, collectionId, {
        platformId,
        url: null,
        price,
        currency: "EUR",
        listingDate: null,
        state: "preparing",
      });

    // One copy on two platforms: the pair the bidding conflict is derived from.
    offerBid = await newOffer(delcampeId, "5.00");
    await addOfferSet(userId, offerBid, [shared]);
    offerTwin = await newOffer(allegroId, "6.00");
    await addOfferSet(userId, offerTwin, [shared]);

    // A second copy on two platforms, one of which is about to sell it.
    offerSold = await newOffer(delcampeId, "7.00");
    const soldSet = await addOfferSet(userId, offerSold, [selling]);
    offerOrphaned = await newOffer(allegroId, "8.00");
    await addOfferSet(userId, offerOrphaned, [selling]);

    for (const id of [offerBid, offerTwin, offerSold, offerOrphaned]) {
      await setOfferState(userId, id, "ready");
      await setOfferState(userId, id, "active");
    }

    const saleId = await createSale(userId, collectionId, {
      platformId: delcampeId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    await addSaleLines(userId, saleId, [
      { offerId: offerSold, offerSetId: soldSet, price: "7.00", itemIds: [selling] },
    ]);

    auctionSaleId = await createAuctionSale(userId, collectionId, {
      sellerId,
      platformId: allegroId,
      name: null,
      url: null,
      endsAt: null,
      currency: "EUR",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("reports the sold-elsewhere offer, and not the offer that did the selling", async () => {
    const byId = await groups();
    const sold = byId["offer-sold-elsewhere" satisfies ActionItemGroupId];
    assert.equal(sold.count, 1);
    assert.deepEqual(
      sold.items.map((i) => i.key),
      [offerOrphaned],
      "the twin left holding a sold copy is the one waiting on a decision"
    );
    assert.equal(sold.href, "offers?needsAction=1");
    assert.equal(sold.severity, "critical", "a copy committed twice is a double sale waiting");
    assert.equal(byId["offer-bidding-conflict"], undefined, "no bid is live yet");
  });

  it("reports a bidding conflict as its own group, separately from the sold one", async () => {
    await setOfferInActiveBidding(userId, offerBid, true);
    try {
      const byId = await groups();
      const conflict = byId["offer-bidding-conflict" satisfies ActionItemGroupId];
      assert.deepEqual(
        conflict.items.map((i) => i.key),
        [offerTwin],
        "the offer holding a copy under someone else's hammer is the flagged one"
      );
      assert.equal(byId["offer-sold-elsewhere"].count, 1, "the other reason is unaffected");
    } finally {
      await setOfferInActiveBidding(userId, offerBid, false);
    }
  });

  it("counts a copy that is dead both ways under each reason, and once in the row's own badge", async () => {
    // One copy on three platforms: one listing sells it, one has a bid live on it, and the third is
    // left carrying both problems at once — which is the case the two reason counts and the badge's
    // own `deadCount` deliberately answer differently.
    const stamp = await prisma.stamp.findFirstOrThrow({ where: { collectionId } });
    const condition = await prisma.stampCondition.findFirstOrThrow({ where: { collectionId } });
    const ebayId = (await prisma.contact.create({ data: { collectionId, name: "eBay", platform: true } })).id;
    const both = (
      await createItem(userId, collectionId, {
        stampId: stamp.id,
        conditionId: condition.id,
        forSale: true,
      })
    ).id;

    const mkActive = async (platformId: string, price: string) => {
      const id = await createOffer(userId, collectionId, {
        platformId,
        url: null,
        price,
        currency: "EUR",
        listingDate: null,
        state: "preparing",
      });
      const setId = await addOfferSet(userId, id, [both]);
      await setOfferState(userId, id, "ready");
      await setOfferState(userId, id, "active");
      return { id, setId };
    };
    const seller = await mkActive(delcampeId, "11.00");
    const victim = await mkActive(allegroId, "12.00");
    const bidder = await mkActive(ebayId, "13.00");

    await setOfferInActiveBidding(userId, bidder.id, true);
    const saleId = await createSale(userId, collectionId, {
      platformId: delcampeId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    await addSaleLines(userId, saleId, [
      { offerId: seller.id, offerSetId: seller.setId, price: "11.00", itemIds: [both] },
    ]);

    const flagged = await offersNeedingAction(userId, collectionId, 10);
    assert.equal(
      flagged["sold-elsewhere"].offers.find((o) => o.offerId === victim.id)?.count,
      1,
      "the copy has sold under another listing"
    );
    assert.equal(
      flagged["bidding-conflict"].offers.find((o) => o.offerId === victim.id)?.count,
      1,
      "…and the same copy is under someone's hammer"
    );
    // …while the list's own badge still counts the *copy*, once, unchanged by the split.
    const rows = await listOffersPaginated(userId, collectionId, { needsAction: true });
    assert.equal(rows.items.find((o) => o.id === victim.id)?.soldCopyCount, 1);
  });

  it("reports lots closing inside a day and lots past their close, and drops a settled one", async () => {
    const closing = await createAuctionLot(userId, collectionId, {
      auctionSaleId,
      lotNo: "1",
      url: null,
      title: "Closing tonight",
      endsAt: inHours(6),
      startingPrice: null,
      currentBid: "40.00",
      myBid: null,
      maxBid: null,
      notes: null,
    });
    // Outside the day, so it is on the watchlist but not waiting on anything today.
    await createAuctionLot(userId, collectionId, {
      auctionSaleId,
      lotNo: "2",
      url: null,
      title: "Next week",
      endsAt: inHours(24 * 5),
      startingPrice: null,
      currentBid: null,
      myBid: null,
      maxBid: null,
      notes: null,
    });
    const ended = await createAuctionLot(userId, collectionId, {
      auctionSaleId,
      lotNo: "3",
      url: null,
      title: "Already over",
      endsAt: inHours(-3),
      startingPrice: null,
      currentBid: "10.00",
      myBid: null,
      maxBid: null,
      notes: null,
    });

    const byId = await groups();
    assert.deepEqual(
      byId["auction-closing" satisfies ActionItemGroupId].items.map((i) => i.key),
      [closing],
      "only the lot inside the day"
    );
    assert.equal(byId["auction-closing"].href, "auctions?outcome=pending&closing=today");
    assert.deepEqual(
      byId["auction-outcome" satisfies ActionItemGroupId].items.map((i) => i.key),
      [ended]
    );
    // A deadline that can still be met outranks bookkeeping, and both sit under the double-sale
    // risk — the grading is by consequence, not by subject.
    assert.equal(byId["auction-closing"].severity, "warning");
    assert.equal(byId["auction-outcome"].severity, "info");

    // Closing the lot is exactly what the group asks for, so it must empty it. Nothing was bid on
    // this one, so it closes carrying no price — a lot that was only ever watched.
    await recordAuctionLotTransition(userId, ended, {
      status: "closed",
      finalPrice: null,
      wonTie: null,
    });
    const after = await groups();
    assert.equal(after["auction-outcome"], undefined, "a closed lot is nobody's to-do");
    assert.equal(after["auction-closing"].count, 1, "the live lot is untouched");
  });

  it("links each row at the entity it is about", async () => {
    const result = await getActionItems(userId, collectionId);
    for (const group of result.groups) {
      for (const item of group.items) {
        assert.ok(
          item.href.startsWith("offers/") || item.href.startsWith("auctions/sales/"),
          `${group.id} links relative to the collection: ${item.href}`
        );
        assert.ok(item.label.length > 0, "every row is named");
      }
    }
    const closing = result.groups.find((g) => g.id === "auction-closing");
    assert.ok(closing?.items[0].href.includes(`?lot=${closing.items[0].key}`), "a lot is marked on its sale");
    assert.ok(closing?.items[0].at, "a closing time rides along for the client to format");
  });
});
