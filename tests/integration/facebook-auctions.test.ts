import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  deleteOffer,
  setOfferState,
  updateOffer,
  type OfferInput,
} from "../../src/lib/offers";
import { setFacebookPlatform } from "../../src/lib/facebook";
import {
  createFacebookGroup,
  setFacebookGroupArchived,
  updateFacebookDefaults,
  updateFacebookGroup,
} from "../../src/lib/facebook-groups";
import {
  FACEBOOK_BLANK_SETTINGS,
  FACEBOOK_GROUP_DEFAULTS,
  type FacebookGroupValues,
} from "../../src/lib/facebook-group-rules";
import { getFacebookOfferKit, listFacebookGroupChoices } from "../../src/lib/facebook-auctions";
import {
  createFacebookPost,
  publishOfferOrPost,
  removeFacebookLot,
} from "../../src/lib/facebook-posts";

// A Facebook auction offer (#1544; ADR-0061 §2, §3, §5). The rules worth a database: an offer on
// Facebook names a group in use and starts from its defaults — its currency over the platform's —
// a copy is in one Facebook auction that is up at a time, and several auctions in one group become
// one post that goes up together, its link written into each lot's own listing link (#1668). The pure half is `tests/unit/facebook-post-rules.test.ts`.

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
          custom: ["postTemplate", "standingNote", "startingPrice", "bidIncrement", "currency"],
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
        url: true,
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
    // The form names no type, so the group's — Facebook's blank one, an auction — decides it.
    const offerId = await createOffer(userId, collectionId, input());
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

  it("makes a quick buy where the group says so, or the form does, with no auction figures (#1671)", async () => {
    // Facebook's own type is a quick buy; the second group follows it, the first does not.
    await updateFacebookDefaults(userId, collectionId, {
      ...FACEBOOK_BLANK_SETTINGS,
      listingType: "fixed",
      quickBuyTemplate: "{title} — {price}",
      bidIncrement: 1,
    });
    const choices = await listFacebookGroupChoices(userId, collectionId, facebookId);
    assert.deepEqual(
      choices.groups.map((g) => [g.name, g.listingType]),
      [["Filatelistyka", "fixed"], ["Znaczki — aukcje", "fixed"]],
      "a group follows Facebook's listing type unless it sets its own"
    );

    const quickBuyId = await createOffer(userId, collectionId, input({ facebookGroupId: otherGroupId, price: "25.00" }));
    const quickBuy = await read(quickBuyId);
    assert.equal(quickBuy.listingType, "fixed");
    assert.equal(quickBuy.startingPrice, null);
    assert.equal(quickBuy.bidIncrement, null, "a quick buy has no bidding to step");
    assert.equal(quickBuy.endsAt, null);

    // The form's own answer outranks the group's, both ways.
    const asked = await read(
      await createOffer(userId, collectionId, input({ facebookGroupId: otherGroupId, listingType: "auction" }))
    );
    assert.equal(asked.listingType, "auction");
    assert.equal(asked.bidIncrement?.toFixed(2), "1.00", "an auction takes the group's increment");

    // A quick buy going live needs its asking price, as anywhere.
    const unpricedCopy = await newItem();
    await assert.rejects(
      () =>
        createOffer(userId, collectionId, input({ facebookGroupId: otherGroupId, state: "active" }), {
          seedItemIds: [unpricedCopy],
        }),
      /no asking price/
    );

    // An edit may switch the type; one naming none keeps it.
    const offerId = await createOffer(userId, collectionId, input({ facebookGroupId: otherGroupId, price: "25.00" }));
    await updateOffer(userId, offerId, input({ facebookGroupId: otherGroupId, listingType: "auction", startingPrice: "5.00", bidIncrement: "0.50" }));
    assert.deepEqual(
      [(await read(offerId)).listingType, (await read(offerId)).bidIncrement?.toFixed(2)],
      ["auction", "0.50"]
    );
    await updateOffer(userId, offerId, input({ facebookGroupId: otherGroupId, startingPrice: "5.00" }));
    assert.equal((await read(offerId)).listingType, "auction");

    // The kit carries both templates and each lot's type.
    const kit = await getFacebookOfferKit(quickBuyId);
    assert.equal(kit?.group.quickBuyTemplate, "{title} — {price}");
    assert.equal(kit?.lots[0].listingType, "fixed");
    // `{description}` is the offer's own and nothing else (#1692): none here, so it is empty, not the title.
    assert.notEqual(kit?.lots[0].title, "");
    assert.equal(kit?.lots[0].description, "");
    // The group follows Facebook's quick-buy template, so the card links a gap in it to the defaults.
    assert.equal(kit?.group.custom.includes("quickBuyTemplate"), false);

    await updateFacebookDefaults(userId, collectionId, FACEBOOK_BLANK_SETTINGS);
  });

  it("starts an auction in a group following Facebook from Facebook's settings, read live (#1661)", async () => {
    // The second group follows Facebook throughout; Facebook states its own settings.
    await updateFacebookDefaults(userId, collectionId, {
      ...FACEBOOK_BLANK_SETTINGS,
      postTemplate: "Facebook {description}",
      standingNote: "Facebook terms",
      startingPriceMode: "amount",
      startingPriceValue: 6,
      bidIncrement: 2,
      auctionDays: 3,
      closingTime: "21:00",
    });
    const before = await createOffer(userId, collectionId, input({ facebookGroupId: otherGroupId }));
    let offer = await read(before);
    assert.equal(offer.currency, "PLN", "following Facebook's currency is the platform's");
    assert.equal(offer.startingPrice?.toFixed(2), "6.00");
    assert.equal(offer.bidIncrement?.toFixed(2), "2.00");
    let kit = await getFacebookOfferKit(before);
    assert.equal(kit?.group.postTemplate, "Facebook {description}");
    assert.equal(kit?.group.standingNote, "Facebook terms");

    // What the offer form starts a new auction from, per group: its own where custom.
    const choices = await listFacebookGroupChoices(userId, collectionId, facebookId);
    const byName = new Map(choices.groups.map((g) => [g.name, g]));
    assert.deepEqual(
      [byName.get("Filatelistyka")?.bidIncrement, byName.get("Filatelistyka")?.auctionDays, byName.get("Filatelistyka")?.closingTime, byName.get("Filatelistyka")?.currency],
      ["2.00", 3, "21:00", "PLN"]
    );
    assert.deepEqual(
      [byName.get("Znaczki — aukcje")?.bidIncrement, byName.get("Znaczki — aukcje")?.auctionDays, byName.get("Znaczki — aukcje")?.currency],
      ["0.50", 3, "EUR"],
      "the custom increment and currency are the group's, the length Facebook's"
    );

    // A changed default reaches the next auction and the group's kit, and no auction already made.
    await updateFacebookDefaults(userId, collectionId, {
      ...FACEBOOK_BLANK_SETTINGS,
      postTemplate: "Changed {description}",
      startingPriceMode: "amount",
      startingPriceValue: 8,
      bidIncrement: 3,
    });
    offer = await read(before);
    assert.equal(offer.startingPrice?.toFixed(2), "6.00");
    assert.equal(offer.bidIncrement?.toFixed(2), "2.00");
    const after = await read(await createOffer(userId, collectionId, input({ facebookGroupId: otherGroupId })));
    assert.equal(after.startingPrice?.toFixed(2), "8.00");
    assert.equal(after.bidIncrement?.toFixed(2), "3.00");
    kit = await getFacebookOfferKit(before);
    assert.equal(kit?.group.postTemplate, "Changed {description}");
    assert.equal(kit?.group.standingNote, "");

    // A group that sets the increment custom — to none — stops following it.
    await updateFacebookGroup(
      userId,
      otherGroupId,
      groupValues({ name: "Filatelistyka", custom: ["bidIncrement"], bidIncrement: null })
    );
    const custom = await read(await createOffer(userId, collectionId, input({ facebookGroupId: otherGroupId })));
    assert.equal(custom.bidIncrement, null, "custom with no increment is not Facebook's 3.00");
    assert.equal(custom.startingPrice?.toFixed(2), "8.00", "the starting price still follows Facebook");

    // Back to a blank Facebook, so the cases below read the groups as they were.
    await updateFacebookDefaults(userId, collectionId, FACEBOOK_BLANK_SETTINGS);
    await updateFacebookGroup(userId, otherGroupId, groupValues({ name: "Filatelistyka" }));
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
      new RegExp(`already in an active Facebook offer: offer #${firstNo} in Znaczki`)
    );
    const draft = await createOffer(userId, collectionId, input({ facebookGroupId: otherGroupId }));
    await assert.rejects(() => addOfferSet(userId, draft, [copy]), /already in an active Facebook offer/);

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
    await assert.rejects(() => setOfferState(userId, b, "active"), /already in an active Facebook offer/);
    assert.equal((await read(b)).state, "ready");
  });

  it("holds a copy in a quick buy that is up against a Facebook auction too (#1671)", async () => {
    const copy = await newItem();
    await createOffer(userId, collectionId, input({ listingType: "fixed", price: "20.00", state: "active" }), {
      seedItemIds: [copy],
    });
    await assert.rejects(
      () => createOffer(userId, collectionId, input({ facebookGroupId: otherGroupId }), { seedItemIds: [copy] }),
      /already in an active Facebook offer/
    );
  });

  it("keeps a post's lots to one type unless the group lets them mix (#1671)", async () => {
    const closes = new Date("2026-10-11T18:00:00Z");
    const a = await auction([await newItem()]);
    await prisma.offer.update({ where: { id: a }, data: { endsAt: closes } });
    const q = await createOffer(userId, collectionId, input({ listingType: "fixed", price: "20.00" }), {
      seedItemIds: [await newItem()],
    });
    await assert.rejects(() => createFacebookPost(userId, collectionId, [a, q]), /share one listing type/);

    // The group lets its posts mix: the quick buy goes in, and takes no closing time from the auction.
    await updateFacebookGroup(
      userId,
      groupId,
      groupValues({
        postTemplate: "Lot {lot}: {description}, start {startingPrice}",
        standingNote: "Shipping 5 EUR.",
        startingPriceMode: "amount",
        startingPriceValue: 4,
        bidIncrement: 0.5,
        currency: "EUR",
        mixedListingTypes: true,
        custom: ["postTemplate", "standingNote", "startingPrice", "bidIncrement", "currency", "mixedListingTypes"],
      })
    );
    await createFacebookPost(userId, collectionId, [a, q]);
    assert.equal((await read(q)).endsAt, null);
    assert.equal((await read(a)).endsAt?.toISOString(), closes.toISOString());

    // Back to one type per post: a lot of the post cannot change type while it is in it.
    await updateFacebookGroup(
      userId,
      groupId,
      groupValues({
        postTemplate: "Lot {lot}: {description}, start {startingPrice}",
        standingNote: "Shipping 5 EUR.",
        startingPriceMode: "amount",
        startingPriceValue: 4,
        bidIncrement: 0.5,
        currency: "EUR",
        custom: ["postTemplate", "standingNote", "startingPrice", "bidIncrement", "currency"],
      })
    );
    const b = await auction([await newItem()]);
    const c = await auction([await newItem()]);
    await createFacebookPost(userId, collectionId, [b, c]);
    await assert.rejects(
      () => updateOffer(userId, b, input({ listingType: "fixed", price: "20.00" })),
      /take it out of the post before changing its type/
    );
    assert.equal((await read(b)).listingType, "auction");
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

  it("activates every lot from any one of them, writing the post's link into each lot without its own", async () => {
    const link = "https://www.facebook.com/groups/1/posts/2";
    const photo = "https://www.facebook.com/photo/?fbid=3";
    const a = await auction([await newItem()], "ready");
    const b = await auction([await newItem()]);
    const c = await auction([await newItem()], "ready");
    await prisma.offer.update({ where: { id: c }, data: { url: photo } });
    await createFacebookPost(userId, collectionId, [a, b, c]);

    await assert.rejects(() => publishOfferOrPost(userId, a, link), /Every lot must be Ready.*lot 2/);
    assert.equal((await read(a)).state, "ready", "nothing moved");
    assert.equal((await read(a)).url, null, "nor was the link written");

    await setOfferState(userId, b, "ready");
    await publishOfferOrPost(userId, b, link);
    for (const id of [a, b, c]) assert.equal((await read(id)).state, "active");
    assert.equal((await read(a)).url, link);
    assert.equal((await read(b)).url, link);
    assert.equal((await read(c)).url, photo, "a lot with its own photo's link keeps it");

    // Up, the lots are what was posted.
    await assert.rejects(() => removeFacebookLot(userId, a), /post is up/);
  });

  it("activates an auction posted alone the ordinary way, its link the listing link", async () => {
    const link = "https://www.facebook.com/groups/1/posts/9";
    const a = await auction([await newItem()], "ready");
    await publishOfferOrPost(userId, a, link);
    const offer = await read(a);
    assert.equal(offer.state, "active");
    assert.equal(offer.url, link);
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
