// **Every signal about a line, resolved to the line it is about** (#662) — the pure half, with no
// database and no React, so the rows that draw the marks, the strip that counts them and the unit
// tests share one reading of what is on a line.
//
// The decision this module exists for is a reversal (ADR-0039 §10, revised in place). #641 gathered
// the partner's answers into an inbox above the two columns and #639 put the reservation collision
// beside it, both on the same argument: what a collector does with these is work through them, so
// gathering beats scattering. In use the opposite holds. A banner that says something about eight
// lines is eight lines to go and find in four section cards, and the collector is already looking at
// the row — the one place where *this one* needs no explaining.
//
// **Nothing new is stored and nothing is re-derived.** The two reads the trade's screen already
// makes — the feedback (`trade-feedback.ts`) and the reservation (`trade-reservations.ts`) — arrive
// whole, about the trade; all this does is index them by the thing each item is about, so a row can
// ask one question and get one answer. A feedback item is about a **line**; a collision or a
// departure is about a **copy**, which is what those reads know a give line by.
//
// **What stays above the columns is what has no row to hang on**: the partner's note about the whole
// exchange, and a count of what is still unhandled with a jump to the first of it. That count keeps
// #639's other argument intact — the refusal on **Agree** is met while the list is being read rather
// than by pressing the button.

import type { TradeFeedbackItem } from "./trade-feedback";
import type { DepartedCopy, ListedCopy } from "./trade-reservation-rules";

/** Everything there is to say about one line, from the row's point of view. A give line asks with
 *  both keys, a receive line with its line id alone — the partner's material is in nobody's
 *  inventory, so nothing about a copy can be true of it. */
export interface TradeLineSignals {
  /** What the partner said about this line, **open or handled**. A handled remark is still what
   *  they said, and a collector who half-remembers one should find it where they left it rather
   *  than reopening the link to read their own trade from the outside (#641's disclosure, re-homed
   *  onto the row it was always about). */
  feedback: TradeFeedbackItem | null;
  /** Marketplace listings this copy is live on. Plural: one copy can be up on two platforms, and
   *  each is a listing to withdraw. Give side only. */
  listed: ListedCopy[];
  /** The copy has left the collection out from under the promise — sold elsewhere, or no longer
   *  held. Give side only, and a warning rather than a block: it is already gone. */
  departed: DepartedCopy | null;
}

const NO_SIGNALS: TradeLineSignals = { feedback: null, listed: [], departed: null };

/** The three reads, indexed by the thing each is about. Built once for the screen and asked per
 *  row, because both reads describe the whole trade and a row must not go looking through them. */
export interface TradeLineSignalIndex {
  feedbackByLine: Map<string, TradeFeedbackItem>;
  listedByItem: Map<string, ListedCopy[]>;
  departedByItem: Map<string, DepartedCopy>;
}

export interface TradeSignalSources {
  /** The collector's feedback read. Items about the whole exchange (`lineId === null`) are not
   *  indexed here: they belong to the strip above, which is the only thing left up there. */
  feedback?: { items: readonly TradeFeedbackItem[] } | undefined;
  reservation?: { listed: readonly ListedCopy[]; departed: readonly DepartedCopy[] } | undefined;
}

export function indexTradeLineSignals(sources: TradeSignalSources): TradeLineSignalIndex {
  const feedbackByLine = new Map<string, TradeFeedbackItem>();
  for (const item of sources.feedback?.items ?? []) {
    // One row per line is the table's own rule (ADR-0039 §10), so the last one wins and there is
    // never a second to lose.
    if (item.lineId) feedbackByLine.set(item.lineId, item);
  }

  const listedByItem = new Map<string, ListedCopy[]>();
  for (const copy of sources.reservation?.listed ?? []) {
    const existing = listedByItem.get(copy.itemId);
    if (existing) existing.push(copy);
    else listedByItem.set(copy.itemId, [copy]);
  }

  const departedByItem = new Map<string, DepartedCopy>();
  for (const copy of sources.reservation?.departed ?? []) {
    departedByItem.set(copy.itemId, copy);
  }

  return { feedbackByLine, listedByItem, departedByItem };
}

/** What is true of one row. `itemId` is the give side's copy and null on the receive side. */
export function tradeLineSignals(
  index: TradeLineSignalIndex,
  lineId: string,
  itemId: string | null
): TradeLineSignals {
  const feedback = index.feedbackByLine.get(lineId) ?? null;
  const listed = (itemId ? index.listedByItem.get(itemId) : undefined) ?? [];
  const departed = (itemId ? index.departedByItem.get(itemId) : undefined) ?? null;
  if (!feedback && listed.length === 0 && !departed) return NO_SIGNALS;
  return { feedback, listed, departed };
}

export function hasTradeLineSignals(signals: TradeLineSignals): boolean {
  return !!signals.feedback || signals.listed.length > 0 || !!signals.departed;
}

/** What is still outstanding on this trade, by kind. Kinds and not one number, because the three
 *  are resolved in three different places — a listing is withdrawn, a remark is answered, a
 *  departure is written off (#642) — and "5 things to look at" says which of them none. */
export interface TradeAttentionCounts {
  /** Partner remarks nobody has dealt with yet. **This is the badge** (ADR-0039 §6). */
  remarks: number;
  /** Copies live on a marketplace. These **block** the agreement. */
  listed: number;
  /** Copies that have left the collection. These warn and never block. */
  departed: number;
  total: number;
}

export function countTradeAttention(sources: TradeSignalSources): TradeAttentionCounts {
  const remarks = (sources.feedback?.items ?? []).filter(
    (item) => item.lineId !== null && item.resolvedAt === null
  ).length;
  // Copies, not listings: two listings of one copy are one thing to go and deal with, and the row
  // they are on is one row.
  const listed = new Set((sources.reservation?.listed ?? []).map((c) => c.itemId)).size;
  const departed = new Set((sources.reservation?.departed ?? []).map((c) => c.itemId)).size;
  return { remarks, listed, departed, total: remarks + listed + departed };
}

/** The counts as the strip reads them out. Null when there is nothing to say — a strip that draws
 *  an empty reassurance on every trade is a strip a collector stops reading. */
export function describeTradeAttention(counts: TradeAttentionCounts): string | null {
  const parts: string[] = [];
  if (counts.listed > 0) {
    parts.push(
      counts.listed === 1 ? "1 copy listed elsewhere" : `${counts.listed} copies listed elsewhere`
    );
  }
  if (counts.remarks > 0) {
    parts.push(counts.remarks === 1 ? "1 partner remark" : `${counts.remarks} partner remarks`);
  }
  if (counts.departed > 0) {
    parts.push(
      counts.departed === 1 ? "1 promised copy gone" : `${counts.departed} promised copies gone`
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Which row the strip's *Go to the first* jumps to, named by the anchor the rows carry. */
export type TradeAttentionTarget =
  | { kind: "line"; lineId: string }
  | { kind: "copy"; itemId: string };

/**
 * The first thing worth going to, in the order the collector has to deal with them.
 *
 * **The blocker leads.** A copy live on a marketplace is what stands between this trade and being
 * agreed, so it comes ahead of a remark, which is a conversation, and ahead of a departure, which is
 * already true and cannot be undone from here. Within a kind, the order the reads are already in —
 * the feedback read is sorted into the screen's own order (section, side, position), so *the first*
 * means the topmost, not the oldest.
 */
export function firstTradeAttention(sources: TradeSignalSources): TradeAttentionTarget | null {
  const listed = sources.reservation?.listed ?? [];
  if (listed.length > 0) return { kind: "copy", itemId: listed[0].itemId };
  const remark = (sources.feedback?.items ?? []).find(
    (item) => item.lineId !== null && item.resolvedAt === null
  );
  if (remark?.lineId) return { kind: "line", lineId: remark.lineId };
  const departed = sources.reservation?.departed ?? [];
  if (departed.length > 0) return { kind: "copy", itemId: departed[0].itemId };
  return null;
}

/** The DOM anchor a row carries, so the strip above can jump to it. One helper rather than two
 *  template strings in two files that have to stay in step.
 *
 *  Two keys and not one, because the two kinds of signal know a row by different things: a remark
 *  names the **line**, while a collision names the **copy** — the only handle the reservation read
 *  has, since it is asked of the copies rather than of the trade. A give row therefore carries both,
 *  and the selector below is what lets the strip ask for either without knowing which it has. */
export function tradeLineAnchorId(lineId: string): string {
  return `trade-line-${lineId}`;
}

/** The attribute a give row carries its copy's id in. */
export const TRADE_COPY_ATTR = "data-trade-copy";

/** Where the strip's *Go to the first* lands, as something `querySelector` takes. Attribute form
 *  for both kinds, so an id containing a character CSS would read as syntax cannot break the jump. */
export function tradeAttentionSelector(target: TradeAttentionTarget): string {
  return target.kind === "line"
    ? `[id="${tradeLineAnchorId(target.lineId)}"]`
    : `[${TRADE_COPY_ATTR}="${target.itemId}"]`;
}
