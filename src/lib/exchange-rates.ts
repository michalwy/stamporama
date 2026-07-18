import { prisma } from "./db";
import type { BaseCurrency } from "./currencies";

const ECB_DAILY_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

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

export async function getOrFetchRate(
  collectionId: string,
  fromCurrency: string,
  toCurrency: string
): Promise<RateResult> {
  if (fromCurrency === toCurrency) {
    return { rate: 1, fetchedAt: new Date(), isStale: false };
  }

  const cached = await prisma.exchangeRate.findUnique({
    where: {
      collectionId_fromCurrency_toCurrency: {
        collectionId,
        fromCurrency,
        toCurrency,
      },
    },
  });

  if (cached) {
    const age = Date.now() - cached.fetchedAt.getTime();
    if (age < STALE_THRESHOLD_MS) {
      return {
        rate: Number(cached.rate),
        fetchedAt: cached.fetchedAt,
        isStale: false,
      };
    }
  }

  try {
    const ecbRates = await fetchEcbRates();
    const rate = convertViaEur(ecbRates, fromCurrency, toCurrency);
    const now = new Date();

    await prisma.exchangeRate.upsert({
      where: {
        collectionId_fromCurrency_toCurrency: {
          collectionId,
          fromCurrency,
          toCurrency,
        },
      },
      update: { rate, fetchedAt: now },
      create: { collectionId, fromCurrency, toCurrency, rate, fetchedAt: now },
    });

    return { rate, fetchedAt: now, isStale: false };
  } catch {
    if (cached) {
      return {
        rate: Number(cached.rate),
        fetchedAt: cached.fetchedAt,
        isStale: true,
      };
    }
    throw new Error(
      `Cannot fetch exchange rate for ${fromCurrency} → ${toCurrency} and no cached rate exists`
    );
  }
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
