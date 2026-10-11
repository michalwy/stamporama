import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import { addSaleLines, createSale } from "../../src/lib/sales";
import { readOfferSpecification } from "../../src/lib/offer-specification";
import {
  canServeOfferSpecificationPhoto,
  createOfferSpecificationShareToken,
  readOfferSpecificationShareState,
  readSharedOfferSpecification,
  revokeOfferSpecificationShareToken,
  verifyOfferSpecificationShareToken,
} from "../../src/lib/offer-specification-share";

// A buyer's link to an offer's specification (#1760), against a real database. The token names one
// offer and resolves to nothing else; a replaced or withdrawn link resolves to nothing at all; the
// page shows the specification only while it reads as it did when the link was made and the offer is
// open, and otherwise a notice; and the thumbnails it serves are exactly the ones the specification
// shows — a copy sold since, another scan of a listed copy, or anything else in the collection is
// refused.

describe("an offer's specification share link (#1760)", () => {
  let userId: string;
  let collectionId: string;
  let offerId: string;
  const photos: Record<string, string> = {};

  before(async () => {
    const ts = Date.now();
    userId = `test-user-specshare-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User specshare-${ts}`,
        email: `test-specshare-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-specshare-${ts}`, name: `Collection specshare-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    const platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Facebook", platform: true } })
    ).id;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: "Copernicus" } })).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;

    const newItem = async () =>
      (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
    const kept = await newItem();
    const backOnly = await newItem();
    const soldElsewhere = await newItem();
    const soldHere = await newItem();
    const outside = await newItem();

    const photo = async (key: string, itemId: string, role: string) => {
      photos[key] = (
        await prisma.photo.create({
          data: {
            itemId,
            role,
            storageKey: `specshare-${ts}-${key}.jpg`,
            mime: "image/jpeg",
            width: 10,
            height: 10,
            sizeBytes: 100,
          },
        })
      ).id;
    };
    await photo("keptFront", kept, "front");
    await photo("keptBack", kept, "back");
    await photo("backOnly", backOnly, "back");
    await photo("soldElsewhere", soldElsewhere, "front");
    await photo("soldHere", soldHere, "front");
    await photo("outside", outside, "front");

    const newOffer = () =>
      createOffer(userId, collectionId, {
        platformId,
        url: null,
        listingType: "fixed",
        price: "10.00",
        currency: "PLN",
        listingDate: null,
        state: "preparing",
      });
    offerId = await newOffer();
    await addOfferSet(userId, offerId, [kept, backOnly, soldElsewhere]);
    const soldSet = await addOfferSet(userId, offerId, [soldHere]);
    const elsewhere = await newOffer();
    const elsewhereSet = await addOfferSet(userId, elsewhere, [soldElsewhere]);
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
      { offerId, offerSetId: soldSet, price: "10.00", itemIds: [soldHere] },
      { offerId: elsewhere, offerSetId: elsewhereSet, price: "10.00", itemIds: [soldElsewhere] },
    ]);
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("resolves to the one offer it was minted for, and records the visit", async () => {
    assert.equal((await readOfferSpecificationShareState(userId, offerId)).link, null);
    const { token } = await createOfferSpecificationShareToken(userId, offerId);
    assert.ok(token.startsWith("stmpo_"));

    const before = (await readOfferSpecificationShareState(userId, offerId)).link;
    assert.ok(before);
    assert.equal(before.lastUsedAt, null);
    assert.equal(before.standing, "current");

    // A thumbnail is not a visit.
    const quiet = await verifyOfferSpecificationShareToken(token, { touch: false });
    assert.ok(quiet);
    assert.deepEqual(
      { offerId: quiet.offerId, ownerId: quiet.ownerId, collectionId: quiet.collectionId },
      { offerId, ownerId: userId, collectionId }
    );
    assert.equal((await readOfferSpecificationShareState(userId, offerId)).link?.lastUsedAt, null);

    // The page is.
    assert.ok(await verifyOfferSpecificationShareToken(token));
    assert.ok((await readOfferSpecificationShareState(userId, offerId)).link?.lastUsedAt);
  });

  it("refuses an invented token and another credential's shape", async () => {
    assert.equal(await verifyOfferSpecificationShareToken("stmpo_nothing-like-this"), null);
    assert.equal(await verifyOfferSpecificationShareToken("stmps_abc"), null);
    assert.equal(await verifyOfferSpecificationShareToken(""), null);
  });

  it("serves exactly the thumbnails the specification shows", async () => {
    const { token } = await createOfferSpecificationShareToken(userId, offerId);
    const access = await verifyOfferSpecificationShareToken(token, { touch: false });
    assert.ok(access);

    const spec = await readOfferSpecification(access.ownerId, access.offerId);
    assert.ok(spec);
    const shown = new Set(spec.rows.flatMap((row) => (row.photoId ? [row.photoId] : [])));
    assert.deepEqual([...shown].sort(), [photos.keptFront, photos.backOnly].sort());

    for (const [key, id] of Object.entries(photos)) {
      assert.equal(
        await canServeOfferSpecificationPhoto(access, id),
        shown.has(id),
        `photo ${key}`
      );
    }
  });

  it("stops the old address working when a new link is generated", async () => {
    const { token: first } = await createOfferSpecificationShareToken(userId, offerId);
    const { token: second } = await createOfferSpecificationShareToken(userId, offerId);
    assert.notEqual(first, second);
    assert.equal(await verifyOfferSpecificationShareToken(first), null);
    assert.ok(await verifyOfferSpecificationShareToken(second));
    assert.equal(await prisma.offerSpecificationShareToken.count({ where: { offerId } }), 1);
  });

  it("shows nothing once withdrawn", async () => {
    const { token } = await createOfferSpecificationShareToken(userId, offerId);
    await revokeOfferSpecificationShareToken(userId, offerId);
    assert.equal(await verifyOfferSpecificationShareToken(token), null);
    assert.equal((await readOfferSpecificationShareState(userId, offerId)).link, null);
  });

  it("is nobody else's to mint, read or withdraw", async () => {
    const other = `${userId}-other`;
    await assert.rejects(createOfferSpecificationShareToken(other, offerId));
    await assert.rejects(readOfferSpecificationShareState(other, offerId));
    await assert.rejects(revokeOfferSpecificationShareToken(other, offerId));
    // Nor read through another collection's address.
    await assert.rejects(readOfferSpecificationShareState(userId, offerId, `${collectionId}-other`));
  });
  it("shows the specification it was made from, in the offer's language", async () => {
    const { token } = await createOfferSpecificationShareToken(userId, offerId);
    const access = await verifyOfferSpecificationShareToken(token, { touch: false });
    assert.ok(access);
    const shared = await readSharedOfferSpecification(access);
    assert.ok(shared && shared.standing === "current");
    // The platform names no language, so the offer's is the collection's own.
    assert.equal(shared.spec.language, "en");
    assert.equal(shared.spec.rows.length, 2);

    await prisma.contact.updateMany({ where: { collectionId, platform: true }, data: { titleLanguage: "pl" } });
    // The language is part of what the link showed, so the old link now reads as changed…
    assert.equal((await readSharedOfferSpecification(access))?.standing, "changed");
    // …and a new one speaks Polish.
    const { token: polish } = await createOfferSpecificationShareToken(userId, offerId);
    const polishAccess = await verifyOfferSpecificationShareToken(polish, { touch: false });
    assert.ok(polishAccess);
    const polishShared = await readSharedOfferSpecification(polishAccess);
    assert.ok(polishShared && polishShared.standing === "current");
    assert.equal(polishShared.spec.language, "pl");
    assert.equal((await readOfferSpecificationShareState(userId, offerId)).language, "pl");
  });

  it("says the offer has changed once anything on the specification has, and nothing of it", async () => {
    const { token } = await createOfferSpecificationShareToken(userId, offerId);
    const access = await verifyOfferSpecificationShareToken(token, { touch: false });
    assert.ok(access);

    await prisma.offer.update({ where: { id: offerId }, data: { name: "Renamed since" } });
    const shared = await readSharedOfferSpecification(access);
    assert.ok(shared);
    assert.equal(shared.standing, "changed");
    assert.ok(!("spec" in shared));
    assert.equal((await readOfferSpecificationShareState(userId, offerId)).link?.standing, "changed");
    // The link itself still opens.
    assert.ok(await verifyOfferSpecificationShareToken(token));

    // A new link records the specification as it is now.
    const { token: fresh } = await createOfferSpecificationShareToken(userId, offerId);
    const freshAccess = await verifyOfferSpecificationShareToken(fresh, { touch: false });
    assert.ok(freshAccess);
    assert.equal((await readSharedOfferSpecification(freshAccess))?.standing, "current");
  });

  it("says the same once the offer has closed, and serves no thumbnail", async () => {
    const { token } = await createOfferSpecificationShareToken(userId, offerId);
    const access = await verifyOfferSpecificationShareToken(token, { touch: false });
    assert.ok(access);
    assert.equal(await canServeOfferSpecificationPhoto(access, photos.keptFront), true);

    await prisma.offer.update({ where: { id: offerId }, data: { state: "withdrawn" } });
    assert.equal((await readSharedOfferSpecification(access))?.standing, "closed");
    assert.equal((await readOfferSpecificationShareState(userId, offerId)).link?.standing, "closed");
    assert.equal(await canServeOfferSpecificationPhoto(access, photos.keptFront), false);
  });
});
