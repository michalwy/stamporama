import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { closeLot, createLot, intakeStamps } from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { addOfferSet, createOffer, getOfferDetail, readPrepareOffers } from "../../src/lib/offers";

// The cost an asking price is set against counts a copy from an opening balance at its opening value
// (#2333), marked as including one, and says why a cost is still missing. The arithmetic has its unit
// test; what this covers is that an offer's sets and its Prepare row read the opening side of the
// holdings summary, which keeps it apart from what was spent (#1324).
//
//  - an opening balance's lot valued at 6.00 over two copies of one stamp, closed — 3.00 each;
//  - an opening balance's lot with no value, one copy;
//  - a purchase lot of 4.00, closed, one copy;
//  - a copy from no lot at all;
//  - an opening balance's lot valued at 5.00, still open, one copy — counted at its estimate (#2437).

const TS = Date.now();

describe("an offer's cost counts opening values (#2333)", () => {
  let userId: string;
  let collectionId: string;
  let offerId: string;
  let openOfferId: string;

  before(async () => {
    userId = `test-user-opencost-${TS}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-opencost-${TS}`, name: "Opening cost", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    // A catalogue value, so a closing lot has something to split its value by.
    const vendor = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    const edition = await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } });
    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
    });
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: "Eagle" } })).id;
    await prisma.stampCollectionArea.create({ data: { stampId, collectionAreaId: area.id, isPrimary: true } });
    await prisma.stampCatalogPrice.create({
      data: { stampId, catalogEditionId: edition.id, conditionId, certificateStatusId: null, price: "2.00", currency: "EUR" },
    });
    const intake = async (lotId: string) => (await intakeStamps(userId, { lotId }, { stampId, conditionId }))[0].itemId;

    const opening = await createPurchase(userId, collectionId, {
      kind: "opening_balance",
      title: "The shelf",
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    const valuedLot = await createLot(userId, opening.id, 6, null);
    const openingA = await intake(valuedLot);
    const openingB = await intake(valuedLot);
    assert.equal((await closeLot(userId, valuedLot)).ok, true);
    const noValueLot = await createLot(userId, opening.id, null, null);
    const noValue = await intake(noValueLot);

    const order = await createPurchase(userId, collectionId, { purchasedAt: "2026-09-01", currency: "EUR" });
    const boughtLot = await createLot(userId, order.id, 4, null);
    const bought = await intake(boughtLot);
    assert.equal((await closeLot(userId, boughtLot)).ok, true);

    const loose = (await prisma.item.create({ data: { collectionId, itemNo: 900, stampId, conditionId } })).id;

    const platformId = (await prisma.platform.create({ data: { collectionId, name: "Delcampe" } })).id;
    offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "10.00",
      currency: "EUR",
      listingDate: null,
    });
    await addOfferSet(userId, offerId, [openingA, bought]);
    await addOfferSet(userId, offerId, [openingB, noValue]);
    await addOfferSet(userId, offerId, [loose]);

    // An opening balance that is still open (#2437): its only copy has an estimate and no basis yet.
    const openLot = await createLot(userId, opening.id, 5, null);
    const stillOpen = await intake(openLot);
    openOfferId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "10.00",
      currency: "EUR",
      listingDate: null,
    });
    await addOfferSet(userId, openOfferId, [stillOpen]);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("counts each set's opening values, marked, and the copies still without a cost by why", async () => {
    const detail = (await getOfferDetail(userId, offerId))!;
    const [mixed, opening, none] = detail.sets;

    assert.equal(mixed.cost.amount, "7.00");
    assert.equal(mixed.cost.knownCount, 1);
    assert.equal(mixed.cost.openingCount, 1);
    assert.equal(mixed.cost.opening, true);
    // What was spent stays apart: the holdings' cost is the purchase's alone (#1324).
    assert.equal(mixed.holdings.cost.totalCostBasis, "4.00");

    assert.equal(opening.cost.amount, "3.00");
    assert.equal(opening.cost.openingCount, 1);
    assert.equal(opening.cost.noOpeningValueCount, 1);
    assert.equal(opening.cost.noneCount, 0);

    assert.equal(none.cost.amount, null);
    assert.equal(none.cost.noneCount, 1);
    assert.equal(none.cost.opening, false);

    const t = detail.setsTotals;
    assert.equal(t.costTotal, "10.00");
    assert.equal(t.costKnownSets, 2);
    assert.equal(t.costOpening, true);
    assert.equal(t.costOpeningCount, 2);
    assert.deepEqual(t.costGaps, { unrecorded: 1, unestimated: 0, noOpeningValue: 1 });
    // The price table's Cost: per set over the two sets carrying one.
    assert.equal(detail.costPrice, "5.00");
  });

  it("reads the same on the offer's Prepare row, which a post's and a proposal's lots are drawn from", async () => {
    const [row] = await readPrepareOffers(userId, collectionId, [offerId], ["preparing"]);
    assert.equal(row.costPrice, "5.00");
    assert.equal(row.setsTotals.costOpening, true);
    assert.equal(row.setsTotals.costEstimated, false);
    assert.deepEqual(row.setsTotals.costGaps, { unrecorded: 1, unestimated: 0, noOpeningValue: 1 });
  });

  it("counts a copy on a still-open opening balance at its estimate, with both marks (#2437)", async () => {
    const detail = (await getOfferDetail(userId, openOfferId))!;
    const [set] = detail.sets;
    assert.equal(set.cost.amount, "5.00");
    assert.equal(set.cost.estimatedCount, 1);
    assert.equal(set.cost.estimated, true);
    assert.equal(set.cost.opening, true);
    assert.equal(set.cost.openingCount, 0);
    assert.equal(detail.setsTotals.costTotal, "5.00");
    assert.equal(detail.setsTotals.costEstimated, true);
    assert.equal(detail.setsTotals.costOpening, true);
    assert.equal(detail.costPrice, "5.00");

    const [row] = await readPrepareOffers(userId, collectionId, [openOfferId], ["preparing"]);
    assert.equal(row.costPrice, "5.00");
    assert.equal(row.setsTotals.costEstimated, true);
    assert.equal(row.setsTotals.costOpening, true);
  });
});
