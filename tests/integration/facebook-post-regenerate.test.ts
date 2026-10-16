import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, patchOffer, setOfferState } from "../../src/lib/offers";
import { saveEntityTranslation } from "../../src/lib/entity-translations";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import {
  createFacebookPost,
  getFacebookPostScreen,
  publishOfferOrPost,
  regenerateFacebookLotTexts,
} from "../../src/lib/facebook-posts";

// *Regenerate lot texts* on a post's screen (#1983): each lot's title and description measured against
// what its templates give now — out of date, written by hand — and regenerated in one go, a
// hand-written one only when ticked; never once the post is up (#1800).

describe("regenerating a Facebook post's lot texts (#1983)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let groupId: string;
  let conditionId: string;
  let areaId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbpostregen-${ts}`;
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
        data: { slug: `col-fbpostregen-${ts}`, name: `fbpostregen-${ts}`, baseCurrency: "PLN", ownerId: userId, defaultLanguage: "en" },
      })
    ).id;
    // The title prints the stamp's name and the description the area's, both in Polish where a
    // translation exists.
    facebookId = (
      await prisma.platform.create({
        data: {
          collectionId,
          name: "Facebook",
          platformCurrency: "PLN",
          titleTemplate: "{name}",
          descriptionTemplate: "From {area}",
          titleLanguage: "pl",
        },
      })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
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

  async function lotTexts(postId: string) {
    return (await getFacebookPostScreen(userId, postId))!.lotTexts;
  }

  async function texts(offerId: string) {
    return prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { name: true, nameEdited: true, description: true },
    });
  }

  /** The stamp's Polish name, entered where nothing re-renders the offers — its own screen's write. */
  async function translate(stampId: string, value: string) {
    await saveEntityTranslation(userId, collectionId, {
      entityType: "stamp",
      entityId: stampId,
      entityField: "name",
      language: "pl",
      value,
    });
  }

  it("marks a lot out of date once its template gives other words, and a hand-written one as such", async () => {
    const a = await lot("Mercury");
    const b = await lot("Venus");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Marks");
    assert.deepEqual(await lotTexts(postId), {
      [a.offerId]: { handWritten: false, outOfDate: false },
      [b.offerId]: { handWritten: false, outOfDate: false },
    });

    await patchOffer(userId, b.offerId, { name: "Venus, by hand" });
    await translate(a.stampId, "Merkury");
    await translate(b.stampId, "Wenus");
    // The hand-written title was never the template's, so it is not out of date — only written by hand.
    assert.deepEqual(await lotTexts(postId), {
      [a.offerId]: { handWritten: false, outOfDate: true },
      [b.offerId]: { handWritten: true, outOfDate: false },
    });
  });

  it("regenerates every lot from its templates, keeping a hand-written title unless it is ticked", async () => {
    const a = await lot("Mars");
    const b = await lot("Jupiter");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Regenerate");
    await patchOffer(userId, b.offerId, { name: "Jupiter, by hand" });
    await translate(a.stampId, "Mars PL");
    await translate(b.stampId, "Jowisz");

    assert.equal(await regenerateFacebookLotTexts(userId, postId, [a.offerId, b.offerId], []), 2);
    assert.equal((await texts(a.offerId)).name, "Mars PL");
    assert.deepEqual(await texts(b.offerId), { name: "Jupiter, by hand", nameEdited: true, description: "From Netherlands" });
    assert.equal((await lotTexts(postId))![a.offerId].outOfDate, false);

    // Ticked, the hand-written title is replaced by the template's and follows it again.
    assert.equal(await regenerateFacebookLotTexts(userId, postId, [], [b.offerId]), 1);
    assert.deepEqual(await texts(b.offerId), { name: "Jowisz", nameEdited: false, description: "From Netherlands" });
    assert.deepEqual((await lotTexts(postId))![b.offerId], { handWritten: false, outOfDate: false });
  });

  it("regenerates only the lots asked for — the out-of-date ones alone", async () => {
    const a = await lot("Saturn");
    const b = await lot("Uranus");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Only some");
    await translate(a.stampId, "Saturn PL");
    await translate(b.stampId, "Uran");

    await regenerateFacebookLotTexts(userId, postId, [a.offerId], []);
    assert.equal((await texts(a.offerId)).name, "Saturn PL");
    assert.equal((await texts(b.offerId)).name, "Uranus");
  });

  it("refuses an offer that is not a lot of the post", async () => {
    const a = await lot("Ceres");
    const b = await lot("Vesta");
    const stranger = await lot("Pallas");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Strangers");
    await assert.rejects(
      regenerateFacebookLotTexts(userId, postId, [a.offerId, stranger.offerId], []),
      /this post's own lots/
    );
    await assert.rejects(regenerateFacebookLotTexts(userId, postId, [], [stranger.offerId]), /this post's own lots/);
  });

  it("is not offered once the post is up, and refused — the posted text is frozen (#1800)", async () => {
    const a = await lot("Neptune");
    const b = await lot("Pluto");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Up");
    await publishOfferOrPost(userId, a.offerId, "https://www.facebook.com/groups/189000/posts/2");

    assert.equal(await lotTexts(postId), null);
    await assert.rejects(regenerateFacebookLotTexts(userId, postId, [a.offerId, b.offerId], []), /The post is up/);
  });
});
