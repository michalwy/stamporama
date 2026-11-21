import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, patchOffer, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { createFacebookPost, getFacebookPostScreen, publishOfferOrPost } from "../../src/lib/facebook-posts";
import { facebookPostStage } from "../../src/lib/facebook-post-rules";
import { createSale } from "../../src/lib/sales";
import { sellPhonePostLots, withdrawPhonePostLots } from "../../src/lib/phone-post-close";

// The desk's post screen reads the lots' photos, through the photo store.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-phone-post-close-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Closing a Facebook post from the phone (#2631): one winner's ticked lots sold into a new sale or that
// buyer's open sale, each at its recorded bid, and the lots left withdrawn — and the desk's post screen
// shows the same. The pure half is `tests/unit/phone-post-close-rules.test.ts`.

describe("closing a Facebook post from the phone (#2631)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let groupId: string;
  let stampId: string;
  let conditionId: string;
  let annaId: string;
  const today = new Date().toISOString().slice(0, 10);

  before(async () => {
    const ts = Date.now();
    userId = `test-user-phone-post-close-${ts}`;
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
        data: { slug: `col-phone-post-close-${ts}`, name: "Phone post close", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — aukcje",
        url: "https://www.facebook.com/groups/2631",
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    annaId = (await prisma.contact.create({ data: { collectionId, name: "Anna Nowak", buyer: true } })).id;
  });

  after(async () => {
    // Sales first: a sold copy is `Restrict`-ed by its sale line, and a buyer by the sale.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.facebookPost.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  /** A Ready Facebook auction of one copy, starting at 3.00 PLN. */
  async function auction(): Promise<string> {
    const itemId = (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
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
        facebookGroupId: groupId,
        listingType: "auction",
      },
      { seedItemIds: [itemId] }
    );
    await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  /** A post of `n` auctions, up in its group, its auctions ended. */
  async function endedPost(n: number): Promise<{ postId: string; lots: string[] }> {
    const lots: string[] = [];
    for (let i = 0; i < n; i++) lots.push(await auction());
    const { postId } = await createFacebookPost(userId, collectionId, lots, "Merkury 1950");
    await publishOfferOrPost(userId, lots[0], "https://www.facebook.com/groups/2631/posts/1");
    await prisma.offer.updateMany({ where: { id: { in: lots } }, data: { endsAt: new Date(Date.now() - 60_000) } });
    return { postId, lots };
  }

  async function saleOf(saleId: string) {
    return prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: {
        saleNo: true,
        status: true,
        platformId: true,
        currency: true,
        soldAt: true,
        buyer: { select: { id: true, name: true, facebookProfiles: { select: { url: true } } } },
        lines: { select: { offerId: true, price: true }, orderBy: { offer: { facebookLotNo: "asc" } } },
      },
    });
  }

  it("sells two winners' lots and withdraws the rest, and the desk shows the same", async () => {
    const { postId, lots } = await endedPost(10);
    // The bids recorded as they came in — each the lot's own price (#1545).
    const bids = ["12.00", "7.50", "4.00", "15.00", "0", "0", "9.00", "0", "0", "0"];
    for (const [i, bid] of bids.entries()) if (bid !== "0") await patchOffer(userId, lots[i], { price: bid });

    // Anna already has a sale open on Facebook, from an earlier post.
    const openSaleId = await createSale(userId, collectionId, {
      platformId: facebookId,
      buyerId: annaId,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-11-18"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });

    // Lots 1, 4 and 7 to Jan, a new buyer, in a new sale.
    const jan = await sellPhonePostLots(
      userId,
      collectionId,
      postId,
      [lots[6], lots[0], lots[3]],
      { buyerName: "Jan Kowalski", buyerFacebookProfileUrl: "https://www.facebook.com/jan.kowalski", saleId: null },
      today
    );
    assert.ok(jan.ok, jan.ok ? "" : jan.message);
    assert.equal(jan.created, true);
    assert.deepEqual(jan.soldLotNos, [1, 4, 7]);
    assert.deepEqual(jan.skipped, []);
    assert.equal(jan.buyerName, "Jan Kowalski");
    const janSale = await saleOf(jan.saleId);
    assert.equal(janSale.saleNo, jan.saleNo);
    assert.equal(janSale.status, "ordered");
    assert.equal(janSale.platformId, facebookId);
    assert.equal(janSale.currency, "PLN");
    assert.equal(janSale.soldAt.toISOString().slice(0, 10), today);
    assert.equal(janSale.buyer?.name, "Jan Kowalski");
    assert.deepEqual(janSale.buyer?.facebookProfiles.map((p) => p.url), ["https://www.facebook.com/jan.kowalski"]);
    assert.deepEqual(
      janSale.lines.map((l) => [l.offerId, l.price.toFixed(2)]),
      [
        [lots[0], "12.00"],
        [lots[3], "15.00"],
        [lots[6], "9.00"],
      ],
      "each lot at its recorded bid"
    );

    // Lot 2 into Anna's open sale.
    const anna = await sellPhonePostLots(
      userId,
      collectionId,
      postId,
      [lots[1]],
      { buyerName: "Anna Nowak", buyerFacebookProfileUrl: "", saleId: openSaleId },
      today
    );
    assert.ok(anna.ok, anna.ok ? "" : anna.message);
    assert.equal(anna.created, false);
    assert.equal(anna.saleId, openSaleId);
    assert.equal(anna.buyerName, "Anna Nowak");
    assert.deepEqual(
      (await saleOf(openSaleId)).lines.map((l) => [l.offerId, l.price.toFixed(2)]),
      [[lots[1], "7.50"]]
    );

    // The other six withdrawn.
    const rest = [lots[2], lots[4], lots[5], lots[7], lots[8], lots[9]];
    const withdrawn = await withdrawPhonePostLots(userId, collectionId, postId, rest);
    assert.ok(withdrawn.ok);
    assert.deepEqual(withdrawn.withdrawnLotNos, [3, 5, 6, 8, 9, 10]);

    // The desk's post screen.
    const screen = await getFacebookPostScreen(userId, postId);
    assert.ok(screen);
    assert.deepEqual(
      screen.kit.lots.map((l) => [l.lotNo, l.state]),
      [
        [1, "sold"],
        [2, "sold"],
        [3, "withdrawn"],
        [4, "sold"],
        [5, "withdrawn"],
        [6, "withdrawn"],
        [7, "sold"],
        [8, "withdrawn"],
        [9, "withdrawn"],
        [10, "withdrawn"],
      ]
    );
    assert.equal(facebookPostStage(screen.kit.lots), "over");
  });

  it("names a ticked lot already sold, and sells the rest", async () => {
    const { postId, lots } = await endedPost(3);
    await patchOffer(userId, lots[0], { price: "5.00" });
    await patchOffer(userId, lots[1], { price: "6.00" });
    const first = await sellPhonePostLots(
      userId,
      collectionId,
      postId,
      [lots[0]],
      { buyerName: "Ewa", buyerFacebookProfileUrl: "", saleId: null },
      today
    );
    assert.ok(first.ok);

    const second = await sellPhonePostLots(
      userId,
      collectionId,
      postId,
      [lots[0], lots[1]],
      { buyerName: "Piotr", buyerFacebookProfileUrl: "", saleId: null },
      today
    );
    assert.ok(second.ok);
    assert.deepEqual(second.soldLotNos, [2]);
    assert.deepEqual(second.skipped, [{ lotNo: 1, reason: "has nothing left to sell" }]);

    const none = await sellPhonePostLots(
      userId,
      collectionId,
      postId,
      [lots[0], lots[1]],
      { buyerName: "Piotr", buyerFacebookProfileUrl: "", saleId: null },
      today
    );
    assert.deepEqual(none, { ok: false, message: "None of the ticked lots can be sold." });
    assert.equal(await prisma.sale.count({ where: { collectionId, buyer: { name: "Piotr" } } }), 1, "no empty sale left behind");
  });

  it("refuses a lot of another post, and withdraws only a lot still up", async () => {
    const { postId, lots } = await endedPost(2);
    const other = await endedPost(2);
    assert.deepEqual(
      await sellPhonePostLots(
        userId,
        collectionId,
        postId,
        [lots[0], other.lots[0]],
        { buyerName: "Ewa", buyerFacebookProfileUrl: "", saleId: null },
        today
      ),
      { ok: false, message: "A ticked lot is no longer in this post." }
    );
    assert.deepEqual(await withdrawPhonePostLots(userId, collectionId, postId, [other.lots[0]]), {
      ok: false,
      message: "A ticked lot is no longer in this post.",
    });

    // A post not yet up is the desk's to withdraw.
    const ready = [await auction(), await auction()];
    const { postId: readyPostId } = await createFacebookPost(userId, collectionId, ready, "Not up yet");
    assert.deepEqual(await withdrawPhonePostLots(userId, collectionId, readyPostId, [ready[1]]), {
      ok: false,
      message: "Lot 2 is not up in the group — withdraw it at the desk.",
    });
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: ready[1] } })).state, "ready");

    // A lot withdrawn since it was ticked is passed over.
    await setOfferState(userId, lots[1], "withdrawn");
    const done = await withdrawPhonePostLots(userId, collectionId, postId, [lots[0], lots[1]]);
    assert.deepEqual(done, { ok: true, withdrawnLotNos: [1] });
  });
});
