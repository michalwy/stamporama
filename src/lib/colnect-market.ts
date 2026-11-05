// Check Colnect market (#2454) — the half that reads and writes. What a read may contain, what is
// kept and how it is drawn are `colnect-market-rules.ts`'s; this loads what those need and stores the
// result on the offer.

import { prisma } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { getOrFetchRate } from "./exchange-rates";
import { COLNECT_PLATFORM_MODULE } from "./platform-modules";
import {
  colnectMarketTargets,
  colnectMarketView,
  DEFAULT_MARKET_PRICE_STEP,
  parseColnectMarketReadInput,
  readStoredColnectMarketRead,
  storeColnectMarketRead,
  type MarketItemSource,
  type OfferColnectMarket,
} from "./colnect-market-rules";

/** Colnect grade → the names of the collection's conditions mapped to it (#404), in the collection's
 *  order of conditions. */
async function loadConditionNamesByGrade(collectionId: string): Promise<Map<string, string[]>> {
  const rows = await prisma.colnectConditionMapping.findMany({
    where: { collectionId },
    select: { colnectValue: true, stampCondition: { select: { name: true, sortOrder: true } } },
    orderBy: { stampCondition: { sortOrder: "asc" } },
  });
  const names = new Map<string, string[]>();
  for (const r of rows) {
    const list = names.get(r.colnectValue) ?? [];
    list.push(r.stampCondition.name);
    names.set(r.colnectValue, list);
  }
  return names;
}

/** The card's content for an offer on Colnect: its items, its last read drawn, the step. */
export async function getOfferColnectMarket(
  collectionId: string,
  input: {
    platformItems: readonly MarketItemSource[];
    read: Prisma.JsonValue | null;
    readAt: Date | null;
    step: string | null;
    currency: string;
  }
): Promise<OfferColnectMarket> {
  const targets = colnectMarketTargets(input.platformItems);
  const stored = readStoredColnectMarketRead(input.read);
  // A read taken in another currency is drawn as no read: its figures would be in the wrong money.
  const current = stored && stored.currency === input.currency ? stored : null;
  const names = current ? await loadConditionNamesByGrade(collectionId) : new Map<string, string[]>();
  return {
    targets,
    view: colnectMarketView(current, targets, names),
    readAt: current ? input.readAt : null,
    step: input.step ?? DEFAULT_MARKET_PRICE_STEP,
    currency: input.currency,
  };
}

export class ColnectMarketReadError extends Error {}

/**
 * Keep a read the Assistant took for an offer on Colnect, replacing the last one.
 *
 * Refused for an offer that is not the owner's, not on the Colnect platform, or a read that is not
 * one — and for a read whose prices are in a currency there is no rate for: kept, it would draw
 * every price in the wrong money.
 */
export async function recordColnectMarketRead(ownerId: string, offerId: string, raw: unknown): Promise<void> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      collectionId: true,
      currency: true,
      collection: { select: { ownerId: true } },
      platform: { select: { platformModule: true } },
    },
  });
  if (!offer || offer.collection.ownerId !== ownerId) throw new ColnectMarketReadError("Offer not found.");
  if (offer.platform.platformModule !== COLNECT_PLATFORM_MODULE) {
    throw new ColnectMarketReadError("Only an offer on Colnect has a Colnect market to check.");
  }
  const input = parseColnectMarketReadInput(raw);
  if (!input) throw new ColnectMarketReadError("The Assistant's read of Colnect's market could not be understood.");

  // Every sale code an offer of this collection records (#696): a listing carrying one is the
  // collector's own, whichever Colnect account the pages were read as.
  const ownSales = await prisma.offer.findMany({
    where: { collectionId: offer.collectionId, colnectSaleId: { not: null } },
    select: { colnectSaleId: true },
  });

  // The rates the read needs, fetched before the pure step — at most one or two currencies.
  const currencies = [
    ...new Set(input.items.flatMap((i) => i.offers.map((o) => o.currency)).filter((c) => c !== offer.currency)),
  ];
  const rates = new Map<string, number | null>();
  for (const currency of currencies) {
    try {
      rates.set(currency, (await getOrFetchRate(offer.collectionId, currency, offer.currency)).rate);
    } catch {
      rates.set(currency, null);
    }
  }

  const stored = storeColnectMarketRead(input, {
    currency: offer.currency,
    rateTo: (currency) => rates.get(currency) ?? null,
    ownSaleCodes: new Set(ownSales.map((o) => o.colnectSaleId!)),
  });
  if (!stored.ok) throw new ColnectMarketReadError(stored.error);

  await prisma.offer.update({
    where: { id: offerId },
    data: {
      colnectMarketRead: stored.read as unknown as Prisma.InputJsonValue,
      colnectMarketReadAt: new Date(),
    },
  });
}
