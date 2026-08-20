import "server-only";
import { prisma } from "./db";
import { assertTradeOwner } from "./trade-access";
import { loadTradeLineLabeller, LABEL_STAMP_SELECT } from "./trade-line-label";
import { isTradeContentEditable, isTradeSide, TRADE_STATUS_LABEL, type TradeSide } from "./trade-rules";
import type { TradeShareAccess } from "./trade-share";
import {
  canLeaveTradeFeedback,
  isTradeFeedbackResolution,
  parseTradeFeedback,
  tradeFeedbackClosedMessage,
  type TradeFeedbackInput,
  type TradeFeedbackResolution,
} from "./trade-feedback-rules";

// **What the partner said back, and what the collector does about it** (#641; ADR-0039 §10). The
// database half; the wording and the gates are the pure `trade-feedback-rules.ts`.
//
// Two halves of one table, and they are asked in two different ways.
//
// **The partner's half takes a `TradeShareAccess` and nothing else.** Same rule as every other read
// the token authorises (`trade-share.ts`): the trade id comes from the token's own row, never from
// the request, so there is no path by which a second trade's line reaches a write. A `lineId` in the
// body is checked against *that* trade before anything is written — an id for a line on somebody
// else's exchange is refused exactly as an invented one is.
//
// **The collector's half takes an owner and asserts it**, like every other domain function here.
//
// **Feedback never edits the list.** Writing a note or striking a line out changes nothing about the
// trade; it puts an item in the collector's inbox. The one act that touches the list is the
// collector *accepting* a rejection, which deletes the line — through the same editability rule
// every other line write obeys, so a locked list stays locked and the collector is told to step the
// trade back rather than having it stepped back for them.

/** One thing the partner has said, as either side reads it. */
export interface TradeFeedbackEntry {
  note: string | null;
  rejected: boolean;
  updatedAt: string;
  /** What the collector did about it, or null while it is still in their inbox. Shown to the partner
   *  too: an answer to *did they see this* that costs nothing and saves an email. */
  resolution: TradeFeedbackResolution | null;
}

// ── The partner's half ──────────────────────────────────────────────────────────────────────────

/** What the partner's page needs to draw its controls: what they already said, and whether this
 *  exchange still takes anything. */
export interface PartnerFeedbackRead {
  canLeave: boolean;
  /** Why not, when it does not. Said on the page rather than leaving a reader hunting for a box. */
  closedMessage: string | null;
  /** The note about the whole exchange, or null. */
  trade: TradeFeedbackEntry | null;
  /** Keyed by line id — the page draws a row at a time. */
  byLine: Record<string, TradeFeedbackEntry>;
}

export async function readPartnerTradeFeedback(
  access: TradeShareAccess
): Promise<PartnerFeedbackRead> {
  const rows = await prisma.tradeFeedback.findMany({
    where: { tradeId: access.tradeId },
    select: { lineId: true, note: true, rejected: true, updatedAt: true, resolution: true },
  });
  const byLine: Record<string, TradeFeedbackEntry> = {};
  let trade: TradeFeedbackEntry | null = null;
  for (const row of rows) {
    const entry = toEntry(row);
    if (row.lineId) byLine[row.lineId] = entry;
    else trade = entry;
  }
  const canLeave = canLeaveTradeFeedback(access.status);
  return {
    canLeave,
    closedMessage: canLeave ? null : tradeFeedbackClosedMessage(access.status),
    trade,
    byLine,
  };
}

/**
 * Write one thing the partner has to say — about a line, or about the whole exchange.
 *
 * **Saying nothing deletes the row.** A partner who unticks the mark and empties the box has
 * withdrawn what they said, and an empty row left behind would sit in the collector's inbox reading
 * as feedback while containing none.
 *
 * **An edit puts a handled item back.** `resolvedAt` and `resolution` are cleared on every write, so
 * a partner who answers again after the collector has dealt with them is heard again — which is what
 * makes *Partner has responded* derivable rather than a flag somebody has to maintain (ADR-0039 §6).
 */
export async function savePartnerTradeFeedback(
  access: TradeShareAccess,
  lineId: string | null,
  input: TradeFeedbackInput
): Promise<TradeFeedbackEntry | null> {
  if (!canLeaveTradeFeedback(access.status)) {
    throw new Error(tradeFeedbackClosedMessage(access.status));
  }

  const parsed = parseTradeFeedback(input, { allowReject: lineId !== null });
  if (!parsed.ok) throw new Error(parsed.message);

  if (lineId) {
    // The one place a reader-supplied id reaches a query, and it is bounded by the token's own trade
    // before it reaches a write.
    const line = await prisma.tradeLine.findFirst({
      where: { id: lineId, tradeId: access.tradeId },
      select: { id: true },
    });
    if (!line) throw new Error("That line is not on this exchange.");
  }

  const value = parsed.value;
  if (!value) {
    await prisma.tradeFeedback.deleteMany({
      where: { tradeId: access.tradeId, lineId: lineId ?? null },
    });
    return null;
  }

  const data = { note: value.note, rejected: value.rejected, resolvedAt: null, resolution: null };

  if (lineId) {
    const row = await prisma.tradeFeedback.upsert({
      where: { lineId },
      create: { tradeId: access.tradeId, lineId, ...data },
      update: data,
      select: { lineId: true, note: true, rejected: true, updatedAt: true, resolution: true },
    });
    return toEntry(row);
  }

  // The whole-trade row is one per trade by a **partial** unique index, which Prisma cannot address
  // in an `upsert` — so it is read and then written. Two saves racing would collide on that index
  // rather than quietly making a second note.
  const existing = await prisma.tradeFeedback.findFirst({
    where: { tradeId: access.tradeId, lineId: null },
    select: { id: true },
  });
  const row = existing
    ? await prisma.tradeFeedback.update({
        where: { id: existing.id },
        data,
        select: { lineId: true, note: true, rejected: true, updatedAt: true, resolution: true },
      })
    : await prisma.tradeFeedback.create({
        data: { tradeId: access.tradeId, lineId: null, ...data },
        select: { lineId: true, note: true, rejected: true, updatedAt: true, resolution: true },
      });
  return toEntry(row);
}

// ── The collector's half ────────────────────────────────────────────────────────────────────────

/** One item in the collector's inbox, carrying enough to read it out of the column it came from. */
export interface TradeFeedbackItem {
  id: string;
  /** Null on the note about the whole exchange. */
  lineId: string | null;
  side: TradeSide | null;
  sectionId: string | null;
  sectionName: string | null;
  /** The line by its catalogue number, the way every other refusal and gate names one — so the item
   *  and the row it is about say the same string. */
  lineLabel: string | null;
  note: string | null;
  rejected: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution: TradeFeedbackResolution | null;
}

export interface TradeFeedbackRead {
  /** Unresolved items. **This is the badge**: *Partner has responded* is derived from feedback
   *  nobody has dealt with yet, never from a status the collector has to keep up to date. */
  open: number;
  /** Open items first, then what has been handled — one list, because the second is the first's
   *  history and a collector reading an item twice should find it where they left it. */
  items: TradeFeedbackItem[];
}

export async function readTradeFeedback(
  ownerId: string,
  tradeId: string
): Promise<TradeFeedbackRead> {
  const { collectionId } = await assertTradeOwner(ownerId, tradeId);

  const rows = await prisma.tradeFeedback.findMany({
    where: { tradeId },
    select: {
      id: true,
      lineId: true,
      note: true,
      rejected: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
      resolution: true,
      line: {
        select: {
          side: true,
          position: true,
          condition: { select: { name: true, abbreviation: true } },
          stamp: { select: LABEL_STAMP_SELECT },
          item: {
            select: {
              condition: { select: { name: true, abbreviation: true } },
              stamp: { select: LABEL_STAMP_SELECT },
            },
          },
          section: { select: { id: true, name: true, position: true } },
        },
      },
    },
  });
  if (rows.length === 0) return { open: 0, items: [] };

  const label = await loadTradeLineLabeller(collectionId);

  const items: TradeFeedbackItem[] = rows.map((row) => ({
    id: row.id,
    lineId: row.lineId,
    side: row.line && isTradeSide(row.line.side) ? row.line.side : null,
    sectionId: row.line?.section.id ?? null,
    sectionName: row.line?.section.name ?? null,
    lineLabel: row.line ? label(row.line) : null,
    note: row.note,
    rejected: row.rejected,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolution: isTradeFeedbackResolution(row.resolution) ? row.resolution : null,
  }));

  // Open first, and the note about the whole exchange ahead of the lines it is about — it is the
  // sentence that frames them. Under that, the order the trade itself is in: section, then side,
  // then where the line sits in its column, so an inbox reads in the same order as the screen behind
  // it rather than in the order the partner happened to click.
  const position = new Map(rows.map((row) => [row.id, row.line?.position ?? 0]));
  const sectionPosition = new Map(rows.map((row) => [row.id, row.line?.section.position ?? 0]));
  items.sort((a, b) => {
    if ((a.resolvedAt === null) !== (b.resolvedAt === null)) return a.resolvedAt === null ? -1 : 1;
    if ((a.lineId === null) !== (b.lineId === null)) return a.lineId === null ? -1 : 1;
    const bySection = (sectionPosition.get(a.id) ?? 0) - (sectionPosition.get(b.id) ?? 0);
    if (bySection !== 0) return bySection;
    if (a.sectionName !== b.sectionName) return (a.sectionName ?? "").localeCompare(b.sectionName ?? "");
    if (a.side !== b.side) return a.side === "give" ? -1 : 1;
    return (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0);
  });

  return { open: items.filter((item) => item.resolvedAt === null).length, items };
}

/**
 * Deal with one item.
 *
 * **Accepting a rejection removes the line**, which is the one thing on this table that touches the
 * list — and it is the collector's act, never the partner's. It obeys the same lock every other line
 * write obeys: while the list is frozen the removal is refused **by name**, with the step that would
 * unfreeze it, rather than being applied to a list the partner is holding a printout of. The
 * feedback row goes with the line (`ON DELETE CASCADE`): the request and the thing it was about
 * leave together, because the inbox states what is outstanding rather than archiving a list that has
 * moved on.
 *
 * Accepting anything else, and dismissing anything at all, only records what the collector decided.
 */
export async function resolveTradeFeedback(
  ownerId: string,
  feedbackId: string,
  action: "accept" | "dismiss"
): Promise<void> {
  const row = await prisma.tradeFeedback.findUnique({
    where: { id: feedbackId },
    select: {
      id: true,
      lineId: true,
      rejected: true,
      trade: { select: { id: true, status: true } },
    },
  });
  if (!row) throw new Error("That feedback is no longer there.");
  const { status } = await assertTradeOwner(ownerId, row.trade.id);

  if (action === "accept" && row.rejected && row.lineId) {
    if (!isTradeContentEditable(status)) {
      throw new Error(
        status === "agreed"
          ? "This list is locked — the partner is holding a copy of it. Step the trade back to shared to take this line off."
          : `A ${TRADE_STATUS_LABEL[status].toLowerCase()} trade's list cannot be changed.`
      );
    }
    await prisma.tradeLine.delete({ where: { id: row.lineId } });
    return;
  }

  await prisma.tradeFeedback.update({
    where: { id: feedbackId },
    data: {
      resolvedAt: new Date(),
      resolution: action === "accept" ? "applied" : "dismissed",
    },
  });
}

function toEntry(row: {
  note: string | null;
  rejected: boolean;
  updatedAt: Date;
  resolution: string | null;
}): TradeFeedbackEntry {
  return {
    note: row.note,
    rejected: row.rejected,
    updatedAt: row.updatedAt.toISOString(),
    resolution: isTradeFeedbackResolution(row.resolution) ? row.resolution : null,
  };
}
