import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  createOffer,
  deleteOffer,
  duplicateOffer,
  getOfferDetail,
  patchOffer,
  readOfferPostTitles,
  setOfferState,
  syncFollowingPostTitles,
  updateOffer,
} from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { getFacebookOfferKit } from "../../src/lib/facebook-auctions";
import {
  addFacebookLots,
  createFacebookPost,
  getFacebookPostScreen,
  listFacebookPostsPaginated,
  publishOfferOrPost,
  rejectOfferOrPost,
  removeFacebookLot,
  setFacebookPostTitle,
} from "../../src/lib/facebook-posts";

// Every Facebook offer is in a post from the moment it is made (#2116; #1989 made it at publishing):
// a new Facebook offer is a post of one lot, numbered and titled with the offer's title (#2068), which
// the post follows until it is renamed by hand or gains a second lot. Joining another post dissolves
// it; taking a lot out of a post gives it a new one. A post of one lot reads as an offer posted alone
// always did (no lot number, laid out as text), is listed beside the posts of several, and is
// published through the post as any post is. Both migrations' backfills are tested here too, written
// in SQL.

const MIGRATION_1989 = fileURLToPath(
  new URL("../../prisma/migrations/20261016180000_facebook_every_offer_in_post/migration.sql", import.meta.url)
);
const MIGRATION_2116 = fileURLToPath(
  new URL("../../prisma/migrations/20261023120000_facebook_post_from_creation/migration.sql", import.meta.url)
);

/** Thrown to roll the migration's transaction back once its effects have been read. */
class RolledBack extends Error {}

describe("every Facebook offer is in a post from the moment it is made (#1989, #2116)", () => {
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

  /** A Facebook auction over one fresh copy, in `state` (Ready by default) and `group`, titled `name`. */
  async function offer(
    {
      state = "ready",
      group = groupId,
      url = null,
      name,
    }: { state?: "preparing" | "ready" | "active"; group?: string; url?: string | null; name?: string } = {}
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
        ...(name !== undefined ? { name } : {}),
      },
      { seedItemIds: [item.id] }
    );
    if (state === "ready") await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  const postOf = async (offerId: string) =>
    (await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { facebookPostId: true, facebookLotNo: true } }));
  const postRow = async (offerId: string) => {
    const { facebookPostId } = await postOf(offerId);
    assert.ok(facebookPostId, "the offer is in a post");
    return prisma.facebookPost.findUniqueOrThrow({ where: { id: facebookPostId }, include: { _count: { select: { lots: true } } } });
  };
  const counter = async () =>
    (await prisma.collection.findUniqueOrThrow({ where: { id: collectionId }, select: { nextFacebookPostNo: true } }))
      .nextFacebookPostNo;
  /** As the data stood before #2116: the offer in no post, its post gone. */
  async function stripPost(offerId: string): Promise<void> {
    const { facebookPostId } = await postOf(offerId);
    await prisma.offer.update({ where: { id: offerId }, data: { facebookPostId: null, facebookLotNo: null } });
    if (facebookPostId) await prisma.facebookPost.delete({ where: { id: facebookPostId } });
  }

  it("puts a new Facebook offer in a post of one, numbered and titled with the offer's title, before it is published", async () => {
    const next = await counter();
    const id = await offer({ state: "preparing", name: "Polska 1950 — Odbudowa" });
    assert.equal((await postOf(id)).facebookLotNo, 1);
    const post = await postRow(id);
    assert.equal(post.postNo, next, "numbered from the collection's counter");
    assert.equal(post.title, "Polska 1950 — Odbudowa");
    assert.equal(post.titleFollowsOffer, true);
    assert.equal(post.groupId, groupId);
    assert.equal(post._count.lots, 1);
  });

  it("gives a duplicate onto Facebook, and an offer moved onto it, a post of their own — and takes it away off Facebook", async () => {
    const source = await offer();
    const copy = await duplicateOffer(userId, source, {
      platformId: facebookId,
      url: null,
      price: "0.00",
      startingPrice: "5.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
      facebookGroupId: groupId,
      listingType: "auction",
    });
    const copyPost = await postRow(copy.id);
    assert.notEqual(copyPost.id, (await postOf(source)).facebookPostId, "a post of its own");

    const elsewhere = (await prisma.platform.create({ data: { collectionId, name: "Elsewhere", platformCurrency: "PLN" } })).id;
    const base = { url: null, price: "0.00", startingPrice: "5.00", currency: "PLN", listingDate: null, state: "preparing" } as const;
    await updateOffer(userId, copy.id, { ...base, platformId: elsewhere, listingType: "auction" });
    assert.deepEqual(await postOf(copy.id), { facebookPostId: null, facebookLotNo: null }, "off Facebook, in no post");
    assert.equal(await prisma.facebookPost.count({ where: { id: copyPost.id } }), 0, "its post of one went with it");

    await updateOffer(userId, copy.id, { ...base, platformId: facebookId, facebookGroupId: otherGroupId, listingType: "auction" });
    const back = await postRow(copy.id);
    assert.notEqual(back.id, copyPost.id);
    assert.ok(back.postNo > copyPost.postNo, "a new number — the old one is never given again");
    assert.equal(back.groupId, otherGroupId);

    await updateOffer(userId, copy.id, { ...base, platformId: facebookId, facebookGroupId: groupId, listingType: "auction" });
    const moved = await postRow(copy.id);
    assert.equal(moved.id, back.id, "a post of one not yet up moves to another group with its offer");
    assert.equal(moved.groupId, groupId);
  });

  it("follows its offer's title until the post is renamed by hand or gains a second lot", async () => {
    const id = await offer({ name: "Polska 1951" });
    await patchOffer(userId, id, { name: "Polska 1951 — Plan 6-letni" });
    assert.equal((await postRow(id)).title, "Polska 1951 — Plan 6-letni", "renamed with its offer");

    await setFacebookPostTitle(userId, (await postRow(id)).id, "Na wymianę");
    await patchOffer(userId, id, { name: "Polska 1951 — po zmianie" });
    const renamed = await postRow(id);
    assert.equal(renamed.title, "Na wymianę", "renamed by hand, it keeps its own");
    assert.equal(renamed.titleFollowsOffer, false);

    const host = await offer({ name: "Polska 1952" });
    const guest = await offer({ name: "Polska 1953" });
    const hostPost = await postRow(host);
    const guestPost = await postRow(guest);
    await addFacebookLots(userId, hostPost.id, [guest]);
    await patchOffer(userId, host, { name: "Polska 1952 — inna" });
    const grown = await postRow(host);
    assert.equal(grown.title, "Polska 1952", "a second lot ends the following; the title stays");
    assert.equal(grown.titleFollowsOffer, false);
    assert.deepEqual(await postOf(guest), { facebookPostId: hostPost.id, facebookLotNo: 2 });
    assert.equal(await prisma.facebookPost.count({ where: { id: guestPost.id } }), 0, "the joining offer's post of one goes");
  });

  it("takes the label derived from the offer's sets when the offer has no stored title", async () => {
    const id = await offer();
    const expected = (await readOfferPostTitles([id])).get(id);
    assert.ok(expected, "an offer with copies has a derived label");
    assert.equal((await postRow(id)).title, expected);
  });

  it("dissolves posts of one that are posted together, and never gives their numbers again", async () => {
    const a = await offer();
    const b = await offer();
    const olds = [(await postRow(a)).id, (await postRow(b)).id];
    const next = await counter();
    const together = await createFacebookPost(userId, collectionId, [a, b], "Together");
    assert.equal(together.postNo, next, "a new number, past the posts of one");
    assert.equal(await prisma.facebookPost.count({ where: { id: { in: olds } } }), 0);
    assert.deepEqual(await postOf(b), { facebookPostId: together.postId, facebookLotNo: 2 });
  });

  it("gives a lot taken out of a post a post of one, and leaves a post of one behind", async () => {
    const a = await offer({ name: "Lot A" });
    const b = await offer({ name: "Lot B" });
    const post = await createFacebookPost(userId, collectionId, [a, b], "Two");

    await removeFacebookLot(userId, a);
    const out = await postRow(a);
    assert.notEqual(out.id, post.postId);
    assert.equal(out.title, "Lot A");
    assert.equal(out.titleFollowsOffer, true);
    const left = await postRow(b);
    assert.equal(left.id, post.postId, "left with one lot, the post stays — a post of one");
    assert.equal(left.title, "Two", "with the title it had");
    assert.equal(left.titleFollowsOffer, false);

    await removeFacebookLot(userId, b);
    assert.equal((await postRow(b)).id, post.postId, "the only lot of a post has nowhere to be taken out to");
  });

  it("publishes a post of one through its post, asking no title", async () => {
    const id = await offer({ name: "Polska 1954" });
    const before = await postRow(id);
    await publishOfferOrPost(userId, id, "https://www.facebook.com/groups/198901/posts/1");
    const after = await postRow(id);
    assert.equal(after.id, before.id, "the post it was made with");
    assert.equal(after.title, "Polska 1954");
    const row = await prisma.offer.findUniqueOrThrow({ where: { id }, select: { state: true, url: true, facebookPostSnapshot: true } });
    assert.equal(row.state, "active");
    assert.equal(row.url, "https://www.facebook.com/groups/198901/posts/1");
    assert.notEqual(row.facebookPostSnapshot, null, "its text is frozen as it went up");
    assert.equal((row.facebookPostSnapshot as { postTitle: string }).postTitle, "Polska 1954");
  });

  it("reads a post of one lot as an offer posted alone: no lot number, laid out as text, the post's ZIP", async () => {
    await prisma.facebookGroup.update({
      where: { id: groupId },
      data: { multiLotLayout: "captions", customSettings: ["multiLotLayout"] },
    });
    try {
      const id = await offer();
      const kit = (await getFacebookOfferKit(id))!;
      assert.ok(kit.post, "the kit names its post before it is published");
      assert.equal(kit.lots.length, 1);
      assert.equal(kit.lots[0].lotNo, null, "{lot} stays empty, as on a single post");
      assert.equal(kit.layout, "text", "the group's layout for several lots does not apply");
      assert.match(
        kit.photoZipPath,
        new RegExp(`/facebook-posts/${kit.post.id}/photos/zip$`),
        "↓ Photos is the post's download, named by the post, as for a post of several (#2133)"
      );
      await publishOfferOrPost(userId, id, null);
      const snapshot = (await prisma.offer.findUniqueOrThrow({ where: { id }, select: { facebookPostSnapshot: true } }))
        .facebookPostSnapshot as { layout: string };
      assert.equal(snapshot.layout, "text", "and it was frozen so");
      const screen = (await getFacebookPostScreen(userId, kit.post.id))!;
      assert.deepEqual(screen.kit.lots.map((l) => l.offerId), [id], "its screen is the post's, with one row");
    } finally {
      await prisma.facebookGroup.update({ where: { id: groupId }, data: { multiLotLayout: "text", customSettings: [] } });
    }
  });

  it("keeps its post through a submission for approval, a rejection and the approval", async () => {
    const id = await offer();
    const { facebookPostId } = await postOf(id);
    await publishOfferOrPost(userId, id, "https://www.facebook.com/groups/198901/pending_posts/7", "pending");
    assert.equal((await postOf(id)).facebookPostId, facebookPostId);

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

  it("places an offer that somehow went up in no post as it goes up (setOfferState)", async () => {
    const id = await offer();
    await stripPost(id);
    await setOfferState(userId, id, "active");
    assert.ok((await postOf(id)).facebookPostId);
  });

  it("lists a post of one lot beside the posts of several, before it is published too", async () => {
    await offer({ name: "Alone, ready" });
    const published = await offer({ name: "Alone, up" });
    await publishOfferOrPost(userId, published, null);
    const a = await offer();
    const b = await offer();
    const several = await createFacebookPost(userId, collectionId, [a, b], "Together");

    const { items } = await listFacebookPostsPaginated(userId, collectionId, { pageSize: 200 });
    const ready = items.find((p) => p.title === "Alone, ready");
    assert.ok(ready, "a post of one not yet up is listed");
    assert.equal(ready.lotCount, 1);
    assert.equal(ready.stage, "ready");
    const up = items.find((p) => p.title === "Alone, up");
    assert.equal(up?.stage, "up");
    assert.equal(up?.layout, "text");
    assert.ok(items.some((p) => p.postId === several.postId));
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
    const detail = await getOfferDetail(userId, id);
    assert.ok(detail?.facebook?.post);
    const post = await postRow(id);
    const { listOffersPaginated } = await import("../../src/lib/offers");
    const page = await listOffersPaginated(userId, collectionId, { facebookPostNo: post.postNo });
    assert.deepEqual(
      page.items.map((o) => o.facebookPost),
      [{ postNo: post.postNo, title: post.title, lotNo: null }]
    );
  });

  it("brings every following title back in step at boot, and leaves the rest (syncFollowingPostTitles)", async () => {
    const following = await offer({ name: "Polska 1955" });
    const own = await offer({ name: "Polska 1956" });
    await setFacebookPostTitle(userId, (await postRow(own)).id, "Własny tytuł");
    // Moved out of sight of the writes that keep it in step.
    await prisma.offer.updateMany({ where: { id: { in: [following, own] } }, data: { name: "Zmieniony" } });

    assert.ok((await syncFollowingPostTitles()) >= 1);
    assert.equal((await postRow(following)).title, "Zmieniony");
    assert.equal((await postRow(own)).title, "Własny tytuł", "a post renamed by hand is not touched");
    assert.equal(await syncFollowingPostTitles([following]), 0, "and a second pass changes nothing");
  });

  it("backfills a post of one for every Facebook offer in no post, and sets which posts of one follow (the #2116 migration)", async () => {
    const preparing = await offer({ state: "preparing", name: "W przygotowaniu" });
    const unnamed = await offer();
    for (const id of [preparing, unnamed]) await stripPost(id);
    // Posts of one as #1989 and #2068 left them: following nothing.
    const untitled = await offer({ name: "Bez tytułu" });
    const copied = await offer({ name: "Skopiowany" });
    const typed = await offer({ name: "Oferta" });
    for (const [id, title] of [[untitled, null], [copied, "Skopiowany"], [typed, "Wpisany w Publish"]] as const) {
      await prisma.facebookPost.update({ where: { id: (await postRow(id)).id }, data: { title, titleFollowsOffer: false } });
    }
    const lotA = await offer({ name: "Lot A" });
    const lotB = await offer({ name: "Lot A" });
    const several = await createFacebookPost(userId, collectionId, [lotA, lotB], "Lot A");
    const next = await counter();

    const sql = (await readFile(MIGRATION_2116, "utf8")).replace(
      'ALTER TABLE "facebook_post" ADD COLUMN "titleFollowsOffer" BOOLEAN NOT NULL DEFAULT false;',
      // The column is already there in a database the suite migrated; the rest runs as written.
      ""
    );
    await assert.rejects(
      prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(sql);
          const row = async (id: string) =>
            (await tx.offer.findUniqueOrThrow({ where: { id }, select: { facebookLotNo: true, facebookPost: true } }));
          const a = await row(preparing);
          const b = await row(unnamed);
          assert.equal(a.facebookPost?.postNo, next, "numbered from the counter, oldest offer first");
          assert.equal(b.facebookPost?.postNo, next + 1);
          for (const r of [a, b]) {
            assert.equal(r.facebookLotNo, 1);
            assert.equal(r.facebookPost?.groupId, groupId);
            assert.equal(r.facebookPost?.titleFollowsOffer, true);
          }
          assert.equal(a.facebookPost?.title, "W przygotowaniu", "titled with the offer's stored title");
          assert.equal(b.facebookPost?.title, null, "a derived label is the boot pass's to write");
          assert.equal((await row(untitled)).facebookPost?.titleFollowsOffer, true, "an untitled post of one follows");
          assert.equal((await row(copied)).facebookPost?.titleFollowsOffer, true, "so does one titled as its offer is");
          assert.equal((await row(typed)).facebookPost?.titleFollowsOffer, false, "one with a title of its own keeps it");
          assert.equal((await row(lotA)).facebookPost?.id, several.postId);
          assert.equal((await row(lotA)).facebookPost?.titleFollowsOffer, false, "a post of several never follows");
          const c = await tx.collection.findUniqueOrThrow({ where: { id: collectionId } });
          assert.equal(c.nextFacebookPostNo, next + 2, "the counter moves past the numbers given");
          throw new RolledBack();
        },
        { timeout: 60_000, maxWait: 60_000 }
      ),
      RolledBack
    );
  });

  it("backfills a post of one lot for every Facebook offer up in no post, in creation order (the migration)", async () => {
    // As the data stood before: offers that went up alone carried no post.
    const first = await offer({ state: "active", url: "https://www.facebook.com/groups/198901/posts/20" });
    const second = await offer();
    await setOfferState(userId, second, "active");
    await setOfferState(userId, second, "withdrawn");
    for (const id of [first, second]) await stripPost(id);
    const ready = await offer();
    await stripPost(ready);
    const lotA = await offer();
    const lotB = await offer();
    const several = await createFacebookPost(userId, collectionId, [lotA, lotB], "Several");
    const frozenBefore = (await prisma.offer.findUniqueOrThrow({ where: { id: first } })).facebookPostSnapshot;
    const next = (await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).nextFacebookPostNo;

    const sql = await readFile(MIGRATION_1989, "utf8");
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
