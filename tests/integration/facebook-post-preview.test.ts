import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import {
  createFacebookPost,
  deleteFacebookPost,
  getFacebookPostScreen,
  publishOfferOrPost,
  takeFacebookPostBackToPreparing,
  withdrawOfferOrPost,
} from "../../src/lib/facebook-posts";
import {
  canServeFacebookPostPreviewPhoto,
  createFacebookPostPreviewToken,
  readFacebookPostPreview,
  readFacebookPostPreviewShareState,
  readSharedFacebookPostPreview,
  revokeFacebookPostPreviewToken,
  verifyFacebookPostPreviewToken,
} from "../../src/lib/facebook-post-preview";

// A Facebook post's preview for a buyer (#2212), against a real database. The preview is the post as
// it will appear and carries nothing of the collection; its link names one post and resolves to
// nothing else; it stays live — gaining the post's link once approved and marking sold lots — says the
// post is being updated while it is prepared again, and that the offer is no longer current once it is
// withdrawn or deleted; a new link or a withdrawal ends the old address; and the photos it serves are
// the post's lots' generated images and nothing else.

describe("a Facebook post's preview for a buyer (#2212)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let facebookId: string;
  let conditionId: string;
  let groupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbpreview-${ts}`;
    otherUserId = `test-user-fbpreview-other-${ts}`;
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
        data: { slug: `col-fbpreview-${ts}`, name: `fbpreview-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({
        data: { collectionId, name: "Facebook", platformCurrency: "PLN", titleLanguage: "pl" },
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
        url: "https://www.facebook.com/groups/221201",
        postTemplate: "{title} — start {startingPrice}",
      })
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  /** A Ready Facebook auction over one fresh copy, titled `name`. */
  async function readyAuction(name: string): Promise<{ offerId: string; itemId: string }> {
    const stamp = await prisma.stamp.create({ data: { collectionId, name: `Stamp ${Math.random()}` } });
    const item = await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true });
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: "0.00",
        startingPrice: "5.00",
        currency: "PLN",
        listingDate: null,
        state: "preparing",
        facebookGroupId: groupId,
        listingType: "auction",
        name,
      },
      { seedItemIds: [item.id] }
    );
    await setOfferState(userId, offerId, "ready");
    return { offerId, itemId: item.id };
  }

  async function readyPost(title: string, names: string[]) {
    const lots = [];
    for (const name of names) lots.push(await readyAuction(name));
    if (lots.length === 1) {
      // A Facebook offer is a post of one from the moment it is made (#2116).
      const { facebookPostId } = await prisma.offer.findUniqueOrThrow({ where: { id: lots[0].offerId } });
      return { postId: facebookPostId!, lots };
    }
    const { postId } = await createFacebookPost(
      userId,
      collectionId,
      lots.map((l) => l.offerId),
      title
    );
    return { postId, lots };
  }

  it("shows the post's title and every lot with its number, title and price — and nothing of the collection", async () => {
    const { postId, lots } = await readyPost("Generalgouvernement", ["Kraków 1940", "Warszawa 1941"]);
    const preview = await readFacebookPostPreview(userId, postId, collectionId);
    assert.ok(preview);
    assert.equal(preview.standing, "shown");
    assert.equal(preview.title, "Generalgouvernement");
    assert.equal(preview.language, "pl");
    assert.equal(preview.postLink, null);
    assert.deepEqual(
      preview.lots.map((l) => [l.lotNo, l.title, l.mark, l.price]),
      [
        [1, "Kraków 1940", null, null],
        [2, "Warszawa 1941", null, null],
      ]
    );
    assert.ok(preview.lots[0].startingPrice?.includes("5"));
    // The kit the browser renders the text from is keyed by the lots, not the offers.
    assert.deepEqual(
      preview.kit?.lots.map((l) => l.offerId),
      preview.lots.map((l) => l.key)
    );
    const json = JSON.stringify(preview);
    for (const secret of [collectionId, userId, groupId, postId, ...lots.flatMap((l) => [l.offerId, l.itemId])]) {
      assert.ok(!json.includes(secret), `the preview carries ${secret}`);
    }
  });

  it("is the owner's alone", async () => {
    const { postId } = await readyPost("Somebody else's", ["Lot A"]);
    assert.equal(await readFacebookPostPreview(otherUserId, postId), null);
    await assert.rejects(() => createFacebookPostPreviewToken(otherUserId, postId));
    await assert.rejects(() => readFacebookPostPreviewShareState(otherUserId, postId));
  });

  it("gives a link that opens the preview, records the visit, and stays live as the post goes up and sells", async () => {
    const { postId, lots } = await readyPost("Live", ["Live 1", "Live 2"]);
    const { token } = await createFacebookPostPreviewToken(userId, postId);
    assert.equal((await getFacebookPostScreen(userId, postId))?.hasPreviewLink, true);

    const before = await readFacebookPostPreviewShareState(userId, postId);
    assert.equal(before.link?.lastUsedAt, null);
    assert.equal(before.standing, "shown");

    const access = await verifyFacebookPostPreviewToken(token);
    assert.ok(access);
    assert.equal(access.postId, postId);
    const opened = await readSharedFacebookPostPreview(access);
    assert.equal(opened.standing, "shown");
    assert.notEqual((await readFacebookPostPreviewShareState(userId, postId)).link?.lastUsedAt, null);

    // Waiting for the group's approval: its link opens only for the collector, so it is not shown.
    const pendingLink = "https://www.facebook.com/groups/221201/pending/1";
    await publishOfferOrPost(userId, lots[0].offerId, pendingLink, "pending");
    const pending = await readSharedFacebookPostPreview(access);
    assert.equal(pending.standing, "shown");
    assert.equal(pending.standing === "shown" && pending.preview.postLink, null);

    // Approved: the post's link appears.
    const postLink = "https://www.facebook.com/groups/221201/posts/2";
    await publishOfferOrPost(userId, lots[0].offerId, postLink, "active");
    const up = await readSharedFacebookPostPreview(access);
    assert.equal(up.standing === "shown" && up.preview.postLink, postLink);

    // A lot sells: marked, and still on the page.
    await prisma.offer.update({ where: { id: lots[0].offerId }, data: { state: "sold" } });
    const sold = await readSharedFacebookPostPreview(access);
    assert.ok(sold.standing === "shown");
    assert.deepEqual(
      sold.preview.lots.map((l) => l.mark),
      ["sold", null]
    );
  });

  it("says the post is being updated while it is prepared again, and shows it again once Ready", async () => {
    const { postId, lots } = await readyPost("Updating", ["Upd 1"]);
    const { token } = await createFacebookPostPreviewToken(userId, postId);
    const access = (await verifyFacebookPostPreviewToken(token))!;

    await takeFacebookPostBackToPreparing(userId, postId);
    assert.deepEqual(await readSharedFacebookPostPreview(access), {
      standing: "updating",
      postNo: (await prisma.facebookPost.findUniqueOrThrow({ where: { id: postId } })).postNo,
      language: "pl",
    });
    assert.equal((await readFacebookPostPreviewShareState(userId, postId)).standing, "updating");

    await setOfferState(userId, lots[0].offerId, "ready");
    assert.equal((await readSharedFacebookPostPreview(access)).standing, "shown");
  });

  it("says the offer is no longer current once the post is withdrawn", async () => {
    const { postId, lots } = await readyPost("Withdrawn", ["Wd 1"]);
    const { token } = await createFacebookPostPreviewToken(userId, postId);
    await publishOfferOrPost(userId, lots[0].offerId, "https://www.facebook.com/groups/221201/pending/9", "pending");
    await withdrawOfferOrPost(userId, lots[0].offerId);
    const access = (await verifyFacebookPostPreviewToken(token))!;
    assert.equal((await readSharedFacebookPostPreview(access)).standing, "gone");
  });

  it("keeps the address once the post is deleted, and says in the post's language that it is no longer current", async () => {
    const { postId } = await readyPost("Deleted", ["Del 1"]);
    const { token } = await createFacebookPostPreviewToken(userId, postId);
    await deleteFacebookPost(userId, postId);

    const access = await verifyFacebookPostPreviewToken(token);
    assert.ok(access);
    assert.equal(access.postId, null);
    assert.deepEqual(await readSharedFacebookPostPreview(access), { standing: "gone", postNo: null, language: "pl" });
    assert.equal(await canServeFacebookPostPreviewPhoto(access, "anything"), false);
  });

  it("ends the old address on a new link, and every address on a withdrawal", async () => {
    const { postId } = await readyPost("Replaced", ["Rep 1"]);
    const first = await createFacebookPostPreviewToken(userId, postId);
    const second = await createFacebookPostPreviewToken(userId, postId);
    assert.equal(await verifyFacebookPostPreviewToken(first.token), null);
    assert.ok(await verifyFacebookPostPreviewToken(second.token));
    assert.equal(await prisma.facebookPostPreviewToken.count({ where: { postId } }), 1);

    await revokeFacebookPostPreviewToken(userId, postId);
    assert.equal(await verifyFacebookPostPreviewToken(second.token), null);
    assert.equal((await readFacebookPostPreviewShareState(userId, postId)).link, null);
    assert.equal(await verifyFacebookPostPreviewToken("stmpo_not-this-kind"), null);
  });

  it("serves the post's lots' generated images and nothing else", async () => {
    const { postId, lots } = await readyPost("Photos", ["Ph 1"]);
    const other = await readyPost("Other post", ["Ph other"]);
    const { token } = await createFacebookPostPreviewToken(userId, postId);
    const access = (await verifyFacebookPostPreviewToken(token, { touch: false }))!;

    const generated = async (offerId: string) => {
      const photo = await prisma.photo.create({
        data: {
          offerId,
          kind: "generated",
          storageKey: `fbpreview-${Math.random()}.jpg`,
          mime: "image/jpeg",
          width: 10,
          height: 10,
          sizeBytes: 100,
        },
      });
      await prisma.offerPhotoEntry.create({ data: { offerId, photoId: photo.id, sortOrder: 0, setIds: [] } });
      return photo.id;
    };
    const lotImage = await generated(lots[0].offerId);
    const otherImage = await generated(other.lots[0].offerId);
    const copyScan = (
      await prisma.photo.create({
        data: {
          itemId: lots[0].itemId,
          role: "front",
          storageKey: `fbpreview-${Math.random()}.jpg`,
          mime: "image/jpeg",
          width: 10,
          height: 10,
          sizeBytes: 100,
        },
      })
    ).id;

    assert.equal(await canServeFacebookPostPreviewPhoto(access, lotImage), true);
    assert.equal(await canServeFacebookPostPreviewPhoto(access, otherImage), false);
    assert.equal(await canServeFacebookPostPreviewPhoto(access, copyScan), false);

    // Nothing while the page shows only a notice.
    await takeFacebookPostBackToPreparing(userId, postId);
    assert.equal(await canServeFacebookPostPreviewPhoto(access, lotImage), false);
  });
});
