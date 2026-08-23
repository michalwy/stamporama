import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer } from "../../src/lib/offers";
import { setColnectPlatform } from "../../src/lib/colnect";
import { createShippingMethod } from "../../src/lib/shipping-methods";
import {
  ColnectOrderError,
  findSalesForColnectOrders,
  importColnectOrder,
} from "../../src/lib/colnect-order";
import type { ColnectOrderInput } from "../../src/lib/colnect-order-rules";

// Recording a Colnect transaction from the screen the collector packs from (#698). What each row
// *says* is asserted against page text in `tests/unit/colnect-order-rules.test.ts`; what needs a
// database is what #698 is for:
//
//   - a transaction becomes a sale whose lines are the offers those listings are, joined on the sale
//     code alone (#696), with the shipping method Colnect named;
//   - a multi-quantity offer arrives picked but not chosen (#697);
//   - a re-import of a recorded transaction is a link and never a second sale;
//   - a transaction that cannot be recorded whole is not recorded at all, and says which listing
//     stopped it;
//   - nothing about the buyer beyond a login and a name reaches the database.

describe("Colnect transaction import (#698)", () => {
  let userId: string;
  let collectionId: string;
  let collectionSlug: string;
  let platformId: string;
  let conditionId: string;

  /** An offer live on Colnect with one copy in it, carrying the sale code #696 derives from the
   *  listing's own address. */
  async function listedOffer(
    name: string,
    price: string,
    saleCode: string | null
  ): Promise<{ id: string; offerNo: number }> {
    const id = await createOffer(userId, collectionId, {
      platformId,
      url: saleCode ? `https://colnect.com/en/market/sale/${saleCode}` : null,
      price,
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addCopy(id, name);
    await prisma.offer.update({ where: { id }, data: { name, state: "active" } });
    const offer = await prisma.offer.findUniqueOrThrow({ where: { id }, select: { offerNo: true } });
    return { id, offerNo: offer.offerNo };
  }

  /** One more set on an offer — a quantity listing, where which identical copy leaves is the
   *  seller's own choice (#697). */
  async function addCopy(offerId: string, name: string): Promise<void> {
    const stamp = await prisma.stamp.create({ data: { collectionId, name } });
    const item = await createItem(userId, collectionId, {
      stampId: stamp.id,
      conditionId,
      forSale: true,
    });
    await addOfferSet(userId, offerId, [item.id]);
  }

  function transaction(
    orderId: string,
    lines: { saleCode: string; price?: string; quantity?: number }[],
    overrides: Partial<ColnectOrderInput> = {}
  ): ColnectOrderInput {
    return {
      orderId,
      orderUrl: `https://colnect.com/en/transaction/show/id/${orderId}`,
      buyerLogin: "samplebuyer",
      buyerName: "Sample Buyer",
      soldAtText: "August 23, 2026 2:21 PM",
      shippingMethodText: "Stamps→domestic: Registered mail (Poczta Polska)",
      totalTexts: ["Items total € 5.00", "Shipping price € 2.40", "Total with shipping € 7.40"],
      lines: lines.map((line) => ({
        saleCode: line.saleCode,
        title: `Listing ${line.saleCode}`,
        priceText: line.price ?? "€ 5.00",
        quantityText: `Item count: ${line.quantity ?? 1}`,
      })),
      ...overrides,
    };
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-colord-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User colord-${ts}`,
        email: `test-colord-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionSlug = `col-colord-${ts}`;
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: collectionSlug,
          name: `Collection colord-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Colnect",
          platform: true,
          platformCurrency: "EUR",
          maxPhotos: 6,
        },
      })
    ).id;
    await setColnectPlatform(userId, collectionId, platformId);
  });

  after(async () => {
    // Sales first: a sold copy is `Restrict`-ed by `sale_line_item` (the no-double-sale backstop),
    // so the collection cannot be cascaded away while its sales still name the copies.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("records a transaction as one sale, matched on the listing's own sale code", async () => {
    const first = await listedOffer("Poland 1947 overprint", "2.00", "aBcDe01");
    const second = await listedOffer("Hungary 2024 sheet", "3.00", "fGhIj01");

    const result = await importColnectOrder(
      userId,
      collectionId,
      transaction("hflVE01", [
        { saleCode: "aBcDe01", price: "€ 2.00" },
        { saleCode: "fGhIj01", price: "€ 3.00" },
      ])
    );

    assert.equal(result.created, true);
    assert.equal(result.path, `/c/${collectionSlug}/sales/${result.saleId}`);

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: result.saleId },
      select: {
        externalRef: true,
        transactionUrl: true,
        currency: true,
        soldAt: true,
        status: true,
        buyerPaidTotal: true,
        buyerHandling: true,
        platformId: true,
        shippingMethodId: true,
        shippingMethodName: true,
        shippingCost: true,
        lines: {
          select: { offerId: true, price: true, setChoicePending: true },
          orderBy: { price: "asc" },
        },
      },
    });
    assert.equal(sale.externalRef, "hflVE01");
    assert.equal(sale.transactionUrl, "https://colnect.com/en/transaction/show/id/hflVE01");
    assert.equal(sale.platformId, platformId);
    assert.equal(sale.currency, "EUR");
    // The transaction's own date, not a row's: Colnect states one for the whole order.
    assert.equal(sale.soldAt.toISOString().slice(0, 10), "2026-08-23");
    // Colnect's own ladder is not mirrored here: an imported transaction starts where every sale
    // starts (#191/#492).
    assert.equal(sale.status, "ordered");
    // `Total with shipping` is the anchor (#205) — never `Items total`, which is the goods alone.
    assert.equal(sale.buyerPaidTotal?.toFixed(2), "7.40");
    assert.equal(sale.buyerHandling, null);
    // The method as Colnect printed it, with no cost: what this parcel cost the collector is not on
    // that page and is learned when the postage receipt turns up (#206).
    assert.equal(sale.shippingMethodName, "Stamps→domestic: Registered mail (Poczta Polska)");
    assert.equal(sale.shippingMethodId, null);
    assert.equal(sale.shippingCost, null);
    assert.deepEqual(
      sale.lines.map((line) => [line.offerId, line.price.toFixed(2), line.setChoicePending]),
      [
        [first.id, "2.00", false],
        [second.id, "3.00", false],
      ]
    );

    const states = await prisma.offer.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { state: true },
    });
    assert.deepEqual(
      states.map((offer) => offer.state),
      ["sold", "sold"]
    );
  });

  it("points the sale at the platform's own shipping method when the printed name is one of them", async () => {
    await createShippingMethod(userId, collectionId, platformId, {
      name: "stamps→domestic: registered mail (poczta polska)",
      cost: "2.40",
      currency: "EUR",
      carrierId: null,
    });
    const offer = await listedOffer("Poland 1963 animals", "5.00", "kLmNo02");

    const result = await importColnectOrder(
      userId,
      collectionId,
      transaction("hflVE02", [{ saleCode: "kLmNo02" }])
    );
    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: result.saleId },
      select: { shippingMethodId: true, shippingMethodName: true, shippingCost: true },
    });
    assert.notEqual(sale.shippingMethodId, null);
    // The dictionary row's own wording, matched case- and space-insensitively — the same method.
    assert.equal(sale.shippingMethodName, "stamps→domestic: registered mail (poczta polska)");
    // Still no cost: the dictionary says what postage usually costs, not what this parcel did.
    assert.equal(sale.shippingCost, null);
    assert.ok(offer.id);
  });

  it("picks the lowest set of a quantity offer and flags that nobody has chosen (#697)", async () => {
    const offer = await listedOffer("Poland 1965 pair", "5.00", "pQrSt03");
    await addCopy(offer.id, "Poland 1965 pair, second copy");
    await addCopy(offer.id, "Poland 1965 pair, third copy");

    const result = await importColnectOrder(
      userId,
      collectionId,
      transaction("hflVE03", [{ saleCode: "pQrSt03" }])
    );

    const lines = await prisma.saleLine.findMany({
      where: { saleId: result.saleId },
      select: { offerSetId: true, setChoicePending: true },
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].setChoicePending, true);
    const sets = await prisma.offerSet.findMany({
      where: { offerId: offer.id },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    assert.equal(lines[0].offerSetId, sets[0].id);
    // The offer still has copies to sell, so it stays live.
    const state = await prisma.offer.findUniqueOrThrow({
      where: { id: offer.id },
      select: { state: true },
    });
    assert.equal(state.state, "active");
  });

  it("files the buyer under their login, with the printed name beside it and nothing else", async () => {
    await listedOffer("USSR 1961", "5.00", "uVwXy04");
    const result = await importColnectOrder(
      userId,
      collectionId,
      transaction("hflVE04", [{ saleCode: "uVwXy04" }])
    );

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: result.saleId },
      select: { buyer: { select: { name: true, fullName: true, email: true, buyer: true } } },
    });
    assert.equal(sale.buyer?.name, "samplebuyer");
    assert.equal(sale.buyer?.fullName, "Sample Buyer");
    assert.equal(sale.buyer?.buyer, true);
    // The transaction page prints the buyer's full postal address. It is never read, so it can never
    // be stored (ADR-0038 §4, ADR-0041 §9).
    assert.equal(sale.buyer?.email, null);
  });

  it("answers a re-import with the sale that already claims the transaction, and writes nothing", async () => {
    await listedOffer("Poland 1966", "5.00", "zAbCd05");
    const first = await importColnectOrder(
      userId,
      collectionId,
      transaction("hflVE05", [{ saleCode: "zAbCd05" }])
    );
    const again = await importColnectOrder(
      userId,
      collectionId,
      transaction("hflVE05", [{ saleCode: "zAbCd05" }])
    );

    assert.equal(again.created, false);
    assert.equal(again.saleId, first.saleId);
    assert.equal(await prisma.sale.count({ where: { collectionId, externalRef: "hflVE05" } }), 1);
  });

  it("finds the sales a transaction screen is asking about, and says nothing about the rest", async () => {
    await listedOffer("Poland 1952", "5.00", "eFgHi06");
    const recorded = await importColnectOrder(
      userId,
      collectionId,
      transaction("hflVE06", [{ saleCode: "eFgHi06" }])
    );

    const matches = await findSalesForColnectOrders(userId, collectionId, ["hflVE06", "nothing"]);
    assert.deepEqual(
      matches.map((match) => match.orderId),
      ["hflVE06"]
    );
    assert.equal(matches[0].saleNo, recorded.saleNo);
    assert.equal(matches[0].status, "ordered");
  });

  it("refuses the whole transaction when one row matches nothing, and records none of it", async () => {
    await listedOffer("Poland 1957", "5.00", "jKlMn07");

    await assert.rejects(
      () =>
        importColnectOrder(
          userId,
          collectionId,
          transaction("hflVE07", [{ saleCode: "jKlMn07" }, { saleCode: "never-listed-here" }])
        ),
      (err: unknown) =>
        err instanceof ColnectOrderError &&
        err.problems.some((problem) => problem.saleCode === "never-listed-here") &&
        /no offer here carries this Colnect listing/.test(err.message)
    );
    assert.equal(await prisma.sale.count({ where: { collectionId, externalRef: "hflVE07" } }), 0);
  });

  it("refuses a multi-item row until a real transaction says what its figure means", async () => {
    const offer = await listedOffer("Poland 1961", "5.00", "oPqRs08");
    await addCopy(offer.id, "Poland 1961, second copy");

    await assert.rejects(
      () =>
        importColnectOrder(
          userId,
          collectionId,
          transaction("hflVE08", [{ saleCode: "oPqRs08", quantity: 2 }])
        ),
      (err: unknown) => err instanceof ColnectOrderError && /price of one or of all/.test(err.message)
    );
    assert.equal(await prisma.sale.count({ where: { collectionId, externalRef: "hflVE08" } }), 0);
  });

  it("refuses a transaction priced in a currency this platform's sales are not in", async () => {
    await listedOffer("Poland 1970", "5.00", "tUvWx09");

    await assert.rejects(
      () =>
        importColnectOrder(
          userId,
          collectionId,
          transaction("hflVE09", [{ saleCode: "tUvWx09", price: "US$ 5.00" }])
        ),
      (err: unknown) => err instanceof ColnectOrderError && /priced in USD/.test(err.message)
    );
    assert.equal(await prisma.sale.count({ where: { collectionId, externalRef: "hflVE09" } }), 0);
  });
});
