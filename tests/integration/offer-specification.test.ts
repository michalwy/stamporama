import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import { addSaleLines, createSale } from "../../src/lib/sales";
import { readOfferSpecification } from "../../src/lib/offer-specification";

// An offer's specification for buyers (#1758), read against a real database: it lists the copies the
// offer still holds — a set sold through it and a copy sold through another listing are both gone —
// and it is written in the offer's language, the platform's, falling back to the collection's own
// wording name by name.

describe("an offer's specification (#1758)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let offerId: string;
  const items: Record<string, string> = {};
  let photoId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-offerspec-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User offerspec-${ts}`,
        email: `test-offerspec-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-offerspec-${ts}`, name: `Collection offerspec-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    // The platform lists in Polish; the collection writes its own names in English.
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Facebook", platform: true, titleLanguage: "pl" },
      })
    ).id;

    const stamp = await prisma.stamp.create({
      data: {
        collectionId,
        name: "Copernicus",
        issuedYear: 1973,
        translations: { create: { language: "pl", name: "Kopernik" } },
      },
    });
    const otherStamp = await prisma.stamp.create({
      data: { collectionId, name: "Chopin", issuedYear: 1949 },
    });
    const condition = await prisma.stampCondition.create({
      data: {
        collectionId,
        name: "Mint never hinged",
        abbreviation: "MNH",
        sortOrder: 0,
        translations: { create: { language: "pl", name: "Czysty", abbreviation: "**" } },
      },
    });
    const certificate = await prisma.certificateStatus.create({
      data: {
        collectionId,
        name: "Certificate",
        abbreviation: "Cert",
        sortOrder: 0,
        translations: { create: { language: "pl", name: "Atest" } },
      },
    });
    const thin = await prisma.fault.create({
      data: { collectionId, name: "Thin", sortOrder: 0, translations: { create: { language: "pl", name: "Cienkie miejsce" } } },
    });
    // No Polish name: it falls back to the collection's own.
    const crease = await prisma.fault.create({ data: { collectionId, name: "Crease", sortOrder: 1 } });

    const newItem = async (stampId: string, extra: { certificateStatusId?: string } = {}) =>
      (await createItem(userId, collectionId, { stampId, conditionId: condition.id, forSale: true, ...extra })).id;
    items.soldHere = await newItem(stamp.id);
    items.kept = await newItem(stamp.id, { certificateStatusId: certificate.id });
    items.soldElsewhere = await newItem(otherStamp.id);
    items.second = await newItem(otherStamp.id);

    await prisma.itemFault.createMany({
      data: [
        { itemId: items.kept, faultId: thin.id },
        { itemId: items.kept, faultId: crease.id },
      ],
    });
    photoId = (
      await prisma.photo.create({
        data: {
          itemId: items.kept,
          role: "front",
          storageKey: `offerspec-${ts}.jpg`,
          mime: "image/jpeg",
          width: 10,
          height: 10,
          sizeBytes: 100,
        },
      })
    ).id;

    const newOffer = async () => {
      const id = await createOffer(userId, collectionId, {
        platformId,
        url: null,
        listingType: "fixed",
        price: "10.00",
        currency: "PLN",
        listingDate: null,
        state: "preparing",
      });
      return id;
    };
    offerId = await newOffer();
    await prisma.offer.update({ where: { id: offerId }, data: { name: "Kopernik i Chopin" } });
    const soldSet = await addOfferSet(userId, offerId, [items.soldHere]);
    await addOfferSet(userId, offerId, [items.kept, items.soldElsewhere, items.second]);
    const elsewhere = await newOffer();
    const elsewhereSet = await addOfferSet(userId, elsewhere, [items.soldElsewhere]);
    for (const id of [offerId, elsewhere]) {
      await setOfferState(userId, id, "ready");
      await setOfferState(userId, id, "active");
    }

    const saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    await addSaleLines(userId, saleId, [
      { offerId, offerSetId: soldSet, price: "10.00", itemIds: [items.soldHere] },
      { offerId: elsewhere, offerSetId: elsewhereSet, price: "10.00", itemIds: [items.soldElsewhere] },
    ]);
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("lists only the copies a partly sold offer still holds", async () => {
    const spec = await readOfferSpecification(userId, offerId);
    assert.ok(spec);
    assert.deepEqual(
      spec.rows.map((row) => row.itemId).sort(),
      [items.kept, items.second].sort()
    );
  });

  it("names the offer by its number and title", async () => {
    const spec = await readOfferSpecification(userId, offerId);
    assert.ok(spec);
    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { offerNo: true } });
    assert.equal(spec.offerNo, offer.offerNo);
    assert.equal(spec.title, "Kopernik i Chopin");
  });

  it("writes each row in the platform's language, falling back name by name", async () => {
    const spec = await readOfferSpecification(userId, offerId);
    assert.ok(spec);
    const kept = spec.rows.find((row) => row.itemId === items.kept);
    assert.ok(kept);
    assert.equal(kept.description, "Kopernik");
    assert.equal(kept.year, 1973);
    assert.equal(kept.condition, "Czysty");
    assert.deepEqual(kept.faults, ["Cienkie miejsce", "Crease"]);
    assert.equal(kept.certificate, "Atest");
    assert.equal(kept.photoId, photoId);

    const second = spec.rows.find((row) => row.itemId === items.second);
    assert.ok(second);
    // No translation of the stamp's name: the collection's own.
    assert.equal(second.description, "Chopin");
    assert.equal(second.certificate, null);
    assert.deepEqual(second.faults, []);
    assert.equal(second.photoId, null);
  });

  it("carries no price, value or internal identifier", async () => {
    const spec = await readOfferSpecification(userId, offerId);
    assert.ok(spec);
    for (const row of spec.rows) {
      assert.deepEqual(Object.keys(row).sort(), [
        "area",
        "catalog",
        "certificate",
        "condition",
        "description",
        "faults",
        "issue",
        "itemId",
        "photoId",
        "year",
      ]);
    }
  });

  it("is nobody else's", async () => {
    assert.equal(await readOfferSpecification(`${userId}-other`, offerId), null);
  });
});
