import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getPurchaseDetail } from "../../src/lib/lots";

// What an order cost, read back out of Prisma (#852): the total, its breakdown into price and
// shipping, and both of those in the collection's base currency.
//
// The arithmetic has a unit test of its own (`tests/unit/purchase-spend.test.ts`); what this one
// covers is everything between the `Decimal` columns and that pure function — which lines are
// counted as "price", which figure a lot's shipping share is, and the two cases where a base
// figure must not appear:
//
//  - a **foreign order with no frozen rate**, where the conversion is absent rather than partial;
//  - a **base-currency order**, whose stored rate is null for a completely different reason.
//
// Both orders below therefore carry `fxRateToBase: null`, so the null alone cannot be what the
// read keys off. Money is written straight to the rows rather than through `createPurchase`, whose
// rate is frozen from the exchange-rate table and is that flow's own subject.

const TS = Date.now();

describe("purchase spend (what an order cost, in both currencies)", () => {
  let userId: string;
  let collectionId: string;
  /** PLN order with a frozen rate: two lots, one expense, and shipping to spread over all three. */
  let converted: string;
  /** PLN order with no rate at all — the unconvertible case. */
  let unconvertible: string;
  /** EUR order in a EUR collection: no conversion needed, and none to be missing. */
  let native: string;

  let nextNo = 7100;

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-pospend-${TS}`,
          name: "Test User PO Spend",
          email: `test-pospend-${TS}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-pospend-${TS}`,
          name: "PO Spend",
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;

    converted = (
      await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: nextNo++,
          purchasedAt: new Date("2026-03-04"),
          currency: "PLN",
          fxRateToBase: "0.23",
          shippingCost: "14.50",
          lots: { create: [{ price: "100.00" }, { price: "20.00" }] },
          expenses: { create: [{ label: "Tongs", price: "10.00" }] },
        },
      })
    ).id;

    unconvertible = (
      await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: nextNo++,
          purchasedAt: new Date("2026-03-05"),
          currency: "PLN",
          fxRateToBase: null,
          shippingCost: "9.00",
          lots: { create: [{ price: "41.00" }] },
        },
      })
    ).id;

    native = (
      await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: nextNo++,
          purchasedAt: new Date("2026-03-06"),
          currency: "EUR",
          fxRateToBase: null,
          shippingCost: "5.00",
          lots: { create: [{ price: "45.00" }] },
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("adds the order's lines and its shipping into one total", async () => {
    const detail = (await getPurchaseDetail(userId, converted))!;
    assert.equal(detail.spend.scope, "order");
    // The expense counts towards the price: it is a line of the order and it absorbs its share of
    // the shipping (ADR-0009 §1), so leaving it out would make a total that is not what was paid.
    assert.equal(detail.spend.tx.price, "130.00");
    assert.equal(detail.spend.tx.shipping, "14.50");
    assert.equal(detail.spend.tx.total, "144.50");
    assert.equal(detail.spend.tx.currency, "PLN");
    // …and it is the very figure the header has always printed, from the same rows.
    assert.equal(detail.spend.tx.total, detail.total);
    assert.deepEqual(detail.spend.lines, { lots: 2, expenses: 1 });
    // An order's shipping is the charge itself, not a share of anything.
    assert.equal(detail.spend.shippingShareOf, null);
  });

  it("states the same total in the base currency, with a breakdown that reconciles", async () => {
    const detail = (await getPurchaseDetail(userId, converted))!;
    assert.equal(detail.spend.base?.currency, "EUR");
    assert.equal(detail.spend.base?.total, "33.24");
    // Compared in cents, the unit the figures are actually stored and printed in — adding two
    // 2-dp strings back as floats reintroduces exactly the drift the apportionment removed.
    const cents = (amount: string) => Math.round(Number(amount) * 100);
    assert.equal(
      cents(detail.spend.base!.price) + cents(detail.spend.base!.shipping),
      cents(detail.spend.base!.total)
    );
  });

  it("gives each lot its price plus its own share of the shipping", async () => {
    const detail = (await getPurchaseDetail(userId, converted))!;
    const [first, second] = detail.lots;
    assert.equal(first.spend.scope, "lot");
    assert.equal(first.spend.tx.price, "100.00");
    assert.equal(first.spend.tx.shipping, "11.15");
    assert.equal(first.spend.tx.total, "111.15");
    assert.equal(second.spend.tx.shipping, "2.23");
    assert.equal(second.spend.tx.total, "22.23");
    // The whole charge is named beside the share, so the apportionment (ADR-0009 §3.1) is visible
    // rather than happening behind the figure.
    assert.equal(first.spend.shippingShareOf, "14.50");
    assert.equal(first.spend.lines, null);

    // The lot totals and the pool the cost basis is split from are one figure, not two that agree
    // today: a lot bar reading a different number from the pool chip above it would be the defect
    // this whole read exists to avoid.
    for (const lot of detail.lots) {
      assert.equal(lot.spend.tx.total, lot.poolTx);
      assert.equal(lot.spend.base?.total, lot.poolBase);
    }

    // The lots' shares add up to the order's shipping, to the cent — nothing is lost or invented
    // between the two scopes.
    const shares = detail.lots.reduce((sum, l) => sum + Number(l.spend.tx.shipping), 0);
    // The expense takes 1.12 of the 14.50; the two lots hold the rest.
    assert.equal(shares.toFixed(2), "13.38");
  });

  it("has no base figures for a foreign order with no rate, at either scope", async () => {
    const detail = (await getPurchaseDetail(userId, unconvertible))!;
    assert.equal(detail.spend.base, null);
    assert.equal(detail.spend.baseCurrency, "EUR");
    // The transaction side is still complete and exact: what is missing is the conversion, not a
    // component of the sum.
    assert.equal(detail.spend.tx.total, "50.00");
    assert.equal(detail.spend.tx.price, "41.00");
    assert.equal(detail.spend.tx.shipping, "9.00");
    assert.equal(detail.lots[0].spend.base, null);
    assert.equal(detail.lots[0].spend.tx.total, "50.00");
    // The same call the pool line has always made, so the bar and the chip cannot disagree.
    assert.equal(detail.lots[0].poolBase, null);
  });

  it("mirrors the transaction figures when the order is already in the base currency", async () => {
    const detail = (await getPurchaseDetail(userId, native))!;
    // The stored rate is null here too, so this and the case above differ only by the currency
    // codes — which is exactly the distinction the read has to get right.
    assert.deepEqual(detail.spend.base, {
      currency: "EUR",
      total: "50.00",
      price: "45.00",
      shipping: "5.00",
    });
    assert.equal(detail.spend.tx.currency, detail.spend.baseCurrency);
  });
});
