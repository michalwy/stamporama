import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  listOffersPaginated,
  patchOffer,
  setOfferState,
  type OfferInput,
} from "../../src/lib/offers";
import { setFacebookPlatform } from "../../src/lib/facebook";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import {
  lookupFacebookWinner,
  recordFacebookAuctionNoBids,
  recordFacebookAuctionWin,
} from "../../src/lib/facebook-results";

// A Facebook auction's running bid and its result (#1545; ADR-0061 §4). The rules worth a database:
// a closed Facebook auction asks for its result with or without a bid typed, the winner becomes a
// buyer contact recognised by their profile link, the win records the sale — new, or the winner's open
// one — in the auction's own currency, and *No bids* withdraws the offer and frees its copies. The
// pure half is `tests/unit/facebook-result-rules.test.ts`.

describe("Facebook auction results (#1545)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;

  const past = new Date(Date.now() - 60 * 60 * 1000);
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbresults-${ts}`;
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
        data: { slug: `col-fbresults-${ts}`, name: `fbresults-${ts}`, baseCurrency: "PLN", ownerId: userId },
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
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    // A group in a currency of its own, so the sale has to follow the auction rather than the platform.
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — aukcje",
        url: "https://www.facebook.com/groups/123456",
        currency: "EUR",
        custom: ["currency"],
      })
    ).id;
  });

  after(async () => {
    // Sales first: a sold copy is `Restrict`-ed by its sale line, and a buyer by the sale.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function newItem(): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  /** A Facebook auction that is up, holding one set per copy, closing at `endsAt`. */
  async function auction(itemIds: string[], endsAt: Date = past): Promise<string> {
    const input: OfferInput = {
      platformId: facebookId,
      url: null,
      price: "0.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
      facebookGroupId: groupId,
      startingPrice: "3.00",
    };
    const offerId = await createOffer(userId, collectionId, input, { seedItemIds: [itemIds[0]] });
    for (const id of itemIds.slice(1)) await addOfferSet(userId, offerId, [id]);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    await prisma.offer.update({ where: { id: offerId }, data: { endsAt } });
    return offerId;
  }

  const endedIds = async () =>
    (await listOffersPaginated(userId, collectionId, { endedAuction: true, pageSize: 100 })).items.map((o) => o.id);

  it("dates a typed bid, and asks a closed auction for its result with or without one", async () => {
    const running = await auction([await newItem()], future);
    await patchOffer(userId, running, { price: "12.00" });
    const row = (await listOffersPaginated(userId, collectionId, { pageSize: 100 })).items.find((o) => o.id === running);
    assert.ok(row?.priceCheckedAt, "the bid carries the time it was recorded");
    assert.equal(row?.needsResolution, false, "a running auction asks nothing yet");

    const closedUnbid = await auction([await newItem()]);
    const listed = (await listOffersPaginated(userId, collectionId, { pageSize: 100 })).items.find(
      (o) => o.id === closedUnbid
    );
    assert.equal(listed?.needsResolution, true, "no bid typed is no evidence that nobody bid");
    const ended = await endedIds();
    assert.ok(ended.includes(closedUnbid), "the filter reads the same rule as the row");
    assert.ok(!ended.includes(running));
  });

  it("records a win as a sale to a new buyer holding the profile link, in the auction's currency", async () => {
    const offerId = await auction([await newItem(), await newItem()]);
    const { saleId, buyerId } = await recordFacebookAuctionWin(userId, offerId, {
      winnerName: "Jan Kowalski",
      profileUrl: "https://m.facebook.com/jan.kowalski/",
      price: "10.00",
      soldOn: "2026-10-05",
      saleId: null,
    });

    const buyer = await prisma.contact.findUniqueOrThrow({ where: { id: buyerId } });
    assert.equal(buyer.name, "Jan Kowalski");
    assert.equal(buyer.buyer, true);
    assert.equal(buyer.facebookProfileUrl, "https://www.facebook.com/jan.kowalski");

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: { lines: { orderBy: { price: "desc" } } },
    });
    assert.equal(sale.buyerId, buyerId);
    assert.equal(sale.platformId, facebookId);
    assert.equal(sale.currency, "EUR", "the group's currency, not the platform's PLN");
    assert.equal(sale.soldAt.toISOString().slice(0, 10), "2026-10-05");
    assert.deepEqual(
      sale.lines.map((l) => l.price.toFixed(2)),
      ["5.00", "5.00"],
      "one lot's price, split over its two sets"
    );

    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
    assert.equal(offer.state, "sold");
    assert.equal(offer.price.toFixed(2), "10.00", "the winning bid is the auction's final figure");
    const platform = await prisma.contact.findUniqueOrThrow({ where: { id: facebookId } });
    assert.equal(platform.platformCurrency, "PLN", "the platform's lock is left alone");
  });

  it("recognises a repeat winner by the profile link, and puts a second lot into their open sale", async () => {
    const first = await auction([await newItem()]);
    const { saleId, buyerId } = await recordFacebookAuctionWin(userId, first, {
      winnerName: "Anna Nowak",
      profileUrl: "https://www.facebook.com/profile.php?id=100012345678",
      price: "4.00",
      soldOn: "2026-10-05",
      saleId: null,
    });

    // The same profile under the name it shows today: the same person.
    const second = await auction([await newItem()]);
    const lookup = await lookupFacebookWinner(userId, second, {
      winnerName: "Anna N.",
      profileUrl: "https://m.facebook.com/profile.php?id=100012345678&mibextid=x",
    });
    assert.equal(lookup.contact?.id, buyerId);
    assert.equal(lookup.contact?.matchedBy, "profile");
    assert.deepEqual(lookup.openSales.map((s) => s.id), [saleId]);

    const into = await recordFacebookAuctionWin(userId, second, {
      winnerName: "Anna N.",
      profileUrl: "https://m.facebook.com/profile.php?id=100012345678",
      price: "6.50",
      soldOn: "2026-10-05",
      saleId,
    });
    assert.equal(into.saleId, saleId);
    assert.equal(into.buyerId, buyerId);
    assert.equal(await prisma.saleLine.count({ where: { saleId } }), 2, "one parcel, two lots");
    assert.equal(await prisma.contact.count({ where: { collectionId, name: { startsWith: "Anna" } } }), 1);

    // A sale that has gone out is no longer offered, and a stale choice of it is refused.
    await prisma.sale.update({ where: { id: saleId }, data: { status: "sent" } });
    const third = await auction([await newItem()]);
    const after = await lookupFacebookWinner(userId, third, { winnerName: "Anna Nowak", profileUrl: "" });
    assert.deepEqual(after.openSales, []);
    await assert.rejects(
      () =>
        recordFacebookAuctionWin(userId, third, {
          winnerName: "Anna Nowak",
          profileUrl: "",
          price: "3.00",
          soldOn: "2026-10-05",
          saleId,
        }),
      /no longer open/
    );
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: third } })).state, "active");
  });

  it("fills the link in on a contact found by name, and refuses one whose profile is somebody else's", async () => {
    const known = await prisma.contact.create({ data: { collectionId, name: "Piotr Zieliński" } });
    const offerId = await auction([await newItem()]);
    const { buyerId } = await recordFacebookAuctionWin(userId, offerId, {
      winnerName: "piotr zieliński",
      profileUrl: "https://www.facebook.com/piotr.z",
      price: "8.00",
      soldOn: "2026-10-05",
      saleId: null,
    });
    assert.equal(buyerId, known.id);
    const filled = await prisma.contact.findUniqueOrThrow({ where: { id: known.id } });
    assert.equal(filled.facebookProfileUrl, "https://www.facebook.com/piotr.z");
    assert.equal(filled.buyer, true);

    const other = await auction([await newItem()]);
    await assert.rejects(
      () =>
        recordFacebookAuctionWin(userId, other, {
          winnerName: "Piotr Zieliński",
          profileUrl: "https://www.facebook.com/another.piotr",
          price: "8.00",
          soldOn: "2026-10-05",
          saleId: null,
        }),
      /different Facebook profile/
    );
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: other } })).state, "active");
  });

  it("ends an auction nobody bid on by withdrawing it, which frees its copies", async () => {
    const copy = await newItem();
    const offerId = await auction([copy]);
    await recordFacebookAuctionNoBids(userId, offerId);
    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
    assert.equal(offer.state, "withdrawn");
    assert.ok(!(await endedIds()).includes(offerId), "resolved, so no longer asking");
    // The copy can go up in another auction at once.
    await auction([copy], future);
  });

  it("records a result only for a Facebook auction that is up", async () => {
    const draft = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: "0.00",
        currency: "EUR",
        listingDate: null,
        state: "preparing",
        facebookGroupId: groupId,
      },
      { seedItemIds: [await newItem()] }
    );
    await assert.rejects(() => recordFacebookAuctionNoBids(userId, draft), /only one that is up/);
    await assert.rejects(
      () =>
        recordFacebookAuctionWin(userId, draft, {
          winnerName: "X",
          profileUrl: "",
          price: "1.00",
          soldOn: "2026-10-05",
          saleId: null,
        }),
      /only one that is up/
    );
  });
});
