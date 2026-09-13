import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import { createOffer, getOfferDetail, regenerateOfferText } from "../../src/lib/offers";

// `{catalog}` on a **multi-stamp copy** (ADR-0044 §8, #749). The rendering rules are unit-tested
// (`tests/unit/offer-title-template.test.ts`, `tests/unit/offer-listing-template.test.ts`); what is
// exercised here is the wiring: that the copy normalisation reads every stamp the piece carries off
// `ItemStamp`, in the collector's order, each resolved against its **own** area's prefix — and that an
// ordinary copy, and a carrier edited back down to one stamp, render exactly as they always did.

describe("{catalog} on a multi-stamp copy (#749)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let conditionId: string;
  let vendorId: string;
  let polandId: string;
  let danzigId: string;

  const TITLE_TEMPLATE = "{catalog}";
  const DESCRIPTION_TEMPLATE = "{#copy}{catalog} · {name}\n{/copy}";

  before(async () => {
    const ts = Date.now();
    userId = `test-user-multi-stamp-catalog-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User multi-stamp-catalog-${ts}`,
        email: `test-multi-stamp-catalog-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-multi-stamp-catalog-${ts}`,
          name: `Collection multi-stamp-catalog-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "en",
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    const catalogNameId = (
      await prisma.catalogName.create({
        data: { vendorId, name: "Michel Katalog", currency: "EUR" },
      })
    ).id;
    // Two areas under one catalogue with different prefixes: a cover franked with stamps of both
    // must name each under its own, which only a per-stamp resolution can do.
    const area = async (name: string, areaPrefix: string) => {
      const id = (
        await prisma.collectionArea.create({
          data: { collectionId, name, primaryCatalogNameId: catalogNameId },
        })
      ).id;
      await prisma.collectionAreaCatalog.create({ data: { collectionAreaId: id, catalogNameId } });
      await prisma.collectionAreaVendor.create({
        data: { collectionAreaId: id, catalogVendorId: vendorId, areaPrefix },
      });
      return id;
    };
    polandId = await area("Poland", "PL");
    danzigId = await area("Danzig", "DR");

    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Delcampe",
          platform: true,
          platformCurrency: "EUR",
          titleTemplate: TITLE_TEMPLATE,
          descriptionTemplate: DESCRIPTION_TEMPLATE,
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function stamp(areaId: string, number: string, name: string): Promise<string> {
    const created = await prisma.stamp.create({
      data: {
        collectionId,
        name,
        stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        catalogNumbers: { create: [{ catalogVendorId: vendorId, number }] },
      },
    });
    return created.id;
  }

  async function copyOf(stampId: string): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  /** A carrier bearing `stampIds` in that order — made the way the collector makes one, by editing
   *  an ordinary copy's list (#746). */
  async function carrierOf(stampIds: string[]): Promise<string> {
    const itemId = await copyOf(stampIds[0]);
    await setItemStamps(userId, itemId, stampIds.map((stampId) => ({ stampId })));
    return itemId;
  }

  async function offerOver(itemIds: string[]): Promise<string> {
    return createOffer(
      userId,
      collectionId,
      { platformId, url: null, price: "5.00", currency: "EUR", listingDate: null, state: "preparing" },
      { seedItemIds: itemIds }
    );
  }

  it("names every stamp a carrier bears, each under its own area's prefix, in the collector's order", async () => {
    const cover = await carrierOf([
      await stamp(polandId, "205", "Chopin"),
      await stamp(danzigId, "5", "Crane"),
      await stamp(polandId, "200", "Copernicus"),
    ]);
    const detail = await getOfferDetail(userId, await offerOver([cover]));
    // Poland leads because the collector put a Polish stamp first; within it the numbers collapse
    // as they would across loose copies.
    assert.equal(detail?.name, "Mi·PL 200,205 / Mi·DR 5");
    assert.equal(detail?.description, "Mi·PL 200,205 / Mi·DR 5 · Chopin");
  });

  it("joins a carrier with the other copies of a batch offer, while each {#copy} names its own", async () => {
    const cover = await carrierOf([
      await stamp(polandId, "300", "Pulaski"),
      await stamp(polandId, "302", "Kosciuszko"),
    ]);
    const loose = await copyOf(await stamp(polandId, "301", "Sobieski"));
    const detail = await getOfferDetail(userId, await offerOver([cover, loose]));
    assert.equal(detail?.name, "Mi·PL 300-02");
    assert.equal(detail?.description, "Mi·PL 300,302 · Pulaski\nMi·PL 301 · Sobieski");
  });

  it("leaves a copy of one stamp exactly as it rendered before", async () => {
    const single = await copyOf(await stamp(polandId, "400", "Kopernik"));
    const detail = await getOfferDetail(userId, await offerOver([single]));
    assert.equal(detail?.name, "Mi·PL 400");
    assert.equal(detail?.description, "Mi·PL 400 · Kopernik");
  });

  it("names only the one stamp left once a carrier is edited back down to it", async () => {
    const first = await stamp(polandId, "500", "Mickiewicz");
    const cover = await carrierOf([first, await stamp(polandId, "501", "Slowacki")]);
    const offerId = await offerOver([cover]);
    assert.equal((await getOfferDetail(userId, offerId))?.name, "Mi·PL 500-01");

    await setItemStamps(userId, cover, [{ stampId: first }]);
    assert.equal(await regenerateOfferText(userId, offerId, "name"), "Mi·PL 500");
  });
});
