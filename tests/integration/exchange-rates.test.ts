import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createCollection } from "../../src/lib/collections";
import { fetchEcbRateOn, getOrFetchRate } from "../../src/lib/exchange-rates";
import { installEcbStub } from "../fixtures/ecb/stub";

// The ECB is answered from its own recorded responses (#1648): the suite is a required check, and a
// 504 from the ECB must not fail a pull request. `tests/fixtures/ecb/stub.ts` says what was recorded.
let restoreFetch: () => void;
before(() => {
  restoreFetch = installEcbStub();
});
after(() => {
  restoreFetch();
});

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
    // 2026-10-02's table: USD 1.1225 and GBP 0.85033 per EUR.
    assert.ok(Math.abs(result.rate - 0.85033 / 1.1225) < 1e-12, `USD → GBP was ${result.rate}`);
    assert.equal(result.isStale, false);
  });
});

// A past day's rate (#1633), for a price observed at a sale long before today's snapshot. The figures
// are the ECB's published reference rates, out of the recorded data API response.
describe("fetchEcbRateOn", () => {
  it("reads the rate of the day, pivoted through EUR", async () => {
    // Friday 2021-03-05: PLN 4.5748 and CHF 1.1066 per EUR.
    const plnToEur = await fetchEcbRateOn(new Date("2021-03-05T00:00:00Z"), "PLN", "EUR");
    assert.ok(Math.abs(plnToEur - 1 / 4.5748) < 1e-12, `PLN → EUR was ${plnToEur}`);
    const chfToPln = await fetchEcbRateOn(new Date("2021-03-05T00:00:00Z"), "CHF", "PLN");
    assert.ok(Math.abs(chfToPln - 4.5748 / 1.1066) < 1e-12, `CHF → PLN was ${chfToPln}`);
  });

  it("takes the last published rate for a day the ECB did not quote", async () => {
    // Sunday 2021-03-07 is Friday's rate.
    const sunday = await fetchEcbRateOn(new Date("2021-03-07T00:00:00Z"), "PLN", "EUR");
    assert.ok(Math.abs(sunday - 1 / 4.5748) < 1e-12, `PLN → EUR on a Sunday was ${sunday}`);
  });

  it("needs no request for a currency into itself", async () => {
    assert.equal(await fetchEcbRateOn(new Date("2021-03-05T00:00:00Z"), "EUR", "EUR"), 1);
  });

  it("throws, saying so, when the ECB cannot answer", async () => {
    const stubbed = globalThis.fetch;
    globalThis.fetch = async () => new Response("Gateway Timeout", { status: 504 });
    try {
      await assert.rejects(
        () => fetchEcbRateOn(new Date("2021-03-05T00:00:00Z"), "PLN", "EUR"),
        /ECB historic fetch failed: 504/
      );
    } finally {
      globalThis.fetch = stubbed;
    }
  });

  it("throws when the ECB quotes neither currency in the window", async () => {
    // The recorded window holds CHF and PLN only, as the API would for a key naming them.
    await assert.rejects(() => fetchEcbRateOn(new Date("2021-03-05T00:00:00Z"), "PLN", "SEK"));
  });
});
