import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  createOffer,
  quickOfferCreationBlock,
  writeGeneratedOffers,
  type OfferInput,
} from "../../src/lib/offers";
import { commitLotProposal } from "../../src/lib/lot-builder";
import type { LotBuilderRequest } from "../../src/lib/lot-builder-criteria";
import { setFacebookPlatform } from "../../src/lib/facebook";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS, type FacebookGroupValues } from "../../src/lib/facebook-group-rules";

// A Facebook offer made without the offer form (#1663): the Lot builder, quick offer mode and the
// generator on the Copies list, *Series from singles*. Each sends the group picked beside its create
// button and the closing time the browser worked out from it; the server reads the rest of the group's
// defaults as it does for the form — and works out a starting price given as a share of catalogue value
// over the offer's own copies, since no form did. The picker itself is client state and not here.

function groupValues(overrides: Partial<FacebookGroupValues> = {}): FacebookGroupValues {
  return {
    ...FACEBOOK_GROUP_DEFAULTS,
    name: "Znaczki — aukcje",
    url: "https://www.facebook.com/groups/123456",
    ...overrides,
  };
}

describe("Facebook offers from the shortcuts (#1663)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let areaId: string;
  /** Opens at half of catalogue value, raises by 1.00. */
  let percentGroupId: string;
  /** Opens at 4.00. */
  let amountGroupId: string;
  let conditionId: string;
  let editionId: string;
  let catalogNameId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbshortcuts-${ts}`;
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
    // The base currency is the platform's, so no exchange rate is asked for.
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-fbshortcuts-${ts}`, name: `fbshortcuts-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.contact.create({
        data: { collectionId, name: "Facebook", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    await setFacebookPlatform(userId, collectionId, facebookId);
    const vendor = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    catalogNameId = (
      await prisma.catalogName.create({
        data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
      })
    ).id;
    editionId = (await prisma.catalogEdition.create({ data: { catalogNameId, year: 2024 } })).id;
    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Germany", primaryCatalogNameId: catalogNameId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    percentGroupId = (
      await createFacebookGroup(
        userId,
        collectionId,
        groupValues({
          startingPriceMode: "catalogPercent",
          startingPriceValue: 50,
          bidIncrement: 1,
          auctionDays: 7,
          closingTime: "20:00",
          custom: ["startingPrice", "bidIncrement", "auctionDays", "closingTime"],
        })
      )
    ).id;
    amountGroupId = (
      await createFacebookGroup(
        userId,
        collectionId,
        groupValues({
          name: "Filatelistyka",
          startingPriceMode: "amount",
          startingPriceValue: 4,
          custom: ["startingPrice"],
        })
      )
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** A copy for sale, catalogued at `price` EUR — or at nothing. */
  async function copy(price: string | null): Promise<string> {
    const stamp = await prisma.stamp.create({
      data: {
        collectionId,
        name: `Stamp ${price ?? "unpriced"} ${Math.random()}`,
        stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
      },
    });
    if (price) {
      await prisma.stampCatalogPrice.create({
        data: {
          stampId: stamp.id,
          catalogEditionId: editionId,
          conditionId,
          certificateStatusId: null,
          price,
          currency: "EUR",
        },
      });
    }
    return (await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true })).id;
  }

  /** What quick offer mode sends: a platform, a status — and, on Facebook, the group. */
  function quick(overrides: Partial<OfferInput> = {}): OfferInput {
    return {
      platformId: facebookId,
      url: null,
      price: "0.00",
      currency: "",
      listingDate: null,
      state: "preparing",
      ...overrides,
    };
  }

  const read = (offerId: string) =>
    prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: {
        listingType: true,
        startingPrice: true,
        bidIncrement: true,
        facebookGroupId: true,
        endsAt: true,
        state: true,
      },
    });

  it("opens a group's auction at its share of the copies' catalogue value, per set", async () => {
    const [a, b] = [await copy("30.00"), await copy("20.00")];
    const together = await read(
      await createOffer(userId, collectionId, quick({ facebookGroupId: percentGroupId }), { seedItemIds: [a, b] })
    );
    assert.equal(together.listingType, "auction");
    assert.equal(together.startingPrice?.toFixed(2), "25.00", "half of the one set's 50.00");
    assert.equal(together.bidIncrement?.toFixed(2), "1.00", "the group's increment");

    // A buyer takes one set, so a quantity listing opens at a share of one set's worth.
    const [c, d] = [await copy("30.00"), await copy("20.00")];
    const perCopy = await read(
      await createOffer(userId, collectionId, quick({ facebookGroupId: percentGroupId }), {
        seedItemIds: [c, d],
        seedPerCopy: true,
      })
    );
    assert.equal(perCopy.startingPrice?.toFixed(2), "12.50", "half of the 25.00 a set is worth on average");

    // A figure the form states outranks the share.
    const e = await copy("30.00");
    const stated = await read(
      await createOffer(userId, collectionId, quick({ facebookGroupId: percentGroupId, startingPrice: "7.00" }), {
        seedItemIds: [e],
      })
    );
    assert.equal(stated.startingPrice?.toFixed(2), "7.00");
  });

  it("states no opening figure over copies with no catalogue value, and refuses to start one Ready", async () => {
    const unpriced = await copy(null);
    const draft = await read(
      await createOffer(userId, collectionId, quick({ facebookGroupId: percentGroupId }), { seedItemIds: [unpriced] })
    );
    assert.equal(draft.startingPrice, null, "a share of nothing is no price");
    const another = await copy(null);
    await assert.rejects(
      () =>
        createOffer(userId, collectionId, quick({ facebookGroupId: percentGroupId, state: "ready" }), {
          seedItemIds: [another],
        }),
      /no starting price/
    );
  });

  it("says before the generator runs that Facebook needs a group, and nothing more once it has one", async () => {
    assert.match(
      (await quickOfferCreationBlock(userId, collectionId, facebookId, "ready")) ?? "",
      /Choose the Facebook group/
    );
    assert.equal(await quickOfferCreationBlock(userId, collectionId, facebookId, "ready", amountGroupId), null);
    // A share of catalogue value is worked out per offer as it is written, so it blocks nothing ahead.
    assert.equal(await quickOfferCreationBlock(userId, collectionId, facebookId, "ready", percentGroupId), null);
  });

  it("generates every new offer as an auction in the group, closing when the browser said", async () => {
    const [a, b] = [await copy("10.00"), await copy("8.00")];
    const endsAt = new Date("2026-11-01T19:00:00.000Z");
    const { createdOfferIds } = await writeGeneratedOffers(userId, collectionId, {
      platformId: facebookId,
      state: "ready",
      facebookGroupId: amountGroupId,
      endsAt,
      newOffers: [[[a]], [[b]]],
      additions: [],
    });
    assert.equal(createdOfferIds.length, 2);
    for (const offerId of createdOfferIds) {
      const offer = await read(offerId);
      assert.equal(offer.facebookGroupId, amountGroupId);
      assert.equal(offer.state, "ready");
      assert.equal(offer.startingPrice?.toFixed(2), "4.00", "the group's amount");
      assert.equal(offer.endsAt?.toISOString(), endsAt.toISOString());
    }

    const c = await copy("10.00");
    await assert.rejects(
      () =>
        writeGeneratedOffers(userId, collectionId, {
          platformId: facebookId,
          state: "preparing",
          facebookGroupId: null,
          endsAt: null,
          newOffers: [[[c]]],
          additions: [],
        }),
      /Choose the Facebook group/
    );
  });

  it("creates the Lot builder's lot in the group picked beside its button", async () => {
    const lotArea = (
      await prisma.collectionArea.create({
        data: { collectionId, name: `Lot ${Date.now()}`, primaryCatalogNameId: catalogNameId },
      })
    ).id;
    const lotCopies: string[] = [];
    for (const price of ["6.00", "4.00"]) {
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name: `Lot stamp ${price}`,
          stampAreaLinks: { create: [{ collectionAreaId: lotArea, isPrimary: true }] },
        },
      });
      await prisma.stampCatalogPrice.create({
        data: { stampId: stamp.id, catalogEditionId: editionId, conditionId, certificateStatusId: null, price, currency: "EUR" },
      });
      lotCopies.push((await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true })).id);
    }
    const request: LotBuilderRequest = {
      criteria: {
        platformId: facebookId,
        areaId: lotArea,
        areaSubtree: true,
        yearFrom: null,
        yearTo: null,
        conditionIds: [],
        formatIds: [],
        maxCatalogValue: null,
        countMin: 2,
        countMax: null,
        valueMin: null,
        valueMax: null,
        series: "neutral",
        maxPerStamp: null,
        duplicates: "neutral",
        nameTemplate: null,
        descriptionTemplate: null,
      },
      seed: "seed-1",
      pinnedItemIds: [],
      rejectedItemIds: [],
    };

    // Without a group the lot is refused as the offer form would refuse it — the button says so first.
    await assert.rejects(
      () => commitLotProposal(userId, collectionId, { ...request, name: null, description: null }),
      /Choose the Facebook group/
    );

    const endsAt = "2026-11-02T19:00:00.000Z";
    const result = await commitLotProposal(userId, collectionId, {
      ...request,
      name: null,
      description: null,
      facebook: { facebookGroupId: percentGroupId, endsAt },
    });
    assert.equal(result.copies, 2);
    const offer = await read(result.offerId);
    assert.equal(offer.facebookGroupId, percentGroupId);
    assert.equal(offer.listingType, "auction");
    assert.equal(offer.startingPrice?.toFixed(2), "5.00", "half of the lot's 10.00");
    assert.equal(offer.bidIncrement?.toFixed(2), "1.00");
    assert.equal(offer.endsAt?.toISOString(), endsAt);
    const held = await prisma.offerSetItem.findMany({
      where: { offerSet: { offerId: result.offerId } },
      select: { itemId: true },
    });
    assert.deepEqual(new Set(held.map((h) => h.itemId)), new Set(lotCopies));
  });
});
