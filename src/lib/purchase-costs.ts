import "server-only";
import { prisma } from "./db";
import { NOT_TRADED_AWAY } from "./trade-exit";
import { UNAVAILABLE_DELIVERY_STATES } from "./delivery-state";
import { getCollectionBaseCurrency } from "./pricing";
import {
  aggregatePurchaseCostsByKey,
  type PurchaseCostCell,
  type PurchaseCostInput,
} from "./cost-basis";

// **What the collector has actually paid for a stamp** (#560) — the third answer in the Valuation
// dialog, beside what the market paid (#457; ADR-0022) and what the catalogs list.
//
// The three are different questions and stay three modules. Market value is what *other* people
// paid at auction, the catalog is what a published book asks, and this is what came out of *this*
// collector's pocket — the only one of the three that is a fact about the collection rather than
// about the stamp. It is why the section sits below market value and above the catalogs: it is
// evidence for neither of them, and it is nearest the one that also comes from transactions.
//
// **The arithmetic is not here.** Grouping by key, the average, min, max and the three cost-basis
// states all live in the pure `cost-basis.ts`, beside `resolveCostBasis`, whose rules (#123;
// ADR-0009 §2/§3) this is entirely built on. What needs a database is only: which copies count,
// what the axes are called, and where the collector sorted them.
//
// **Which copies count.** The held, unsold copies of that stamp *exactly*: the same filter
// `copy-counts.ts` (#348) narrows the copies-held badge with, and the same no-rollup rule — a
// variant child's copies are its own, and the umbrella's badge does not claim them either. This is
// deliberately not the catalog price's behaviour (#238 rolls a headline price up from the lowest
// variant child), because a price is a property of the stamp while a copy is a thing on the table.
//
// Nothing is stored and nothing is converted: a cost basis is frozen in the base currency when its
// lot closes, so the figures are already in one currency and the next read reflects the next lot to
// close.

/** What was paid at one `condition × certificate × format` key, with the labels and sort orders the
 * Valuation dialog's grid is laid out on — the same shape `StampMarketValue` carries, so the two
 * sections line up column for column. */
export interface StampPurchaseCost extends PurchaseCostCell {
  conditionName: string;
  conditionAbbreviation: string;
  conditionSortOrder: number;
  certificateStatusName: string | null;
  certificateStatusAbbreviation: string | null;
  certificateSortOrder: number;
  formatName: string | null;
  formatAbbreviation: string | null;
  formatSortOrder: number;
  /** Every figure on this cell is in this currency. */
  baseCurrency: string;
}

/** The whole answer for one stamp: the cells, plus the copies the whole section is over. The totals
 * are said once above the grid rather than summed from it — a reader asking "how many of these do I
 * have priced" should not have to add up a matrix. */
export interface StampPurchaseCosts {
  baseCurrency: string;
  cells: StampPurchaseCost[];
  /** Held, unsold copies of this stamp with a frozen cost basis. */
  knownCount: number;
  /** …sitting in a still-open purchase lot, so their share of the pool is not final. */
  pendingCount: number;
  /** …with no cost recorded at all: hand-added, or dropped from a closed lot. */
  noneCount: number;
}

const EMPTY: Omit<StampPurchaseCosts, "baseCurrency"> = {
  cells: [],
  knownCount: 0,
  pendingCount: 0,
  noneCount: 0,
};

/**
 * What this stamp's held copies cost, per key (#560).
 *
 * Owner-checked through the stamp's own collection, exactly as `getStampMarketValueByStamp` is: the
 * Valuation dialog opens off a row's `⋮` menu holding a stamp id and nothing else.
 */
export async function getStampPurchaseCosts(
  ownerId: string,
  stampId: string
): Promise<StampPurchaseCosts> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: stampId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!stamp || stamp.collection.ownerId !== ownerId) throw new Error("Stamp not found");

  const baseCurrency = await getCollectionBaseCurrency(stamp.collectionId);

  const items = await prisma.item.findMany({
    where: {
      collectionId: stamp.collectionId,
      // That stamp exactly — no rollup from variant children (#348's rule for copies).
      stampId,
      // Held and unsold: the same three guards the copies-held badge narrows by, so the section and
      // the badge can never describe different copies.
      saleLineItems: { none: {} },
      // The fourth guard is the third exit (#644): a copy given to a partner is gone the same way.
      ...NOT_TRADED_AWAY,
      disposedAt: null,
      deliveryState: { notIn: [...UNAVAILABLE_DELIVERY_STATES] },
    },
    select: {
      costBasis: true,
      lotId: true,
      lot: { select: { status: true, purchase: { select: { purchasedAt: true } } } },
      condition: { select: { id: true, name: true, abbreviation: true, sortOrder: true } },
      certificateStatus: { select: { id: true, name: true, abbreviation: true, sortOrder: true } },
      format: { select: { id: true, name: true, abbreviation: true, sortOrder: true } },
    },
  });
  if (items.length === 0) return { baseCurrency, ...EMPTY };

  // What a key is *called* and where it sorts, read off any copy carrying it — every copy with the
  // same key resolves identically, the way `readStampMarketValues` reads its labels off any line.
  type Labels = Pick<
    StampPurchaseCost,
    | "conditionName"
    | "conditionAbbreviation"
    | "conditionSortOrder"
    | "certificateStatusName"
    | "certificateStatusAbbreviation"
    | "certificateSortOrder"
    | "formatName"
    | "formatAbbreviation"
    | "formatSortOrder"
  >;
  const labels = new Map<string, Labels>();

  const inputs = items.map<PurchaseCostInput>((item) => {
    const key = `${item.condition.id}~${item.certificateStatus?.id ?? ""}~${item.format?.id ?? ""}`;
    if (!labels.has(key)) {
      labels.set(key, {
        conditionName: item.condition.name,
        conditionAbbreviation: item.condition.abbreviation,
        conditionSortOrder: item.condition.sortOrder,
        certificateStatusName: item.certificateStatus?.name ?? null,
        certificateStatusAbbreviation: item.certificateStatus?.abbreviation ?? null,
        // A null certificate is "none" and a null format is the single: both are the unmarked
        // default, and both lead — the convention the whole dialog's columns are ordered by.
        certificateSortOrder: item.certificateStatus?.sortOrder ?? -1,
        formatName: item.format?.name ?? null,
        formatAbbreviation: item.format?.abbreviation ?? null,
        formatSortOrder: item.format?.sortOrder ?? -1,
      });
    }
    return {
      conditionId: item.condition.id,
      certificateStatusId: item.certificateStatus?.id ?? null,
      formatId: item.format?.id ?? null,
      costBasis: item.costBasis?.toString() ?? null,
      lotId: item.lotId,
      lotStatus: item.lot?.status ?? null,
      purchasedAt: item.lot?.purchase?.purchasedAt ?? null,
    };
  });

  const cells = aggregatePurchaseCostsByKey(inputs)
    .map<StampPurchaseCost>((cell) => ({
      ...cell,
      ...labels.get(
        `${cell.conditionId}~${cell.certificateStatusId ?? ""}~${cell.formatId ?? ""}`
      )!,
      baseCurrency,
    }))
    .sort(
      (a, b) =>
        a.conditionSortOrder - b.conditionSortOrder ||
        a.certificateSortOrder - b.certificateSortOrder ||
        a.formatSortOrder - b.formatSortOrder
    );

  return {
    baseCurrency,
    cells,
    knownCount: cells.reduce((n, cell) => n + cell.knownCount, 0),
    pendingCount: cells.reduce((n, cell) => n + cell.pendingCount, 0),
    noneCount: cells.reduce((n, cell) => n + cell.noneCount, 0),
  };
}
