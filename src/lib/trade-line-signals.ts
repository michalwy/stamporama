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
import type { TradeSubstitution } from "./trade-intake";
import type { TradeLineRealisation } from "./trade-realisation";
import type { DepartedCopy, ListedCopy } from "./trade-reservation-rules";
import { canRecordTradeRealisation, hasTradeVerdict } from "./trade-realisation-rules";
import { isTradeContentEditable, type TradeSide, type TradeStatus } from "./trade-rules";

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
  /** **What became of this line** (#642), or null while nobody has said. Both sides carry it: a
   *  verdict is about the line rather than about a copy, which is what lets the receive side have one
   *  at all. Drawn on the row for the same reason as everything else here — the row is where the
   *  collector is already looking, and it is the only place where *this one* needs no explaining. */
  realisation: TradeLineRealisation | null;
  /** **What came instead of what was promised** (#642, shipped with #644). Receive side only, and
   *  derived rather than stored: the line says what was agreed and the copy identified from the scan
   *  tile says what turned up, so this is those two disagreeing. Shown for confirmation — the
   *  collector either meant it, or has a copy filed under the wrong stamp. */
  substituted: TradeSubstitution | null;
}

const NO_SIGNALS: TradeLineSignals = {
  feedback: null,
  listed: [],
  departed: null,
  realisation: null,
  substituted: null,
};

/** The three reads, indexed by the thing each is about. Built once for the screen and asked per
 *  row, because both reads describe the whole trade and a row must not go looking through them. */
export interface TradeLineSignalIndex {
  feedbackByLine: Map<string, TradeFeedbackItem>;
  listedByItem: Map<string, ListedCopy[]>;
  departedByItem: Map<string, DepartedCopy>;
  /** Only the lines somebody has answered for. A `pending` line is the ordinary state of a freshly
   *  agreed trade, and a mark on every row of one would be a mark that says nothing. */
  realisationByLine: Map<string, TradeLineRealisation>;
  /** At most one per line: a substitution is *this line came as something else*, and where a line of
   *  quantity three brought three different stamps the first is what the row says — the collector
   *  opens the lot for the rest, which is the one place the whole list of them is. */
  substitutionByLine: Map<string, TradeSubstitution>;
}

export interface TradeSignalSources {
  /** The collector's feedback read. Items about the whole exchange (`lineId === null`) are not
   *  indexed here: they belong to the strip above, which is the only thing left up there. */
  feedback?: { items: readonly TradeFeedbackItem[] } | undefined;
  reservation?: { listed: readonly ListedCopy[]; departed: readonly DepartedCopy[] } | undefined;
  /** The realisation read (#642). `recordable` is not indexed here — it is a fact about the *trade*,
   *  not about a line, and what it governs is whether the row's menu offers the verdict at all. */
  realisation?: { lines: readonly TradeLineRealisation[] } | undefined;
  /** The intake read (#644). Only its substitutions are about a line; the purchase and the cost gate
   *  are facts about the *trade* and belong to the panel above. */
  intake?: { substitutions: readonly TradeSubstitution[] } | undefined;
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

  const realisationByLine = new Map<string, TradeLineRealisation>();
  for (const line of sources.realisation?.lines ?? []) {
    if (hasTradeVerdict(line.fulfillment)) realisationByLine.set(line.lineId, line);
  }

  const substitutionByLine = new Map<string, TradeSubstitution>();
  for (const substitution of sources.intake?.substitutions ?? []) {
    if (!substitutionByLine.has(substitution.lineId)) {
      substitutionByLine.set(substitution.lineId, substitution);
    }
  }

  return { feedbackByLine, listedByItem, departedByItem, realisationByLine, substitutionByLine };
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
  const realisation = index.realisationByLine.get(lineId) ?? null;
  const substituted = index.substitutionByLine.get(lineId) ?? null;
  if (!feedback && listed.length === 0 && !departed && !realisation && !substituted) {
    return NO_SIGNALS;
  }
  return { feedback, listed, departed, realisation, substituted };
}

export function hasTradeLineSignals(signals: TradeLineSignals): boolean {
  return (
    !!signals.feedback ||
    signals.listed.length > 0 ||
    !!signals.departed ||
    !!signals.realisation ||
    !!signals.substituted
  );
}

/** What is still outstanding on this trade, by kind. Kinds and not one number, because the three
 *  are resolved in three different places — a listing is withdrawn, a remark is answered, a
 *  departure is written off (#642) — and "5 things to look at" says which of them none.
 *
 *  A line with **no verdict yet** is deliberately not a fourth kind. Every line of a freshly agreed
 *  trade is pending, so counting them here would put *40 things to look at* over every agreement the
 *  minute it was struck. What that is really outstanding *for* is closing, so it is stated as the
 *  closing gate, on the balance panel, beside the other gates. */
export interface TradeAttentionCounts {
  /** Partner remarks nobody has dealt with yet. **This is the badge** (ADR-0039 §6). */
  remarks: number;
  /** Copies live on a marketplace. These **block** the agreement. */
  listed: number;
  /** Copies that have left the collection. These warn and never block. */
  departed: number;
  /** Receive lines that came as a different stamp (#644). Like a departure it is already true and
   *  blocks nothing; unlike one, nothing else on the screen would say so — the row's mark is the
   *  only place it is said, and a closed trade's rows are the ones nobody scrolls through again. */
  substituted: number;
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
  // Lines, not copies: a line of three that brought three different stamps is one row to look at.
  const substituted = new Set(
    (sources.intake?.substitutions ?? []).map((s) => s.lineId)
  ).size;
  return {
    remarks,
    listed,
    departed,
    substituted,
    total: remarks + listed + departed + substituted,
  };
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
  if (counts.substituted > 0) {
    parts.push(
      counts.substituted === 1
        ? "1 line came as something else"
        : `${counts.substituted} lines came as something else`
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
  const substituted = sources.intake?.substitutions ?? [];
  if (substituted.length > 0) return { kind: "line", lineId: substituted[0].lineId };
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

// ── What is waiting for the collector ───────────────────────────────────────────────────────────
//
// **The question a collector opens a trade with is *what is waiting for me?*** (#663). Everything
// above draws a signal on the row it is about, which is right — and on a trade of two hundred lines
// it is visible only by scrolling past everything that is fine. So one filter narrows a side to the
// lines carrying an open call for action.
//
// The set is decided **here**, once, rather than per surface: the filter that narrows a side and the
// count on the toggle that offers it must never disagree, and a second reading of "needs action"
// living in a `where` clause would drift from this one the first time a condition moved.
//
// **An action is something the collector can do now.** That is what governs the two conditions that
// are not simply true or false about a line: a missing valuation is only waiting while the list is
// still editable (`setTradeLineValue` refuses once the partner holds a copy of it), and a missing
// verdict is only waiting while a verdict may be written at all (`agreed`, #642). A line pointing at
// something the collector is forbidden to change is not a call for action; it is a fact.
//
// A **substitution** (#644) is deliberately not in the set for that same reason: it is shown for
// confirmation — the copy that turned up is not the one that was promised — and there is nothing to
// go and do about it. It stays a mark on its row.

/** What one line is waiting on. Kinds rather than a boolean, because the collector resolves them in
 *  four different places — a listing is withdrawn, a remark is answered, a figure is typed, a
 *  verdict is recorded — and a filter that has narrowed to eleven lines should be able to say what
 *  it narrowed to. */
export type TradeLineAction = "listed" | "remark" | "departed" | "unvalued" | "verdict";

/** One line as the rule sees it: enough to be found, and enough to be counted into its column.
 *  `itemId` is the give side's copy and null on the receive side — the reservation read knows a
 *  give line by nothing else. */
export interface TradeActionLine {
  lineId: string;
  sectionId: string;
  side: TradeSide;
  itemId: string | null;
}

export interface TradeActionSources extends TradeSignalSources {
  /**
   * The lines **#638's gate names**, whichever of its two gaps they fall in.
   *
   * Read off the gate rather than re-derived from the figures, so the filter and the refusal on
   * **Agree** can never come to disagree about which line is unvalued. Both kinds count: the issue's
   * own reasoning is *what holds the trade in `preparing`*, and on a trade balanced by value a line
   * with no figure in the agreed catalog holds it exactly as firmly as one with no figure at all.
   */
  unvaluedLineIds?: readonly string[];
  /** Where the trade is. It decides the two conditions that are about the collector's window rather
   *  than about the line: a value may only be typed while the list is unlocked, and a verdict only
   *  while it is `agreed`. */
  status?: TradeStatus;
}

/** How a `(section, side)` is keyed in the counts. One helper, because the server writes these keys
 *  and the column reads them, and two template strings in two files stay in step by luck. */
export function tradeSideActionKey(sectionId: string, side: TradeSide): string {
  return `${sectionId}:${side}`;
}

/** What is waiting on this trade, ready to be sent to the browser as it is — plain objects rather
 *  than the `Map`s the row index uses, because this one crosses the wire. */
export interface TradeActionRead {
  /** Only the lines with something waiting, each with what it is waiting on. The filter is
   *  membership of this; the row draws its marks from the signal index above, as it always has. */
  lines: Record<string, TradeLineAction[]>;
  /** `${sectionId}:${side}` → how many of that column's lines are waiting. **This is the count on
   *  the toggle**, and it is deliberately a fact about the whole column rather than about the column
   *  as currently searched: *what is waiting for me here* is not a different number because the
   *  search box has three letters in it. */
  counts: Record<string, number>;
  total: number;
}

/**
 * Which lines are waiting, and for what.
 *
 * The order the kinds are listed in is the order the collector meets them, and it is the strip's
 * own (`firstTradeAttention`): the blocker leads — a copy live on a marketplace is what stands
 * between this trade and being agreed — then the conversation, then what is already true.
 */
export function indexTradeLineActions(
  lines: readonly TradeActionLine[],
  sources: TradeActionSources
): TradeActionRead {
  const openRemarks = new Set(
    (sources.feedback?.items ?? [])
      .filter((item) => item.lineId !== null && item.resolvedAt === null)
      .map((item) => item.lineId!)
  );
  const listed = new Set((sources.reservation?.listed ?? []).map((c) => c.itemId));
  const departed = new Set((sources.reservation?.departed ?? []).map((c) => c.itemId));
  // Only while a figure can still be typed onto the line — see the header.
  const unvalued = new Set(
    sources.status && !isTradeContentEditable(sources.status) ? [] : (sources.unvaluedLineIds ?? [])
  );
  // Only while a verdict may be written at all. Note that this is the one condition that is about
  // the *absence* of a record: every line of a freshly agreed trade is in it, which is why the strip
  // above the columns deliberately does not count it and this filter deliberately does — one is
  // unbidden and would read as *40 things to look at* on every agreement, and the other is asked for.
  const awaitingVerdict = new Set(
    sources.status && canRecordTradeRealisation(sources.status)
      ? (sources.realisation?.lines ?? [])
          .filter((line) => !hasTradeVerdict(line.fulfillment))
          .map((line) => line.lineId)
      : []
  );

  const out: Record<string, TradeLineAction[]> = {};
  const counts: Record<string, number> = {};
  let total = 0;
  for (const line of lines) {
    const actions: TradeLineAction[] = [];
    if (line.itemId && listed.has(line.itemId)) actions.push("listed");
    if (openRemarks.has(line.lineId)) actions.push("remark");
    if (line.itemId && departed.has(line.itemId)) actions.push("departed");
    if (unvalued.has(line.lineId)) actions.push("unvalued");
    if (awaitingVerdict.has(line.lineId)) actions.push("verdict");
    if (actions.length === 0) continue;
    out[line.lineId] = actions;
    const key = tradeSideActionKey(line.sectionId, line.side);
    counts[key] = (counts[key] ?? 0) + 1;
    total += 1;
  }
  return { lines: out, counts, total };
}

/** How many of one column's lines are waiting, or zero — including while the read is still in
 *  flight, so a toggle never has to render a blank where a number belongs. */
export function tradeSideActionCount(
  read: TradeActionRead | undefined,
  sectionId: string,
  side: TradeSide
): number {
  return read?.counts[tradeSideActionKey(sectionId, side)] ?? 0;
}
