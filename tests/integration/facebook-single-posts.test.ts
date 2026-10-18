import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, deleteOffer, getOfferDetail, patchOffer, readOfferPostTitles, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { getFacebookOfferKit } from "../../src/lib/facebook-auctions";
import {
  createFacebookPost,
  getFacebookPostScreen,
  listFacebookOffersNotInPost,
  listFacebookPostsPaginated,
  publishOfferOrPost,
  rejectOfferOrPost,
  removeFacebookLot,
  titleUntitledFacebookPostsOfOne,
} from "../../src/lib/facebook-posts";

// Every Facebook offer that has gone up is in a post (#1989): an offer published in no post gets its
// post of one lot then — numbered, titled as *Publish…* was told or with the offer's own title (#2068)
// — and never when it is created. A post of one lot reads as an offer posted alone always did (no lot number, laid out as
// text), is listed beside the posts of several, and survives as long as its lot has gone up; the
// Facebook offers not yet in a post are listed as *Not in a post yet*. The migration's backfill is the
// same shape, written in SQL.

const MIGRATION = fileURLToPath(
  new URL("../../prisma/migrations/20261016180000_facebook_every_offer_in_post/migration.sql", import.meta.url)
);

/** Thrown to roll the migration's transaction back once its effects have been read. */
class RolledBack extends Error {}

describe("every Facebook offer that goes up is in a post (#1989)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let conditionId: string;
  let groupId: string;
  let otherGroupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbsingle-${ts}`;
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
        data: { slug: `col-fbsingle-${ts}`, name: `fbsingle-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — pojedyncze",
        url: "https://www.facebook.com/groups/198901",
      })
    ).id;
    otherGroupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — inna grupa",
        url: "https://www.facebook.com/groups/198902",
      })
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** A Facebook auction over one fresh copy, in `state` (Ready by default) and `group`. */
  async function offer(
    { state = "ready", group = groupId, url = null }: { state?: "preparing" | "ready" | "active"; group?: string; url?: string | null } = {}
  ): Promise<string> {
    const stamp = await prisma.stamp.create({ data: { collectionId, name: `Stamp ${Math.random()}` } });
    const item = await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true });
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url,
        price: "0.00",
        startingPrice: "5.00",
        currency: "PLN",
        listingDate: null,
        state: state === "active" ? "active" : "preparing",
        facebookGroupId: group,
        listingType: "auction",
      },
      { seedItemIds: [item.id] }
    );
    if (state === "ready") await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  const postOf = async (offerId: string) =>
    (await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { facebookPostId: true, facebookLotNo: true } }));

  it("creates no post when an offer is created", async () => {
    const id = await offer();
    assert.deepEqual(await postOf(id), { facebookPostId: null, facebookLotNo: null });
  });

  it("gives an offer published in no post its post of one lot, numbered and titled as asked", async () => {
    const before = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId }, select: { nextFacebookPostNo: true } });
    const id = await offer();
    await publishOfferOrPost(userId, id, "https://www.facebook.com/groups/198901/posts/1", "active", undefined, "  Poczta Polska 1950  ");

    const { facebookPostId, facebookLotNo } = await postOf(id);
    assert.ok(facebookPostId, "the published offer is in a post");
    assert.equal(facebookLotNo, 1);
    const post = await prisma.facebookPost.findUniqueOrThrow({ where: { id: facebookPostId } });
    assert.equal(post.postNo, before.nextFacebookPostNo, "numbered from the collection's counter");
    assert.equal(post.title, "Poczta Polska 1950");
    assert.equal(post.groupId, groupId);
    const row = await prisma.offer.findUniqueOrThrow({ where: { id }, select: { state: true, url: true, facebookPostSnapshot: true } });
    assert.equal(row.state, "active");
    assert.equal(row.url, "https://www.facebook.com/groups/198901/posts/1", "the link is the offer's own, as it was");
    assert.notEqual(row.facebookPostSnapshot, null, "its text is frozen as it went up");
  });


  it("reads a post of one lot as an offer posted alone: no lot number, laid out as text, the offer's own ZIP", async () => {
    await prisma.facebookGroup.update({
      where: { id: groupId },
      data: { multiLotLayout: "captions", customSettings: ["multiLotLayout"] },
    });
    try {
      const id = await offer();
      await publishOfferOrPost(userId, id, null);
      const kit = (await getFacebookOfferKit(id))!;
      assert.ok(kit.post, "the kit names its post");
      assert.equal(kit.lots.length, 1);
      assert.equal(kit.lots[0].lotNo, null, "{lot} stays empty, as on a single post");
      assert.equal(kit.layout, "text", "the group's layout for several lots does not apply");
      assert.match(kit.photoZipPath, new RegExp(`/offers/${id}/photos/zip$`));
      const snapshot = (await prisma.offer.findUniqueOrThrow({ where: { id }, select: { facebookPostSnapshot: true } }))
        .facebookPostSnapshot as { layout: string };
      assert.equal(snapshot.layout, "text", "and it was frozen so");
      const screen = (await getFacebookPostScreen(userId, kit.post.id))!;
      assert.deepEqual(screen.kit.lots.map((l) => l.offerId), [id], "its screen is the post's, with one row");
    } finally {
      await prisma.facebookGroup.update({ where: { id: groupId }, data: { multiLotLayout: "text", customSettings: [] } });
    }
  });

  it("makes the post on submission for approval, keeps it through a rejection, and approves through it", async () => {
    const id = await offer();
    await publishOfferOrPost(userId, id, "https://www.facebook.com/groups/198901/pending_posts/7", "pending");
    const { facebookPostId } = await postOf(id);
    assert.ok(facebookPostId, "a post waiting for approval is up — it has its post");

    await rejectOfferOrPost(userId, id);
    assert.equal((await postOf(id)).facebookPostId, facebookPostId, "turned down, it is still its post");
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id } })).state, "ready");

    await publishOfferOrPost(userId, id, "https://www.facebook.com/groups/198901/posts/8");
    assert.equal((await postOf(id)).facebookPostId, facebookPostId, "published again, through the same post");
    assert.equal(await prisma.facebookPost.count({ where: { lots: { some: { id } } } }), 1);
  });

  it("gives an offer created already up its post too", async () => {
    const id = await offer({ state: "active", url: "https://www.facebook.com/groups/198901/posts/9" });
    const { facebookPostId, facebookLotNo } = await postOf(id);
    assert.ok(facebookPostId);
    assert.equal(facebookLotNo, 1);
  });

  it("goes through setOfferState itself, whatever path publishes", async () => {
    const id = await offer();
    await setOfferState(userId, id, "active");
    assert.ok((await postOf(id)).facebookPostId);
  });

  it("lists a post of one lot beside the posts of several", async () => {
    const single = await offer();
    await publishOfferOrPost(userId, single, null, "active", undefined, "Alone");
    const a = await offer();
    const b = await offer();
    const several = await createFacebookPost(userId, collectionId, [a, b], "Together");

    const { items } = await listFacebookPostsPaginated(userId, collectionId, { pageSize: 200 });
    const alone = items.find((p) => p.title === "Alone");
    assert.ok(alone, "the post of one lot is listed");
    assert.equal(alone.lotCount, 1);
    assert.equal(alone.stage, "up");
    assert.equal(alone.layout, "text");
    assert.ok(items.some((p) => p.postId === several.postId));
  });

  it("lists the Facebook offers in no post and not yet up as Not in a post yet", async () => {
    const preparing = await offer({ state: "preparing" });
    const ready = await offer();
    const elsewhere = await offer({ group: otherGroupId });
    const published = await offer();
    await publishOfferOrPost(userId, published, null);
    const grouped = await offer();
    const partner = await offer();
    await createFacebookPost(userId, collectionId, [grouped, partner], "Grouped");

    const ids = (await listFacebookOffersNotInPost(userId, collectionId)).map((o) => o.offerId);
    for (const id of [preparing, ready, elsewhere]) assert.ok(ids.includes(id), "an offer in no post is named");
    for (const id of [published, grouped, partner]) assert.ok(!ids.includes(id), "an offer in a post is not");

    const inGroup = (await listFacebookOffersNotInPost(userId, collectionId, { groupIds: [otherGroupId] })).map((o) => o.offerId);
    assert.deepEqual(inGroup, [elsewhere], "narrowed to a group");
    const onlyReady = (await listFacebookOffersNotInPost(userId, collectionId, { states: ["ready"] })).map((o) => o.offerId);
    assert.ok(onlyReady.includes(ready) && !onlyReady.includes(preparing), "narrowed to a state");
    const posted = await listFacebookOffersNotInPost(userId, collectionId, { states: ["active"] });
    assert.deepEqual(posted, [], "a state an offer in no post cannot be in names nothing");
  });

  it("groups offers in no post, and a lot taken out of a post not yet up is in no post again", async () => {
    const a = await offer();
    const b = await offer();
    const c = await offer();
    const post = await createFacebookPost(userId, collectionId, [a, b, c], "Three");

    await removeFacebookLot(userId, a);
    assert.deepEqual(await postOf(a), { facebookPostId: null, facebookLotNo: null });
    await removeFacebookLot(userId, b);
    assert.deepEqual(await postOf(c), { facebookPostId: null, facebookLotNo: null }, "left with one lot not yet up, the post is dissolved");
    assert.equal(await prisma.facebookPost.count({ where: { id: post.postId } }), 0);

    const published = await offer();
    await publishOfferOrPost(userId, published, null);
    await assert.rejects(
      createFacebookPost(userId, collectionId, [published, a], "Too late"),
      /already a lot of another post|already up/,
      "an offer that went up is in its own post and cannot be grouped"
    );
  });

  it("keeps a post that has gone up when it is left with one lot, and removes it with its last", async () => {
    const a = await offer();
    const b = await offer();
    const post = await createFacebookPost(userId, collectionId, [a, b], "Up together");
    await publishOfferOrPost(userId, a, "https://www.facebook.com/groups/198901/posts/10");

    await deleteOffer(userId, a);
    assert.deepEqual(await postOf(b), { facebookPostId: post.postId, facebookLotNo: 1 }, "a published lot stays in its post");

    await deleteOffer(userId, b);
    assert.equal(await prisma.facebookPost.count({ where: { id: post.postId } }), 0, "a post with no lot is removed");
  });

  it("names its post on the offers list as Post #N, with no lot number", async () => {
    const id = await offer();
    await publishOfferOrPost(userId, id, null);
    const detail = await getOfferDetail(userId, id);
    assert.ok(detail?.facebook?.post);
    const { facebookPostId } = await postOf(id);
    const post = await prisma.facebookPost.findUniqueOrThrow({ where: { id: facebookPostId! } });
    const { listOffersPaginated } = await import("../../src/lib/offers");
    const page = await listOffersPaginated(userId, collectionId, { facebookPostNo: post.postNo });
    assert.deepEqual(
      page.items.map((o) => o.facebookPost),
      [{ postNo: post.postNo, title: post.title, lotNo: null }]
    );
  });

  describe("its title (#2068)", () => {
    const titleOf = async (offerId: string) => {
      const { facebookPostId } = await postOf(offerId);
      assert.ok(facebookPostId, "the offer is in a post");
      return (await prisma.facebookPost.findUniqueOrThrow({ where: { id: facebookPostId } })).title;
    };
    const named = async (name: string) => {
      const id = await offer();
      await prisma.offer.update({ where: { id }, data: { name, nameEdited: true } });
      return id;
    };

    it("takes the offer's title when Publish… is left as offered", async () => {
      const id = await named("Polska 1950 — Odbudowa Warszawy");
      await publishOfferOrPost(userId, id, null, "active", undefined, "Polska 1950 — Odbudowa Warszawy");
      assert.equal(await titleOf(id), "Polska 1950 — Odbudowa Warszawy");
    });

    it("takes the offer's title when the field was emptied, or not asked at all", async () => {
      const cleared = await named("Polska 1951 — Plan 6-letni");
      await publishOfferOrPost(userId, cleared, null, "active", undefined, "   ");
      assert.equal(await titleOf(cleared), "Polska 1951 — Plan 6-letni");

      const unasked = await named("Polska 1952 — Konstytucja");
      await setOfferState(userId, unasked, "active");
      assert.equal(await titleOf(unasked), "Polska 1952 — Konstytucja", "any path that puts it up");
    });

    it("uses a title typed in the dialog instead", async () => {
      const id = await named("Polska 1953");
      await publishOfferOrPost(userId, id, null, "active", undefined, "Na wymianę");
      assert.equal(await titleOf(id), "Na wymianę");
    });

    it("takes the label derived from the offer's sets when the offer has no stored title", async () => {
      const id = await offer();
      await prisma.offer.update({ where: { id }, data: { name: null, nameEdited: true } });
      const expected = (await readOfferPostTitles([id])).get(id);
      assert.ok(expected, "an offer with copies has a derived label");
      await publishOfferOrPost(userId, id, null);
      assert.equal(await titleOf(id), expected);
    });

    it("copies it once: renaming the offer later leaves the post's title as it was", async () => {
      const id = await named("Polska 1954");
      await publishOfferOrPost(userId, id, null);
      await patchOffer(userId, id, { name: "Polska 1954 — po zmianie" });
      assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id } })).name, "Polska 1954 — po zmianie");
      assert.equal(await titleOf(id), "Polska 1954");
    });

    it("gives existing untitled posts of one offer their offer's title, and leaves the rest (the boot pass)", async () => {
      const alone = await named("Polska 1955");
      await publishOfferOrPost(userId, alone, null);
      const titled = await named("Polska 1956");
      await publishOfferOrPost(userId, titled, null, "active", undefined, "Własny tytuł");
      const lotA = await offer();
      const lotB = await offer();
      const several = await createFacebookPost(userId, collectionId, [lotA, lotB], "Several");
      // As the data stood before: a post of one went up untitled, as did a post of several made
      // before posts had titles.
      const aloneId = (await postOf(alone)).facebookPostId!;
      await prisma.facebookPost.updateMany({ where: { id: { in: [aloneId, several.postId] } }, data: { title: null } });

      assert.ok((await titleUntitledFacebookPostsOfOne()) >= 1);
      assert.equal(await titleOf(alone), "Polska 1955");
      assert.equal(await titleOf(titled), "Własny tytuł", "a post with a title is not touched");
      assert.equal(await titleOf(lotA), null, "a post of several keeps asking for its own");

      await prisma.offer.update({ where: { id: alone }, data: { name: "Polska 1955 — inna" } });
      await titleUntitledFacebookPostsOfOne();
      assert.equal(await titleOf(alone), "Polska 1955", "and a second pass changes nothing");
    });
  });

  it("backfills a post of one lot for every Facebook offer up in no post, in creation order (the migration)", async () => {
    // As the data stood before: offers that went up alone carried no post.
    const first = await offer({ state: "active", url: "https://www.facebook.com/groups/198901/posts/20" });
    const second = await offer();
    await setOfferState(userId, second, "active");
    await setOfferState(userId, second, "withdrawn");
    for (const id of [first, second]) {
      const { facebookPostId } = await postOf(id);
      await prisma.offer.update({ where: { id }, data: { facebookPostId: null, facebookLotNo: null } });
      await prisma.facebookPost.delete({ where: { id: facebookPostId! } });
    }
    const ready = await offer();
    const lotA = await offer();
    const lotB = await offer();
    const several = await createFacebookPost(userId, collectionId, [lotA, lotB], "Several");
    const frozenBefore = (await prisma.offer.findUniqueOrThrow({ where: { id: first } })).facebookPostSnapshot;
    const next = (await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).nextFacebookPostNo;

    const sql = await readFile(MIGRATION, "utf8");
    await assert.rejects(
      prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(sql);
          const rows = await tx.offer.findMany({
            where: { id: { in: [first, second, ready, lotA] } },
            select: { id: true, state: true, url: true, facebookLotNo: true, facebookPostSnapshot: true, facebookPost: true },
          });
          const byId = new Map(rows.map((r) => [r.id, r]));
          const a = byId.get(first)!;
          const b = byId.get(second)!;
          assert.equal(a.facebookPost?.postNo, next, "numbered from the counter, oldest offer first");
          assert.equal(b.facebookPost?.postNo, next + 1);
          for (const r of [a, b]) {
            assert.equal(r.facebookLotNo, 1);
            assert.equal(r.facebookPost?.groupId, groupId);
            assert.equal(r.facebookPost?.title, null, "untitled — a title is the collector's words");
            assert.equal(r.facebookPost?.layout, null);
          }
          assert.equal(a.state, "active");
          assert.equal(a.url, "https://www.facebook.com/groups/198901/posts/20", "its link stays where it was");
          assert.deepEqual(a.facebookPostSnapshot, frozenBefore, "and its frozen text");
          assert.equal(b.state, "withdrawn", "an offer that went up and closed gets its post too");
          assert.equal(byId.get(ready)!.facebookPost, null, "an offer not yet up gets none");
          assert.equal(byId.get(lotA)!.facebookPost?.id, several.postId, "a lot of a post keeps its post");
          const counter = await tx.collection.findUniqueOrThrow({ where: { id: collectionId } });
          assert.equal(counter.nextFacebookPostNo, next + 2, "the counter moves past the numbers given");
          throw new RolledBack();
        },
        { timeout: 60_000, maxWait: 60_000 }
      ),
      RolledBack
    );
  });
});
