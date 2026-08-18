import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer } from "../../src/lib/offers";
import { setDelcampePlatform } from "../../src/lib/delcampe";
import {
  DelcampeOrderError,
  findSalesForDelcampeOrders,
  importDelcampeOrder,
} from "../../src/lib/delcampe-order";
import type { DelcampeOrderInput } from "../../src/lib/delcampe-order-rules";

// Recording a Delcampe order from the My Sold Items screens (#612). What each row *says* is asserted
// against page text in `tests/unit/delcampe-order-rules.test.ts`; what needs a database is the four
// things #612 is for:
//
//   - an order becomes a sale whose lines are the offers those listings are, with the copies gone;
//   - a re-import of a recorded order is a link and never a second sale;
//   - an order that cannot be recorded whole is not recorded at all, and says which item stopped it;
//   - nothing about the buyer beyond a login and a name reaches the database.

describe("Delcampe order import (#612)", () => {
  let userId: string;
  let collectionId: string;
  let collectionSlug: string;
  let platformId: string;
  let conditionId: string;

  /** An offer live on Delcampe with one copy in it, carrying the listing id #611 would have written
   *  onto it from the active-items export. */
  async function listedOffer(
    name: string,
    price: string,
    itemId: string | null
  ): Promise<{ id: string; offerNo: number }> {
    const id = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price,
      currency: "USD",
      listingDate: null,
      state: "preparing",
    });
    const stamp = await prisma.stamp.create({ data: { collectionId, name } });
    const item = await createItem(userId, collectionId, {
      stampId: stamp.id,
      conditionId,
      forSale: true,
    });
    await addOfferSet(userId, id, [item.id]);
    await prisma.offer.update({
      where: { id },
      data: { name, state: "active", delcampeItemId: itemId },
    });
    const offer = await prisma.offer.findUniqueOrThrow({ where: { id }, select: { offerNo: true } });
    return { id, offerNo: offer.offerNo };
  }

  /** A second copy on an offer, which is what makes "which one sold?" unanswerable from an order. */
  async function addSecondSet(offerId: string, name: string): Promise<void> {
    const stamp = await prisma.stamp.create({ data: { collectionId, name } });
    const item = await createItem(userId, collectionId, {
      stampId: stamp.id,
      conditionId,
      forSale: true,
    });
    await addOfferSet(userId, offerId, [item.id]);
  }

  function order(
    orderId: string,
    lines: { itemId: string; price?: string; reference?: string | null }[],
    overrides: Partial<DelcampeOrderInput> = {}
  ): DelcampeOrderInput {
    return {
      orderId,
      orderUrl: `https://www.delcampe.net/en_GB/payment-request/${orderId}`,
      buyerLogin: "birdcollector",
      buyerName: "Sample Buyer",
      totalTexts: ["± €13.95", "US$16.15"],
      lines: lines.map((line) => ({
        itemId: line.itemId,
        title: `Listing ${line.itemId}`,
        reference: line.reference ?? null,
        priceText: line.price ?? "US$3.00",
        soldAtText: "Sun 22 Mar 2026 at 22:25",
      })),
      ...overrides,
    };
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-delcord-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User delcord-${ts}`,
        email: `test-delcord-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionSlug = `col-delcord-${ts}`;
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: collectionSlug,
          name: `Collection delcord-${ts}`,
          baseCurrency: "USD",
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
          name: "Delcampe",
          platform: true,
          platformCurrency: "USD",
          maxPhotos: 6,
        },
      })
    ).id;
    await setDelcampePlatform(userId, collectionId, platformId);
  });

  after(async () => {
    // Sales first: a sold copy is `Restrict`-ed by `sale_line_item` (the no-double-sale backstop),
    // so the collection cannot be cascaded away while its sales still name the copies.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("records a multi-item order as one sale, matched on Delcampe's own listing ids", async () => {
    const first = await listedOffer("Poland 1947 overprint", "0.15", "2508694478");
    const second = await listedOffer("Hungary 2024 sheet", "3.00", "2508694520");

    const result = await importDelcampeOrder(
      userId,
      collectionId,
      order("104867762", [
        { itemId: "2508694478", price: "US$0.15" },
        { itemId: "2508694520", price: "US$3.00" },
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
        lines: { select: { offerId: true, price: true }, orderBy: { price: "asc" } },
      },
    });
    assert.equal(sale.externalRef, "104867762");
    assert.equal(sale.transactionUrl, "https://www.delcampe.net/en_GB/payment-request/104867762");
    assert.equal(sale.platformId, platformId);
    assert.equal(sale.currency, "USD");
    assert.equal(sale.soldAt.toISOString().slice(0, 10), "2026-03-22");
    // Delcampe's phases are not mirrored here: an imported order starts where every sale starts.
    assert.equal(sale.status, "ordered");
    // The exact total in the sale's own currency is the anchor (#205) — never the `± €13.95`.
    assert.equal(sale.buyerPaidTotal?.toFixed(2), "16.15");
    assert.equal(sale.buyerHandling, null);
    assert.deepEqual(
      sale.lines.map((line) => [line.offerId, line.price.toFixed(2)]),
      [
        [first.id, "0.15"],
        [second.id, "3.00"],
      ]
    );

    // Both offers sold out with the order, which is the sale's own side effect and not this flow's.
    const states = await prisma.offer.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { state: true },
    });
    assert.deepEqual(
      states.map((offer) => offer.state),
      ["sold", "sold"]
    );
  });

  it("files the buyer under their login, with the printed name beside it and nothing else", async () => {
    await listedOffer("Poland 1963 animals", "3.00", "2511756500");
    const result = await importDelcampeOrder(
      userId,
      collectionId,
      order("105098666", [{ itemId: "2511756500" }])
    );

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: result.saleId },
      select: { buyer: { select: { name: true, fullName: true, email: true, buyer: true } } },
    });
    assert.equal(sale.buyer?.name, "birdcollector");
    assert.equal(sale.buyer?.fullName, "Sample Buyer");
    assert.equal(sale.buyer?.buyer, true);
    // Delcampe prints an address on the same row and serves an e-mail relay beside it. Neither is
    // read, so neither can be stored.
    assert.equal(sale.buyer?.email, null);
  });

  it("answers a re-import with the sale that already claims the order, and writes nothing", async () => {
    await listedOffer("USSR 1961", "0.70", "2513925755");
    const first = await importDelcampeOrder(
      userId,
      collectionId,
      order("105196895", [{ itemId: "2513925755" }])
    );
    const again = await importDelcampeOrder(
      userId,
      collectionId,
      order("105196895", [{ itemId: "2513925755" }])
    );

    assert.equal(again.created, false);
    assert.equal(again.saleId, first.saleId);
    assert.equal(
      await prisma.sale.count({ where: { collectionId, externalRef: "105196895" } }),
      1
    );
  });

  it("finds the sales an order screen is asking about, and says nothing about the rest", async () => {
    await listedOffer("Poland 1966", "1.00", "2522387564");
    const recorded = await importDelcampeOrder(
      userId,
      collectionId,
      order("105852818", [{ itemId: "2522387564" }])
    );

    const matches = await findSalesForDelcampeOrders(userId, collectionId, [
      "105852818",
      "999999999",
    ]);
    assert.deepEqual(
      matches.map((match) => match.orderId),
      ["105852818"]
    );
    assert.equal(matches[0].saleNo, recorded.saleNo);
    assert.equal(matches[0].status, "ordered");
  });

  it("matches on the reference the row prints where no listing id was ever stored", async () => {
    const offer = await listedOffer("Poland 1952", "0.80", null);
    const result = await importDelcampeOrder(
      userId,
      collectionId,
      order("105393395", [
        {
          itemId: "2518015106",
          reference: `https://stamps.example.test/o/${collectionSlug}/${offer.offerNo}`,
        },
      ])
    );

    const line = await prisma.saleLine.findFirstOrThrow({
      where: { saleId: result.saleId },
      select: { offerId: true },
    });
    assert.equal(line.offerId, offer.id);
  });

  it("refuses the whole order when one row matches nothing, and records none of it", async () => {
    await listedOffer("Poland 1957", "0.30", "2519213720");

    await assert.rejects(
      () =>
        importDelcampeOrder(
          userId,
          collectionId,
          order("106491743", [{ itemId: "2519213720" }, { itemId: "9999999999" }])
        ),
      (err: unknown) =>
        err instanceof DelcampeOrderError &&
        err.problems.some((problem) => problem.itemId === "9999999999") &&
        /no offer here carries/.test(err.message)
    );
    assert.equal(
      await prisma.sale.count({ where: { collectionId, externalRef: "106491743" } }),
      0
    );
  });

  it("refuses rather than guessing which copy went when an offer still has several", async () => {
    const offer = await listedOffer("Poland 1965 pair", "0.25", "2517589961");
    await addSecondSet(offer.id, "Poland 1965 pair, second copy");

    await assert.rejects(
      () =>
        importDelcampeOrder(userId, collectionId, order("105042326", [{ itemId: "2517589961" }])),
      (err: unknown) => err instanceof DelcampeOrderError && /several sets/.test(err.message)
    );
  });

  it("refuses an order priced in a currency this platform's sales are not in", async () => {
    await listedOffer("Poland 1961", "0.50", "2512971737");

    await assert.rejects(
      () =>
        importDelcampeOrder(
          userId,
          collectionId,
          order("106512230", [{ itemId: "2512971737", price: "€0.50" }])
        ),
      (err: unknown) => err instanceof DelcampeOrderError && /sold in EUR/.test(err.message)
    );
  });
});
