import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  findOfferListingDuplicates,
  findStampConditionCollisions,
  listComposeTargets,
} from "../../src/lib/offers";
import { previewOfferGeneration, type GeneratorInput } from "../../src/lib/offer-generator";

// An umbrella offer and an offer on its cheapest variant are one Colnect listing (#1347).
//
// Colnect lists an unknown-variant umbrella under its cheapest variant (#616), resolved per condition,
// so the check for an existing similar offer (#732) has to compare what each set will be **listed
// as** — or it misses the pair Colnect then refuses. Each case builds a tree of its own, so the cases
// never see each other's offers.
//
// The trees below are priced so that the answer depends on the condition: used, the `I` variant is
// the cheaper (the collector's 523 / 523I case, 2026-09-18); MNH, the `II` variant is.

const ts = Date.now();

describe("umbrella collisions by listed variant (#1347)", () => {
  let userId: string;
  let collectionId: string;
  let colnectId: string;
  let allegroId: string;
  let mnhId: string;
  let usedId: string;
  let vendorId: string;
  let catalogEditionId: string;
  let areaId: string;
  let variantSubtypeId: string;
  let seq = 0;

  before(async () => {
    userId = `test-user-umbrella-collisions-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User umbrella-collisions-${ts}`,
        email: `test-umbrella-collisions-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-umbrella-collisions-${ts}`, name: "Umbrella collisions", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 } })
    ).id;
    colnectId = (
      await prisma.contact.create({
        data: { collectionId, name: "Colnect", platform: true, platformModule: "colnect", platformCurrency: "EUR" },
      })
    ).id;
    allegroId = (
      await prisma.contact.create({
        data: { collectionId, name: "Allegro", platform: true, platformModule: "allegro", platformCurrency: "PLN" },
      })
    ).id;
    vendorId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    const catalogNameId = (
      await prisma.catalogName.create({ data: { vendorId, name: "Michel Katalog", currency: "EUR" } })
    ).id;
    catalogEditionId = (await prisma.catalogEdition.create({ data: { catalogNameId, year: 2024 } })).id;
    areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland", primaryCatalogNameId: catalogNameId } })
    ).id;
    await prisma.collectionAreaCatalog.create({ data: { collectionAreaId: areaId, catalogNameId } });
    await prisma.collectionAreaVendor.create({
      data: { collectionAreaId: areaId, catalogVendorId: vendorId, areaPrefix: "PL" },
    });
    variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Colour variety", actsAsVariant: true, isDefault: true, sortOrder: 0 },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** An umbrella with variants `I` and `II`, both matched on Colnect: `I` the cheaper used, `II` the
   *  cheaper MNH. */
  async function tree(): Promise<{ umbrella: string; one: string; two: string }> {
    seq += 1;
    const umbrella = await prisma.stamp.create({
      data: {
        collectionId,
        name: `Umbrella ${seq}`,
        issuedYear: 1960,
        stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
      },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: umbrella.id, catalogVendorId: vendorId, number: `${500 + seq}` },
    });
    const variant = async (suffix: string, used: string, mnh: string) => {
      const child = await prisma.stamp.create({
        data: {
          collectionId,
          parentId: umbrella.id,
          name: `Umbrella ${seq} ${suffix}`,
          issuedYear: 1960,
          subtypeId: variantSubtypeId,
          colnectId: `${seq}-${suffix}`,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      });
      await prisma.stampCatalogNumber.create({
        data: { stampId: child.id, catalogVendorId: vendorId, number: `${500 + seq}${suffix}` },
      });
      await prisma.stampCatalogPrice.createMany({
        data: [
          { stampId: child.id, catalogEditionId, conditionId: usedId, certificateStatusId: null, price: used, currency: "EUR" },
          { stampId: child.id, catalogEditionId, conditionId: mnhId, certificateStatusId: null, price: mnh, currency: "EUR" },
        ],
      });
      return child.id;
    };
    const one = await variant("I", "2.00", "30.00");
    const two = await variant("II", "8.00", "12.00");
    return { umbrella: umbrella.id, one, two };
  }

  async function copy(stampId: string, conditionId: string): Promise<string> {
    return (
      await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" })
    ).id;
  }

  async function offer(platformId: string, sets: string[][]): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    for (const itemIds of sets) await addOfferSet(userId, offerId, itemIds);
    return offerId;
  }

  const collidingOffers = async (itemIds: string[], platformId: string) =>
    (await findStampConditionCollisions(userId, collectionId, itemIds, { platformId })).map((c) => c.offerId);

  it("warns that the offer on the resolved variant already covers an umbrella copy", async () => {
    const { umbrella, one } = await tree();
    const listed = await offer(colnectId, [[await copy(one, usedId)]]);
    const candidate = await copy(umbrella, usedId);

    const collisions = await findStampConditionCollisions(userId, collectionId, [candidate], { platformId: colnectId });
    assert.deepEqual(
      collisions.map((c) => [c.offerId, c.itemIds]),
      [[listed, [candidate]]]
    );

    // The picker says the same, from the same read.
    const targets = await listComposeTargets(userId, collectionId, [candidate]);
    assert.deepEqual(targets.offers.find((o) => o.offerId === listed)?.collidingItemIds, [candidate]);

    // Taking **Add to #N instead** gives that offer a second unit of the one listing.
    await addOfferSet(userId, listed, [candidate]);
    const sets = await prisma.offerSet.count({ where: { offerId: listed } });
    assert.equal(sets, 2);
  });

  it("warns the other way round too: a variant copy against an umbrella offer resolving to it", async () => {
    const { umbrella, one } = await tree();
    const listed = await offer(colnectId, [[await copy(umbrella, usedId)]]);
    assert.deepEqual(await collidingOffers([await copy(one, usedId)], colnectId), [listed]);
  });

  it("resolves per condition: MNH, the umbrella is matched against the other variant", async () => {
    const { umbrella, one, two } = await tree();
    const onOne = await offer(colnectId, [[await copy(one, mnhId)]]);
    const onTwo = await offer(colnectId, [[await copy(two, mnhId)]]);
    const found = await collidingOffers([await copy(umbrella, mnhId)], colnectId);
    assert.deepEqual(found, [onTwo]);
    assert.ok(!found.includes(onOne));
  });

  it("follows a variant chosen by hand on the listed offer", async () => {
    const { umbrella, one, two } = await tree();
    // Used, the umbrella would resolve to `I`; this offer says to list it under `II`.
    const listed = await offer(colnectId, [[await copy(umbrella, usedId)]]);
    await prisma.offerListedVariant.create({
      data: { offerId: listed, stampId: umbrella, conditionId: usedId, variantStampId: two },
    });
    assert.deepEqual(await collidingOffers([await copy(two, usedId)], colnectId), [listed]);
    assert.deepEqual(await collidingOffers([await copy(one, usedId)], colnectId), []);
  });

  it("changes nothing on a platform that lists the umbrella itself", async () => {
    const { umbrella, one } = await tree();
    await offer(allegroId, [[await copy(one, usedId)]]);
    assert.deepEqual(await collidingOffers([await copy(umbrella, usedId)], allegroId), []);

    const umbrellaOffer = await offer(allegroId, [[await copy(umbrella, usedId)]]);
    assert.deepEqual(await collidingOffers([await copy(umbrella, usedId)], allegroId), [umbrellaOffer]);
  });

  it("flags an existing pair on each offer's own screen", async () => {
    const { umbrella, one } = await tree();
    const onVariant = await offer(colnectId, [[await copy(one, usedId)]]);
    const onUmbrella = await offer(colnectId, [[await copy(umbrella, usedId)]]);
    // A third offer on another platform is not a pair: the entry is per platform.
    await offer(allegroId, [[await copy(one, usedId)]]);

    const fromUmbrella = await findOfferListingDuplicates(userId, collectionId, onUmbrella);
    assert.deepEqual(fromUmbrella.map((d) => d.offerId), [onVariant]);
    const fromVariant = await findOfferListingDuplicates(userId, collectionId, onVariant);
    assert.deepEqual(fromVariant.map((d) => d.offerId), [onUmbrella]);
  });

  it("does not flag an umbrella offer beside an offer on a variant it does not resolve to", async () => {
    const { umbrella, two } = await tree();
    await offer(colnectId, [[await copy(two, usedId)]]);
    const onUmbrella = await offer(colnectId, [[await copy(umbrella, usedId)]]);
    assert.deepEqual(await findOfferListingDuplicates(userId, collectionId, onUmbrella), []);
  });

  describe("the offer generator (#1287)", () => {
    const input = (itemIds: string[]): GeneratorInput => ({
      platformId: colnectId,
      state: "preparing",
      mode: "singles",
      packaging: "multi",
      itemIds,
      filters: {},
      targets: {},
    });

    it("adds an umbrella copy to the offer on the variant it is listed under", async () => {
      const { umbrella, one } = await tree();
      const listed = await offer(colnectId, [[await copy(one, usedId)]]);
      const preview = await previewOfferGeneration(userId, collectionId, input([await copy(umbrella, usedId)]));
      assert.deepEqual(
        preview.lines.map((line) => line.target),
        [{ kind: "existing", offerId: listed }]
      );
    });

    it("packs an umbrella and its resolved variant as one line", async () => {
      const { umbrella, one } = await tree();
      const preview = await previewOfferGeneration(
        userId,
        collectionId,
        input([await copy(umbrella, usedId), await copy(one, usedId)])
      );
      assert.equal(preview.lines.length, 1);
      assert.equal(preview.lines[0].sets.length, 2);
    });
  });
});
