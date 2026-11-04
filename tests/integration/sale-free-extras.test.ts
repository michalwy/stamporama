import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { createTrade } from "../../src/lib/trades";
import { addTradeGiveLines } from "../../src/lib/trade-lines";
import { addProposalLots, createProposal, getDirectPlatform } from "../../src/lib/proposals";
import { PlatformFieldError, updatePlatform } from "../../src/lib/platforms";
import { ContactFieldError, createContact, getContactListItem, updateContact } from "../../src/lib/contacts";
import {
  addSaleCopySet,
  addSaleFreeExtras,
  createSale,
  getSaleDetail,
  listFreeExtraCandidates,
  listSaleCopies,
  mergeSales,
  moveSaleLines,
  removeSaleLineCopy,
  setSaleLineItemPacked,
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
  let make: (
    price: string | null,
    data: { forSale?: boolean; forTrade?: boolean; inCollection?: boolean },
    costBasis?: string
  ) => Promise<string>;

  const blocked = (reason: string) => (e: unknown) =>
    e instanceof SaleActionBlockedError && e.reason === reason;

  const newSale = (buyerId: string | null = null) =>
    createSale(userId, collectionId, {
      platformId,
      buyerId,
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
    make = async (
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

  it("adds the ticked copies as free extras: one line named Free extras, at price 0, the order unchanged", async () => {
    const lineId = await addSaleFreeExtras(userId, saleId, [ids.unlisted, ids.forTrade]);

    const sale = (await getSaleDetail(userId, saleId))!;
    const free = sale.lines.filter((l) => l.freeExtra);
    assert.deepEqual(
      free.map((l) => [l.id, l.price, l.copyCount, l.offerSetId, l.name.title]),
      [[lineId, "0.00", 2, null, "Free extras"]]
    );
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
  // #2416: the buyer's own terms travel beside the platform's, in the sale's currency; the dialog
  // combines the two (`combineFreeExtraTerms`, pinned in the unit suite).
  it("stores a contact's free-extras terms and refuses ones that are not positive", async () => {
    const created = await createContact(userId, collectionId, {
      name: `Regular ${ts}`,
      buyer: true,
      freeExtrasMinimumOrder: "10",
      freeExtrasBudgetPercent: "12.5",
    });
    assert.equal(created.freeExtrasMinimumOrder, "10.00");
    assert.equal(created.freeExtrasBudgetPercent, "12.5");
    assert.equal(created.freeExtrasMaximumBudget, null);

    for (const bad of [
      { freeExtrasMinimumOrder: "0" },
      { freeExtrasBudgetPercent: "-1" },
      { freeExtrasBudgetPercent: "101" },
      { freeExtrasMaximumBudget: "abc" },
    ]) {
      await assert.rejects(
        updateContact(userId, created.id, { name: created.name, buyer: true, ...bad }),
        ContactFieldError
      );
    }
    const kept = await getContactListItem(userId, created.id);
    assert.equal(kept?.freeExtrasBudgetPercent, "12.5");

    // Cleared by leaving the fields empty.
    const cleared = await updateContact(userId, created.id, { name: created.name, buyer: true });
    assert.equal(cleared.freeExtrasMinimumOrder, null);
    assert.equal(cleared.freeExtrasBudgetPercent, null);
  });

  it("sends the buyer's terms with the candidates, and none for a buyer who states none", async () => {
    const plain = await createContact(userId, collectionId, { name: `Plain ${ts}`, buyer: true });
    const toPlain = await newSale(plain.id);
    assert.equal((await listFreeExtraCandidates(userId, toPlain)).contactTerms, null);
    // A sale with no buyer has none either.
    assert.equal((await listFreeExtraCandidates(userId, saleId)).contactTerms, null);

    const regular = await createContact(userId, collectionId, {
      name: `Generous ${ts}`,
      buyer: true,
      freeExtrasBudgetPercent: "10",
      freeExtrasMaximumBudget: "3.00",
    });
    const toRegular = await newSale(regular.id);
    const result = await listFreeExtraCandidates(userId, toRegular);
    assert.deepEqual(result.contactTerms, {
      contactName: regular.name,
      minimumOrder: null,
      budgetPercent: "10",
      maximumBudget: "3.00",
      convertedFrom: null,
    });
    // The platform's are still sent on their own — the two are combined in the dialog.
    assert.equal(result.platformDefaults?.platformName, "Fair");
  });

  it("converts the buyer's amounts from the collection's currency into the sale's", async () => {
    const regular = await createContact(userId, collectionId, {
      name: `Abroad ${ts}`,
      buyer: true,
      freeExtrasMinimumOrder: "5.00",
      freeExtrasMaximumBudget: "1.50",
    });
    const pln = await newSale(regular.id);
    await prisma.sale.update({ where: { id: pln }, data: { currency: "PLN", fxRateToBase: "0.25" } });
    await prisma.exchangeRate.deleteMany({ where: { collectionId } });
    await prisma.exchangeRate.createMany({
      data: [
        { collectionId, fromCurrency: "EUR", toCurrency: "EUR", rate: 1, fetchedAt: new Date() },
        { collectionId, fromCurrency: "EUR", toCurrency: "PLN", rate: 4, fetchedAt: new Date() },
      ],
    });
    try {
      const result = await listFreeExtraCandidates(userId, pln);
      assert.deepEqual(result.contactTerms, {
        contactName: regular.name,
        minimumOrder: "20.00",
        budgetPercent: null,
        maximumBudget: "6.00",
        convertedFrom: "EUR",
      });
    } finally {
      await prisma.exchangeRate.deleteMany({ where: { collectionId } });
    }
  });

  it("grows the sale's one free-extras line on a later addition (#2420)", async () => {
    const sale = await newSale();
    const [a, b, c] = [await make("0.40", { forSale: true }), await make("0.40", { forSale: true }), await make("0.40", { forSale: true })];
    const first = await addSaleFreeExtras(userId, sale, [a]);
    await setSaleLineItemPacked(userId, a, true);
    const second = await addSaleFreeExtras(userId, sale, [b, c]);
    assert.equal(second, first);
    const lines = (await getSaleDetail(userId, sale))!.lines;
    assert.deepEqual(lines.map((l) => [l.freeExtra, l.copyCount]), [[true, 3]]);
    const copies = await listSaleCopies(userId, sale);
    assert.deepEqual(
      copies.map((c) => [c.id, c.saleLineId, c.packed, c.onNoOffer]).sort(),
      [
        [a, first, true, true],
        [b, first, false, true],
        [c, first, false, true],
      ].sort()
    );
  });

  it("takes one copy off a line on no offer, and the line with its last copy (#2420)", async () => {
    const sale = await newSale();
    const [a, b] = [await make("0.40", { forSale: true }), await make("0.40", { forSale: true })];
    const lineId = await addSaleFreeExtras(userId, sale, [a, b]);
    assert.deepEqual(await removeSaleLineCopy(userId, a), { lineRemoved: false });
    let lines = (await getSaleDetail(userId, sale))!.lines;
    assert.deepEqual(lines.map((l) => [l.id, l.copyCount]), [[lineId, 1]]);
    // Back in stock, so the sale may propose it again.
    const candidates = await listFreeExtraCandidates(userId, sale);
    assert.ok(candidates.candidates.some((c) => c.item.id === a));

    assert.deepEqual(await removeSaleLineCopy(userId, b), { lineRemoved: true });
    lines = (await getSaleDetail(userId, sale))!.lines;
    assert.deepEqual(lines, []);
  });

  it("does not take one copy off an offer's set", async () => {
    const sale = await newSale();
    const id = await make("0.40", { forSale: true });
    const offerId = await createOffer(
      userId,
      collectionId,
      { platformId, url: null, price: "2.00", startingPrice: null, currency: "EUR", listingDate: null },
      { seedItemIds: [id], seedPerCopy: true }
    );
    const offerSetId = (await prisma.offerSet.findFirstOrThrow({ where: { offerId } })).id;
    await prisma.saleLine.create({
      data: { saleId: sale, offerId, offerSetId, price: "2.00", items: { create: [{ itemId: id }] } },
    });
    await assert.rejects(removeSaleLineCopy(userId, id), blocked("on-offer"));
  });

  it("keeps one free-extras line when a merge or a move brings a second (#2420)", async () => {
    const buyer = await createContact(userId, collectionId, { name: `Merge buyer ${ts}`, buyer: true });
    const [a, b, c] = [await make("0.40", { forSale: true }), await make("0.40", { forSale: true }), await make("0.40", { forSale: true })];
    const remaining = await newSale(buyer.id);
    const other = await newSale(buyer.id);
    const kept = await addSaleFreeExtras(userId, remaining, [a]);
    await addSaleFreeExtras(userId, other, [b]);
    await setSaleLineItemPacked(userId, b, true);
    await mergeSales(userId, {
      remainingSaleId: remaining,
      otherSaleId: other,
      choices: { buyer: "remaining", commission: "remaining", postage: "remaining" },
    });
    let lines = (await getSaleDetail(userId, remaining))!.lines;
    assert.deepEqual(lines.map((l) => [l.id, l.copyCount]), [[kept, 2]]);
    const packed = await prisma.saleLineItem.findUniqueOrThrow({ where: { itemId: b } });
    assert.deepEqual([packed.saleLineId, packed.packed], [kept, true]);

    const third = await newSale(buyer.id);
    const moving = await addSaleFreeExtras(userId, third, [c]);
    // A paid set stays behind: a move never takes every set of a sale.
    await addSaleCopySet(userId, third, { itemIds: [await make("0.40", { forSale: true })], price: "1.00" });
    await moveSaleLines(userId, { sourceSaleId: third, lineIds: [moving], target: { saleId: remaining } });
    lines = (await getSaleDetail(userId, remaining))!.lines;
    assert.deepEqual(lines.map((l) => [l.id, l.copyCount]), [[kept, 3]]);
  });
});
