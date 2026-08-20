import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { assertContentEditable, assertTradeOwner } from "./trade-access";
import { valuateItemRows, type ValuationRow } from "./item-valuation";
import type { CopyValuation } from "./valuation";
import { buildVendorCatalogMap, getCollectionBaseCurrency } from "./pricing";
import { getOrFetchRate } from "./exchange-rates";
import { readCollectionAreas } from "./areas";
import { loadIssuePrefixMap } from "./issue-prefix";
import { isUnknownVariantStamp } from "./variant-classification";
import {
  LABEL_STAMP_SELECT,
  makeTradeLineLabeller,
} from "./trade-line-label";
import {
  judgeTradeBalance,
  summariseTradeSide,
  tradeGateBlockers,
  TRADE_VALUATION_KINDS,
  type TradeBalanceVerdict,
  type TradeGateBlocker,
  type TradeLineValue,
  type TradeSideTotals,
  type TradeValuationKind,
} from "./trade-balance";
import {
  isTradeContentEditable,
  isTradeSide,
  resolveBalanceRule,
  TRADE_STATUS_LABEL,
  type TradeBalanceRule,
  type TradeStatus,
} from "./trade-rules";

// **What a trade is worth, on both sides, in both valuations** (#638; ADR-0039 §7). The database
// half of the balancing engine, beside `trades.ts` and `trade-lines.ts`; the arithmetic it feeds is
// the pure `trade-balance.ts`, and the catalogue rule it reads is `valuateItemRows` — the very same
// one the copies list is priced by.
//
// **Own valuation is `valuateItemRows` with no override of any kind.** Not a policy this module
// restates but the identical call, because the figure the trade screen quotes for a stamp has to be
// the figure every other screen quotes for it. A trade that valued its copies its own way would be
// describing a different collection.
//
// **Agreed valuation is the same call against a different book.** The trade names a *vendor*, and
// which volume a line is read in follows from its stamp's area through `CollectionAreaCatalog`
// (`buildVendorCatalogMap`) — so a trade spanning Poland and Germany reads Fischer for one and
// Michel for the other while both sides only ever agreed on "we go by Michel". A line may name a
// vendor of its own as a rescue, which is one more map and one more pass, never a second rule.
//
// **Three regimes, and which one is in force is the trade's status**, never a flag:
//
//   - `preparing` — live catalogs, live rates. Nothing has left the building.
//   - `shared` — live catalogs, **frozen rates** (`TradeFxRate`, written on the first share and
//     refreshable while the negotiation runs). The list is still being edited, so a figure that
//     moved because a price was corrected is a figure that should move.
//   - `agreed` and after — **frozen everything** (`TradeLineValuation`). The partner is holding a
//     printout, and a catalog edition loaded next week silently rewriting what two people shook
//     hands on is the failure this whole mechanism exists to prevent.
//
// The freeze is **released** the moment the trade returns to a status whose list can be edited. One
// rule, stated once: what is editable is not frozen.

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────

/** One line's figures as the screen and the value dialog read them: the pure engine's input, plus
 *  where each figure came from and what the collector has typed over it. */
export interface TradeLineValueRead extends TradeLineValue {
  /** The book the own figure was read in and the edition it was read at — the catalogue's own name,
   *  so a frozen line still says where its number came from after the catalog is renamed. */
  ownCatalogName: string | null;
  ownEditionYear: number | null;
  /** The picked price in the catalog's own currency, before conversion. Both halves are printed
   *  together: a converted figure with no original beside it is one nobody can check. */
  ownAmount: number | null;
  ownCurrency: string | null;
  agreedCatalogName: string | null;
  agreedEditionYear: number | null;
  agreedAmount: number | null;
  agreedCurrency: string | null;
  /** As stored, so the value dialog opens on what is actually on the line rather than on what was
   *  computed from it. */
  manualValue: number | null;
  /** The line's own agreed-catalog vendor, where it overrides the trade's. */
  catalogVendorId: string | null;
  catalogVendorName: string | null;
}

/** One section's rule and verdict. */
export interface TradeSectionBalance {
  sectionId: string;
  name: string;
  rule: TradeBalanceRule & { inherited: boolean };
  verdict: TradeBalanceVerdict;
}

/** A rate this trade's figures are read through, with the day it was taken. */
export interface TradeRateRead {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  fetchedAt: string;
}

export interface TradeBalanceRead {
  tradeId: string;
  /** Carried so the route can check the trade really is in the collection its URL names, exactly as
   *  the trade's own read does — ownership alone does not make a path honest. */
  collectionId: string;
  status: TradeStatus;
  /** The collector's own valuation is in this. */
  baseCurrency: string;
  /** The partner's figures — and so the agreed valuation — are in this. Labelled apart from the
   *  base currency everywhere both appear, or someone will one day add 340 to 78. */
  tradeCurrency: string;
  agreedCatalogVendorId: string | null;
  agreedCatalogVendorName: string | null;
  /** True once the line snapshots are what is being read: the trade is `agreed` or beyond. */
  frozen: boolean;
  frozenAt: string | null;
  /** True from the first share: the rates below are the trade's own, not today's. */
  ratesFrozen: boolean;
  rates: TradeRateRead[];
  sections: TradeSectionBalance[];
  /** The whole trade, judged against the trade's own rule. */
  trade: TradeBalanceVerdict;
  lines: TradeLineValueRead[];
  /** Why this trade cannot be shared or agreed yet, named line by line. Reported on every read
   *  rather than only on the attempt: a refusal a collector meets by pressing the button is a
   *  refusal they meet at the worst possible moment. */
  blockers: TradeGateBlocker[];
}

const LINE_SELECT = {
  id: true,
  sectionId: true,
  side: true,
  quantity: true,
  manualValue: true,
  catalogVendorId: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
  condition: { select: { name: true, abbreviation: true } },
  catalogVendor: { select: { abbreviation: true, name: true } },
  stamp: { select: LABEL_STAMP_SELECT },
  item: {
    select: {
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      condition: { select: { name: true, abbreviation: true } },
      stamp: { select: LABEL_STAMP_SELECT },
    },
  },
  valuations: {
    select: {
      kind: true,
      amount: true,
      currency: true,
      catalogName: true,
      editionYear: true,
      rate: true,
      targetCurrency: true,
      value: true,
      uncertain: true,
      manual: true,
      frozenAt: true,
    },
  },
} satisfies Prisma.TradeLineSelect;

type LineRow = Prisma.TradeLineGetPayload<{ select: typeof LINE_SELECT }>;

/** The valuation key a line is priced on: the copy's for a give line, the want key for a receive
 *  one. Null when the row is malformed — a give line whose copy has gone, which the `Restrict` on
 *  `TradeLine.itemId` makes impossible but which a read must not crash on. */
function valuationKeyOf(row: LineRow): ValuationRow | null {
  const source = row.item ?? row;
  if (!source.stampId || !source.conditionId) return null;
  const stamp = row.item?.stamp ?? row.stamp;
  return {
    id: row.id,
    stampId: source.stampId,
    conditionId: source.conditionId,
    certificateStatusId: source.certificateStatusId,
    formatId: source.formatId,
    unknownVariant: stamp ? isUnknownVariantStamp(stamp) : false,
  };
}

/**
 * The rates one read is carried out at.
 *
 * `preparing` asks the collection's ordinary rate cache, exactly as every other valuation in the app
 * does. From `shared` on it asks the trade's own frozen rows and **never falls back to a live
 * fetch**: a rate that quietly refreshed itself would be the one thing freezing was for. A pair with
 * no row yields null, and the figure that needed it is absent rather than approximated.
 */
interface TradeRates {
  frozen: boolean;
  rows: TradeRateRead[];
  convert(amount: number, from: string, to: string): number | null;
}

function makeTradeRates(frozen: boolean, rows: TradeRateRead[]): TradeRates {
  const byPair = new Map(rows.map((r) => [`${r.fromCurrency}>${r.toCurrency}`, r.rate]));
  return {
    frozen,
    rows,
    convert(amount, from, to) {
      if (from === to) return round2(amount);
      const rate = byPair.get(`${from}>${to}`);
      return rate === undefined ? null : round2(amount * rate);
    },
  };
}

/** Every conversion this trade needs: each catalog currency to the base (for the own valuation) and
 *  to the trade's (for the agreed one), plus base → trade currency, which is what carries a manual
 *  figure — typed in the base currency — into the agreed column. */
function ratePairsFor(
  currencies: Iterable<string>,
  baseCurrency: string,
  tradeCurrency: string
): { from: string; to: string }[] {
  const pairs = new Map<string, { from: string; to: string }>();
  const add = (from: string, to: string) => {
    if (!from || !to || from === to) return;
    pairs.set(`${from}>${to}`, { from, to });
  };
  for (const c of currencies) {
    add(c, baseCurrency);
    add(c, tradeCurrency);
  }
  add(baseCurrency, tradeCurrency);
  return [...pairs.values()];
}

/** Fetch the pairs live, one failure never sinking the rest — `safeRateMap`'s rule, at two
 *  targets. */
async function fetchRates(
  collectionId: string,
  pairs: { from: string; to: string }[]
): Promise<TradeRateRead[]> {
  const rows: TradeRateRead[] = [];
  for (const pair of pairs) {
    try {
      const result = await getOrFetchRate(collectionId, pair.from, pair.to);
      rows.push({
        fromCurrency: pair.from,
        toCurrency: pair.to,
        rate: result.rate,
        fetchedAt: result.fetchedAt.toISOString(),
      });
    } catch {
      // Nothing recorded: the figure that needed this pair is reported absent rather than guessed.
    }
  }
  return rows;
}

async function readFrozenRates(tradeId: string): Promise<TradeRateRead[]> {
  const rows = await prisma.tradeFxRate.findMany({
    where: { tradeId },
    select: { fromCurrency: true, toCurrency: true, rate: true, fetchedAt: true },
    orderBy: [{ fromCurrency: "asc" }, { toCurrency: "asc" }],
  });
  return rows.map((r) => ({
    fromCurrency: r.fromCurrency,
    toCurrency: r.toCurrency,
    rate: Number(r.rate),
    fetchedAt: r.fetchedAt.toISOString(),
  }));
}

/** The catalogue figures for one trade's lines, in both valuations, before any conversion.
 *
 * One batched `valuateItemRows` for the own side; one more per distinct agreed vendor, which is the
 * trade's own plus however many lines named a rescue — in practice one or two. */
async function computeCatalogFigures(
  collectionId: string,
  rows: LineRow[],
  agreedVendorId: string | null
) {
  const keys = new Map<string, ValuationRow>();
  for (const row of rows) {
    const key = valuationKeyOf(row);
    if (key) keys.set(row.id, key);
  }
  const own = await valuateItemRows(collectionId, [...keys.values()]);

  const agreed = new Map<string, CopyValuation>();
  if (agreedVendorId) {
    // Grouped by the vendor actually in force for each line, so a per-line rescue costs one extra
    // pass rather than one pass per line.
    const byVendor = new Map<string, ValuationRow[]>();
    for (const row of rows) {
      const key = keys.get(row.id);
      if (!key) continue;
      const vendorId = row.catalogVendorId ?? agreedVendorId;
      const bucket = byVendor.get(vendorId);
      if (bucket) bucket.push(key);
      else byVendor.set(vendorId, [key]);
    }
    for (const [vendorId, vendorRows] of byVendor) {
      const catalogNameByArea = await buildVendorCatalogMap(collectionId, vendorId);
      const valued = await valuateItemRows(collectionId, vendorRows, { catalogNameByArea });
      for (const [id, valuation] of valued) agreed.set(id, valuation);
    }
  }

  return { own, agreed };
}

type CatalogFigures = Awaited<ReturnType<typeof computeCatalogFigures>>;

/** Which currencies this trade's catalogue figures are printed in — read off the figures rather
 *  than guessed at, or the trade would either fetch rates nobody needs or miss the one line that
 *  needed one. Base and trade currency are always in, since a manual figure is carried between
 *  them. */
function currenciesIn(figures: CatalogFigures, baseCurrency: string, tradeCurrency: string): string[] {
  const currencies = new Set<string>([baseCurrency, tradeCurrency]);
  for (const v of figures.own.values()) if (v.currency) currencies.add(v.currency);
  for (const v of figures.agreed.values()) if (v.currency) currencies.add(v.currency);
  return [...currencies];
}

/** Catalog name ids → the names they read by, for the freeze and for the screen. */
async function readCatalogNames(ids: Iterable<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set([...ids].filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map();
  const rows = await prisma.catalogName.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** The trade's lines with both figures resolved live, from the catalogs as they stand now. */
async function valueLinesLive(
  rows: LineRow[],
  figures: CatalogFigures,
  agreedVendorId: string | null,
  baseCurrency: string,
  tradeCurrency: string,
  label: (row: LineRow) => string,
  rates: TradeRates
): Promise<TradeLineValueRead[]> {
  const { own, agreed } = figures;
  const names = await readCatalogNames([
    ...[...own.values()].map((v) => v.catalogNameId),
    ...[...agreed.values()].map((v) => v.catalogNameId),
  ]);

  return rows.map((row) => {
    const ownPick = own.get(row.id) ?? null;
    const agreedPick = agreed.get(row.id) ?? null;
    // The collector's own figure wins over both catalogs, and is marked as theirs in both — the
    // point of the escape hatch is that material no catalog prices cannot deadlock a trade, and the
    // point of the mark is that a typed number never reads as a published price.
    const manual = row.manualValue === null ? null : Number(row.manualValue);
    const ownAmount = ownPick?.amount === null || ownPick === null ? null : Number(ownPick.amount);
    const agreedAmount =
      agreedPick?.amount === null || agreedPick === null ? null : Number(agreedPick.amount);

    const ownValue =
      manual !== null
        ? round2(manual)
        : ownAmount !== null && ownPick?.currency
          ? rates.convert(ownAmount, ownPick.currency, baseCurrency)
          : null;
    const agreedValue = !agreedVendorId
      ? null
      : manual !== null
        ? rates.convert(manual, baseCurrency, tradeCurrency)
        : agreedAmount !== null && agreedPick?.currency
          ? rates.convert(agreedAmount, agreedPick.currency, tradeCurrency)
          : null;

    return {
      lineId: row.id,
      sectionId: row.sectionId,
      side: isTradeSide(row.side) ? row.side : "give",
      quantity: row.quantity,
      label: label(row),
      own: ownValue,
      ownUncertain: manual === null && (ownPick?.uncertain ?? false),
      ownManual: manual !== null,
      ownCatalogName: manual !== null ? null : (names.get(ownPick?.catalogNameId ?? "") ?? null),
      ownEditionYear: manual !== null ? null : (ownPick?.editionYear ?? null),
      ownAmount: manual !== null ? null : ownAmount,
      ownCurrency: manual !== null ? null : (ownPick?.currency ?? null),
      agreed: agreedValue,
      agreedUncertain: manual === null && (agreedPick?.uncertain ?? false),
      agreedManual: manual !== null,
      agreedCatalogName: manual !== null ? null : (names.get(agreedPick?.catalogNameId ?? "") ?? null),
      agreedEditionYear: manual !== null ? null : (agreedPick?.editionYear ?? null),
      agreedAmount: manual !== null ? null : agreedAmount,
      agreedCurrency: manual !== null ? null : (agreedPick?.currency ?? null),
      manualValue: manual,
      catalogVendorId: row.catalogVendorId,
      catalogVendorName: row.catalogVendor?.abbreviation ?? row.catalogVendor?.name ?? null,
    } satisfies TradeLineValueRead;
  });
}

/** The trade's lines as they were frozen. Nothing is recomputed and nothing is looked up: what is
 *  read here is exactly what was written on the day both sides committed. */
function valueLinesFrozen(rows: LineRow[], label: (row: LineRow) => string): TradeLineValueRead[] {
  return rows.map((row) => {
    const byKind = new Map(row.valuations.map((v) => [v.kind, v]));
    const own = byKind.get("own") ?? null;
    const agreed = byKind.get("agreed") ?? null;
    return {
      lineId: row.id,
      sectionId: row.sectionId,
      side: isTradeSide(row.side) ? row.side : "give",
      quantity: row.quantity,
      label: label(row),
      own: own?.value === null || own === null ? null : Number(own.value),
      ownUncertain: own?.uncertain ?? false,
      ownManual: own?.manual ?? false,
      ownCatalogName: own?.catalogName ?? null,
      ownEditionYear: own?.editionYear ?? null,
      ownAmount: own?.amount === null || own === null ? null : Number(own.amount),
      ownCurrency: own?.currency ?? null,
      agreed: agreed?.value === null || agreed === null ? null : Number(agreed.value),
      agreedUncertain: agreed?.uncertain ?? false,
      agreedManual: agreed?.manual ?? false,
      agreedCatalogName: agreed?.catalogName ?? null,
      agreedEditionYear: agreed?.editionYear ?? null,
      agreedAmount: agreed?.amount === null || agreed === null ? null : Number(agreed.amount),
      agreedCurrency: agreed?.currency ?? null,
      manualValue: row.manualValue === null ? null : Number(row.manualValue),
      catalogVendorId: row.catalogVendorId,
      catalogVendorName: row.catalogVendor?.abbreviation ?? row.catalogVendor?.name ?? null,
    } satisfies TradeLineValueRead;
  });
}

/** Everything one read needs about a trade, loaded once. */
async function loadTradeForBalance(tradeId: string) {
  return prisma.trade.findUnique({
    where: { id: tradeId },
    select: {
      id: true,
      collectionId: true,
      status: true,
      currency: true,
      catalogVendorId: true,
      balanceByValue: true,
      countTolerance: true,
      valueTolerancePct: true,
      ownValueWarnPct: true,
      catalogVendor: { select: { name: true, abbreviation: true } },
      sections: {
        select: {
          id: true,
          name: true,
          position: true,
          balanceByValue: true,
          countTolerance: true,
          valueTolerancePct: true,
          ownValueWarnPct: true,
        },
        orderBy: [{ position: "asc" }, { name: "asc" }],
      },
      lines: { select: LINE_SELECT, orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
    },
  });
}

type TradeForBalance = NonNullable<Awaited<ReturnType<typeof loadTradeForBalance>>>;

function tradeRule(trade: TradeForBalance): TradeBalanceRule {
  return {
    balanceByValue: trade.balanceByValue,
    countTolerance: trade.countTolerance,
    valueTolerancePct: Number(trade.valueTolerancePct),
    ownValueWarnPct: Number(trade.ownValueWarnPct),
  };
}

/** The sections whose **resolved** rule balances by value — the only lines the agreed-valuation gate
 *  applies to. A trade balanced on pieces whose sections all inherit yields an empty set, and the
 *  gate is then empty by construction rather than by a special case. */
function valueBalancedSectionIds(trade: TradeForBalance): Set<string> {
  const base = tradeRule(trade);
  const ids = new Set<string>();
  for (const section of trade.sections) {
    if (resolveBalanceRule(base, section2override(section)).balanceByValue) ids.add(section.id);
  }
  return ids;
}

function section2override(section: TradeForBalance["sections"][number]) {
  return {
    balanceByValue: section.balanceByValue,
    countTolerance: section.countTolerance,
    valueTolerancePct: section.valueTolerancePct === null ? null : Number(section.valueTolerancePct),
    ownValueWarnPct: section.ownValueWarnPct === null ? null : Number(section.ownValueWarnPct),
  };
}

/** The figures for one trade, in whichever regime its status puts it. Shared by the read, the gate
 *  and the freeze, so no two of them can come to disagree about what a line is worth. */
async function valueTrade(trade: TradeForBalance): Promise<{
  lines: TradeLineValueRead[];
  rates: TradeRates;
  baseCurrency: string;
  frozen: boolean;
}> {
  const [baseCurrency, areas, issuePrefixes] = await Promise.all([
    getCollectionBaseCurrency(trade.collectionId),
    // Named the way every other stamp surface names them, so a refusal and the row it is about
    // print the same catalogue number the same way.
    readCollectionAreas(trade.collectionId),
    loadIssuePrefixMap(trade.collectionId),
  ]);
  const label = makeTradeLineLabeller(areas, issuePrefixes);
  const status = trade.status as TradeStatus;
  const editable = isTradeContentEditable(status);
  const hasSnapshot = trade.lines.some((l) => l.valuations.length > 0);

  // Frozen only when there is something frozen to read. A trade agreed before this shipped, or one
  // whose lines were all removed, falls back to a live read rather than reporting every figure as
  // absent — an empty snapshot is missing data, not an answer.
  if (!editable && hasSnapshot) {
    return {
      lines: valueLinesFrozen(trade.lines, label),
      rates: makeTradeRates(true, await readFrozenRates(trade.id)),
      baseCurrency,
      frozen: true,
    };
  }

  // The catalogues are read **once** and the rates derived from what they printed — which currencies
  // a trade needs is a question only the figures can answer, and valuing everything twice to ask it
  // would double the cost of the screen's heaviest read.
  const figures = await computeCatalogFigures(trade.collectionId, trade.lines, trade.catalogVendorId);

  // From the first share the trade reads its own rates and never a live one; before it, the
  // collection's ordinary cache, exactly as every other valuation in the app.
  const rates =
    status === "preparing"
      ? makeTradeRates(
          false,
          await fetchRates(
            trade.collectionId,
            ratePairsFor(
              currenciesIn(figures, baseCurrency, trade.currency),
              baseCurrency,
              trade.currency
            )
          )
        )
      : makeTradeRates(true, await readFrozenRates(trade.id));

  return {
    lines: await valueLinesLive(
      trade.lines,
      figures,
      trade.catalogVendorId,
      baseCurrency,
      trade.currency,
      label,
      rates
    ),
    rates,
    baseCurrency,
    frozen: false,
  };
}

/**
 * The whole balancing read for one trade: both valuations, per section and for the trade, with the
 * verdicts and the gate's blockers.
 *
 * One endpoint for the screen, not one per section: the two sides are judged against each other and
 * the whole-trade totals are summed from the sections', so a screen assembling them from several
 * reads could show a section balanced and the trade not, out of two different moments.
 */
export async function readTradeBalance(
  ownerId: string,
  tradeId: string
): Promise<TradeBalanceRead | null> {
  await assertTradeOwner(ownerId, tradeId);
  const trade = await loadTradeForBalance(tradeId);
  if (!trade) return null;

  const { lines, rates, baseCurrency, frozen } = await valueTrade(trade);
  const base = tradeRule(trade);
  const byLineSection = new Map<string, TradeLineValueRead[]>();
  for (const line of lines) {
    const bucket = byLineSection.get(line.sectionId);
    if (bucket) bucket.push(line);
    else byLineSection.set(line.sectionId, [line]);
  }

  const sections: TradeSectionBalance[] = trade.sections.map((section) => {
    const own = byLineSection.get(section.id) ?? [];
    const rule = resolveBalanceRule(base, section2override(section));
    return {
      sectionId: section.id,
      name: section.name,
      rule,
      verdict: judgeTradeBalance(rule, sideTotals(own, "give"), sideTotals(own, "receive")),
    };
  });

  const frozenAt = frozen
    ? (trade.lines.flatMap((l) => l.valuations.map((v) => v.frozenAt)).sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString() ?? null)
    : null;

  return {
    tradeId: trade.id,
    collectionId: trade.collectionId,
    status: trade.status as TradeStatus,
    baseCurrency,
    tradeCurrency: trade.currency,
    agreedCatalogVendorId: trade.catalogVendorId,
    agreedCatalogVendorName: trade.catalogVendor?.name ?? null,
    frozen,
    frozenAt,
    ratesFrozen: rates.frozen,
    rates: rates.rows,
    sections,
    // Judged against the **trade's** own rule, never a section's — the whole-trade verdict is the
    // one the two collectors struck, and a section stating its own says nothing about the total.
    trade: judgeTradeBalance(base, sideTotals(lines, "give"), sideTotals(lines, "receive")),
    lines,
    blockers: tradeGateBlockers(lines, valueBalancedSectionIds(trade), trade.catalogVendorId !== null),
  };
}

function sideTotals(lines: readonly TradeLineValueRead[], side: "give" | "receive"): TradeSideTotals {
  return summariseTradeSide(lines.filter((l) => l.side === side));
}

// ── The gate ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Why this trade may not move on, or an empty list.
 *
 * Re-run on **every** attempt rather than stamped once: a line added while the trade was `shared`
 * must not slip through into `agreed` on the strength of a check that passed a week ago. Cheap
 * enough to mean it — the figures are computed for the screen on every read anyway.
 */
export async function readTradeGateBlockers(tradeId: string): Promise<TradeGateBlocker[]> {
  const trade = await loadTradeForBalance(tradeId);
  if (!trade) return [];
  const { lines } = await valueTrade(trade);
  return tradeGateBlockers(lines, valueBalancedSectionIds(trade), trade.catalogVendorId !== null);
}

// ── Freezing ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Write the rate rows this trade will be read through from now on — the first share.
 *
 * Idempotent and **additive**: pairs already frozen are left exactly as they are, and only the ones
 * this trade has come to need since (a line added in a currency nothing else on the trade was priced
 * in) are fetched. A refresh is the deliberate act (`refreshTradeRates`), not a side effect of
 * adding a line.
 */
export async function freezeTradeRates(tradeId: string): Promise<void> {
  const trade = await loadTradeForBalance(tradeId);
  if (!trade) return;
  const baseCurrency = await getCollectionBaseCurrency(trade.collectionId);
  const figures = await computeCatalogFigures(
    trade.collectionId,
    trade.lines,
    trade.catalogVendorId
  );
  const wanted = ratePairsFor(
    currenciesIn(figures, baseCurrency, trade.currency),
    baseCurrency,
    trade.currency
  );
  const existing = new Set(
    (await readFrozenRates(tradeId)).map((r) => `${r.fromCurrency}>${r.toCurrency}`)
  );
  const missing = wanted.filter((p) => !existing.has(`${p.from}>${p.to}`));
  if (missing.length === 0) return;
  const fetched = await fetchRates(trade.collectionId, missing);
  if (fetched.length === 0) return;
  await prisma.tradeFxRate.createMany({
    data: fetched.map((r) => ({
      tradeId,
      fromCurrency: r.fromCurrency,
      toCurrency: r.toCurrency,
      rate: new Prisma.Decimal(r.rate),
      fetchedAt: new Date(r.fetchedAt),
    })),
    skipDuplicates: true,
  });
}

/**
 * Take today's rates for a trade still being negotiated.
 *
 * Only while `shared`. `preparing` has nothing frozen to refresh — it already reads live — and
 * `agreed` is where refreshing would silently restate a total the partner has a printout of, which
 * is refused **by name** rather than ignored.
 */
export async function refreshTradeRates(ownerId: string, tradeId: string): Promise<void> {
  const { status } = await assertTradeOwner(ownerId, tradeId);
  if (status !== "shared") {
    throw new Error(
      status === "preparing"
        ? "A trade being prepared already reads today's rates — they are frozen when you share it."
        : `A ${TRADE_STATUS_LABEL[status].toLowerCase()} trade's rates are frozen: both sides agreed under them.`
    );
  }
  await prisma.tradeFxRate.deleteMany({ where: { tradeId } });
  await freezeTradeRates(tradeId);
}

/**
 * Snapshot both valuations onto every line — the move to `agreed`.
 *
 * Without it, loading a new catalog edition next week silently rewrites a trade both sides have
 * already shaken hands on, and the partner is holding a printout. Amounts, catalogue names,
 * editions, currencies and the rates they were converted through all go down together, because a
 * figure with no book and no rate behind it is a number nobody can check.
 */
export async function freezeTradeValuations(tradeId: string): Promise<void> {
  const trade = await loadTradeForBalance(tradeId);
  if (!trade) return;
  const { lines, rates, baseCurrency } = await valueTrade(trade);
  const rateOf = (from: string | null, to: string) =>
    from && from !== to
      ? (rates.rows.find((r) => r.fromCurrency === from && r.toCurrency === to)?.rate ?? null)
      : null;

  const data = lines.flatMap((line) =>
    TRADE_VALUATION_KINDS.map((kind: TradeValuationKind) => {
      const own = kind === "own";
      const target = own ? baseCurrency : trade.currency;
      const amount = own ? line.ownAmount : line.agreedAmount;
      const currency = own ? line.ownCurrency : line.agreedCurrency;
      const value = own ? line.own : line.agreed;
      return {
        lineId: line.lineId,
        kind,
        amount: amount === null ? null : new Prisma.Decimal(amount.toFixed(2)),
        currency,
        catalogName: own ? line.ownCatalogName : line.agreedCatalogName,
        editionYear: own ? line.ownEditionYear : line.agreedEditionYear,
        rate: (() => {
          // A manual figure is carried into the agreed column through base → trade currency; a
          // catalogue one through its own catalog's currency. Two different rates, both recorded.
          const from = line.manualValue !== null && !own ? baseCurrency : currency;
          const r = rateOf(from, target);
          return r === null ? null : new Prisma.Decimal(r);
        })(),
        targetCurrency: target,
        value: value === null ? null : new Prisma.Decimal(value.toFixed(2)),
        uncertain: own ? line.ownUncertain : line.agreedUncertain,
        manual: own ? line.ownManual : line.agreedManual,
      };
    })
  );

  await prisma.$transaction([
    prisma.tradeLineValuation.deleteMany({ where: { line: { tradeId } } }),
    ...(data.length > 0
      ? [prisma.tradeLineValuation.createMany({ data, skipDuplicates: true })]
      : []),
  ]);
}

/**
 * Drop the snapshot — the trade has gone back to a status whose list can be edited.
 *
 * One rule, stated once: **what is editable is not frozen.** A snapshot left behind would shadow
 * every edit made after it, and a line added tomorrow would sit beside figures from last week
 * wearing the same label. Re-agreeing writes a fresh one.
 */
export async function releaseTradeValuations(tradeId: string): Promise<void> {
  await prisma.tradeLineValuation.deleteMany({ where: { line: { tradeId } } });
}

// ── Writing a line's own figure ──────────────────────────────────────────────────────────────────

export interface TradeLineValueInput {
  /** The collector's own figure in the collection's base currency, or null to clear it and go back
   *  to the catalogs. */
  manualValue?: number | null;
  /** The vendor this one line is read in instead of the trade's agreed catalog, or null to follow
   *  the trade again. */
  catalogVendorId?: string | null;
}

/**
 * Set a line's manual value and/or its own agreed catalog.
 *
 * Both are edits to what is on the trade, so both are refused once the list is locked — the partner
 * is holding a copy of it, and a figure quietly changed underneath an agreement is exactly what
 * freezing exists to prevent.
 *
 * A negative figure is refused rather than clamped: it is a typo, and silently turning -40 into 40
 * or into 0 would put a number on the trade that nobody typed.
 */
export async function setTradeLineValue(
  ownerId: string,
  lineId: string,
  input: TradeLineValueInput
): Promise<void> {
  const line = await prisma.tradeLine.findUnique({
    where: { id: lineId },
    select: {
      tradeId: true,
      trade: {
        select: { status: true, collectionId: true, collection: { select: { ownerId: true } } },
      },
    },
  });
  if (!line || line.trade.collection.ownerId !== ownerId) {
    throw new Error("Trade line not found or access denied.");
  }
  assertContentEditable(line.trade.status as TradeStatus);

  const data: Prisma.TradeLineUpdateInput = {};
  if (input.manualValue !== undefined) {
    if (input.manualValue === null) {
      data.manualValue = null;
    } else {
      if (!Number.isFinite(input.manualValue) || input.manualValue < 0) {
        throw new Error("A manual value cannot be negative.");
      }
      data.manualValue = new Prisma.Decimal(input.manualValue.toFixed(2));
    }
  }
  if (input.catalogVendorId !== undefined) {
    const id = input.catalogVendorId?.trim() || null;
    if (id) {
      const found = await prisma.catalogVendor.findFirst({
        where: { id, collectionId: line.trade.collectionId },
        select: { id: true },
      });
      if (!found) throw new Error("That catalog publisher is not in this collection.");
      data.catalogVendor = { connect: { id } };
    } else {
      data.catalogVendor = { disconnect: true };
    }
  }
  if (Object.keys(data).length === 0) return;
  await prisma.tradeLine.update({ where: { id: lineId }, data });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
