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

  it("stores the whole EUR-anchored snapshot in the database", async () => {
    const result = await getOrFetchRate(collectionId, "EUR", "USD");
    assert.ok(result.rate > 0);
    assert.equal(result.isStale, false);

    const stored = await prisma.exchangeRate.findMany({ where: { collectionId } });
    // A refresh caches the ECB table, not the requested pair: every row is anchored at EUR and
    // every row carries the same instant, which is what makes the rates mutually consistent.
    assert.ok(stored.length > 1, `Expected a full snapshot, got ${stored.length} row(s)`);
    assert.ok(stored.every((r) => r.fromCurrency === "EUR"));
    assert.equal(new Set(stored.map((r) => r.fetchedAt.getTime())).size, 1);

    const usd = stored.find((r) => r.toCurrency === "USD");
    assert.ok(usd);
    assert.equal(Number(usd.rate), result.rate);
  });

  it("returns exactly reciprocal rates for the two directions of a pair", async () => {
    // The reason the snapshot exists (#20): a catalogue price valued into the base currency and
    // converted back into a sale's must come out where it started, not 0.1% under.
    const forward = await getOrFetchRate(collectionId, "EUR", "PLN");
    const back = await getOrFetchRate(collectionId, "PLN", "EUR");
    assert.ok(
      Math.abs(forward.rate * back.rate - 1) < 1e-12,
      `Round trip lost value: ${forward.rate} × ${back.rate}`
    );
    assert.ok(Math.abs(1500 * forward.rate * back.rate - 1500) < 1e-6);
  });

  it("returns cached rate on second call", async () => {
    const first = await getOrFetchRate(collectionId, "EUR", "GBP");
    const second = await getOrFetchRate(collectionId, "EUR", "GBP");
    assert.equal(first.rate, second.rate);
    assert.equal(second.isStale, false);
  });

  it("returns stale cached rate with isStale flag when cache is old and fetch fails", async () => {
    await getOrFetchRate(collectionId, "EUR", "PLN");

    // Ageing one row ages the snapshot: it is dated by its oldest part, so a mixed-age table is
    // never treated as current.
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
    // Nothing cached at all — one successful refresh covers every ECB currency, so the empty cache
    // has to be made explicitly rather than assumed from an unusual pair.
    await prisma.exchangeRate.deleteMany({ where: { collectionId } });
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
