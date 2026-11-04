import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { createTrade } from "../../src/lib/trades";
import { addTradeGiveLines } from "../../src/lib/trade-lines";
import { addProposalLots, createProposal, getDirectPlatform } from "../../src/lib/proposals";
import { PlatformFieldError, updatePlatform } from "../../src/lib/platforms";
import {
  addSaleCopySet,
  addSaleFreeExtras,
  createSale,
  getSaleDetail,
  listFreeExtraCandidates,
  listSaleCopies,
  updateSaleLinePrice,
  SaleActionBlockedError,
} from "../../src/lib/sales";

// Free extras on a sale (#2408), against a real database. The ranking and the proposal are pinned in
// `tests/unit/free-extra-rules.test.ts`; what only a database can show is which copies the sale may
// give away at all, their values in the sale's currency, and that a confirmed free extra is a line at
// price 0 whose copy leaves the holdings and whose cost counts against the sale's profit.

const ts = Date.now();

describe("free extras on a sale (#2408)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let saleId: string;
  const ids: Record<string, string> = {};

  const blocked = (reason: string) => (e: unknown) =>
    e instanceof SaleActionBlockedError && e.reason === reason;

  const newSale = () =>
    createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-11-04"),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });

  before(async () => {
    userId = `test-user-free-extras-${ts}`;
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
        data: { slug: `col-free-extras-${ts}`, name: "Free extras", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const catalogName = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Europa", currency: "EUR" },
    });
    const editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2026 } })
    ).id;
    const areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
      })
    ).id;
    await prisma.collectionAreaCatalog.create({
      data: { collectionAreaId: areaId, catalogNameId: catalogName.id },
    });
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Fair" } })).id;

    let n = 0;
    const make = async (
      price: string | null,
      data: { forSale?: boolean; forTrade?: boolean; inCollection?: boolean },
      costBasis?: string
    ) => {
      n += 1;
      const stampId = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Stamp ${n}`,
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
      if (price !== null) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId,
            catalogEditionId: editionId,
            conditionId,
            certificateStatusId: null,
            formatId: null,
            price,
            currency: "EUR",
          },
        });
      }
      const id = (
        await createItem(userId, collectionId, {
          stampId,
          conditionId,
          inCollection: data.inCollection ?? false,
          forSale: data.forSale ?? false,
          forTrade: data.forTrade ?? false,
        })
      ).id;
      if (costBasis) await prisma.item.update({ where: { id }, data: { costBasis } });
      return id;
    };

    ids.paid = await make("30.00", { forSale: true }, "5.00");
    ids.listed = await make("1.00", { forSale: true });
    ids.unlisted = await make("1.00", { forSale: true }, "0.30");
    ids.forTrade = await make("2.00", { forTrade: true }, "0.70");
    ids.dear = await make("10.00", { forSale: true });
    ids.keeper = await make("0.50", { inCollection: true });
    ids.noValue = await make(null, { forSale: true });
    ids.onTrade = await make("0.50", { forSale: true });
    ids.onProposal = await make("0.50", { forSale: true });

    // On an active offer: ranked after the unlisted copy of the same value.
    const offerId = await createOffer(
      userId,
      collectionId,
      { platformId, url: null, price: "3.00", startingPrice: null, currency: "EUR", listingDate: null },
      { seedItemIds: [ids.listed], seedPerCopy: true }
    );
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");

    const partnerId = (
      await prisma.contact.create({ data: { collectionId, name: "Karel", exchangePartner: true } })
    ).id;
    const trade = await createTrade(userId, collectionId, { partnerId, currency: "EUR", catalogVendorId: vendorId });
    await addTradeGiveLines(userId, trade.sections[0].id, [ids.onTrade]);

    const buyerId = (await prisma.contact.create({ data: { collectionId, name: "Ola" } })).id;
    const { proposalId } = await createProposal(userId, collectionId, buyerId);
    const lot = await createOffer(
      userId,
      collectionId,
      {
        platformId: (await getDirectPlatform(collectionId)).id,
        url: null,
        price: "2.00",
        startingPrice: null,
        currency: "EUR",
        listingDate: null,
      },
      { seedItemIds: [ids.onProposal], seedPerCopy: true }
    );
    await addProposalLots(userId, proposalId, [lot]);

    saleId = await newSale();
    await addSaleCopySet(userId, saleId, { itemIds: [ids.paid], price: "20.00" });
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.proposal.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("ranks the copies that may be given away, cheapest first and unlisted before listed", async () => {
    const result = await listFreeExtraCandidates(userId, saleId);
    assert.equal(result.currency, "EUR");
    assert.equal(result.orderValue, "20.00");
    assert.deepEqual(
      result.candidates.map((c) => [c.item.id, c.value, c.listed]),
      [
        [ids.unlisted, "1.00", false],
        [ids.listed, "1.00", true],
        [ids.forTrade, "2.00", false],
        [ids.dear, "10.00", false],
      ]
    );
    // Neither a copy kept only in the collection, nor one on an open trade or proposal, nor one
    // already sold; and a copy with no value is counted, not proposed.
    assert.equal(result.unvaluedCount, 1);
    assert.equal(result.truncated, false);
  });

  it("adds the ticked copies as free extras: one line each, at price 0, the order unchanged", async () => {
    const lineIds = await addSaleFreeExtras(userId, saleId, [ids.unlisted, ids.forTrade]);
    assert.equal(lineIds.length, 2);

    const sale = (await getSaleDetail(userId, saleId))!;
    const free = sale.lines.filter((l) => l.freeExtra);
    assert.deepEqual(free.map((l) => [l.price, l.copyCount, l.offerSetId]).sort(), [
      ["0.00", 1, null],
      ["0.00", 1, null],
    ]);
    assert.equal(sale.grossProceeds, "20.00");
    // The free extras' cost counts against the profit: 20 − (5.00 + 0.30 + 0.70).
    assert.equal(sale.profit.cost, "6.00");
    assert.equal(sale.profit.profit, "14.00");

    const copies = await listSaleCopies(userId, saleId);
    assert.deepEqual(
      copies.filter((c) => c.freeExtra).map((c) => c.id).sort(),
      [ids.unlisted, ids.forTrade].sort()
    );

    // Gone from the holdings, so no longer proposed; the order is still the paid line alone.
    const again = await listFreeExtraCandidates(userId, saleId);
    assert.deepEqual(again.candidates.map((c) => c.item.id), [ids.listed, ids.dear]);
    assert.equal(again.orderValue, "20.00");
  });

  it("refuses a copy the sale could not propose", async () => {
    for (const id of [ids.keeper, ids.onTrade, ids.onProposal, ids.paid]) {
      await assert.rejects(addSaleFreeExtras(userId, saleId, [id]), blocked("not-in-stock"));
    }
  });

  it("does not take a price on a free extra", async () => {
    const line = (await getSaleDetail(userId, saleId))!.lines.find((l) => l.freeExtra)!;
    await assert.rejects(updateSaleLinePrice(userId, line.id, "1.00"), blocked("free-extra"));
  });

  it("converts the values into the sale's currency at its frozen rate", async () => {
    const pln = await newSale();
    // 1 PLN = 0.25 EUR, so a copy worth 1.00 EUR is 4.00 PLN.
    await prisma.sale.update({ where: { id: pln }, data: { currency: "PLN", fxRateToBase: "0.25" } });
    const result = await listFreeExtraCandidates(userId, pln);
    assert.equal(result.currency, "PLN");
    const listed = result.candidates.find((c) => c.item.id === ids.listed)!;
    assert.equal(listed.value, "4.00");
    assert.equal(listed.converted, true);
  });

  // #2409: the platform's free-extras settings travel with the candidates, in the sale's currency.
  it("sends no platform defaults where the platform states none", async () => {
    const result = await listFreeExtraCandidates(userId, saleId);
    assert.equal(result.platformDefaults, null);
  });

  it("stores a platform's free-extras settings and refuses ones that are not positive", async () => {
    const saved = await updatePlatform(userId, platformId, {
      name: "Fair",
      platformCurrency: "EUR",
      freeExtrasMinimumOrder: "15",
      freeExtrasBudgetPercent: "7.5",
      freeExtrasMaximumBudget: "1.20",
    });
    assert.equal(saved.freeExtrasMinimumOrder, "15.00");
    assert.equal(saved.freeExtrasBudgetPercent, "7.5");
    assert.equal(saved.freeExtrasMaximumBudget, "1.20");

    for (const bad of [
      { freeExtrasMinimumOrder: "0" },
      { freeExtrasBudgetPercent: "-1" },
      { freeExtrasBudgetPercent: "101" },
      { freeExtrasMaximumBudget: "abc" },
    ]) {
      await assert.rejects(
        updatePlatform(userId, platformId, { name: "Fair", platformCurrency: "EUR", ...bad }),
        PlatformFieldError
      );
    }
    // The refused writes left the settings as they were.
    const result = await listFreeExtraCandidates(userId, saleId);
    assert.deepEqual(result.platformDefaults, {
      platformName: "Fair",
      minimumOrder: "15.00",
      budgetPercent: "7.5",
      maximumBudget: "1.20",
      convertedFrom: null,
    });
  });

  it("converts the platform's amounts into the sale's currency where the two differ", async () => {
    const pln = await newSale();
    await prisma.sale.update({ where: { id: pln }, data: { currency: "PLN", fxRateToBase: "0.25" } });
    // Seeded, so nothing depends on the ECB: 1 EUR = 4 PLN today.
    await prisma.exchangeRate.deleteMany({ where: { collectionId } });
    await prisma.exchangeRate.createMany({
      data: [
        { collectionId, fromCurrency: "EUR", toCurrency: "EUR", rate: 1, fetchedAt: new Date() },
        { collectionId, fromCurrency: "EUR", toCurrency: "PLN", rate: 4, fetchedAt: new Date() },
      ],
    });
    try {
      const result = await listFreeExtraCandidates(userId, pln);
      assert.deepEqual(result.platformDefaults, {
        platformName: "Fair",
        minimumOrder: "60.00",
        budgetPercent: "7.5",
        maximumBudget: "4.80",
        convertedFrom: "EUR",
      });
    } finally {
      await prisma.exchangeRate.deleteMany({ where: { collectionId } });
    }
  });

  it("reads a platform with no currency of its own in the collection's", async () => {
    await updatePlatform(userId, platformId, {
      name: "Fair",
      platformCurrency: null,
      freeExtrasMaximumBudget: "2.00",
    });
    const result = await listFreeExtraCandidates(userId, saleId);
    assert.deepEqual(result.platformDefaults, {
      platformName: "Fair",
      minimumOrder: null,
      budgetPercent: null,
      maximumBudget: "2.00",
      convertedFrom: null,
    });
  });
});
