import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  getOfferDetail,
  listOffersPaginated,
  offerFilterCounts,
  repostOffer,
  setOfferState,
} from "../../src/lib/offers";
import { FACEBOOK_PLATFORM_MODULE } from "../../src/lib/platform-modules";

// Quick buys past their platform's refresh threshold, and reposting them on the same offer (#1718).
//
// What is under test is where the threshold comes from — the platform off Facebook, the group (or
// Facebook's defaults it follows) on it — which offers count (active quick buys only), that the
// filter, its count, the row and the offer's screen agree, and that a repost keeps the offer and
// its history while restarting the count.

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS - 60_000);

describe("quick-buy refresh (#1718)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let delcampeId: string;
  let allegroId: string;
  let stampId: string;
  let conditionId: string;
  let nextOfferNo = 9000;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-refresh-${ts}`;
    otherUserId = `test-user-refresh-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-refresh-${ts}`, name: `Refresh ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp R" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    delcampeId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, refreshQuickBuysAfterDays: 3 },
      })
    ).id;
    allegroId = (await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.facebookPost.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  /** An offer taken live through the ordinary lifecycle, then dated `age` days back. */
  async function liveOffer(
    platformId: string,
    age: number,
    listingType: "fixed" | "auction" = "fixed"
  ): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: `https://example.com/listing/${nextOfferNo++}`,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
      listingType,
      startingPrice: listingType === "auction" ? "1.00" : null,
    });
    const itemId = (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
    await addOfferSet(userId, offerId, [itemId]);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    await prisma.offer.update({ where: { id: offerId }, data: { listingDate: daysAgo(age) } });
    return offerId;
  }

  async function needsRefreshIds(): Promise<string[]> {
    const page = await listOffersPaginated(userId, collectionId, { needsRefresh: true });
    return page.items.map((o) => o.id).sort();
  }

  let due: string;
  let fresh: string;
  let auction: string;
  let paused: string;
  let allegro: string;

  it("marks and finds an active quick buy past its platform's threshold, and nothing else", async () => {
    due = await liveOffer(delcampeId, 5);
    fresh = await liveOffer(delcampeId, 1);
    auction = await liveOffer(delcampeId, 5, "auction");
    paused = await liveOffer(delcampeId, 5);
    await setOfferState(userId, paused, "paused");
    allegro = await liveOffer(allegroId, 30);

    assert.deepEqual(await needsRefreshIds(), [due]);
    assert.equal((await offerFilterCounts(userId, collectionId)).needsRefresh, 1);
    assert.equal((await offerFilterCounts(userId, collectionId, { platformId: allegroId })).needsRefresh, 0);

    const rows = new Map((await listOffersPaginated(userId, collectionId)).items.map((o) => [o.id, o]));
    assert.equal(rows.get(due)!.refreshDueDays, 5);
    for (const id of [fresh, auction, paused, allegro]) assert.equal(rows.get(id)!.refreshDueDays, null);
    assert.equal((await getOfferDetail(userId, due))!.refreshDueDays, 5);
  });

  it("reposts on the same offer: new link, count restarted, earlier link kept with its dates", async () => {
    const before = await prisma.offer.findUniqueOrThrow({ where: { id: due } });
    await prisma.offer.update({ where: { id: due }, data: { listingContentChangedAt: new Date() } });

    assert.deepEqual(await repostOffer(userId, due, "  https://example.com/listing/new  "), { reposted: 1 });

    const after = await prisma.offer.findUniqueOrThrow({ where: { id: due } });
    assert.equal(after.url, "https://example.com/listing/new");
    assert.equal(after.offerNo, before.offerNo);
    assert.deepEqual(after.listingDate, before.listingDate);
    assert.ok(after.lastPostedAt && Date.now() - after.lastPostedAt.getTime() < 60_000);
    assert.equal(after.listingContentChangedAt, null);

    const detail = (await getOfferDetail(userId, due))!;
    assert.equal(detail.refreshDueDays, null);
    assert.equal(detail.postings.length, 1);
    assert.equal(detail.postings[0].url, before.url);
    assert.deepEqual(detail.postings[0].postedAt, before.listingDate);
    assert.deepEqual(await needsRefreshIds(), []);

    // Up again past the threshold, the count runs from the repost rather than the first listing.
    await prisma.offer.update({ where: { id: due }, data: { lastPostedAt: daysAgo(4) } });
    assert.deepEqual(await needsRefreshIds(), [due]);
    assert.equal((await getOfferDetail(userId, due))!.refreshDueDays, 4);
  });

  it("refuses a repost without a link, of anything but an active quick buy, or by another user", async () => {
    await assert.rejects(() => repostOffer(userId, fresh, "   "), /link of the new post/);
    await assert.rejects(() => repostOffer(userId, auction, "https://x.test/a"), /active quick buy/);
    await assert.rejects(() => repostOffer(userId, paused, "https://x.test/p"), /active quick buy/);
    await assert.rejects(() => repostOffer(otherUserId, fresh, "https://x.test/o"), /access denied/);
    assert.equal(await prisma.offerPosting.count({ where: { offerId: { in: [fresh, auction, paused] } } }), 0);
  });

  describe("on Facebook", () => {
    let facebookId: string;
    let following: string;
    let never: string;
    let postId: string;

    /** A Facebook offer written straight to the table — the group rules are not what is under test. */
    async function facebookOffer(
      groupId: string,
      age: number,
      listingType: "fixed" | "auction",
      lot?: { postId: string; lotNo: number }
    ): Promise<string> {
      return (
        await prisma.offer.create({
          data: {
            collectionId,
            offerNo: nextOfferNo++,
            platformId: facebookId,
            facebookGroupId: groupId,
            facebookPostId: lot?.postId ?? null,
            facebookLotNo: lot?.lotNo ?? null,
            url: lot ? "https://www.facebook.com/groups/1/posts/old" : `https://www.facebook.com/p/${nextOfferNo}`,
            listingType,
            price: "5.00",
            currency: "PLN",
            state: "active",
            listingDate: daysAgo(age),
          },
        })
      ).id;
    }

    before(async () => {
      // The contact's own column is set and must not be read for Facebook: its threshold is the
      // defaults row's, which its groups follow.
      facebookId = (
        await prisma.contact.create({
          data: {
            collectionId,
            name: "Facebook",
            platform: true,
            platformModule: FACEBOOK_PLATFORM_MODULE,
            refreshQuickBuysAfterDays: 1,
          },
        })
      ).id;
      await prisma.facebookDefaults.create({ data: { platformId: facebookId, refreshQuickBuysAfterDays: 2 } });
      following = (
        await prisma.facebookGroup.create({
          data: { collectionId, platformId: facebookId, name: "Following", url: "https://www.facebook.com/groups/1" },
        })
      ).id;
      never = (
        await prisma.facebookGroup.create({
          data: {
            collectionId,
            platformId: facebookId,
            name: "Never",
            url: "https://www.facebook.com/groups/2",
            customSettings: ["refreshQuickBuysAfterDays"],
            refreshQuickBuysAfterDays: null,
          },
        })
      ).id;
      postId = (await prisma.facebookPost.create({ data: { collectionId, groupId: following } })).id;
    });

    it("holds an offer to its group's threshold — Facebook's where the group follows it", async () => {
      const inFollowing = await facebookOffer(following, 3, "fixed");
      const youngInFollowing = await facebookOffer(following, 1, "fixed");
      const inNever = await facebookOffer(never, 30, "fixed");
      const ids = await needsRefreshIds();
      assert.ok(ids.includes(inFollowing));
      assert.ok(!ids.includes(youngInFollowing), "the contact's own threshold of 1 day is not read");
      assert.ok(!ids.includes(inNever), "a group's custom never wins over Facebook's 2 days");
      assert.equal((await getOfferDetail(userId, inFollowing))!.refreshDueDays, 3);
    });

    it("reposts every active quick-buy lot of a post together, and leaves an auction lot alone", async () => {
      const lot1 = await facebookOffer(following, 3, "fixed", { postId, lotNo: 1 });
      const lot2 = await facebookOffer(following, 3, "fixed", { postId, lotNo: 2 });
      const lot3 = await facebookOffer(following, 3, "auction", { postId, lotNo: 3 });

      const link = "https://www.facebook.com/groups/1/posts/new";
      assert.deepEqual(await repostOffer(userId, lot2, link), { reposted: 2 });

      const lots = await prisma.offer.findMany({
        where: { id: { in: [lot1, lot2, lot3] } },
        select: { id: true, url: true, lastPostedAt: true, _count: { select: { postings: true } } },
      });
      const byId = new Map(lots.map((l) => [l.id, l]));
      for (const id of [lot1, lot2]) {
        assert.equal(byId.get(id)!.url, link);
        assert.ok(byId.get(id)!.lastPostedAt);
        assert.equal(byId.get(id)!._count.postings, 1);
      }
      assert.equal(byId.get(lot3)!.url, "https://www.facebook.com/groups/1/posts/old");
      assert.equal(byId.get(lot3)!.lastPostedAt, null);
      assert.equal(byId.get(lot3)!._count.postings, 0);
    });
  });
});
