import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, setOfferState } from "../../src/lib/offers";
import {
  addSaleCopySet,
  addSaleLines,
  createSale,
  getSaleDetail,
  listSaleMergeCandidates,
  markSaleWrittenByApi,
  mergeSales,
  SaleActionBlockedError,
  soldItemIds,
} from "../../src/lib/sales";
import { createPackingSupply, createPurchaseSupplyLine } from "../../src/lib/packing-supplies";
import { createSaleSupplyLine } from "../../src/lib/sale-supplies";
import type { SaleMergeChoices } from "../../src/lib/sale-merge-rules";

// Merging one sale into another (#2041), read back out of Prisma: every sold set and packing supply
// of the other sale moves to the remaining one, the other is deleted and its number never given
// again, each amount is the one chosen, and only two open sales on one platform in one currency can
// be merged. The amount rules themselves are unit-tested (`tests/unit/sale-merge-rules.test.ts`).

describe("merging two sales (#2041)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let facebookId: string;
  let allegroId: string;
  let stampId: string;
  let conditionId: string;
  let supplyId: string;

  const blocked = (e: unknown) => e instanceof SaleActionBlockedError && e.reason === "cannot-merge";

  const choose = (choices: Partial<SaleMergeChoices> = {}): SaleMergeChoices => ({
    buyer: "remaining",
    commission: "remaining",
    postage: "remaining",
    ...choices,
  });

  async function newSale(data: {
    platformId?: string;
    soldAt?: string;
    buyerHandling?: string | null;
    commission?: string | null;
    externalRef?: string | null;
  } = {}): Promise<string> {
    return createSale(userId, collectionId, {
      platformId: data.platformId ?? facebookId,
      buyerId: null,
      externalRef: data.externalRef ?? null,
      transactionUrl: null,
      soldAt: new Date(data.soldAt ?? "2026-10-18"),
      currency: "PLN",
      buyerHandling: data.buyerHandling ?? null,
      buyerPaidTotal: null,
      commission: data.commission ?? null,
    });
  }

  const newCopy = async () => (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-sale-merge-${ts}`;
    otherUserId = `test-user-sale-merge-other-${ts}`;
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
        data: { slug: `col-sale-merge-${ts}`, name: "Merge", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    allegroId = (
      await prisma.platform.create({ data: { collectionId, name: "Allegro", platformCurrency: "PLN" } })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp M" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    supplyId = await createPackingSupply(userId, collectionId, "C6 envelope");
    const purchaseId = (
      await prisma.purchase.create({
        data: { collectionId, purchaseNo: 1, purchasedAt: new Date("2026-01-01"), currency: "PLN" },
      })
    ).id;
    await createPurchaseSupplyLine(userId, purchaseId, { supplyId, quantity: 10, price: 5 });
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    for (const id of [userId, otherUserId]) {
      await prisma.collection.deleteMany({ where: { ownerId: id } });
      await prisma.user.delete({ where: { id } });
    }
  });

  it("offers the open sales on the same platform in the same currency, and nothing else", async () => {
    const here = await newSale();
    const open = await newSale();
    const elsewhere = await newSale({ platformId: allegroId });
    const sent = await newSale();
    await prisma.sale.update({ where: { id: sent }, data: { status: "sent" } });
    const euro = await newSale();
    await prisma.sale.update({ where: { id: euro }, data: { currency: "EUR" } });

    const { sale, candidates } = await listSaleMergeCandidates(userId, here);
    assert.equal(sale.id, here);
    const ids = candidates.map((c) => c.id);
    assert.ok(ids.includes(open));
    for (const id of [here, elsewhere, sent, euro]) assert.ok(!ids.includes(id));

    // A sent sale is merged with nothing.
    assert.deepEqual((await listSaleMergeCandidates(userId, sent)).candidates, []);
    await assert.rejects(() => listSaleMergeCandidates(otherUserId, here));
  });

  it("moves every sold set and packing supply, deletes the other sale, and takes the amounts chosen", async () => {
    const remaining = await newSale({ buyerHandling: "5.00", commission: "1.10", externalRef: "A-1" });
    const other = await newSale({ soldAt: "2026-10-17", buyerHandling: "6.00", commission: "2.20", externalRef: "B-2" });
    await prisma.sale.update({ where: { id: remaining }, data: { shippingCost: "8.50", shippingCurrency: "PLN" } });
    await prisma.sale.update({ where: { id: other }, data: { shippingCost: "9.00", shippingCurrency: "PLN" } });

    // The other sale: a set sold through an offer, a set on no offer, and an envelope.
    const offered = await newCopy();
    const offerId = await createOffer(userId, collectionId, {
      platformId: facebookId,
      url: null,
      price: "30.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [offered]);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    const offerSet = await prisma.offerSet.findFirstOrThrow({ where: { offerId } });
    await addSaleLines(userId, other, [{ offerId, offerSetId: offerSet.id, price: "30.00", itemIds: [offered] }]);
    const loose = await newCopy();
    await addSaleCopySet(userId, other, { itemIds: [loose], price: "4.00" });
    await createSaleSupplyLine(userId, other, { supplyId, quantity: 2 });
    // And one on the remaining sale.
    const own = await newCopy();
    await addSaleCopySet(userId, remaining, { itemIds: [own], price: "20.00" });
    const otherNo = (await prisma.sale.findUniqueOrThrow({ where: { id: other } })).saleNo;

    const kept = await mergeSales(userId, {
      remainingSaleId: remaining,
      otherSaleId: other,
      choices: choose({ buyer: "sum", commission: "other" }),
    });
    assert.equal(kept, remaining);

    assert.equal(await prisma.sale.count({ where: { id: other } }), 0, "the other sale is gone");
    const detail = (await getSaleDetail(userId, remaining))!;
    assert.equal(detail.lines.length, 3, "every sold set moved");
    assert.equal(detail.grossProceeds, "54.00");
    assert.equal(detail.supplies.lines.length, 1, "the packing supply moved");
    assert.equal(detail.supplies.lines[0].quantity, 2);
    assert.equal(detail.supplies.costBase, "1.00", "with the units it took");
    assert.equal(detail.buyerHandling, "11.00", "summed");
    assert.equal(detail.commission, "2.20", "the other's");
    assert.equal(detail.shippingCost, "8.50", "the remaining sale's");
    // The remaining sale keeps its own header.
    assert.equal(detail.externalRef, "A-1");
    assert.equal(detail.soldAt.toISOString().slice(0, 10), "2026-10-18");

    // Nothing is sold twice or put back: the copies are still sold, the offer still sold.
    assert.deepEqual([...(await soldItemIds([offered, loose, own]))].sort(), [offered, loose, own].sort());
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).state, "sold");

    // Its number is never given again.
    const next = await newSale();
    assert.ok((await prisma.sale.findUniqueOrThrow({ where: { id: next } })).saleNo > otherNo);
  });

  it("makes the merged sale to review when the other was the agent's and unconfirmed", async () => {
    const remaining = await newSale();
    const other = await newSale();
    await prisma.$transaction((tx) =>
      markSaleWrittenByApi(tx, other, { kind: "created", actions: ["added offer #9 at 12 PLN"] })
    );
    await mergeSales(userId, { remainingSaleId: remaining, otherSaleId: other, choices: choose() });
    const review = (await getSaleDetail(userId, remaining))!.apiReview;
    assert.ok(review, "the merged sale is to review");
    assert.equal(review.created, false);
    assert.ok(review.actions.includes("added offer #9 at 12 PLN"));
  });

  it("refuses another platform, a sent sale, a postage sum in two currencies, and another collector", async () => {
    const here = await newSale();
    const elsewhere = await newSale({ platformId: allegroId });
    await assert.rejects(
      () => mergeSales(userId, { remainingSaleId: here, otherSaleId: elsewhere, choices: choose() }),
      blocked
    );

    const sent = await newSale();
    await prisma.sale.update({ where: { id: sent }, data: { status: "sent" } });
    await assert.rejects(
      () => mergeSales(userId, { remainingSaleId: sent, otherSaleId: here, choices: choose() }),
      blocked
    );

    const euroPostage = await newSale();
    await prisma.sale.update({ where: { id: here }, data: { shippingCost: "8.50", shippingCurrency: "PLN" } });
    await prisma.sale.update({ where: { id: euroPostage }, data: { shippingCost: "3.00", shippingCurrency: "EUR" } });
    await assert.rejects(
      () =>
        mergeSales(userId, {
          remainingSaleId: here,
          otherSaleId: euroPostage,
          choices: choose({ postage: "sum" }),
        }),
      blocked
    );

    await assert.rejects(
      () => mergeSales(otherUserId, { remainingSaleId: here, otherSaleId: euroPostage, choices: choose() }),
      /not found/
    );
    // Every refusal left both sales where they were.
    assert.equal(await prisma.sale.count({ where: { id: { in: [here, elsewhere, sent, euroPostage] } } }), 4);
  });
});
