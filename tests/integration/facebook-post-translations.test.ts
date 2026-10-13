import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, patchOffer, setOfferState } from "../../src/lib/offers";
import { saveEntityTranslation } from "../../src/lib/entity-translations";
import { setFacebookPlatform } from "../../src/lib/facebook";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { getFacebookOfferKit } from "../../src/lib/facebook-auctions";
import {
  createFacebookPost,
  getFacebookPostScreen,
  publishOfferOrPost,
  refreshFacebookPostTexts,
  setFacebookPostLayout,
} from "../../src/lib/facebook-posts";

// A post's untranslated names (#1889): the post's screen lists every name its text and captions print
// in the default language — once each, and by lot — read off the templates the lots' titles and
// descriptions follow; entering a translation and refreshing re-renders those texts at once. Which of
// an offer's texts a lot's template prints is pure (`tests/unit/facebook-post-rules.test.ts`).

describe("a Facebook post's untranslated names (#1889)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let groupId: string;
  let conditionId: string;
  let areaId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbposttr-${ts}`;
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
        data: { slug: `col-fbposttr-${ts}`, name: `fbposttr-${ts}`, baseCurrency: "PLN", ownerId: userId, defaultLanguage: "en" },
      })
    ).id;
    // The title prints the stamp's name, the description the area's: two different names, so which
    // of the two texts a template prints decides which names the post holds.
    facebookId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Facebook",
          platform: true,
          platformCurrency: "PLN",
          titleTemplate: "{name}",
          descriptionTemplate: "From {area}",
          titleLanguage: "pl",
        },
      })
    ).id;
    await setFacebookPlatform(userId, collectionId, facebookId);
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Netherlands", titleName: "Netherlands" } })).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki",
        url: "https://www.facebook.com/groups/189000",
        postTemplate: "{lot}. {title}",
        auctionCaptionTemplate: "{title} — {description}",
        custom: ["postTemplate", "auctionCaptionTemplate"],
      })
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** A Ready Facebook auction over one copy of a fresh stamp called `name`, in the Netherlands. */
  async function lot(name: string): Promise<{ offerId: string; stampId: string }> {
    const stampId = (
      await prisma.stamp.create({
        data: { collectionId, name, stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] } },
      })
    ).id;
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: "0.00",
        startingPrice: "3.00",
        currency: "PLN",
        listingDate: null,
        state: "preparing",
        facebookGroupId: groupId,
      },
      { seedItemIds: [item.id] }
    );
    await setOfferState(userId, offerId, "ready");
    return { offerId, stampId };
  }

  async function translations(postId: string) {
    return (await getFacebookPostScreen(userId, postId))!.translations;
  }

  it("lists the names a post's text prints untranslated, once each and by lot, and only from the texts it prints", async () => {
    const a = await lot("Mercury");
    const b = await lot("Jupiter");
    const c = await lot("Mercury Twin");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId, c.offerId], "Planets");

    const found = (await translations(postId))!;
    assert.equal(found.language, "pl");
    // The post template prints `{title}` only: the description's area is not in the post, so it is not
    // listed.
    assert.deepEqual(
      found.gaps.map((g) => `${g.entityType}:${g.defaultValue}`),
      ["stamp:Mercury", "stamp:Jupiter", "stamp:Mercury Twin"]
    );
    assert.deepEqual(found.byLot[a.offerId], [`stamp:${a.stampId}:name`]);
    assert.deepEqual(found.byLot[b.offerId], [`stamp:${b.stampId}:name`]);

    // Captioned, each caption prints the description too — and the area, behind all three, once.
    await setFacebookPostLayout(userId, postId, "captions");
    const captioned = (await translations(postId))!;
    assert.deepEqual(
      captioned.gaps.map((g) => `${g.entityType}:${g.defaultValue}`),
      ["stamp:Mercury", "area:Netherlands", "stamp:Jupiter", "stamp:Mercury Twin"]
    );
    assert.deepEqual(captioned.byLot[b.offerId], [`stamp:${b.stampId}:name`, `area:${areaId}:titleName`]);
    await setFacebookPostLayout(userId, postId, null);
  });

  it("leaves out a title written by hand, which holds the collector's words and no template's names", async () => {
    const a = await lot("Venus");
    const b = await lot("Mars");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Hand-written");
    await patchOffer(userId, b.offerId, { name: "Mars, by hand" });

    const found = (await translations(postId))!;
    assert.deepEqual(found.gaps.map((g) => g.defaultValue), ["Venus"]);
    assert.equal(found.byLot[b.offerId], undefined);
  });

  it("re-renders the lots' texts once a translation is entered, so the name leaves the list — a hand-written title kept", async () => {
    const a = await lot("Saturn");
    const b = await lot("Uranus");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Refresh");
    await patchOffer(userId, b.offerId, { name: "Uranus, by hand" });

    // The entity's own translation — the one its own screen writes.
    await saveEntityTranslation(userId, collectionId, {
      entityType: "stamp",
      entityId: a.stampId,
      entityField: "name",
      language: "pl",
      value: "Saturn PL",
    });
    await saveEntityTranslation(userId, collectionId, {
      entityType: "stamp",
      entityId: b.stampId,
      entityField: "name",
      language: "pl",
      value: "Uran",
    });
    await refreshFacebookPostTexts(userId, postId);

    const kit = (await getFacebookOfferKit(a.offerId))!;
    assert.deepEqual(
      kit.lots.map((l) => l.title),
      ["Saturn PL", "Uranus, by hand"]
    );
    assert.deepEqual((await translations(postId))!.gaps, []);
  });

  it("is not read once the post is up, and its texts are not refreshed — the posted text is frozen (#1800)", async () => {
    const a = await lot("Neptune");
    const b = await lot("Pluto");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Up");
    assert.equal((await translations(postId))!.gaps.length, 2);
    await publishOfferOrPost(userId, a.offerId, "https://www.facebook.com/groups/189000/posts/1");

    assert.equal(await translations(postId), null);
    await assert.rejects(refreshFacebookPostTexts(userId, postId), /The post is up/);
  });
});
