import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { stageUpload, applyPhotoChangeSet } from "../../src/lib/photos";
import { setFacebookPlatform } from "../../src/lib/facebook";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { FACEBOOK_POST_STAGES } from "../../src/lib/facebook-post-rules";
import {
  createFacebookPost,
  listFacebookPostGroups,
  listFacebookPostsPaginated,
  publishOfferOrPost,
  setFacebookPostLayout,
} from "../../src/lib/facebook-posts";

// Bytes go through the filesystem backend, pointed at a throwaway directory (the photo tests' rule).
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-fb-posts-list-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// The list of multi-lot Facebook posts (#1850): newest first, each row read off its lots, and the
// stage filter — a query over the lots, since the stage is no column — holding exactly the posts
// whose own stage it names.

describe("the list of Facebook posts (#1850)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupA: string;
  let groupB: string;
  const posts: Record<"preparing" | "ready" | "up" | "over", { postId: string; postNo: number }> = {} as never;
  const LINK = "https://www.facebook.com/groups/190000/posts/7";

  /** A Ready Facebook auction in `groupId` over one fresh copy with a front scan. */
  async function offer(groupId: string): Promise<string> {
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
    const scan = await sharp({ create: { width: 80, height: 100, channels: 3, background: { r: 40, g: 90, b: 160 } } })
      .png()
      .toBuffer();
    const upload = await stageUpload(userId, collectionId, { bytes: scan, mime: "image/png" });
    await applyPhotoChangeSet(userId, item.id, {
      add: [{ uploadId: upload.id, role: "front", title: null, sortOrder: 0 }],
      update: [],
      remove: [],
    });
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
    return offerId;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbpostslist-${ts}`;
    otherUserId = `test-user-fbpostslist-other-${ts}`;
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
        data: { slug: `col-fbpostslist-${ts}`, name: `fbpostslist-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.contact.create({
        data: { collectionId, name: "Facebook", platform: true, platformCurrency: "PLN", maxPhotoEdge: 2000 },
      })
    ).id;
    await setFacebookPlatform(userId, collectionId, facebookId);
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    for (const [name, n] of [
      ["Aukcje znaczków", 190000],
      ["Znaczki — giełda", 190001],
    ] as const) {
      const id = (
        await createFacebookGroup(userId, collectionId, {
          ...FACEBOOK_GROUP_DEFAULTS,
          name,
          url: `https://www.facebook.com/groups/${n}`,
          postTemplate: "{lot}. {title}",
          custom: ["postTemplate"],
        })
      ).id;
      if (n === 190000) groupA = id;
      else groupB = id;
    }

    // Oldest first: one still being prepared, one ready and captioned, one up with a lot withdrawn,
    // and one over.
    const prep = [await offer(groupA), await offer(groupA)];
    posts.preparing = await createFacebookPost(userId, collectionId, prep);
    await setOfferState(userId, prep[1], "preparing");

    posts.ready = await createFacebookPost(userId, collectionId, [await offer(groupA), await offer(groupA)]);
    await setFacebookPostLayout(userId, posts.ready.postId, "captions");

    const up = [await offer(groupB), await offer(groupB)];
    posts.up = await createFacebookPost(userId, collectionId, up);
    await publishOfferOrPost(userId, up[0], LINK);
    await setOfferState(userId, up[1], "withdrawn");

    const over = [await offer(groupA), await offer(groupA)];
    posts.over = await createFacebookPost(userId, collectionId, over);
    await publishOfferOrPost(userId, over[0], "https://www.facebook.com/groups/190000/posts/8");
    for (const id of over) await setOfferState(userId, id, "withdrawn");
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("lists every post newest first, each row read off its lots", async () => {
    const { items, nextCursor } = await listFacebookPostsPaginated(userId, collectionId);
    assert.equal(nextCursor, null);
    assert.deepEqual(
      items.map((i) => i.postNo),
      [posts.over.postNo, posts.up.postNo, posts.ready.postNo, posts.preparing.postNo]
    );
    const byId = new Map(items.map((i) => [i.postId, i]));

    const up = byId.get(posts.up.postId)!;
    assert.deepEqual(up.group, { id: groupB, name: "Znaczki — giełda", archived: false });
    assert.equal(up.lotCount, 2);
    assert.equal(up.forSaleCount, 1, "the withdrawn lot is no longer for sale");
    assert.equal(up.stage, "up");
    assert.equal(up.layout, "text");
    assert.equal(up.link, LINK);
    assert.equal(up.postedOn, new Date().toISOString().slice(0, 10));

    const ready = byId.get(posts.ready.postId)!;
    assert.equal(ready.stage, "ready");
    assert.equal(ready.layout, "captions");
    assert.equal(ready.forSaleCount, 2);
    assert.equal(ready.postedOn, null);
    assert.equal(ready.link, null);

    assert.equal(byId.get(posts.preparing.postId)!.stage, "preparing");
    const over = byId.get(posts.over.postId)!;
    assert.equal(over.stage, "over");
    assert.equal(over.forSaleCount, 0);
  });

  it("filters by stage to exactly the posts whose own stage it names", async () => {
    const all = (await listFacebookPostsPaginated(userId, collectionId)).items;
    for (const stage of FACEBOOK_POST_STAGES) {
      const { items } = await listFacebookPostsPaginated(userId, collectionId, { stage });
      assert.deepEqual(
        items.map((i) => i.postId),
        all.filter((i) => i.stage === stage).map((i) => i.postId),
        stage
      );
    }
    assert.deepEqual(
      (await listFacebookPostsPaginated(userId, collectionId, { stage: "up" })).items.map((i) => i.postId),
      [posts.up.postId]
    );
  });

  it("filters by group, and offers the groups holding posts", async () => {
    const { items } = await listFacebookPostsPaginated(userId, collectionId, { groupIds: [groupB] });
    assert.deepEqual(items.map((i) => i.postId), [posts.up.postId]);
    const inA = await listFacebookPostsPaginated(userId, collectionId, { groupIds: [groupA], stage: "over" });
    assert.deepEqual(inA.items.map((i) => i.postId), [posts.over.postId]);

    assert.deepEqual(
      (await listFacebookPostGroups(userId, collectionId)).map((g) => g.id),
      [groupA, groupB]
    );
  });

  it("pages by offset", async () => {
    const first = await listFacebookPostsPaginated(userId, collectionId, { pageSize: 3 });
    assert.equal(first.items.length, 3);
    assert.equal(first.nextCursor, "3");
    const second = await listFacebookPostsPaginated(userId, collectionId, { pageSize: 3, offset: 3 });
    assert.deepEqual(second.items.map((i) => i.postId), [posts.preparing.postId]);
    assert.equal(second.nextCursor, null);
  });

  it("is not read for somebody else", async () => {
    await assert.rejects(listFacebookPostsPaginated(otherUserId, collectionId));
    await assert.rejects(listFacebookPostGroups(otherUserId, collectionId));
  });
});
