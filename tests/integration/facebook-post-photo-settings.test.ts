import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { createFacebookPost, publishOfferOrPost } from "../../src/lib/facebook-posts";
import {
  getFacebookPostPhotoSettings,
  updateFacebookPostPhotoSettings,
} from "../../src/lib/facebook-post-photo-settings";

// A post's *Photo settings…* (#2032): every lot's photo settings read as one — shared, or differing by
// lot — and a change written to every lot, leaving what was not changed as each lot has it; never once
// the post is up.

describe("a Facebook post's photo settings for every lot (#2032)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let groupId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbpostphotos-${ts}`;
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
        data: { slug: `col-fbpostphotos-${ts}`, name: `fbpostphotos-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({
        data: { collectionId, name: "Facebook", platformCurrency: "PLN", maxPhotos: 10 },
      })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki",
        url: "https://www.facebook.com/groups/189001",
      })
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** A Ready Facebook auction over one copy of a fresh stamp, photographing `sides`. */
  async function lot(sides: string, label: string | null = "{ref}"): Promise<string> {
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: `Stamp ${sides}` } })).id;
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
    await prisma.offer.update({ where: { id: offerId }, data: { photoSides: sides, photoLabelLeftTemplate: label } });
    await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  async function stored(offerId: string) {
    return prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { photoSides: true, photoPreferSingles: true, photoLabelLeftTemplate: true },
    });
  }

  it("shows what the lots share, and a setting they do not as differing", async () => {
    const a = await lot("front");
    const b = await lot("both");
    const { postId } = await createFacebookPost(userId, collectionId, [a, b], "Shared");

    const read = await getFacebookPostPhotoSettings(userId, postId);
    assert.equal(read.lotCount, 2);
    assert.equal(read.platformName, "Facebook");
    assert.equal(read.limits.maxPhotos, 10);
    assert.deepEqual(read.settings.photoSides, { same: false });
    assert.deepEqual(read.settings.photoLabelLeftTemplate, { same: true, value: "{ref}" });
  });

  it("writes a change to every lot and leaves a differing setting as each lot has it", async () => {
    const a = await lot("front");
    const b = await lot("both");
    const { postId } = await createFacebookPost(userId, collectionId, [a, b], "Every lot");

    const changed = await updateFacebookPostPhotoSettings(userId, postId, { preferSingles: false });
    assert.deepEqual(changed, [a, b]);
    assert.deepEqual(await stored(a), { photoSides: "front", photoPreferSingles: false, photoLabelLeftTemplate: "{ref}" });
    assert.deepEqual(await stored(b), { photoSides: "both", photoPreferSingles: false, photoLabelLeftTemplate: "{ref}" });
  });

  it("answers only the lots whose settings changed — the ones to regenerate", async () => {
    const a = await lot("front");
    const b = await lot("both");
    const { postId } = await createFacebookPost(userId, collectionId, [a, b], "Changed");

    assert.deepEqual(await updateFacebookPostPhotoSettings(userId, postId, { photoSides: "both" }), [a]);
    assert.equal((await stored(a)).photoSides, "both");
    assert.deepEqual(await updateFacebookPostPhotoSettings(userId, postId, {}), []);
    assert.deepEqual(await updateFacebookPostPhotoSettings(userId, postId, { photoLabelLeftTemplate: null }), [a, b]);
    assert.equal((await stored(b)).photoLabelLeftTemplate, null);
  });

  it("is refused once the post is up — its photos are the ones posted", async () => {
    const a = await lot("front");
    const b = await lot("front");
    const { postId } = await createFacebookPost(userId, collectionId, [a, b], "Up");
    await publishOfferOrPost(userId, a, "https://www.facebook.com/groups/189001/posts/1");

    await assert.rejects(getFacebookPostPhotoSettings(userId, postId), /The post is up/);
    await assert.rejects(updateFacebookPostPhotoSettings(userId, postId, { photoSides: "both" }), /The post is up/);
    assert.equal((await stored(a)).photoSides, "front");
  });

  it("is refused for another collector's post", async () => {
    const a = await lot("front");
    const b = await lot("front");
    const { postId } = await createFacebookPost(userId, collectionId, [a, b], "Theirs");
    await assert.rejects(updateFacebookPostPhotoSettings("someone-else", postId, { photoSides: "both" }), /Post not found/);
  });
});
