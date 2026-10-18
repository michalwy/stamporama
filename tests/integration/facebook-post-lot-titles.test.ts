import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, patchOffer, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import {
  addFacebookLots,
  changeFacebookLotTitleWords,
  createFacebookPost,
  getFacebookPostScreen,
  publishOfferOrPost,
  setFacebookPostTitleTemplate,
} from "../../src/lib/facebook-posts";

// A post's lot titles changed all at once (#2033): a title template given to every lot, which writes
// their titles again — a hand-written one only when ticked — and the same words added to or removed
// from the start or end of every title; neither once the post is up (#1800).

describe("changing a Facebook post's lot titles at once (#2033)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let groupId: string;
  let conditionId: string;
  let areaId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbposttitles-${ts}`;
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
        data: { slug: `col-fbposttitles-${ts}`, name: `fbposttitles-${ts}`, baseCurrency: "PLN", ownerId: userId, defaultLanguage: "en" },
      })
    ).id;
    // The platform's title prints the stamp's name; a post's template is what the test gives it.
    facebookId = (
      await prisma.platform.create({
        data: {
          collectionId,
          name: "Facebook",
          platformCurrency: "PLN",
          titleTemplate: "{name}",
          descriptionTemplate: "From {area}",
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
        url: "https://www.facebook.com/groups/189001",
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

  async function lotTitles(postId: string) {
    return (await getFacebookPostScreen(userId, postId))!.lotTitles;
  }

  async function title(offerId: string) {
    return prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { name: true, nameEdited: true, nameTemplate: true },
    });
  }

  it("opens on the platform's title template, then on the one the lots were given", async () => {
    const a = await lot("Mercury");
    const b = await lot("Venus");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Start");
    assert.deepEqual(await lotTitles(postId), { template: "{name}", handWritten: [] });

    await setFacebookPostTitleTemplate(userId, postId, "{name} — {area}", []);
    assert.deepEqual(await lotTitles(postId), { template: "{name} — {area}", handWritten: [] });
  });

  it("writes every lot's title from the template, keeping a hand-written one unless it is ticked", async () => {
    const a = await lot("Mars");
    const b = await lot("Jupiter");
    const c = await lot("Saturn");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId, c.offerId], "Template");
    await patchOffer(userId, b.offerId, { name: "Jupiter, by hand" });
    await patchOffer(userId, c.offerId, { name: "Saturn, by hand" });
    assert.deepEqual((await lotTitles(postId))!.handWritten, [b.offerId, c.offerId]);

    assert.equal(await setFacebookPostTitleTemplate(userId, postId, "  Planet {name}  ", [c.offerId]), 2);
    assert.deepEqual(await title(a.offerId), { name: "Planet Mars", nameEdited: false, nameTemplate: "Planet {name}" });
    assert.deepEqual(await title(b.offerId), {
      name: "Jupiter, by hand",
      nameEdited: true,
      nameTemplate: "Planet {name}",
    });
    assert.deepEqual(await title(c.offerId), { name: "Planet Saturn", nameEdited: false, nameTemplate: "Planet {name}" });
  });

  it("leaves a lot added later its own title", async () => {
    const a = await lot("Ceres");
    const b = await lot("Vesta");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Later");
    await setFacebookPostTitleTemplate(userId, postId, "Asteroid {name}", []);
    const later = await lot("Pallas");
    await addFacebookLots(userId, postId, [later.offerId]);
    assert.deepEqual(await title(later.offerId), { name: "Pallas", nameEdited: false, nameTemplate: null });
  });

  it("refuses a blank template, and an offer that is not a lot of the post", async () => {
    const a = await lot("Io");
    const b = await lot("Europa");
    const stranger = await lot("Ganymede");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Refusals");
    await assert.rejects(setFacebookPostTitleTemplate(userId, postId, "   ", []), /Write a title template/);
    await assert.rejects(setFacebookPostTitleTemplate(userId, postId, "{name}", [stranger.offerId]), /own lots/);
    assert.equal((await title(a.offerId)).nameTemplate, null);
  });

  it("adds the words to the start or end of every title, hand-written ones included, and makes them hand-written", async () => {
    const a = await lot("Titan");
    const b = await lot("Rhea");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Add");
    await patchOffer(userId, b.offerId, { name: "Rhea, by hand" });

    assert.equal(await changeFacebookLotTitleWords(userId, postId, "RARE", "start", "add"), 2);
    assert.equal(await changeFacebookLotTitleWords(userId, postId, "– mint", "end", "add"), 2);
    assert.deepEqual(await title(a.offerId), { name: "RARE Titan – mint", nameEdited: true, nameTemplate: null });
    assert.deepEqual(await title(b.offerId), { name: "RARE Rhea, by hand – mint", nameEdited: true, nameTemplate: null });
  });

  it("removes the words only where a title starts or ends with them exactly", async () => {
    const a = await lot("Triton");
    const b = await lot("Nereid");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Remove");
    await patchOffer(userId, a.offerId, { name: "RARE Triton" });
    await patchOffer(userId, b.offerId, { name: "Nereid RARE" });

    assert.equal(await changeFacebookLotTitleWords(userId, postId, "RARE", "start", "remove"), 1);
    assert.equal((await title(a.offerId)).name, "Triton");
    assert.equal((await title(b.offerId)).name, "Nereid RARE");
    await assert.rejects(changeFacebookLotTitleWords(userId, postId, "  ", "end", "remove"), /Write the words/);
  });

  it("is not offered once the post is up, and refused — the posted text is frozen (#1800)", async () => {
    const a = await lot("Charon");
    const b = await lot("Nix");
    const { postId } = await createFacebookPost(userId, collectionId, [a.offerId, b.offerId], "Up");
    await publishOfferOrPost(userId, a.offerId, "https://www.facebook.com/groups/189001/posts/2");

    assert.equal(await lotTitles(postId), null);
    await assert.rejects(setFacebookPostTitleTemplate(userId, postId, "{name}", []), /The post is up/);
    await assert.rejects(changeFacebookLotTitleWords(userId, postId, "RARE", "start", "add"), /The post is up/);
    assert.equal((await title(a.offerId)).name, "Charon");
  });
});
