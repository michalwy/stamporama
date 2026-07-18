import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createCollection } from "../../src/lib/collections";
import { getOrFetchRate } from "../../src/lib/exchange-rates";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

describe("getOrFetchRate", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    userId = (await createTestUser(`exr-${Date.now()}`)).id;
    const c = await createCollection(userId, "Exchange Rate Test", "EUR");
    collectionId = c.id;
  });

  after(async () => {
    await prisma.exchangeRate.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("returns rate 1 for same currency without DB access", async () => {
    const result = await getOrFetchRate(collectionId, "EUR", "EUR");
    assert.equal(result.rate, 1);
    assert.equal(result.isStale, false);
  });

  it("stores a fetched rate in the database", async () => {
    const result = await getOrFetchRate(collectionId, "EUR", "USD");
    assert.ok(result.rate > 0);
    assert.equal(result.isStale, false);

    const stored = await prisma.exchangeRate.findUnique({
      where: {
        collectionId_fromCurrency_toCurrency: {
          collectionId,
          fromCurrency: "EUR",
          toCurrency: "USD",
        },
      },
    });
    assert.ok(stored !== null);
    assert.equal(Number(stored!.rate), result.rate);
  });

  it("returns cached rate on second call", async () => {
    const first = await getOrFetchRate(collectionId, "EUR", "GBP");
    const second = await getOrFetchRate(collectionId, "EUR", "GBP");
    assert.equal(first.rate, second.rate);
    assert.equal(second.isStale, false);
  });

  it("returns stale cached rate with isStale flag when cache is old and fetch fails", async () => {
    await getOrFetchRate(collectionId, "EUR", "PLN");

    await prisma.exchangeRate.update({
      where: {
        collectionId_fromCurrency_toCurrency: {
          collectionId,
          fromCurrency: "EUR",
          toCurrency: "PLN",
        },
      },
      data: { fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Network unavailable");
    };
    try {
      const result = await getOrFetchRate(collectionId, "EUR", "PLN");
      assert.ok(result.isStale);
      assert.ok(result.rate > 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws when no cache exists and fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Network unavailable");
    };
    try {
      await assert.rejects(
        () => getOrFetchRate(collectionId, "CHF", "SEK"),
        /Cannot fetch exchange rate/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles cross-currency conversion via EUR pivot", async () => {
    const result = await getOrFetchRate(collectionId, "USD", "GBP");
    assert.ok(result.rate > 0);
    assert.ok(result.rate < 1);
    assert.equal(result.isStale, false);
  });
});
