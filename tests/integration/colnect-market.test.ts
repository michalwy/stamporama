import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, getOfferDetail } from "../../src/lib/offers";
import { setColnectConditionMapping } from "../../src/lib/colnect";
import { ColnectMarketReadError, recordColnectMarketRead } from "../../src/lib/colnect-market";
import { PlatformFieldError, updatePlatform } from "../../src/lib/platforms";

// Check Colnect market (#2454) against a real database: a read the Assistant took is kept on the
// offer in the offer's currency, the collector's own listings set apart, and drawn as one row per
// condition named by the collection's mapping, the offer's own condition highlighted.

describe("Check Colnect market (#2454)", () => {
  let userId: string;
  let collectionId: string;
  let colnectId: string;
  let otherId: string;
  let offerId: string;
  let usedId: string;

  const offerRead = (over: Record<string, unknown> = {}) => ({
    saleCode: "s1",
    grade: "4",
    gradeLabel: "U - Used",
    amount: "0.25",
    currency: "EUR",
    originalPrice: null,
    seller: "someone",
    note: null,
    ...over,
  });
  const read = (offers: Record<string, unknown>[], signedInAs = "me") => ({
    signedInAs,
    items: [{ colnectId: "60512", offers, lots: 1, unreadable: 0, pages: 1, truncated: false }],
  });

  before(async () => {
    const ts = Date.now();
    userId = `test-user-colnect-market-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Test User",
        email: `test-colnect-market-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-colnect-market-${ts}`, name: "Market", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    colnectId = (
      await prisma.platform.create({
        data: { collectionId, name: "Colnect", platformModule: "colnect", platformCurrency: "PLN" },
      })
    ).id;
    otherId = (
      await prisma.platform.create({ data: { collectionId, name: "Elsewhere", platformCurrency: "PLN" } })
    ).id;
    const stampId = (
      await prisma.stamp.create({ data: { collectionId, name: "Knight", issuedYear: 1953, colnectId: "60512" } })
    ).id;
    usedId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    const mintId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Mint", abbreviation: "MNH", sortOrder: 1 } })
    ).id;
    await setColnectConditionMapping(userId, usedId, "4");
    await setColnectConditionMapping(userId, mintId, "1");
    await prisma.exchangeRate.createMany({
      data: [
        { collectionId, fromCurrency: "EUR", toCurrency: "EUR", rate: 1, fetchedAt: new Date() },
        { collectionId, fromCurrency: "EUR", toCurrency: "PLN", rate: 4, fetchedAt: new Date() },
      ],
    });

    offerId = await createOffer(userId, collectionId, {
      platformId: colnectId,
      url: null,
      listingType: "fixed",
      price: "0.00",
      currency: "PLN",
      listingDate: null,
    });
    const copy = (await createItem(userId, collectionId, { stampId, conditionId: usedId, forSale: true })).id;
    await addOfferSet(userId, offerId, [copy]);

    // Another offer of this collection, live on Colnect under sale code `mine`.
    const live = await createOffer(userId, collectionId, {
      platformId: colnectId,
      url: null,
      listingType: "fixed",
      price: "1.00",
      currency: "PLN",
      listingDate: null,
    });
    await prisma.offer.update({ where: { id: live }, data: { colnectSaleId: "mine" } });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("offers the card on Colnect only, asking about the item the offer is listed under", async () => {
    const detail = await getOfferDetail(userId, offerId);
    assert.deepEqual(detail?.colnectMarket?.targets, [{ colnectId: "60512", label: "Knight", grades: ["4"] }]);
    assert.equal(detail?.colnectMarket?.readAt, null);
    assert.equal(detail?.colnectMarket?.step, "0.01");

    const elsewhere = await createOffer(userId, collectionId, {
      platformId: otherId,
      url: null,
      listingType: "fixed",
      price: "0.00",
      currency: "PLN",
      listingDate: null,
    });
    assert.equal((await getOfferDetail(userId, elsewhere))?.colnectMarket, null);
    await assert.rejects(recordColnectMarketRead(userId, elsewhere, read([])), ColnectMarketReadError);
  });

  it("keeps a read in the offer's currency, own listings set apart, and draws it per condition", async () => {
    await recordColnectMarketRead(
      userId,
      offerId,
      read([
        offerRead({ amount: "0.25" }),
        offerRead({ saleCode: "s2", amount: "1.00", note: "Cachet rond" }),
        offerRead({ saleCode: "mine", amount: "0.10" }),
        offerRead({ saleCode: "s3", amount: "0.05", seller: "ME" }),
        offerRead({ saleCode: "s4", grade: "1", gradeLabel: "MNH - Mint Never Hinged", amount: "2.00" }),
      ])
    );
    const market = (await getOfferDetail(userId, offerId))!.colnectMarket!;
    assert.ok(market.readAt instanceof Date);
    const rows = market.view.items[0].rows!;
    const used = rows.find((r) => r.key === "4")!;
    assert.equal(used.name, "Used");
    assert.equal(used.colnectGrade, "U");
    assert.equal(used.highlighted, true);
    // 0.25 € and 1.00 € at 4 PLN/€, the two of the collector's own counted apart.
    assert.deepEqual([used.lowest, used.median, used.count, used.ownCount], ["1.00", "2.50", 2, 2]);
    assert.equal(used.dots[1].note, "Cachet rond");
    assert.equal(used.dots[0].converted, true);
    const mint = rows.find((r) => r.key === "1")!;
    assert.deepEqual([mint.name, mint.highlighted, mint.lowest], ["Mint", false, "8.00"]);
    assert.equal(rows.find((r) => r.key === "2")!.count, 0);
    assert.equal(market.view.items[0].lots, 1);

    const stored = await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { colnectMarketRead: true } });
    assert.equal(JSON.stringify(stored.colnectMarketRead).includes("someone"), false);
  });

  it("replaces the last read with the next", async () => {
    await recordColnectMarketRead(userId, offerId, read([]));
    const market = (await getOfferDetail(userId, offerId))!.colnectMarket!;
    assert.equal(market.view.anyListings, false);
  });

  it("refuses a read it cannot understand, and keeps the last one", async () => {
    await recordColnectMarketRead(userId, offerId, read([offerRead()]));
    await assert.rejects(
      recordColnectMarketRead(userId, offerId, read([offerRead({ amount: "free" })])),
      ColnectMarketReadError
    );
    const market = (await getOfferDetail(userId, offerId))!.colnectMarket!;
    assert.equal(market.view.items[0].rows!.find((r) => r.key === "4")!.count, 1);
  });

  it("takes the step from the Colnect platform's settings, and only there", async () => {
    const platform = await prisma.platform.findUniqueOrThrow({ where: { id: colnectId } });
    const saved = await updatePlatform(userId, colnectId, {
      name: platform.name,
      platformCurrency: "PLN",
      marketPriceStep: "0.05",
    });
    assert.equal(saved.marketPriceStep, "0.05");
    assert.equal((await getOfferDetail(userId, offerId))!.colnectMarket!.step, "0.05");
    await assert.rejects(
      updatePlatform(userId, colnectId, { name: platform.name, platformCurrency: "PLN", marketPriceStep: "0" }),
      PlatformFieldError
    );
    const other = await updatePlatform(userId, otherId, {
      name: "Elsewhere",
      platformCurrency: "PLN",
      marketPriceStep: "0.05",
    });
    assert.equal(other.marketPriceStep, null);
  });
});
