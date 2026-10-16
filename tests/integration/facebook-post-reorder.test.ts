import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { sortFacebookLots } from "../../src/lib/facebook-post-rules";
import {
  createFacebookPost,
  getFacebookPostScreen,
  publishOfferOrPost,
  reorderFacebookLots,
} from "../../src/lib/facebook-posts";

// The order of a multi-lot post's lots (#1986): written as the lots' numbers, so the kit — the post's
// text, captions and photos — reads them in it; refused once the post is up (#1800), for an order that
// no longer names exactly the post's lots, and to anyone but the collection's owner. Each kit lot
// carries its lowest catalogue number as a sort key, which *Sort by catalogue number* orders by; the
// sorting itself is pure (`tests/unit/facebook-post-rules.test.ts`).

describe("reordering a multi-lot post's lots (#1986)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let facebookId: string;
  let vendorId: string;
  let conditionId: string;
  let groupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbreorder-${ts}`;
    otherUserId = `test-user-fbreorder-other-${ts}`;
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
        data: { slug: `col-fbreorder-${ts}`, name: `fbreorder-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({
        data: { collectionId, name: "Facebook", platformCurrency: "PLN" },
      })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    vendorId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — kolejność",
        url: "https://www.facebook.com/groups/198601",
      })
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  /** A Ready Facebook auction over one fresh copy of a stamp numbered `number` (or none), starting at
   *  `start`. */
  async function offer(number: string | null, start: string): Promise<string> {
    const stamp = await prisma.stamp.create({
      data: {
        collectionId,
        name: `Stamp ${number ?? "unnumbered"} ${Math.random()}`,
        ...(number ? { catalogNumbers: { create: [{ catalogVendorId: vendorId, number }] } } : {}),
      },
    });
    const item = await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true });
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: "0.00",
        startingPrice: start,
        currency: "PLN",
        listingDate: null,
        state: "preparing",
        facebookGroupId: groupId,
        listingType: "auction",
      },
      { seedItemIds: [item.id] }
    );
    await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  const kitOrder = async (postId: string) =>
    (await getFacebookPostScreen(userId, postId))!.kit.lots.map((l) => [l.offerId, l.lotNo]);

  it("numbers the lots in the order given, and the kit reads them in it", async () => {
    const a = await offer("200", "5.00");
    const b = await offer("12", "9.00");
    const c = await offer(null, "1.00");
    const post = await createFacebookPost(userId, collectionId, [a, b, c], "Reordered");

    await reorderFacebookLots(userId, post.postId, [c, a, b]);
    assert.deepEqual(await kitOrder(post.postId), [
      [c, 1],
      [a, 2],
      [b, 3],
    ]);
  });

  it("carries each lot's catalogue sort key, so a post sorts into catalogue order", async () => {
    const a = await offer("200", "5.00");
    const b = await offer("12", "9.00");
    const c = await offer(null, "1.00");
    const post = await createFacebookPost(userId, collectionId, [a, b, c], "By number");

    const lots = (await getFacebookPostScreen(userId, post.postId))!.kit.lots;
    assert.deepEqual(
      lots.map((l) => l.catalogSortKey),
      ["0000000200", "0000000012", null]
    );
    const byCatalog = sortFacebookLots(lots, "catalog");
    assert.deepEqual(byCatalog, [b, a, c], "12 before 200 — numerically — and the unnumbered last");
    await reorderFacebookLots(userId, post.postId, byCatalog);
    assert.deepEqual(await kitOrder(post.postId), [
      [b, 1],
      [a, 2],
      [c, 3],
    ]);
  });

  it("refuses an order that does not name exactly the post's lots, writing nothing", async () => {
    const a = await offer("1", "1.00");
    const b = await offer("2", "1.00");
    const c = await offer("3", "1.00");
    const post = await createFacebookPost(userId, collectionId, [a, b, c], "Stale");
    const outsider = await offer("4", "1.00");

    for (const order of [[b, a], [b, a, c, c], [b, a, outsider]]) {
      await assert.rejects(() => reorderFacebookLots(userId, post.postId, order), /lots have changed/);
    }
    assert.deepEqual(await kitOrder(post.postId), [
      [a, 1],
      [b, 2],
      [c, 3],
    ]);
  });

  it("refuses once the post is up, and to anyone but the collection's owner", async () => {
    const a = await offer("1", "1.00");
    const b = await offer("2", "1.00");
    const post = await createFacebookPost(userId, collectionId, [a, b], "Posted");

    await assert.rejects(() => reorderFacebookLots(otherUserId, post.postId, [b, a]), /Collection not found/);

    await publishOfferOrPost(userId, a, "https://www.facebook.com/groups/198601/pending/1", "pending");
    await assert.rejects(
      () => reorderFacebookLots(userId, post.postId, [b, a]),
      /stay in the order they were posted/
    );
    assert.deepEqual(await kitOrder(post.postId), [
      [a, 1],
      [b, 2],
    ]);
  });
});
