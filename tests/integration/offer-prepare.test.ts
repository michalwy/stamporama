import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  applyEstimatedPrices,
  createOffer,
  getOfferDetail,
  listPreparingOffers,
  patchOffer,
  type PrepareOffer,
} from "../../src/lib/offers";

// The Prepare screen (#1894): the collection's Preparing offers a page at a time, each with the price
// table's figures and the ready gate's reasons — read in one pass for the page, and required to say
// exactly what the offer's own screen says — and *Use estimated price*, which prices the ones without
// a price at their Estimated value.

describe("the Prepare screen (#1894)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let otherPlatformId: string;
  let germanyId: string;
  let franceId: string;
  /** Germany, catalogue 30.00, cost 12.00. */
  let german: string;
  /** Germany, catalogue 20.00, no cost. */
  let german2: string;
  /** France, catalogue 40.00, with a photo. */
  let french: string;
  /** Germany, no catalogue value. */
  let unpricedCopy: string;
  let photoId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-prepare-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User prepare-${ts}`,
        email: `test-prepare-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-prepare-${ts}`, name: `Collection prepare-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true, minimumPrice: "2.00" } })
    ).id;
    otherPlatformId = (await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })).id;

    const vendor = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    const edition = await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } });
    germanyId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Germany", primaryCatalogNameId: catalogName.id } })
    ).id;
    franceId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "France", primaryCatalogNameId: catalogName.id } })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    const mkCopy = async (name: string, areaId: string, price: string | null, costBasis: string | null) => {
      const stamp = await prisma.stamp.create({
        data: { collectionId, name, stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] } },
      });
      if (price) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: stamp.id,
            catalogEditionId: edition.id,
            conditionId,
            certificateStatusId: null,
            price,
            currency: "EUR",
          },
        });
      }
      const item = await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true });
      if (costBasis) await prisma.item.update({ where: { id: item.id }, data: { costBasis } });
      return item.id;
    };

    german = await mkCopy("German", germanyId, "30.00", "12.00");
    german2 = await mkCopy("German two", germanyId, "20.00", null);
    french = await mkCopy("French", franceId, "40.00", null);
    unpricedCopy = await mkCopy("Unpriced", germanyId, null, null);
    photoId = (
      await prisma.photo.create({
        data: {
          itemId: french,
          role: "front",
          storageKey: `prepare-${ts}.jpg`,
          mime: "image/jpeg",
          width: 10,
          height: 10,
          sizeBytes: 100,
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function offer(
    sets: string[][],
    over: { price?: string; state?: "preparing" | "ready"; platform?: string; auction?: boolean } = {}
  ) {
    const offerId = await createOffer(userId, collectionId, {
      platformId: over.platform ?? platformId,
      url: null,
      price: over.price ?? "0.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
      ...(over.auction ? { listingType: "auction" as const } : {}),
    });
    for (const itemIds of sets) await addOfferSet(userId, offerId, itemIds);
    if (over.state === "ready") await prisma.offer.update({ where: { id: offerId }, data: { state: "ready" } });
    return offerId;
  }

  async function rows(filters: Parameters<typeof listPreparingOffers>[2] = {}): Promise<PrepareOffer[]> {
    return (await listPreparingOffers(userId, collectionId, { pageSize: 100, ...filters })).items;
  }

  it("reads each row's price figures exactly as the offer's own screen does", async () => {
    const offerId = await offer([[german], [german2, unpricedCopy]], { price: "9.00" });
    const row = (await rows()).find((r) => r.id === offerId);
    const detail = await getOfferDetail(userId, offerId);
    assert.ok(row && detail);
    assert.equal(row.catalogPrice, detail.catalogPrice);
    assert.equal(row.catalogPrice, "25.00");
    assert.equal(row.suggestedPrice, detail.suggestedPrice);
    assert.ok(row.suggestedPrice !== null);
    assert.equal(row.costPrice, detail.costPrice);
    assert.equal(row.costPrice, "12.00");
    assert.deepEqual(row.marketPrice, detail.marketPrice);
    assert.equal(row.marketUnconvertible, detail.marketUnconvertible);
    assert.equal(row.catalogUnpricedSets, detail.catalogUnpricedSets);
    assert.deepEqual(row.suggestedEstimate, detail.suggestedEstimate);
    assert.equal(row.platformMinimumPrice, "2.00");
    assert.deepEqual(
      row.readyBlockers.map((b) => b.code),
      detail.readyBlockers.map((b) => b.code)
    );
    assert.equal(row.setCount, 2);
    assert.equal(row.itemCount, 3);
  });

  it("lists only offers being prepared, newest first", async () => {
    const older = await offer([[german]]);
    const ready = await offer([[german]], { price: "5.00", state: "ready" });
    const newer = await offer([[german2]]);
    const ids = (await rows()).map((r) => r.id);
    assert.ok(!ids.includes(ready));
    assert.ok(ids.indexOf(newer) < ids.indexOf(older));
  });

  it("narrows to a platform", async () => {
    const elsewhere = await offer([[german]], { platform: otherPlatformId });
    assert.ok((await rows({ platformId: otherPlatformId })).every((r) => r.platformId === otherPlatformId));
    assert.ok((await rows({ platformId: otherPlatformId })).some((r) => r.id === elsewhere));
    assert.ok(!(await rows({ platformId })).some((r) => r.id === elsewhere));
  });

  it("matches an area only when every copy is inside it", async () => {
    const allGerman = await offer([[german, german2]]);
    const mixed = await offer([[german], [french]]);
    const empty = await offer([]);
    const inGermany = (await rows({ areaIds: [germanyId] })).map((r) => r.id);
    assert.ok(inGermany.includes(allGerman));
    assert.ok(!inGermany.includes(mixed));
    assert.ok(!inGermany.includes(empty));
    assert.ok((await rows({ areaIds: [germanyId, franceId] })).some((r) => r.id === mixed));
  });

  it("narrows to the offers with no stated price — an auction's being its starting price", async () => {
    const priced = await offer([[german]], { price: "7.00" });
    const unpricedOffer = await offer([[german]]);
    const auction = await offer([[german]], { auction: true });
    const ids = (await rows({ noPrice: true })).map((r) => r.id);
    assert.ok(!ids.includes(priced));
    assert.ok(ids.includes(unpricedOffer));
    assert.ok(ids.includes(auction));
    await prisma.offer.update({ where: { id: auction }, data: { startingPrice: "3.00" } });
    assert.ok(!(await rows({ noPrice: true })).some((r) => r.id === auction));
  });

  it("shows the copies' photos until the offer has generated images of its own", async () => {
    const offerId = await offer([[german], [french]]);
    let row = (await rows()).find((r) => r.id === offerId)!;
    assert.equal(row.picturesGenerated, false);
    assert.deepEqual(
      row.pictures.map((p) => p.photoId),
      [photoId]
    );
    const generated = await prisma.photo.create({
      data: { offerId, kind: "generated", storageKey: `gen-${offerId}.jpg`, mime: "image/jpeg", width: 10, height: 10, sizeBytes: 100 },
    });
    await prisma.offerPhotoEntry.create({ data: { offerId, photoId: generated.id, sortOrder: 0, setIds: [] } });
    row = (await rows()).find((r) => r.id === offerId)!;
    assert.equal(row.picturesGenerated, true);
    assert.deepEqual(
      row.pictures.map((p) => p.photoId),
      [generated.id]
    );
  });

  it("carries the offer's copies set by set, and their conditions with counts in dictionary order (#1941)", async () => {
    const hinged = await prisma.stampCondition.create({
      data: { collectionId, name: "Mint Hinged", abbreviation: "MH", sortOrder: 1 },
    });
    const stamp = await prisma.stamp.create({
      data: { collectionId, name: "Hinged", stampAreaLinks: { create: [{ collectionAreaId: germanyId, isPrimary: true }] } },
    });
    const hingedCopy = (await createItem(userId, collectionId, { stampId: stamp.id, conditionId: hinged.id, forSale: true })).id;
    const offerId = await offer([[hingedCopy], [german, german2]]);
    const row = (await rows()).find((r) => r.id === offerId)!;
    assert.equal(row.itemIds[0], hingedCopy);
    assert.deepEqual([...row.itemIds.slice(1)].sort(), [german, german2].sort());
    assert.deepEqual(row.conditions, [
      { id: conditionId, abbreviation: "MNH", name: "Mint Never Hinged", count: 2 },
      { id: hinged.id, abbreviation: "MH", name: "Mint Hinged", count: 1 },
    ]);
  });

  it("names the translations a title following its template is missing, and none once it is written by hand (#1941)", async () => {
    const polish = await prisma.contact.create({
      data: { collectionId, name: "Allegro PL", platform: true, titleTemplate: "{name}", titleLanguage: "pl" },
    });
    const offerId = await offer([[german]], { platform: polish.id });
    let row = (await rows()).find((r) => r.id === offerId)!;
    assert.equal(row.titleTranslations.language, "pl");
    assert.deepEqual(
      row.titleTranslations.gaps.map((g) => `${g.entityType}:${g.entityField}:${g.defaultValue}`),
      ["stamp:name:German"]
    );
    await patchOffer(userId, offerId, { name: "Niemcy, znaczek" });
    row = (await rows()).find((r) => r.id === offerId)!;
    assert.deepEqual(row.titleTranslations.gaps, []);
    // An offer on a platform listing in the collection's own language has nothing to translate.
    const plain = (await rows()).find((r) => r.platformId === platformId)!;
    assert.deepEqual(plain.titleTranslations, { language: null, gaps: [] });
  });

  it("pages through the list", async () => {
    await offer([[german]]);
    await offer([[german]]);
    const first = await listPreparingOffers(userId, collectionId, { pageSize: 1 });
    assert.equal(first.items.length, 1);
    assert.equal(first.nextCursor, "1");
    const second = await listPreparingOffers(userId, collectionId, { pageSize: 1, offset: 1 });
    assert.notEqual(second.items[0].id, first.items[0].id);
  });

  it("prices the offers without a price at their estimate, and names the rest", async () => {
    const quickBuy = await offer([[german]]);
    const auction = await offer([[german2]], { auction: true });
    const priced = await offer([[german]], { price: "8.00" });
    const nothingToEstimate = await offer([[unpricedCopy]]);
    const expected = new Map((await rows()).map((r) => [r.id, r.suggestedPrice]));

    const result = await applyEstimatedPrices(userId, collectionId, [quickBuy, auction, priced, nothingToEstimate]);
    assert.deepEqual(result.succeeded, [quickBuy, auction]);
    assert.deepEqual(
      result.skipped.map((s) => s.offerId),
      [priced, nothingToEstimate]
    );

    const quick = await prisma.offer.findUniqueOrThrow({ where: { id: quickBuy }, select: { price: true } });
    assert.equal(quick.price.toFixed(2), expected.get(quickBuy));
    const auctioned = await prisma.offer.findUniqueOrThrow({
      where: { id: auction },
      select: { price: true, startingPrice: true },
    });
    // An auction states its opening figure; its current price is the bidding's and stays untouched.
    assert.equal(auctioned.startingPrice?.toFixed(2), expected.get(auction));
    assert.equal(auctioned.price.toFixed(2), "0.00");
    const kept = await prisma.offer.findUniqueOrThrow({ where: { id: priced }, select: { price: true } });
    assert.equal(kept.price.toFixed(2), "8.00");
  });

  it("refuses an offer of another collection's owner", async () => {
    await assert.rejects(listPreparingOffers("someone-else", collectionId));
  });
});
