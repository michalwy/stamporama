import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState, type NewOfferInput, type OfferInput } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { createFacebookPost, getFacebookPostScreen, publishOfferOrPost } from "../../src/lib/facebook-posts";
import { moveProposal } from "../../src/lib/proposals";
import { createProposalShareToken } from "../../src/lib/proposal-handout";
import { getPhonePost } from "../../src/lib/phone-posts";
import { getPhoneProposal } from "../../src/lib/phone-proposals";
import { phonePostCanPropose } from "../../src/lib/phone-post-view";
import { makePhonePostProposal } from "../../src/lib/phone-post-proposal";

// The post's phone screen reads the lots' photos, through the photo store.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-phone-post-proposal-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// A post not yet up made into a proposal from the phone (#2632): the desk's *Make a proposal…* (#2602)
// for a contact picked or typed as the phone's contact fields take one, landing on a proposal of the
// post's own lots under their numbers, which the desk's post screen links. The pure half — where the
// move is offered — is in `tests/unit/phone-post-view.test.ts`.

describe("making a proposal of a post from the phone (#2632)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-phonepostprop-${ts}`;
    otherUserId = `test-user-phonepostprop-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: `Test User ${id}`, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-phonepostprop-${ts}`, name: `phonepostprop-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-phonepostprop-o-${ts}`, name: `phonepostprop-o-${ts}`, baseCurrency: "PLN", ownerId: otherUserId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — aukcje",
        url: "https://www.facebook.com/groups/123456",
      })
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.proposal.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  function input(): OfferInput & NewOfferInput {
    return {
      platformId: facebookId,
      url: null,
      price: "0.00",
      currency: "PLN",
      listingDate: null,
      facebookGroupId: groupId,
      startingPrice: "3.00",
    };
  }

  /** A post of `count` Ready lots, in lot order. */
  async function post(count: number): Promise<{ postId: string; postNo: number; lots: string[] }> {
    const lots: string[] = [];
    for (let i = 0; i < count; i++) {
      const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
      const offerId = await createOffer(userId, collectionId, input(), { seedItemIds: [item.id] });
      await prisma.offer.update({ where: { id: offerId }, data: { price: "3.00" } });
      await setOfferState(userId, offerId, "ready");
      lots.push(offerId);
    }
    const { postId, postNo } = await createFacebookPost(userId, collectionId, lots, "Test post");
    return { postId, postNo, lots };
  }

  it("makes a post of 8 lots into a proposal of the same 8 lots for a typed name, shared, linked on the desk", async () => {
    const { postId, postNo, lots } = await post(8);
    assert.equal(phonePostCanPropose((await getPhonePost(userId, collectionId, postNo))!), true);

    // A name typed without picking a suggestion is a new contact, with no role, as the desk's *Create*.
    const { proposalId, proposalNo } = await makePhonePostProposal(userId, collectionId, postId, {
      contactId: "",
      contactName: "Regular Buyer",
    });
    const contact = await prisma.contact.findFirstOrThrow({
      where: { collectionId, name: "Regular Buyer" },
      select: { id: true, buyer: true, seller: true },
    });
    assert.deepEqual({ buyer: contact.buyer, seller: contact.seller }, { buyer: false, seller: false });

    const phone = (await getPhoneProposal(userId, collectionId, proposalNo))!;
    assert.equal(phone.proposalId, proposalId);
    assert.equal(phone.status, "preparing");
    assert.equal(phone.contact.name, "Regular Buyer");
    assert.deepEqual(
      phone.lots.map((l) => [l.offerId, l.lotNo]),
      lots.map((id, i) => [id, i + 1])
    );
    assert.equal(phone.post?.postNo, postNo);
    assert.ok(phone.message, "an open proposal has its message to share");

    // Shared from the phone: the link is made, and a share that went through marks it Sent (#2625).
    await createProposalShareToken(userId, proposalId);
    await moveProposal(userId, proposalId, "send");

    // The desk's post screen shows the same proposal linked to the post, and the phone links it instead.
    const desk = await getFacebookPostScreen(userId, postId);
    assert.deepEqual(desk?.proposal, { proposalId, proposalNo, contactName: "Regular Buyer", status: "sent" });
    const after = (await getPhonePost(userId, collectionId, postNo))!;
    assert.equal(after.proposal?.proposalNo, proposalNo);
    assert.equal(phonePostCanPropose(after), false);

    // A post has one open proposal at a time — refused before any contact is made.
    await assert.rejects(
      () => makePhonePostProposal(userId, collectionId, postId, { contactId: "", contactName: "Someone New" }),
      /still open on this post/
    );
    assert.equal(await prisma.contact.count({ where: { collectionId, name: "Someone New" } }), 0);
  });

  it("reuses a picked contact, or one named alike in any case", async () => {
    const existing = await prisma.contact.create({ data: { collectionId, name: "Anna Nowak", buyer: true } });
    const first = await post(2);
    const picked = await makePhonePostProposal(userId, collectionId, first.postId, {
      contactId: existing.id,
      contactName: "Anna Nowak",
    });
    const second = await post(2);
    const typed = await makePhonePostProposal(userId, collectionId, second.postId, {
      contactId: "",
      contactName: "anna nowak",
    });
    const owners = await prisma.proposal.findMany({
      where: { id: { in: [picked.proposalId, typed.proposalId] } },
      select: { contactId: true },
    });
    assert.deepEqual(
      owners.map((o) => o.contactId),
      [existing.id, existing.id]
    );
    assert.equal(await prisma.contact.count({ where: { collectionId, name: { equals: "Anna Nowak", mode: "insensitive" } } }), 1);
  });

  it("is refused once the post is up, without a contact, and for another collection's post", async () => {
    const { postId, postNo, lots } = await post(2);
    await assert.rejects(
      () => makePhonePostProposal(userId, collectionId, postId, { contactId: "", contactName: "  " }),
      /Pick the contact/
    );
    await assert.rejects(
      () => makePhonePostProposal(otherUserId, otherCollectionId, postId, { contactId: "", contactName: "Thief" }),
      /Post not found/
    );
    assert.equal(await prisma.contact.count({ where: { collectionId: otherCollectionId } }), 0);

    await publishOfferOrPost(userId, lots[0]!, "https://www.facebook.com/groups/123456/posts/2");
    assert.equal(phonePostCanPropose((await getPhonePost(userId, collectionId, postNo))!), false);
    await assert.rejects(
      () => makePhonePostProposal(userId, collectionId, postId, { contactId: "", contactName: "Late Buyer" }),
      /is up/
    );
    assert.equal(await prisma.contact.count({ where: { collectionId, name: "Late Buyer" } }), 0);
  });
});
