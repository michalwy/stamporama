import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  createOffer,
  addOfferSet,
  getOfferDetail,
  updateOfferSet,
} from "../../src/lib/offers";

// A set's **derived** label (#379): the numbers of the copies it holds, under the catalogue that
// leads in their area and collapsed into ranges — `Mi·RU-NW 15-19`, where a bare `15 + 16 + 17 + 18
// + 19` named no catalogue and could not be read at a glance. The collapsing itself is unit-tested
// (`tests/unit/offer-set-rules.test.ts`); what is exercised here is the server-side resolution: which
// vendor leads in the stamp's area and how that vendor's numbers are prefixed there.

describe("derived offer set label (#379)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  /** Copies of Mi·NW 15…19, in catalogue order. */
  let northWest: string[];
  /** A copy under a second area + second vendor, to prove numbers are not pooled. */
  let southEast: string;
  /** A copy of a stamp no catalogue numbered. */
  let nameless: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-set-label-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User set-label-${ts}`,
        email: `test-set-label-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-set-label-${ts}`,
        name: `Collection set-label-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    platformId = (await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })).id;
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });

    const michel = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const fischer = await prisma.catalogVendor.create({
      data: { collectionId, name: "Fischer", abbreviation: "Fi" },
    });
    // Each area declares its own catalogue with its own per-area prefix, and names one primary —
    // which is what decides the number a label picks when a stamp carries several.
    const mkArea = async (name: string, vendorId: string, prefix: string) => {
      const catalogName = await prisma.catalogName.create({
        data: { vendorId, name: `${name} catalogue`, currency: "EUR" },
      });
      return prisma.collectionArea.create({
        data: {
          collectionId,
          name,
          primaryCatalogNameId: catalogName.id,
          // The area declares which catalogue it uses, and separately how that vendor's numbers
          // are prefixed inside it — the two halves `buildAreaVendorMaps` resolves a label from.
          collectionAreaCatalogs: { create: [{ catalogNameId: catalogName.id }] },
          collectionAreaVendors: { create: [{ catalogVendorId: vendorId, areaPrefix: prefix }] },
        },
      });
    };
    const nw = await mkArea("North-West", michel.id, "RU-NW");
    const se = await mkArea("South-East", fischer.id, "PL");

    const mkCopy = async (name: string, areaId: string, vendorId: string | null, number: string | null) => {
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          ...(vendorId && number
            ? { catalogNumbers: { create: [{ catalogVendorId: vendorId, number }] } }
            : {}),
        },
      });
      const item = await createItem(userId, collectionId, {
        stampId: stamp.id,
        conditionId: condition.id,
        forSale: true,
      });
      return item.id;
    };

    northWest = [];
    for (const n of ["15", "16", "17", "18", "19"]) {
      northWest.push(await mkCopy(`NW ${n}`, nw.id, michel.id, n));
    }
    southEast = await mkCopy("SE 3", se.id, fischer.id, "3");
    nameless = await mkCopy("Unlisted essay", nw.id, null, null);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function labelOf(itemIds: string[], title?: string): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, itemIds, title);
    const detail = await getOfferDetail(userId, offerId);
    assert.ok(detail);
    return detail.sets[0].label;
  }

  it("collapses a series into one range under its area's catalogue", async () => {
    assert.equal(await labelOf(northWest), "Mi·RU-NW 15-19");
  });

  it("names a single copy with its prefix too", async () => {
    assert.equal(await labelOf([northWest[0]]), "Mi·RU-NW 15");
  });

  it("keeps two areas' catalogues apart instead of pooling their numbers", async () => {
    assert.equal(await labelOf([northWest[0], northWest[1], southEast]), "Mi·RU-NW 15-16 / Fi·PL 3");
  });

  it("falls back to the stamp's name when no catalogue numbered it", async () => {
    assert.equal(await labelOf([nameless]), "Unlisted essay");
  });

  it("still lets an explicit title win", async () => {
    assert.equal(await labelOf(northWest, "Komplet 1938"), "Komplet 1938");
  });

  it("goes back to the derived label when the title is cleared", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    const setId = await addOfferSet(userId, offerId, northWest, "Komplet 1938");
    await updateOfferSet(userId, setId, "");
    const detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.sets[0].label, "Mi·RU-NW 15-19");
  });

  it("carries the offer's own label from its only set", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, northWest);
    const detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.label, "Mi·RU-NW 15-19");
  });
});
