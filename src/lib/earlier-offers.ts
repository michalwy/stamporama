// The read behind an offer's *Last sale* rows and *Earlier offers* tab (#2521). Everything about
// meaning — which sets are the same stamps, which sale is the last, the axes — is pure, in
// `earlier-offers-rules.ts`; this module only reads the candidates and brings every amount into the
// offer's currency, as the price table's figures are brought (#1829): to the base currency first —
// a sale at the rate frozen on it, a listed price at today's — then with the screen's own base → offer
// rate. A missing rate leaves the amount null rather than one in the wrong currency.

import { prisma } from "./db";
import { earlierOffers, type EarlierOffers, type EarlierSetInput, type MatchCopyInput } from "./earlier-offers-rules";
import { getOrFetchRate } from "./exchange-rates";
import { isOfferState, normalizeListingType, isAuctionListing, type OfferState } from "./offer-rules";

const COPY_SELECT = {
  conditionId: true,
  condition: { select: { name: true } },
  stamps: { select: { stampId: true, quantity: true, formatId: true } },
} as const;

type CopyRow = {
  conditionId: string | null;
  condition: { name: string } | null;
  stamps: { stampId: string; quantity: number; formatId: string | null }[];
};

function matchCopy(row: CopyRow): MatchCopyInput {
  return { conditionId: row.conditionId, conditionName: row.condition?.name ?? null, stamps: row.stamps };
}

/** The states an earlier offer is never read in: still being prepared, nothing of it was ever up. */
const PREPARED_STATES: readonly OfferState[] = ["preparing", "ready"];

/**
 * This offer's earlier offers and its two last sales. `ownSets` are the offer's sets as its screen
 * names them; `baseToOffer` is the screen's own base → offer rate (1 when the offer prices in base,
 * null when none is known).
 */
export async function readEarlierOffers(input: {
  collectionId: string;
  offerId: string;
  platformId: string;
  baseCurrency: string;
  baseToOffer: number | null;
  ownSets: readonly { id: string; label: string; itemIds: readonly string[] }[];
}): Promise<EarlierOffers> {
  const empty: EarlierOffers = {
    rows: [],
    lastSale: { platform: null, any: null },
    lastSaleUnconvertible: { platform: false, any: false },
  };
  const itemIds = input.ownSets.flatMap((s) => s.itemIds);
  if (itemIds.length === 0) return empty;

  const ownCopies = await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, ...COPY_SELECT } });
  const copyById = new Map(ownCopies.map((c) => [c.id, matchCopy(c)]));
  const own = input.ownSets.map((s) => ({
    setId: s.id,
    label: s.label,
    copies: s.itemIds.flatMap((id) => (copyById.has(id) ? [copyById.get(id)!] : [])),
  }));
  const stampIds = [...new Set(ownCopies.flatMap((c) => c.stamps.map((s) => s.stampId)))];
  if (stampIds.length === 0) return empty;

  const sets = await prisma.offerSet.findMany({
    where: {
      offer: {
        collectionId: input.collectionId,
        id: { not: input.offerId },
        state: { notIn: [...PREPARED_STATES] },
      },
      items: { some: { item: { stamps: { some: { stampId: { in: stampIds } } } } } },
    },
    select: {
      id: true,
      offer: {
        select: {
          id: true,
          offerNo: true,
          platformId: true,
          platform: { select: { name: true } },
          state: true,
          listingType: true,
          price: true,
          startingPrice: true,
          currency: true,
          listingDate: true,
          createdAt: true,
          sets: { select: { id: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        },
      },
      items: { select: { item: { select: COPY_SELECT } } },
      // A set is sold indivisibly, so there is at most one line; a cancelled sale's lines are gone (#2500).
      saleLines: { select: { price: true, sale: { select: { soldAt: true, currency: true, fxRateToBase: true } } }, take: 1 },
    },
  });
  if (sets.length === 0) return empty;

  // Today's rate into base, once per currency met; null where none is known.
  const todayToBase = new Map<string, number | null>();
  const rateToBase = async (currency: string): Promise<number | null> => {
    if (currency === input.baseCurrency) return 1;
    if (!todayToBase.has(currency)) {
      try {
        todayToBase.set(currency, (await getOrFetchRate(input.collectionId, currency, input.baseCurrency)).rate);
      } catch {
        todayToBase.set(currency, null);
      }
    }
    return todayToBase.get(currency)!;
  };
  const inOffer = (amount: number, toBase: number | null) =>
    toBase === null || input.baseToOffer === null ? null : (amount * toBase * input.baseToOffer).toFixed(2);

  const candidates: EarlierSetInput[] = [];
  for (const set of sets) {
    const offer = set.offer;
    const state = isOfferState(offer.state) ? offer.state : "active";
    const stated = isAuctionListing(normalizeListingType(offer.listingType)) ? offer.startingPrice : offer.price;
    const statedValue = stated === null ? 0 : Number(stated);
    const line = set.saleLines[0] ?? null;
    let sale: EarlierSetInput["sale"] = null;
    if (line) {
      const toBase =
        line.sale.currency === input.baseCurrency
          ? 1
          : line.sale.fxRateToBase !== null
            ? Number(line.sale.fxRateToBase)
            : await rateToBase(line.sale.currency);
      sale = { amount: inOffer(Number(line.price), toBase), soldAt: line.sale.soldAt };
    }
    const position = offer.sets.findIndex((s) => s.id === set.id);
    candidates.push({
      setId: set.id,
      offerId: offer.id,
      offerNo: offer.offerNo,
      platformId: offer.platformId,
      platformName: offer.platform.name,
      state,
      date: offer.listingDate ?? offer.createdAt,
      listed: statedValue > 0 ? inOffer(statedValue, await rateToBase(offer.currency)) : null,
      sale,
      setPosition: position < 0 ? 1 : position + 1,
      setCount: offer.sets.length,
      copies: set.items.map((i) => matchCopy(i.item)),
    });
  }
  return earlierOffers(own, candidates, input.platformId);
}
