import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, listOffersPaginated, patchOffer, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { getPhoneOffer, sellPhoneOffer } from "../../src/lib/phone-offers";

// The phone offer read touches the photo store, as the phone-offers test does.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-phone-fb-bidding-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// A Facebook group auction followed from the phone (#2010): the phone reads its bidding while it is up
// in the group, the bid it records is the desk card's own write — the offer's price, dated — so the
// desk's rows show it as if typed there, and once the closing time has passed the auction reads as
// closed and is sold to the winner at the bid recorded. The pure rule is
// `tests/unit/facebook-bidding-rules.test.ts`.

describe("a Facebook group auction on the phone (#2010)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let groupId: string;
  let stampId: string;
  let conditionId: string;
  const today = new Date().toISOString().slice(0, 10);

  before(async () => {
    const ts = Date.now();
    userId = `test-user-phone-fb-bid-${ts}`;
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
        data: { slug: `col-phone-fb-bid-${ts}`, name: "Phone FB bid", baseCurrency: "EUR", ownerId: userId },
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
        url: "https://www.facebook.com/groups/2010",
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
  });

  after(async () => {
    // Sales first: a sold copy is `Restrict`-ed by its sale line, and a buyer by the sale.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  /** A Facebook offer of one copy, published, closing at `endsAt` when it is an auction. */
  async function upInGroup(listingType: "auction" | "fixed", endsAt: Date | null): Promise<string> {
    const itemId = (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: listingType === "auction" ? "0.00" : "5.00",
        currency: "PLN",
        listingDate: null,
        state: "preparing",
        facebookGroupId: groupId,
        listingType,
        ...(listingType === "auction" ? { startingPrice: "3.00" } : {}),
      },
      { seedItemIds: [itemId] }
    );
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    await prisma.offer.update({ where: { id: offerId }, data: { endsAt } });
    return offerId;
  }

  const deskRow = async (offerId: string) => {
    const { items } = await listOffersPaginated(userId, collectionId, { pageSize: 100 });
    const row = items.find((o) => o.id === offerId);
    assert.ok(row);
    return row;
  };

  it("follows a running auction, and the bid recorded is the desk's", async () => {
    const endsAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const offerId = await upInGroup("auction", endsAt);
    const fresh = await getPhoneOffer(userId, collectionId, offerId);
    assert.deepEqual(fresh?.bidding, {
      closed: false,
      hasBid: false,
      endsAt: endsAt.toISOString(),
      priceCheckedAt: null,
    });

    // The phone's *Record bid* is the desk card's write: `patchOfferAction(…, "price")`.
    await patchOffer(userId, offerId, { price: "12.50" });
    const bid = await getPhoneOffer(userId, collectionId, offerId);
    assert.equal(bid?.price, "12.50");
    assert.equal(bid?.bidding?.hasBid, true);
    assert.ok(bid?.bidding?.priceCheckedAt, "the bid is dated");

    const row = await deskRow(offerId);
    assert.equal(row.price, "12.50");
    assert.equal(row.priceCheckedAt?.toISOString(), bid?.bidding?.priceCheckedAt);
  });

  it("reads a closed auction as closed, and sells it to the winner at the winning bid", async () => {
    const offerId = await upInGroup("auction", new Date(Date.now() - 60 * 1000));
    await patchOffer(userId, offerId, { price: "20.00" });
    const closed = await getPhoneOffer(userId, collectionId, offerId);
    assert.equal(closed?.bidding?.closed, true);
    assert.equal(closed?.setsLeft, 1, "a closed auction is sold from the phone like any offer up");

    const result = await sellPhoneOffer(
      userId,
      collectionId,
      offerId,
      {
        buyerId: "",
        buyerName: "Ola Kot",
        buyerFacebookProfileUrl: "https://www.facebook.com/ola.kot",
        price: closed!.price,
      },
      today
    );
    assert.ok(result.ok);
    const line = await prisma.saleLine.findFirstOrThrow({ where: { saleId: result.saleId }, select: { price: true } });
    assert.equal(line.price.toFixed(2), "20.00");
    const sold = await getPhoneOffer(userId, collectionId, offerId);
    assert.equal(sold?.state, "sold");
    assert.equal(sold?.bidding, null, "a sold auction has no bidding left to follow");
  });

  it("has nothing to follow once withdrawn, nor on a quick buy", async () => {
    const offerId = await upInGroup("auction", new Date(Date.now() - 60 * 1000));
    await setOfferState(userId, offerId, "withdrawn");
    assert.equal((await getPhoneOffer(userId, collectionId, offerId))?.bidding, null);

    const quickBuy = await upInGroup("fixed", null);
    assert.equal((await getPhoneOffer(userId, collectionId, quickBuy))?.bidding, null);
  });
});
