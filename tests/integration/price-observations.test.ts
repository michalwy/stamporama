import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  DuplicatePriceObservationError,
  createPriceObservation,
  deletePriceObservation,
  getAuctionHouseTerms,
  getStampPriceObservations,
  updatePriceObservation,
  type PriceObservationRaw,
} from "../../src/lib/price-observations";
import { getStampMarketValue } from "../../src/lib/market-values";
import { loadRealizationRatios } from "../../src/lib/realization-ratios";
import { deleteStamp } from "../../src/lib/stamps";

// Realised prices from other people's auctions (#1633; ADR-0063). The arithmetic is unit-tested in
// `price-observation.test.ts`; what earns a database here is that an observation is written with
// the collection's vocabulary and contacts, that the market read and the ratio learner pick the
// exact ones up beside the collector's own lots and leave the hints out, and that nothing about it
// reaches the auction or purchase tables.
//
// Every price is in EUR, the collection's base, so no rate is fetched: a write in a foreign currency
// reads the ECB data API, which `exchange-rates.test.ts` covers, and a network call here would fail
// the suite offline. The foreign-currency cases set the frozen rate on the row by hand, which is
// exactly what the write stores.

describe("price observations (#1633)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let conditionId: string;
  let attestId: string;
  let editionId: string;
  let platformId: string;
  let houseId: string;
  /** Priced 50.00 at MNH. */
  let stampId: string;
  /** An unknown-variant umbrella over one variant. */
  let umbrellaId: string;

  // Each call names a lot of its own: a source lot is recorded once (#1635), and these cases are
  // about everything else.
  let lotSeq = 0;
  function raw(overrides: Partial<PriceObservationRaw> = {}): PriceObservationRaw {
    const lotNo = String(1203 + lotSeq++);
    return {
      conditionId,
      certificateStatusId: null,
      certificateUncertain: false,
      formatId: null,
      price: "40.00",
      currency: "EUR",
      priceBasis: "hammer",
      premiumPercent: "",
      premiumFixed: "",
      soldOn: "2026-03-14",
      platformId,
      platformName: null,
      auctionHouseId: houseId,
      auctionHouseName: null,
      auctionName: "385",
      lotNo,
      url: `https://example.com/lot/${lotNo}`,
      ...overrides,
    };
  }

  beforeEach(async () => {
    await prisma.priceObservation.deleteMany({ where: { collectionId } });
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
  });

  before(async () => {
    const ts = Date.now();
    userId = `test-user-obs-${ts}`;
    otherUserId = `test-user-obs-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-obs-${ts}`, name: `Collection obs-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Europa", currency: "EUR" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    attestId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Fotoattest", abbreviation: "FA", sortOrder: 0 },
      })
    ).id;
    const areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Danzig", primaryCatalogNameId: catalogName.id },
      })
    ).id;
    const subtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Variant", actsAsVariant: true, isDefault: true, sortOrder: 0 },
      })
    ).id;

    async function stamp(name: string, parentId?: string): Promise<string> {
      const s = await prisma.stamp.create({
        data: { collectionId, name, parentId, subtypeId: parentId ? subtypeId : undefined, issuedYear: 1920 },
      });
      await prisma.stampCollectionArea.create({
        data: { stampId: s.id, collectionAreaId: areaId, isPrimary: true },
      });
      return s.id;
    }
    stampId = await stamp("Mi 5");
    await prisma.stampCatalogPrice.create({
      data: { stampId, catalogEditionId: editionId, conditionId, price: "50.00", currency: "EUR" },
    });
    umbrellaId = await stamp("Mi 6");
    await stamp("Mi 6 a", umbrellaId);

    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Philasearch", platform: true } })
    ).id;
    houseId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Köhler",
          auctionHouse: true,
          buyerPremiumPercent: "23.00",
          buyerPremiumFixed: "1.50",
          defaultCurrency: "EUR",
        },
      })
    ).id;
  });

  after(async () => {
    // Observations and sales first: both point at contacts with `Restrict`, and dropping the
    // collection would race its own cascades.
    await prisma.priceObservation.deleteMany({ where: { collectionId } });
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("records an exact hammer price and counts it in the market value, with its source as evidence", async () => {
    await createPriceObservation(userId, stampId, raw());

    const [value] = await getStampMarketValue(userId, collectionId, stampId);
    assert.ok(value, "an exact observation alone gives the key a market value");
    assert.equal(value.median, "40.00");
    assert.equal(value.n, 1);
    assert.equal(value.lots.length, 0);
    assert.equal(value.observations.length, 1);
    assert.equal(value.observations[0].platformName, "Philasearch");
    assert.equal(value.observations[0].auctionHouseName, "Köhler");
    assert.equal(value.observations[0].amount, "40.00");
    // Read against the catalogue like any other result: 40 of 50.
    assert.equal(value.catalogueValue, "50.00");
    assert.equal(value.realizationRatio, 0.8);
  });

  it("reduces an all-in price by its premium before it counts, and lists both figures", async () => {
    await createPriceObservation(
      userId,
      stampId,
      raw({ price: "124.50", priceBasis: "all_in", premiumPercent: "23", premiumFixed: "1.50" })
    );

    const [value] = await getStampMarketValue(userId, collectionId, stampId);
    // (124.50 − 1.50) ÷ 1.23 = 100.00
    assert.equal(value.median, "100.00");

    const { observations } = await getStampPriceObservations(userId, stampId);
    assert.equal(observations[0].price, "124.50");
    assert.equal(observations[0].allIn, "124.50");
    assert.equal(observations[0].hammer, "100.00");
    assert.equal(observations[0].countedAmount, "100.00");
  });

  it("never counts an uncertain observation, and lists it as a hint saying why", async () => {
    await createPriceObservation(userId, stampId, raw({ conditionId: null, price: "999" }));
    await createPriceObservation(
      userId,
      stampId,
      raw({ certificateStatusId: attestId, certificateUncertain: true, price: "888" })
    );
    await createPriceObservation(userId, umbrellaId, raw({ price: "777" }));

    assert.deepEqual(await getStampMarketValue(userId, collectionId, stampId), []);
    assert.deepEqual(await getStampMarketValue(userId, collectionId, umbrellaId), []);

    const { observations } = await getStampPriceObservations(userId, stampId);
    assert.equal(observations.length, 2);
    assert.ok(observations.every((o) => o.notCounted === "uncertain" && o.countedAmount === null));
    assert.deepEqual(
      observations.map((o) => o.doubts).sort(),
      [["certificate"], ["condition"]]
    );

    const umbrella = await getStampPriceObservations(userId, umbrellaId);
    assert.equal(umbrella.umbrella, true);
    assert.deepEqual(umbrella.observations[0].doubts, ["variant"]);
  });

  it("sits beside the collector's own closed lots in one median", async () => {
    const sellerId = (
      await prisma.contact.create({ data: { collectionId, name: `Seller ${Date.now()}`, seller: true } })
    ).id;
    const sale = await prisma.auctionSale.create({
      data: { collectionId, sellerId, platformId, name: "Own sale", currency: "EUR" },
    });
    await prisma.auctionLot.create({
      data: {
        auctionSaleId: sale.id,
        auctionLotNo: 9901,
        endsAt: new Date("2026-02-01T12:00:00Z"),
        status: "closed",
        finalPrice: "20.00",
        lines: { create: [{ stampId, conditionId, quantity: 1 }] },
      },
    });
    await createPriceObservation(userId, stampId, raw({ price: "40" }));
    await createPriceObservation(userId, stampId, raw({ price: "90" }));

    const [value] = await getStampMarketValue(userId, collectionId, stampId);
    assert.equal(value.n, 3);
    assert.equal(value.median, "40.00");
    assert.equal(value.lots.length, 1);
    assert.equal(value.observations.length, 2);
  });

  it("converts a foreign price at the rate frozen on it, and does not count one without a rate", async () => {
    const id = await createPriceObservation(userId, stampId, raw({ price: "100" }));
    await prisma.priceObservation.update({
      where: { id },
      data: { currency: "PLN", fxRateToBase: "0.25" },
    });
    let [value] = await getStampMarketValue(userId, collectionId, stampId);
    assert.equal(value.median, "25.00");

    await prisma.priceObservation.update({ where: { id }, data: { fxRateToBase: null } });
    assert.deepEqual(await getStampMarketValue(userId, collectionId, stampId), []);
    const { observations } = await getStampPriceObservations(userId, stampId);
    assert.equal(observations[0].notCounted, "no-rate");

    // Back in the base currency, nothing is converted and the rate is not needed.
    await prisma.priceObservation.update({ where: { id }, data: { currency: "EUR" } });
    [value] = await getStampMarketValue(userId, collectionId, stampId);
    assert.equal(value.median, "100.00");
  });

  it("keeps the frozen rate when a correction leaves the day and the currency alone", async () => {
    const id = await createPriceObservation(userId, stampId, raw());
    // As if it had been written in PLN with a rate read on the day.
    await prisma.priceObservation.update({ where: { id }, data: { currency: "PLN", fxRateToBase: "0.2345" } });

    await updatePriceObservation(userId, id, raw({ currency: "PLN", price: "80" }));
    const row = await prisma.priceObservation.findUniqueOrThrow({ where: { id } });
    assert.equal(row.fxRateToBase?.toString(), "0.2345");
    assert.equal(row.price.toFixed(2), "80.00");
  });

  it("corrects and deletes an observation, and the market value follows", async () => {
    const id = await createPriceObservation(userId, stampId, raw({ price: "40" }));
    await updatePriceObservation(userId, id, raw({ price: "45" }));
    const [value] = await getStampMarketValue(userId, collectionId, stampId);
    assert.equal(value.median, "45.00");

    await deletePriceObservation(userId, id);
    assert.deepEqual(await getStampMarketValue(userId, collectionId, stampId), []);
    assert.equal(await prisma.priceObservation.count({ where: { id } }), 0);
  });

  it("records a source lot once — by its address, or by its number in the same auction at the same house (#1635)", async () => {
    const id = await createPriceObservation(
      userId,
      stampId,
      raw({ lotNo: "77", auctionName: "Spring Sale", url: "https://example.com/r/77" })
    );
    // The same address, whatever else is typed.
    await assert.rejects(
      createPriceObservation(userId, umbrellaId, raw({ lotNo: "78", url: "https://example.com/r/77" })),
      (err: unknown) => err instanceof DuplicatePriceObservationError && err.existingId === id
    );
    // The same lot number in the same auction at the same house, case aside, with no address.
    await assert.rejects(
      createPriceObservation(userId, stampId, raw({ lotNo: "77", auctionName: " spring sale ", url: "" })),
      DuplicatePriceObservationError
    );
    // The same number in another auction, or with no house at another platform, is another lot.
    await createPriceObservation(userId, stampId, raw({ lotNo: "77", auctionName: "Autumn Sale", url: "" }));
    await createPriceObservation(userId, stampId, raw({ lotNo: "77", auctionName: "Spring Sale", auctionHouseId: null, url: "" }));
    // Neither an address nor a number names no lot, and nothing duplicates it.
    await createPriceObservation(userId, stampId, raw({ lotNo: "", url: "" }));
    await createPriceObservation(userId, stampId, raw({ lotNo: "", url: "" }));
    // A correction is not its own duplicate, and cannot become another's.
    await updatePriceObservation(
      userId,
      id,
      raw({ lotNo: "77", auctionName: "Spring Sale", url: "https://example.com/r/77", price: "41" })
    );
    const other = await createPriceObservation(userId, stampId, raw());
    await assert.rejects(
      updatePriceObservation(userId, other, raw({ url: "https://example.com/r/77" })),
      DuplicatePriceObservationError
    );
  });

  it("is never a lot, a sale or a purchase", async () => {
    await createPriceObservation(userId, stampId, raw());
    const [sales, lots, purchases] = await Promise.all([
      prisma.auctionSale.count({ where: { collectionId } }),
      prisma.auctionLot.count({ where: { auctionSale: { collectionId } } }),
      prisma.purchase.count({ where: { collectionId } }),
    ]);
    assert.deepEqual([sales, lots, purchases], [0, 0, 0]);
  });

  it("refuses what it cannot read, in the form's own words", async () => {
    await assert.rejects(createPriceObservation(userId, stampId, raw({ price: "0" })), /price it sold for/);
    await assert.rejects(
      createPriceObservation(userId, stampId, raw({ platformId: null, platformName: null })),
      /platform/
    );
    await assert.rejects(createPriceObservation(userId, stampId, raw({ soldOn: "2999-01-01" })), /future/);
    await assert.rejects(createPriceObservation(userId, stampId, raw({ soldOn: "2026-02-30" })), /day of the sale/);
    await assert.rejects(createPriceObservation(userId, stampId, raw({ priceBasis: "total" })), /hammer or all-in/);
    await assert.rejects(
      createPriceObservation(
        userId,
        stampId,
        raw({ price: "1", priceBasis: "all_in", premiumFixed: "2" })
      ),
      /lot fee/
    );
    await assert.rejects(
      createPriceObservation(userId, stampId, raw({ conditionId: "not-a-condition" })),
      /condition no longer exists/
    );
    assert.equal(await prisma.priceObservation.count({ where: { collectionId } }), 0);
  });

  it("creates a platform and a house typed by name, each with its role", async () => {
    const suffix = Date.now();
    await createPriceObservation(
      userId,
      stampId,
      raw({
        platformId: null,
        platformName: `Delcampe ${suffix}`,
        auctionHouseId: null,
        auctionHouseName: `Rauhut ${suffix}`,
      })
    );
    const platform = await prisma.contact.findFirstOrThrow({ where: { collectionId, name: `Delcampe ${suffix}` } });
    const house = await prisma.contact.findFirstOrThrow({ where: { collectionId, name: `Rauhut ${suffix}` } });
    assert.equal(platform.platform, true);
    assert.equal(house.auctionHouse, true);
  });

  it("proposes the house's own terms for a new observation", async () => {
    const terms = await getAuctionHouseTerms(userId, collectionId, houseId);
    assert.deepEqual(terms, { premiumPercent: "23.00", premiumFixed: "1.50", currency: "EUR" });
  });

  it("is the owner's alone", async () => {
    const id = await createPriceObservation(userId, stampId, raw());
    await assert.rejects(getStampPriceObservations(otherUserId, stampId), /not found/i);
    await assert.rejects(createPriceObservation(otherUserId, stampId, raw()), /not found/i);
    await assert.rejects(updatePriceObservation(otherUserId, id, raw({ price: "1" })), /not found/i);
    await assert.rejects(deletePriceObservation(otherUserId, id), /not found/i);
    assert.equal(await prisma.priceObservation.count({ where: { id } }), 1);
  });

  it("teaches the learned realization ratio, and names itself in the bucket's evidence", async () => {
    // Three, the ladder's minimum sample: 30, 40 and 45 of a 50.00 catalogue value.
    for (const price of ["30", "40", "45"]) {
      await createPriceObservation(userId, stampId, raw({ price }));
    }
    // A hint never teaches anything.
    await createPriceObservation(userId, stampId, raw({ conditionId: null, price: "5" }));

    const ratios = await loadRealizationRatios(collectionId);
    assert.equal(ratios.observationCount, 3);
    const resolved = ratios.resolve({ areaId: null, conditionId, issuedYear: null });
    assert.equal(resolved.level, "collection");
    assert.equal(resolved.ratio, 0.8);
    const evidence = ratios.describeObservations(resolved);
    assert.equal(evidence.length, 3);
    assert.ok(evidence.every((e) => e.stampName === "Mi 5" && e.conditionAbbreviation === "MNH"));
    assert.deepEqual(ratios.describeLots(resolved), []);
  });

  it("goes with its stamp", async () => {
    const doomed = await prisma.stamp.create({ data: { collectionId, name: "Doomed" } });
    await createPriceObservation(userId, doomed.id, raw());
    await deleteStamp(userId, doomed.id);
    assert.equal(await prisma.priceObservation.count({ where: { stampId: doomed.id } }), 0);
  });
});
