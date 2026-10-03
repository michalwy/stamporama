import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  deleteOffer,
  getOfferDetail,
  setOfferState,
  updateOffer,
  type OfferInput,
} from "../../src/lib/offers";
import { setFacebookPlatform } from "../../src/lib/facebook";
import { createFacebookGroup, setFacebookGroupArchived } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS, type FacebookGroupValues } from "../../src/lib/facebook-group-rules";
import { getFacebookOfferKit } from "../../src/lib/facebook-auctions";
import {
  createFacebookPost,
  recordFacebookPostLink,
  removeFacebookLot,
} from "../../src/lib/facebook-posts";

// A Facebook auction offer (#1544; ADR-0061 §2, §3, §5). The rules worth a database: an offer on
// Facebook names a group in use and starts from its defaults — its currency over the platform's —
// a copy is in one Facebook auction that is up at a time, and several auctions in one group become
// one post whose link activates them all. The pure half is `tests/unit/facebook-post-rules.test.ts`.

function groupValues(overrides: Partial<FacebookGroupValues> = {}): FacebookGroupValues {
  return {
    ...FACEBOOK_GROUP_DEFAULTS,
    name: "Znaczki — aukcje",
    url: "https://www.facebook.com/groups/123456",
    ...overrides,
  };
}

describe("Facebook auction offers (#1544)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let delcampeId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;
  let otherGroupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbauctions-${ts}`;
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
        data: { slug: `col-fbauctions-${ts}`, name: `fbauctions-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.contact.create({
        data: { collectionId, name: "Facebook", platform: true, platformCurrency: "PLN" },
      })
    ).id;
    delcampeId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    await setFacebookPlatform(userId, collectionId, facebookId);
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    groupId = (
      await createFacebookGroup(
        userId,
        collectionId,
        groupValues({
          postTemplate: "Lot {lot}: {description}, start {startingPrice}",
          standingNote: "Shipping 5 EUR.",
          startingPriceMode: "amount",
          startingPriceValue: 4,
          bidIncrement: 0.5,
          currency: "EUR",
        })
      )
    ).id;
    otherGroupId = (
      await createFacebookGroup(userId, collectionId, groupValues({ name: "Filatelistyka" }))
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function newItem(): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  function input(overrides: Partial<OfferInput> = {}): OfferInput {
    return {
      platformId: facebookId,
      url: null,
      price: "0.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
      facebookGroupId: groupId,
      ...overrides,
    };
  }

  /** A Facebook auction in `group` holding `itemIds`, taken to `state`. */
  async function auction(itemIds: string[], state: "preparing" | "ready" | "active" = "preparing", group = groupId) {
    const offerId = await createOffer(userId, collectionId, input({ facebookGroupId: group, startingPrice: "3.00" }), {
      seedItemIds: itemIds,
    });
    if (state !== "preparing") await setOfferState(userId, offerId, "ready");
    if (state === "active") await setOfferState(userId, offerId, "active");
    return offerId;
  }

  const read = (offerId: string) =>
    prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: {
        listingType: true,
        currency: true,
        startingPrice: true,
        bidIncrement: true,
        facebookGroupId: true,
        facebookPostId: true,
        facebookLotNo: true,
        endsAt: true,
        state: true,
      },
    });

  it("asks a Facebook offer for its group, and refuses an archived one", async () => {
    await assert.rejects(
      () => createOffer(userId, collectionId, input({ facebookGroupId: null })),
      /Choose the Facebook group/
    );
    const archived = (await createFacebookGroup(userId, collectionId, groupValues({ name: "Old group" }))).id;
    await setFacebookGroupArchived(userId, archived, true);
    await assert.rejects(
      () => createOffer(userId, collectionId, input({ facebookGroupId: archived })),
      /archived/
    );
  });

  it("makes an auction from the group's defaults, in the group's currency, leaving the platform's alone", async () => {
    // A quick buy asked for is still an auction: that is the only way Facebook sells here.
    const offerId = await createOffer(userId, collectionId, input({ listingType: "fixed" }));
    const offer = await read(offerId);
    assert.equal(offer.listingType, "auction");
    assert.equal(offer.currency, "EUR", "the group's currency, not the platform's PLN");
    assert.equal(offer.startingPrice?.toFixed(2), "4.00", "the group's starting amount");
    assert.equal(offer.bidIncrement?.toFixed(2), "0.50", "the group's increment");
    assert.equal(offer.facebookGroupId, groupId);
    const platform = await prisma.contact.findUniqueOrThrow({ where: { id: facebookId } });
    assert.equal(platform.platformCurrency, "PLN");

    // A figure the form states outranks the group's.
    const stated = await createOffer(userId, collectionId, input({ startingPrice: "9.00", bidIncrement: "2.00" }));
    assert.equal((await read(stated)).startingPrice?.toFixed(2), "9.00");
    assert.equal((await read(stated)).bidIncrement?.toFixed(2), "2.00");
  });

  it("leaves no Facebook group on an offer elsewhere, and clears it when one moves off Facebook", async () => {
    const elsewhere = await createOffer(
      userId,
      collectionId,
      input({ platformId: delcampeId, currency: "EUR", listingType: "fixed" })
    );
    assert.equal((await read(elsewhere)).facebookGroupId, null);

    const offerId = await createOffer(userId, collectionId, input());
    await updateOffer(userId, offerId, input({ platformId: delcampeId, listingType: "fixed", facebookGroupId: groupId }));
    const moved = await read(offerId);
    assert.equal(moved.facebookGroupId, null);
    assert.equal(moved.bidIncrement, null);
  });

  it("keeps a copy in one Facebook auction that is up, in any group, and names it", async () => {
    const copy = await newItem();
    const first = await auction([copy], "active");
    const firstNo = (await prisma.offer.findUniqueOrThrow({ where: { id: first } })).offerNo;

    await assert.rejects(
      () => createOffer(userId, collectionId, input({ facebookGroupId: otherGroupId }), { seedItemIds: [copy] }),
      new RegExp(`already in an active Facebook auction: offer #${firstNo} in Znaczki`)
    );
    const draft = await createOffer(userId, collectionId, input({ facebookGroupId: otherGroupId }));
    await assert.rejects(() => addOfferSet(userId, draft, [copy]), /already in an active Facebook auction/);

    // Listing the same copy on another platform is the collector's own business.
    const elsewhere = await createOffer(
      userId,
      collectionId,
      input({ platformId: delcampeId, currency: "EUR", listingType: "fixed" })
    );
    await addOfferSet(userId, elsewhere, [copy]);

    // Once the first auction is closed, the copy is free again.
    await setOfferState(userId, first, "withdrawn");
    await addOfferSet(userId, draft, [copy]);
  });

  it("refuses to activate a second auction holding a copy the first went up with", async () => {
    const copy = await newItem();
    const a = await auction([copy], "ready");
    const b = await auction([copy], "ready", otherGroupId); // drafts compete for nothing
    await setOfferState(userId, a, "active");
    await assert.rejects(() => setOfferState(userId, b, "active"), /already in an active Facebook auction/);
    assert.equal((await read(b)).state, "ready");
  });

  it("puts auctions in one group into a post, as lots in the order given, closing together", async () => {
    const closes = new Date("2026-10-11T18:00:00Z");
    const a = await auction([await newItem()]);
    const b = await auction([await newItem()]);
    await prisma.offer.update({ where: { id: b }, data: { endsAt: closes } });
    const other = await auction([await newItem()], "preparing", otherGroupId);

    await assert.rejects(
      () => createFacebookPost(userId, collectionId, [a, other]),
      /different groups/
    );

    const { postId } = await createFacebookPost(userId, collectionId, [b, a]);
    const [lotB, lotA] = [await read(b), await read(a)];
    assert.deepEqual([lotB.facebookPostId, lotB.facebookLotNo], [postId, 1]);
    assert.deepEqual([lotA.facebookPostId, lotA.facebookLotNo], [postId, 2]);
    assert.equal(lotA.endsAt?.toISOString(), closes.toISOString(), "the lots close together");

    // A closing time edited on one lot is the post's.
    const later = new Date("2026-10-12T18:00:00Z");
    await updateOffer(userId, a, input({ startingPrice: "3.00", endsAt: later }));
    assert.equal((await read(b)).endsAt?.toISOString(), later.toISOString());

    // …and a lot shares its post's group.
    await assert.rejects(
      () => updateOffer(userId, a, input({ facebookGroupId: otherGroupId, startingPrice: "3.00" })),
      /take it out of the post/
    );

    const kit = await getFacebookOfferKit(a);
    assert.deepEqual(kit?.lots.map((l) => [l.offerId, l.lotNo]), [[b, 1], [a, 2]]);
    assert.equal(kit?.post?.id, postId);
    assert.match(kit!.photoZipPath, new RegExp(`/facebook-posts/${postId}/photos/zip$`));
  });

  it("activates every lot when the post's link is recorded, once every lot is Ready", async () => {
    const a = await auction([await newItem()], "ready");
    const b = await auction([await newItem()]);
    const { postId } = await createFacebookPost(userId, collectionId, [a, b]);

    await assert.rejects(
      () => recordFacebookPostLink(userId, postId, "https://www.facebook.com/groups/1/posts/2"),
      /Every lot must be Ready.*lot 2/
    );
    assert.equal((await read(a)).state, "ready", "nothing moved");

    await setOfferState(userId, b, "ready");
    const { activated } = await recordFacebookPostLink(userId, postId, "https://www.facebook.com/groups/1/posts/2");
    assert.equal(activated, 2);
    assert.equal((await read(a)).state, "active");
    assert.equal((await read(b)).state, "active");
    const post = await prisma.facebookPost.findUniqueOrThrow({ where: { id: postId } });
    assert.equal(post.url, "https://www.facebook.com/groups/1/posts/2");

    // Up, the lots are what was posted.
    await assert.rejects(() => removeFacebookLot(userId, a), /post is up/);
    const detail = await getOfferDetail(userId, a);
    assert.equal(detail?.facebook?.post?.url, post.url);
  });

  it("renumbers the lots when one leaves, and dissolves a post left with one", async () => {
    const [a, b, c] = [
      await auction([await newItem()]),
      await auction([await newItem()]),
      await auction([await newItem()]),
    ];
    const { postId } = await createFacebookPost(userId, collectionId, [a, b, c]);

    await removeFacebookLot(userId, a);
    assert.deepEqual([(await read(a)).facebookPostId, (await read(a)).facebookLotNo], [null, null]);
    assert.deepEqual([(await read(b)).facebookLotNo, (await read(c)).facebookLotNo], [1, 2]);

    await deleteOffer(userId, b);
    assert.equal((await read(c)).facebookPostId, null, "one lot left is a post of its own");
    assert.equal(await prisma.facebookPost.count({ where: { id: postId } }), 0);
  });
});
