import "server-only";
import { prisma } from "./db";
import { toBaseAmount } from "./contact-page-rules";
import { getOrFetchRate } from "./exchange-rates";
import type { LotGroup } from "./offer-lot-group-rules";
import { OFFER_STATES, type OfferState } from "./offer-rules";
import { readPrepareOffers } from "./offers";
import { lotGroupSummary, lotInBase, type GroupSummaryLot, type LotGroupSummary } from "./lot-group-summary-rules";

// The summary of a group's lots (#2326) — a proposal's or a Facebook post's, in every state. The lots
// are read as Prepare rows, the read their price tables are drawn from, so the summary's figures are
// the rows' summed; the counting is `lot-group-summary-rules.ts`'.

/** Every state but withdrawn — the summary leaves withdrawn lots out, so they are not read at all. */
const COUNTED_STATES: readonly OfferState[] = OFFER_STATES.filter((s) => s !== "withdrawn");

const LOT_SELECT = { id: true, state: true } as const;

/** The group's lots, in lot order — refused as *Post not found.* / *Proposal not found.* when the
 *  group is not in the owner's collection. Unlike the tools' gate, every state is read. */
async function groupLots(
  ownerId: string,
  collectionId: string,
  group: LotGroup
): Promise<{ id: string; state: string }[]> {
  if (group.kind === "post") {
    const post = await prisma.facebookPost.findFirst({
      where: { id: group.id, collectionId, collection: { ownerId } },
      select: { lots: { select: LOT_SELECT, orderBy: { facebookLotNo: "asc" } } },
    });
    if (!post) throw new Error("Post not found.");
    return post.lots;
  }
  const proposal = await prisma.proposal.findFirst({
    where: { id: group.id, collectionId, collection: { ownerId } },
    select: { lots: { select: LOT_SELECT, orderBy: [{ proposalLotNo: "asc" }, { offerNo: "asc" }] } },
  });
  if (!proposal) throw new Error("Proposal not found.");
  return proposal.lots;
}

/** What each lot's sold sets brought in, keyed by offer id — base currency at each sale's own rate. */
async function readLotProceeds(
  offerIds: readonly string[],
  baseCurrency: string
): Promise<Map<string, { sets: number; amount: string | null }>> {
  const lines =
    offerIds.length === 0
      ? []
      : await prisma.saleLine.findMany({
          where: { offerId: { in: [...offerIds] } },
          select: { offerId: true, price: true, sale: { select: { currency: true, fxRateToBase: true } } },
        });
  const sums = new Map<string, { sets: number; cents: number | null }>();
  for (const line of lines) {
    if (!line.offerId) continue;
    const base = toBaseAmount(
      Number(line.price),
      line.sale.currency,
      baseCurrency,
      line.sale.fxRateToBase === null ? null : Number(line.sale.fxRateToBase)
    );
    const sum = sums.get(line.offerId) ?? { sets: 0, cents: 0 };
    sum.sets++;
    sum.cents = sum.cents === null || base === null ? null : sum.cents + Math.round(base * 100);
    sums.set(line.offerId, sum);
  }
  return new Map(
    [...sums].map(([id, s]) => [id, { sets: s.sets, amount: s.cents === null ? null : (s.cents / 100).toFixed(2) }])
  );
}

/** The summary of the group's lots — withdrawn left out, every figure in the collection's base currency. */
export async function getLotGroupSummary(
  ownerId: string,
  collectionId: string,
  group: LotGroup
): Promise<LotGroupSummary> {
  const groupRows = await groupLots(ownerId, collectionId, group);
  const states = new Map(groupRows.map((l) => [l.id, l.state as OfferState]));
  const ids = groupRows.filter((l) => l.state !== "withdrawn").map((l) => l.id);
  const { baseCurrency } = await prisma.collection.findUniqueOrThrow({
    where: { id: collectionId },
    select: { baseCurrency: true },
  });
  const [rows, proceeds] = await Promise.all([
    readPrepareOffers(ownerId, collectionId, ids, COUNTED_STATES),
    readLotProceeds(ids, baseCurrency),
  ]);

  // lot currency → base, once per currency; null where no rate is known.
  const rates = new Map<string, number | null>();
  for (const currency of new Set(rows.map((row) => row.currency))) {
    if (currency === baseCurrency) continue;
    try {
      rates.set(currency, (await getOrFetchRate(collectionId, currency, baseCurrency)).rate);
    } catch {
      rates.set(currency, null);
    }
  }

  const lots: GroupSummaryLot[] = rows.map((row) =>
    lotInBase(
      {
        id: row.id,
        state: states.get(row.id)!,
        listingType: row.listingType,
        price: row.price,
        startingPrice: row.startingPrice,
        currency: row.currency,
        catalogPrice: row.catalogPrice,
        suggestedPrice: row.suggestedPrice,
        marketPrice: row.marketPrice,
        costPrice: row.costPrice,
        setCount: row.setCount,
        itemCount: row.itemCount,
        sold: proceeds.get(row.id) ?? null,
      },
      baseCurrency,
      rates.get(row.currency) ?? null
    )
  );
  return lotGroupSummary(lots, baseCurrency);
}
