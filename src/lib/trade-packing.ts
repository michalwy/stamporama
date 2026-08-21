import "server-only";
import { prisma } from "./db";
import { listItemsPaginated } from "./items";
import type { PackingCopy, PackingLine } from "./packing-list";
import { readTradeBalance } from "./trade-valuation";
import {
  canRecordTradeRealisation,
  readTradeFulfillment,
  tradeFulfillmentLabel,
  tradeRealisationClosedMessage,
  tradeShareFulfillmentLabel,
} from "./trade-realisation-rules";
import { isTradeStatus, type TradeStatus } from "./trade-rules";

// **The give side as paper** (#643) — the read behind the trade's two printouts, and nothing else.
//
// Two sheets come off it and they are the same list: a **packing checklist** the collector walks the
// shelves with, and the **parcel enclosure** that goes in the envelope for the partner. The shaping
// is the sale's own `buildPackingList` (#330), widened for this; what is here is only how to get a
// trade's give side into the projection that function takes.
//
// **The whole side at once, and no paging.** `listTradeLinePage` is the trade screen's read and is
// paged, filtered and grouped for a screen — a printout is none of those things, and printing
// whatever happened to be loaded is the failure `TRADE_SHARE_SIDE_LIMIT` exists to avoid on the
// partner's page. A trade's give side is bounded by the parcel it fits in, so it is read whole.
//
// **The figures are the balance engine's**, read through `readTradeBalance` exactly as the partner's
// page reads them, so a number the partner is posted and the same number on the collector's screen
// cannot come from two different calculations. Which of the two valuations is printed follows the same
// rule as there: the agreed catalogue when the trade names one, the collector's own when it does not.
// They are never merged (ADR-0039 §7).

/** How each of the two sheets words a verdict. The checklist is the collector's own, so it says *I
 *  withdrew it*; the enclosure is read from the far end of the post, so it says the neutral
 *  *Withdrawn* — the partner page's rule (#642), and it holds on paper for the same reason. */
export type TradePackingVoice = "own" | "partner";

/** What the printed figures are, and where they came from. Null when the sheet prints none. */
export interface TradePackingValuation {
  /** The agreed catalogue, or the collector's own valuation where the trade names none. */
  kind: "agreed" | "own";
  currency: string;
  /** The book both sides named, stated once for the whole sheet rather than on every line. */
  catalogName: string | null;
  /** The figures are the ones both sides shook hands on, not today's. */
  frozen: boolean;
}

export interface TradePackingRead {
  copies: PackingCopy[];
  /** Lines whose copy could not be enriched — a give line whose `itemId` no longer resolves. Told on
   *  the sheet rather than silently dropped: a printed list one line short is a parcel one stamp
   *  short. */
  unresolved: number;
  /** Whether a verdict may be recorded right now — `agreed`, and nothing else (#642). */
  recordable: boolean;
  /** Said in place of the controls when it may not be, so a collector who cannot tick is told why. */
  closedMessage: string | null;
  valuation: TradePackingValuation | null;
}

/**
 * Read a trade's give side as printable copies.
 *
 * `withValues` is the caller's, not this module's: the checklist prints no figures at all, and the
 * enclosure prints them only under the partner link's own `showValues` (#640) — a decision about what
 * this collector shows their partner, taken in one place and honoured on paper too. Asking for none
 * skips the balance read entirely, which is the expensive half.
 */
export async function readTradePackingList(
  ownerId: string,
  tradeId: string,
  options: { withValues: boolean; voice: TradePackingVoice }
): Promise<TradePackingRead | null> {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: {
      collectionId: true,
      status: true,
      collection: { select: { ownerId: true } },
      // Section order is the **trade's own** (`position`), because on the enclosure the sections are
      // the headings and their order is a term of the agreement, not a collation.
      lines: {
        where: { side: "give", itemId: { not: null } },
        orderBy: [
          { section: { position: "asc" } },
          { section: { name: "asc" } },
          { position: "asc" },
          { createdAt: "asc" },
        ],
        select: {
          id: true,
          itemId: true,
          fulfillment: true,
          fulfillmentNote: true,
          section: { select: { name: true } },
        },
      },
    },
  });
  if (!trade || trade.collection.ownerId !== ownerId) return null;

  const status: TradeStatus = isTradeStatus(trade.status) ? trade.status : "preparing";
  const recordable = canRecordTradeRealisation(status);
  const itemIds = trade.lines.map((l) => l.itemId!).filter(Boolean);

  // The copies are enriched by the Copies list's own pass, exactly as a sale's packing list enriches
  // its own — the sheet prints photos, catalogue numbers, areas and locations, and a second query
  // shaping them here would be a second answer to "what is this copy".
  const [{ items }, balance] = await Promise.all([
    itemIds.length === 0
      ? Promise.resolve({ items: [] })
      : listItemsPaginated(ownerId, trade.collectionId, { ids: itemIds, pageSize: itemIds.length }),
    options.withValues ? readTradeBalance(ownerId, tradeId) : Promise.resolve(null),
  ]);
  const byId = new Map(items.map((item) => [item.id, item]));

  const kind: "agreed" | "own" = balance?.agreedCatalogVendorId ? "agreed" : "own";
  const currency = balance ? (kind === "agreed" ? balance.tradeCurrency : balance.baseCurrency) : "";
  const values = new Map(
    (balance?.lines ?? []).map((line) => [
      line.lineId,
      {
        amount: kind === "agreed" ? line.agreed : line.own,
        // In the agreed valuation the header names the book for every line, so the only attribution
        // worth the space is the line that was deliberately read somewhere else — the partner page's
        // judgement, and paper has even less room to spend than a screen.
        attribution:
          kind === "agreed"
            ? line.catalogVendorName
            : catalogAttribution(line.ownCatalogName, line.ownEditionYear),
        uncertain: kind === "agreed" ? line.agreedUncertain : line.ownUncertain,
        manual: kind === "agreed" ? line.agreedManual : line.ownManual,
      },
    ])
  );

  const copies: PackingCopy[] = [];
  let unresolved = 0;
  for (const row of trade.lines) {
    const item = row.itemId ? byId.get(row.itemId) : null;
    if (!item) {
      unresolved += 1;
      continue;
    }
    const fulfillment = readTradeFulfillment(row.fulfillment);
    const read = values.get(row.id);
    const line: PackingLine = {
      id: row.id,
      group: row.section.name,
      verdict: fulfillment,
      verdictLabel:
        options.voice === "partner"
          ? tradeShareFulfillmentLabel(fulfillment)
          : verdictWord(fulfillment),
      note: row.fulfillmentNote,
      value:
        read && read.amount !== null
          ? {
              amount: read.amount,
              currency,
              attribution: read.attribution,
              uncertain: read.uncertain,
              manual: read.manual,
            }
          : null,
    };
    copies.push({
      ...item,
      // **The tick is the verdict** (#642). No second packed flag like the sale's (#192): the box on
      // this sheet says *this one went in the envelope*, which is exactly what `fulfilled` means, and
      // a parallel flag would be a second record of one fact for the two to disagree about.
      packed: fulfillment === "fulfilled",
      line,
    });
  }

  return {
    copies,
    unresolved,
    recordable,
    closedMessage: recordable ? null : tradeRealisationClosedMessage(status),
    valuation: balance
      ? {
          kind,
          currency,
          catalogName: kind === "agreed" ? balance.agreedCatalogVendorName : null,
          frozen: balance.frozen,
        }
      : null,
  };
}

/** The collector's own word for a verdict, or null where the ordinary outcome has nothing to say.
 *  `fulfilled` prints nothing: the ticked box already says it, and a column repeating it on every row
 *  of a packed parcel is a column nobody reads. */
function verdictWord(fulfillment: ReturnType<typeof readTradeFulfillment>): string | null {
  if (fulfillment === "pending" || fulfillment === "fulfilled") return null;
  return tradeFulfillmentLabel(fulfillment, "give");
}

/** `Fischer 2024` — the book and the edition it was read at, which is what makes a column of figures
 *  out of several catalogues readable at all. */
function catalogAttribution(name: string | null, year: number | null): string | null {
  if (!name) return null;
  return year ? `${name} ${year}` : name;
}
