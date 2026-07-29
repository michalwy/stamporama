import { prisma } from "./db";
import type { BaseCurrency } from "./currencies";

// **One dated snapshot of the ECB table per collection, never a bag of per-pair rates.**
//
// Every rate handed out here is derived from a single `EUR → X` snapshot: `rate(A → B) = X_B / X_A`,
// the same pivot arithmetic `convertViaEur` does over a freshly fetched table. The cache stores that
// table verbatim — one row per currency, all sharing one `fetchedAt` — rather than caching each
// requested pair separately.
//
// The reason is **consistency, not storage**. Pair-wise caching let `EUR → PLN` and `PLN → EUR` be
// filled on different days and refresh independently, so their product was not 1: a catalogue price
// valued into the base currency and converted back into the sale's — which is exactly what an
// auction lot's composition does (`auction-lines.ts`) — lost about a tenth of a percent on the round
// trip, and lost a *different* amount tomorrow. With one snapshot behind both directions, the two
// rates are exact reciprocals and the round trip is lossless.
//
// A refresh therefore rewrites the whole table for the collection, and staleness is a property of
// the snapshot (its oldest row), not of a pair: a snapshot is entirely current or entirely replaced.

const ECB_DAILY_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** The currency every stored row is anchored to, mirroring the ECB feed's own pivot. */
const ANCHOR = "EUR";

export type RateResult = {
  rate: number;
  fetchedAt: Date;
  isStale: boolean;
};

export function parseEcbXml(xml: string): Map<string, number> {
  const rates = new Map<string, number>();
  rates.set("EUR", 1);
  const regex = /<Cube\s+currency='([A-Z]+)'\s+rate='([0-9.]+)'\s*\/>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    rates.set(match[1], parseFloat(match[2]));
  }
  return rates;
}

export function convertViaEur(
  rates: Map<string, number>,
  from: string,
  to: string
): number {
  const fromRate = rates.get(from);
  const toRate = rates.get(to);
  if (fromRate === undefined || toRate === undefined) {
    throw new Error(
      `Unsupported currency pair: ${from} → ${to}`
    );
  }
  return toRate / fromRate;
}

async function fetchEcbRates(): Promise<Map<string, number>> {
  const response = await fetch(ECB_DAILY_URL);
  if (!response.ok) {
    throw new Error(`ECB fetch failed: ${response.status}`);
  }
  const xml = await response.text();
  return parseEcbXml(xml);
}

/** A collection's cached ECB table: what it holds, and when it was taken. */
type Snapshot = { rates: Map<string, number>; fetchedAt: Date };

/**
 * Read the collection's snapshot, or null when it holds nothing.
 *
 * `fetchedAt` is the **oldest** row's. A refresh writes them all at one instant, so the rows are
 * normally uniform; taking the minimum means a snapshot that somehow ends up mixed ages is treated
 * as being as old as its oldest part rather than as current.
 */
async function readSnapshot(collectionId: string): Promise<Snapshot | null> {
  const rows = await prisma.exchangeRate.findMany({
    where: { collectionId, fromCurrency: ANCHOR },
    select: { toCurrency: true, rate: true, fetchedAt: true },
  });
  if (rows.length === 0) return null;

  const rates = new Map<string, number>();
  let fetchedAt = rows[0].fetchedAt;
  for (const row of rows) {
    rates.set(row.toCurrency, Number(row.rate));
    if (row.fetchedAt < fetchedAt) fetchedAt = row.fetchedAt;
  }
  return { rates, fetchedAt };
}

/**
 * Replace the collection's snapshot with a freshly fetched table.
 *
 * Delete-then-insert rather than per-row upsert, in one transaction: a snapshot is one dated
 * observation, so a half-old half-new table is the very thing this exists to prevent. The delete is
 * unscoped by `fromCurrency` on purpose — it also clears the per-pair rows written before this
 * module was snapshot-based, which are unreadable now and must not linger.
 */
async function writeSnapshot(
  collectionId: string,
  rates: Map<string, number>,
  fetchedAt: Date
): Promise<void> {
  await prisma.$transaction([
    prisma.exchangeRate.deleteMany({ where: { collectionId } }),
    prisma.exchangeRate.createMany({
      data: [...rates].map(([currency, rate]) => ({
        collectionId,
        fromCurrency: ANCHOR,
        toCurrency: currency,
        rate,
        fetchedAt,
      })),
    }),
  ]);
}

export async function getOrFetchRate(
  collectionId: string,
  fromCurrency: string,
  toCurrency: string
): Promise<RateResult> {
  if (fromCurrency === toCurrency) {
    return { rate: 1, fetchedAt: new Date(), isStale: false };
  }

  const cached = await readSnapshot(collectionId);
  const cachedCovers =
    cached !== null &&
    cached.rates.has(fromCurrency) &&
    cached.rates.has(toCurrency);

  if (cached && cachedCovers) {
    const age = Date.now() - cached.fetchedAt.getTime();
    if (age < STALE_THRESHOLD_MS) {
      return {
        rate: convertViaEur(cached.rates, fromCurrency, toCurrency),
        fetchedAt: cached.fetchedAt,
        isStale: false,
      };
    }
  }

  let ecbRates: Map<string, number>;
  try {
    ecbRates = await fetchEcbRates();
  } catch {
    // Unreachable feed: an old snapshot still answers, flagged as such. Only when it cannot answer
    // the pair at all is there nothing to return.
    if (cached && cachedCovers) {
      return {
        rate: convertViaEur(cached.rates, fromCurrency, toCurrency),
        fetchedAt: cached.fetchedAt,
        isStale: true,
      };
    }
    throw new Error(
      `Cannot fetch exchange rate for ${fromCurrency} → ${toCurrency} and no cached rate exists`
    );
  }

  const now = new Date();
  await writeSnapshot(collectionId, ecbRates, now);
  // After the write, so an unsupported pair still surfaces as itself rather than as a fetch failure
  // — and so the snapshot the next caller reads is current either way.
  return { rate: convertViaEur(ecbRates, fromCurrency, toCurrency), fetchedAt: now, isStale: false };
}

export async function getOrFetchRates(
  collectionId: string,
  toCurrency: BaseCurrency,
  fromCurrencies: string[]
): Promise<Map<string, RateResult>> {
  const unique = [...new Set(fromCurrencies)];
  const results = new Map<string, RateResult>();
  for (const from of unique) {
    results.set(from, await getOrFetchRate(collectionId, from, toCurrency));
  }
  return results;
}
