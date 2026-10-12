import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { setFacebookPlatform } from "../../src/lib/facebook";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import {
  addFacebookLots,
  createFacebookPost,
  listFacebookLotCandidates,
  listFacebookPostsPaginated,
  publishOfferOrPost,
} from "../../src/lib/facebook-posts";

// Adding offers to a multi-lot post that already exists (#1870): they become its next lots in the order
// given, each asked what *Post together* asks — one that fails is named and the rest are added — the
// auctions share the post's closing time, and a post that is pending or live takes none. The list of
// posts narrowed to those not yet up is what *Add to post…* offers; the candidates are what *Add lots…*
// picks from. Which screen offers which is pure (`tests/unit/facebook-post-rules.test.ts`).

describe("adding offers to an existing multi-lot post (#1870)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;
  let otherGroupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbaddlots-${ts}`;
    otherUserId = `test-user-fbaddlots-other-${ts}`;
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
        data: { slug: `col-fbaddlots-${ts}`, name: `fbaddlots-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.contact.create({
        data: { collectionId, name: "Facebook", platform: true, platformCurrency: "PLN" },
      })
    ).id;
    await setFacebookPlatform(userId, collectionId, facebookId);
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    const group = (name: string, n: number) =>
      createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name,
        url: `https://www.facebook.com/groups/${n}`,
      });
    groupId = (await group("Znaczki — posty", 190001)).id;
    otherGroupId = (await group("Filatelistyka", 190002)).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  /** A Ready Facebook offer over one fresh copy — an auction unless a quick buy is asked for. */
  async function offer(
    opts: { group?: string; quickBuy?: boolean; state?: "preparing" | "ready" } = {}
  ): Promise<string> {
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: opts.quickBuy ? "20.00" : "0.00",
        startingPrice: opts.quickBuy ? null : "3.00",
        currency: "PLN",
        listingDate: null,
        state: "preparing",
        facebookGroupId: opts.group ?? groupId,
        listingType: opts.quickBuy ? "fixed" : "auction",
      },
      { seedItemIds: [item.id] }
    );
    if ((opts.state ?? "ready") === "ready") await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  const lot = (offerId: string) =>
    prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { offerNo: true, facebookPostId: true, facebookLotNo: true, endsAt: true },
    });

  it("adds offers as the post's next lots in the order given, naming each it turns away", async () => {
    const a = await offer();
    const b = await offer();
    const post = await createFacebookPost(userId, collectionId, [a, b], "Generalgouvernement");
    const closes = new Date("2026-11-01T18:00:00Z");
    await prisma.offer.updateMany({ where: { id: { in: [a, b] } }, data: { endsAt: closes } });

    const later = await offer({ state: "preparing" });
    const sooner = await offer();
    const elsewhere = await offer({ group: otherGroupId });
    const quickBuy = await offer({ quickBuy: true });
    const inPost = await offer();
    await createFacebookPost(userId, collectionId, [inPost, await offer()], "Another");

    const result = await addFacebookLots(userId, post.postId, [later, elsewhere, sooner, quickBuy, inPost]);
    assert.equal(result.postNo, post.postNo);
    assert.deepEqual(
      result.added.map((x) => [x.offerId, x.lotNo]),
      [
        [later, 3],
        [sooner, 4],
      ],
      "the next lots, in the order given — a preparing offer joins as a Ready one does"
    );
    const no = async (id: string) => (await lot(id)).offerNo;
    assert.deepEqual(
      result.refused.map((r) => [r.offerId, r.reason]),
      [
        [elsewhere, "is in another group"],
        [quickBuy, "is a quick buy and this post's lots are auctions"],
        [inPost, "is already a lot of another post"],
      ]
    );
    assert.equal(
      result.notAdded,
      `Not added: #${await no(elsewhere)} is in another group; #${await no(quickBuy)} is a quick buy and this post's lots are auctions; #${await no(inPost)} is already a lot of another post.`
    );

    for (const id of [later, sooner]) {
      const row = await lot(id);
      assert.equal(row.facebookPostId, post.postId);
      assert.equal(row.endsAt?.toISOString(), closes.toISOString(), "an added auction takes the post's closing time");
    }
    for (const id of [elsewhere, quickBuy]) assert.equal((await lot(id)).facebookPostId, null);
  });

  it("gives every auction the closing time the first one carries when the post had none", async () => {
    const a = await offer();
    const b = await offer();
    const post = await createFacebookPost(userId, collectionId, [a, b], "Untimed");
    const c = await offer();
    const closes = new Date("2026-11-08T18:00:00Z");
    await prisma.offer.update({ where: { id: c }, data: { endsAt: closes } });
    await addFacebookLots(userId, post.postId, [c]);
    for (const id of [a, b, c]) assert.equal((await lot(id)).endsAt?.toISOString(), closes.toISOString());
  });

  it("writes nothing when no offer can join, and names them all", async () => {
    const a = await offer();
    const b = await offer();
    const post = await createFacebookPost(userId, collectionId, [a, b], "Full");
    const elsewhere = await offer({ group: otherGroupId });
    await assert.rejects(
      () => addFacebookLots(userId, post.postId, [elsewhere, a]),
      (err: Error) => {
        assert.match(err.message, /^Not added: #\d+ is in another group; #\d+ is already a lot of this post\.$/);
        return true;
      }
    );
    assert.equal((await lot(elsewhere)).facebookPostId, null);
    assert.equal((await lot(a)).facebookLotNo, 1);
  });

  it("refuses a post that is pending or live, and offers no candidates for it", async () => {
    const a = await offer();
    const b = await offer();
    const post = await createFacebookPost(userId, collectionId, [a, b], "Submitted");
    const c = await offer();
    assert.ok((await listFacebookLotCandidates(userId, collectionId, post.postId)).some((o) => o.offerId === c));

    await publishOfferOrPost(userId, a, "https://www.facebook.com/groups/190001/pending/1", "pending");
    await assert.rejects(() => addFacebookLots(userId, post.postId, [c]), /is up, so it takes no new lots/);
    assert.equal((await lot(c)).facebookPostId, null);
    assert.deepEqual(await listFacebookLotCandidates(userId, collectionId, post.postId), []);

    await publishOfferOrPost(userId, a, "https://www.facebook.com/groups/190001/posts/1", "active");
    await assert.rejects(() => addFacebookLots(userId, post.postId, [c]), /is up, so it takes no new lots/);
  });

  it("lists as candidates only the offers that could join, and only to the collection's owner", async () => {
    const a = await offer();
    const b = await offer();
    const post = await createFacebookPost(userId, collectionId, [a, b], "Candidates");
    const free = await offer();
    const preparing = await offer({ state: "preparing" });
    const elsewhere = await offer({ group: otherGroupId });
    const quickBuy = await offer({ quickBuy: true });
    const ids = (await listFacebookLotCandidates(userId, collectionId, post.postId)).map((o) => o.offerId);
    assert.ok(ids.includes(free) && ids.includes(preparing));
    for (const id of [a, b, elsewhere, quickBuy]) assert.ok(!ids.includes(id));

    await assert.rejects(() => listFacebookLotCandidates(otherUserId, collectionId, post.postId));
    await assert.rejects(() => addFacebookLots(otherUserId, post.postId, [free]));
  });

  it("lists, for Add to post, only the posts not yet up — beside any stage filter", async () => {
    const ready = await createFacebookPost(userId, collectionId, [await offer(), await offer()], "Ready one");
    const preparing = await createFacebookPost(
      userId,
      collectionId,
      [await offer({ state: "preparing" }), await offer()],
      "Preparing one"
    );
    const upLot = await offer();
    const up = await createFacebookPost(userId, collectionId, [upLot, await offer()], "Up one");
    await publishOfferOrPost(userId, upLot, "https://www.facebook.com/groups/190001/posts/2", "active");

    const open = await listFacebookPostsPaginated(userId, collectionId, { groupIds: [groupId], notUp: true });
    const nos = open.items.map((p) => p.postNo);
    assert.ok(nos.includes(ready.postNo) && nos.includes(preparing.postNo));
    assert.ok(!nos.includes(up.postNo));
    assert.ok(open.items.every((p) => p.stage === "ready" || p.stage === "preparing"));
    assert.deepEqual(nos, [...nos].sort((x, y) => y - x), "newest first");

    const readyOnly = await listFacebookPostsPaginated(userId, collectionId, { notUp: true, stage: "ready" });
    assert.ok(readyOnly.items.length > 0 && readyOnly.items.every((p) => p.stage === "ready"));
    assert.ok(!readyOnly.items.some((p) => p.postNo === preparing.postNo));

    const otherGroup = await listFacebookPostsPaginated(userId, collectionId, { groupIds: [otherGroupId], notUp: true });
    assert.deepEqual(otherGroup.items, []);
  });
});
