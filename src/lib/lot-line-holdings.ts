/**
 * What the collection already has of an auction lot line's stamp (#2543): copies **held**, and
 * copies **on the way** — bought and not yet arrived.
 *
 * Until #2543 the figure was only the *Recommended* popover's *you hold N*, one popover per lot; a
 * screen of forty lots could not be read for it. So it rides on the line itself, and the lot's header
 * says when any of its lines has some.
 *
 * Pure and client-safe: the server rolls the rows up, and the chip and the popover read the result.
 *
 * - **Counting set** is `heldCopiesWhere`'s, the one every *have I got this* count uses — sold,
 *   disposed, traded-away and never-usably-delivered copies are not counted (`copy-counts.ts`).
 * - **Held** is a copy in hand: delivered, or arrived and waiting to be sorted. **On the way** is
 *   `ordered` or `in_transit`. Both named off `delivery-state.ts`, never restated here.
 * - **The chip counts the line's own condition**, every condition it may be in when that is still
 *   open (#1623) — a different condition is a different purchase decision. The others are listed in
 *   the tooltip only, so an MH copy held against an MNH line is still seen.
 * - **Information only** (ADR-0029 §7): nothing here moves a recommended bid.
 */

import { ON_THE_WAY_DELIVERY_STATES } from "./delivery-state";

/** One `(condition × delivery state)` count of copies, as the database groups them. */
export interface HoldingRow {
  conditionId: string;
  deliveryState: string;
  count: number;
}

/** A condition the collection holds the stamp in, and how many of each kind. */
export interface LineHoldingCondition {
  conditionId: string;
  abbreviation: string;
  name: string;
  held: number;
  onTheWay: number;
  /** One of the line's own conditions — what the chip's figures count. */
  own: boolean;
}

export interface LineHoldings {
  /** Held at the line's own condition(s). */
  held: number;
  /** On the way at the line's own condition(s). */
  onTheWay: number;
  /** Every condition with a copy, the line's own first, then the rest; each group in the
   *  collection's own order. */
  conditions: LineHoldingCondition[];
}

/** Whether a copy in this delivery state is bought but has not arrived. */
export function isOnTheWay(deliveryState: string): boolean {
  return (ON_THE_WAY_DELIVERY_STATES as readonly string[]).includes(deliveryState);
}

/**
 * Roll a stamp's held-copy rows up against one line.
 *
 * `ownConditionIds` is the line's own condition, or every condition it may be in while that is open
 * (an unknown condition ranges over the whole dictionary, #1623). `dictionary` is the collection's
 * conditions in their own order, for the names and the order. Null when the collection has no copy
 * of the stamp at any condition.
 */
export function summarizeLineHoldings(
  rows: readonly HoldingRow[],
  ownConditionIds: readonly string[],
  dictionary: readonly { id: string; abbreviation: string; name: string }[]
): LineHoldings | null {
  const own = new Set(ownConditionIds);
  const byCondition = new Map<string, { held: number; onTheWay: number }>();
  for (const row of rows) {
    if (row.count <= 0) continue;
    const entry = byCondition.get(row.conditionId) ?? { held: 0, onTheWay: 0 };
    if (isOnTheWay(row.deliveryState)) entry.onTheWay += row.count;
    else entry.held += row.count;
    byCondition.set(row.conditionId, entry);
  }
  if (byCondition.size === 0) return null;

  const order = new Map(dictionary.map((condition, index) => [condition.id, index]));
  const named = new Map(dictionary.map((condition) => [condition.id, condition]));
  const conditions: LineHoldingCondition[] = [...byCondition].map(([conditionId, counts]) => ({
    conditionId,
    abbreviation: named.get(conditionId)?.abbreviation ?? "?",
    name: named.get(conditionId)?.name ?? "Unknown condition",
    held: counts.held,
    onTheWay: counts.onTheWay,
    own: own.has(conditionId),
  }));
  const rank = (c: LineHoldingCondition) => order.get(c.conditionId) ?? Number.MAX_SAFE_INTEGER;
  conditions.sort((a, b) => Number(b.own) - Number(a.own) || rank(a) - rank(b));

  const mine = conditions.filter((c) => c.own);
  return {
    held: mine.reduce((sum, c) => sum + c.held, 0),
    onTheWay: mine.reduce((sum, c) => sum + c.onTheWay, 0),
    conditions,
  };
}

/** Whether the line's chip is drawn: a copy held or on the way at the line's own condition(s). */
export function showsHoldings(holdings: LineHoldings | null): holdings is LineHoldings {
  return holdings !== null && holdings.held + holdings.onTheWay > 0;
}

/** What the chip says: *held 2*, *held 2 · 1 on the way*, or *1 on the way*. Empty when nothing is
 *  counted at the line's own condition. */
export function lineHoldingsLabel(holdings: { held: number; onTheWay: number }): string {
  const onTheWay = holdings.onTheWay > 0 ? `${holdings.onTheWay} on the way` : null;
  if (holdings.held > 0) return onTheWay ? `held ${holdings.held} · ${onTheWay}` : `held ${holdings.held}`;
  return onTheWay ?? "";
}

/** Whether a lot has any line whose chip is drawn — the mark on a collapsed lot's header. */
export function lotHoldsCopies(lines: readonly { holdings: LineHoldings | null }[]): boolean {
  return lines.some((line) => showsHoldings(line.holdings));
}
