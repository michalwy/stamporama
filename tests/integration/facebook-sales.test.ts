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
import { addSaleLines, createSale } from "../../src/lib/sales";
import { resolveSaleHeader, type SaleHeaderRaw } from "../../src/lib/sale-header-input";
import { setFacebookPlatform } from "../../src/lib/facebook";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { facebookOfferSaleCurrency, lookupFacebookBuyer } from "../../src/lib/facebook-sales";

// A Facebook offer is sold and withdrawn like any other (#1777; ADR-0061 §4, amending #1545/#1671).
// The rules worth a database: a closed Facebook auction asks for its result with or without a bid
// typed, until it is sold or withdrawn; *Sell*'s new sale finds its buyer by the Facebook profile link
// first and the name second, refuses a name held by somebody with another link, and keeps the link on
// the contact; and the sale is in the offer's own currency, a group's currency surviving the
// platform's. The sale itself is the ordinary `createSale` + `addSaleLines` the *Sell* flow calls. The
// pure half is `tests/unit/facebook-profile-rules.test.ts`.

describe("Selling a Facebook offer (#1777)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let otherPlatformId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;

  const past = new Date(Date.now() - 60 * 60 * 1000);
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbsales-${ts}`;
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
        data: { slug: `col-fbsales-${ts}`, name: `fbsales-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.contact.create({
        data: { collectionId, name: "Facebook", platform: true, platformCurrency: "PLN" },
      })
    ).id;
    otherPlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    await setFacebookPlatform(userId, collectionId, facebookId);
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    // A group in a currency of its own, so the sale has to follow the offer rather than the platform.
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

  /** The sale form's header as *Sell* submits it for a Facebook offer: the buyer by their profile. */
  const header = (buyerName: string, profileUrl: string, platformId = facebookId): SaleHeaderRaw => ({
    platformId,
    platformName: null,
    buyerId: null,
    buyerName,
    buyerFacebookProfileUrl: profileUrl,
    externalRef: "",
    transactionUrl: "",
    soldAt: "2026-10-05",
    currency: "EUR",
    handlingMode: "direct",
    buyerHandling: "",
    buyerPaidTotal: "",
    commission: "",
  });

  async function buyerOf(raw: SaleHeaderRaw): Promise<string | null> {
    const resolved = await resolveSaleHeader(collectionId, raw);
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.message);
    return resolved.buyerId;
  }

  async function refusal(raw: SaleHeaderRaw): Promise<string> {
    const resolved = await resolveSaleHeader(collectionId, raw);
    assert.equal(resolved.ok, false);
    return resolved.ok ? "" : resolved.message;
  }

  /** What *Sell* does with a resolved header: a new sale in the offer's currency, every set at the
   *  offer's current price. */
  async function sell(offerId: string, raw: SaleHeaderRaw): Promise<string> {
    const resolved = await resolveSaleHeader(collectionId, raw);
    assert.ok(resolved.ok, resolved.ok ? "" : resolved.message);
    const offerCurrency = await facebookOfferSaleCurrency(userId, collectionId, offerId);
    const saleId = await createSale(userId, collectionId, resolved, offerCurrency ? { offerCurrency } : {});
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { price: true, sets: { select: { id: true, items: { select: { itemId: true } } } } },
    });
    await addSaleLines(
      userId,
      saleId,
      offer.sets.map((s) => ({
        offerId,
        offerSetId: s.id,
        price: offer.price.toFixed(2),
        itemIds: s.items.map((i) => i.itemId),
      }))
    );
    return saleId;
  }

  it("asks a closed auction for its result with or without a bid, until it is sold", async () => {
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

    // The winning bid typed after the close, then *Sell*: resolved, so no longer asking.
    await patchOffer(userId, closedUnbid, { price: "9.00" });
    await sell(closedUnbid, header("Marek Lis", "https://www.facebook.com/marek.lis"));
    assert.ok(!(await endedIds()).includes(closedUnbid));
  });

  it("sells to a new buyer holding the profile link, in the offer's currency rather than the platform's", async () => {
    const offerId = await auction([await newItem(), await newItem()]);
    await patchOffer(userId, offerId, { price: "5.00" });
    const saleId = await sell(offerId, header("Jan Kowalski", "https://m.facebook.com/jan.kowalski/"));

    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, include: { lines: true } });
    const buyer = await prisma.contact.findUniqueOrThrow({ where: { id: sale.buyerId! } });
    assert.deepEqual([buyer.name, buyer.buyer, buyer.facebookProfileUrl], [
      "Jan Kowalski",
      true,
      "https://www.facebook.com/jan.kowalski",
    ]);
    assert.equal(sale.platformId, facebookId);
    assert.equal(sale.currency, "EUR", "the group's currency, not the platform's PLN");
    assert.deepEqual(sale.lines.map((l) => l.price.toFixed(2)), ["5.00", "5.00"], "each set at its current price");
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).state, "sold");
    const platform = await prisma.contact.findUniqueOrThrow({ where: { id: facebookId } });
    assert.equal(platform.platformCurrency, "PLN", "the platform's lock is left alone");
  });

  it("recognises a repeat buyer by the profile link, under whatever name it shows today", async () => {
    const first = await buyerOf(header("Anna Nowak", "https://www.facebook.com/profile.php?id=100012345678"));
    const lookup = await lookupFacebookBuyer(collectionId, {
      name: "Anna N.",
      profileUrl: "https://m.facebook.com/profile.php?id=100012345678&mibextid=x",
    });
    assert.equal(lookup.contact?.id, first);
    assert.equal(lookup.contact?.matchedBy, "profile");
    assert.equal(
      await buyerOf(header("Anna N.", "https://m.facebook.com/profile.php?id=100012345678")),
      first,
      "the save finds whom the lookup found"
    );
    assert.equal(await prisma.contact.count({ where: { collectionId, name: { startsWith: "Anna" } } }), 1);
  });

  it("fills the link in on a contact found by name, and refuses one whose profile is somebody else's", async () => {
    const known = await prisma.contact.create({ data: { collectionId, name: "Piotr Zieliński" } });
    assert.equal(await buyerOf(header("piotr zieliński", "https://www.facebook.com/piotr.z")), known.id);
    const filled = await prisma.contact.findUniqueOrThrow({ where: { id: known.id } });
    assert.equal(filled.facebookProfileUrl, "https://www.facebook.com/piotr.z");
    assert.equal(filled.buyer, true);

    const before = await prisma.contact.count({ where: { collectionId } });
    const lookup = await lookupFacebookBuyer(collectionId, {
      name: "Piotr Zieliński",
      profileUrl: "https://www.facebook.com/another.piotr",
    });
    assert.match(lookup.conflict ?? "", /different Facebook profile/);
    assert.match(
      await refusal(header("Piotr Zieliński", "https://www.facebook.com/another.piotr")),
      /different Facebook profile/
    );
    assert.equal(await prisma.contact.count({ where: { collectionId } }), before, "nothing written");
  });

  it("takes a name alone or nobody, and refuses a link nobody has with no name, a non-profile link, another platform", async () => {
    const named = await buyerOf(header("Ewa Wiśniewska", ""));
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: named! } })).facebookProfileUrl, null);
    assert.equal(await buyerOf(header("", "")), null, "no buyer, as on any sale");
    assert.match(await refusal(header("", "https://www.facebook.com/nobody.yet")), /name the buyer/);
    assert.match(await refusal(header("X", "https://allegro.pl/uzytkownik/x")), /not a Facebook link/);
    assert.match(await refusal(header("X", "", otherPlatformId)), /only on the Facebook platform/);
  });

  it("sells a quick buy the same way, at its asking price (#1671)", async () => {
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        listingType: "fixed",
        price: "25.00",
        currency: "EUR",
        listingDate: null,
        state: "active",
        facebookGroupId: groupId,
      },
      { seedItemIds: [await newItem()] }
    );
    assert.ok(!(await endedIds()).includes(offerId), "a quick buy never ends of itself");
    const saleId = await sell(offerId, header("Ola Kot", "https://www.facebook.com/ola.kot"));
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, include: { lines: true } });
    assert.equal(sale.currency, "EUR");
    assert.deepEqual(sale.lines.map((l) => l.price.toFixed(2)), ["25.00"]);
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).state, "sold");
  });

  it("ends an auction nobody bid on with the ordinary Withdraw, which frees its copies", async () => {
    const copy = await newItem();
    const offerId = await auction([copy]);
    await setOfferState(userId, offerId, "withdrawn");
    assert.ok(!(await endedIds()).includes(offerId), "resolved, so no longer asking");
    await auction([copy], future);
  });

  it("keeps the platform's currency for any other offer, and an offer of another collection out", async () => {
    const delcampeOffer = await createOffer(
      userId,
      collectionId,
      { platformId: otherPlatformId, url: null, price: "4.00", currency: "EUR", listingDate: null, state: "preparing" },
      { seedItemIds: [await newItem()] }
    );
    assert.equal(await facebookOfferSaleCurrency(userId, collectionId, delcampeOffer), null);
    await assert.rejects(() => facebookOfferSaleCurrency("someone-else", collectionId, delcampeOffer), /access denied/);
  });
});
