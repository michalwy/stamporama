// Interchangeable copies on a give line (#657) — the pure half. No Prisma, no React, so the read
// that counts a pool, the dialog that draws it, the write that blocks a copy and the unit tests all
// share one reading of what "the same thing" means.
//
// The rule in one sentence: **two copies are alternatives to each other when they match on the full
// valuation key — stamp × condition × certificate × format — and nothing weaker.**
//
// That key is load-bearing, and it is the reason this module exists rather than the matching being
// written inline wherever it is needed. #638 values a line on exactly that key, so a swap inside it
// changes neither valuation, neither total and neither verdict: the substitution is invisible to
// every figure on the screen and to the snapshots frozen at `agreed`. A pool matched on stamp and
// condition alone would let a certified copy replace an uncertified one, or a block of four replace
// a single, and silently rewrite a balance both sides had shaken hands on. A copy differing in
// certificate or format is not an alternative to this line; it is a different line.
//
// The key is `copy-groups.ts`'s, with **both optional axes on** — that module already says in its own
// header that with format and certificate joined, the key is exactly the one catalogue valuation is
// computed on. Restating it here as a fifth grouping rule would be a fifth place for it to drift.
//
// **Nothing about the pool is stored.** It is `listOfferableCopies`'s eligibility (#639) narrowed to
// one key: in hand, unsold, not disposed of, not promised to another live trade, not already on this
// one. What *is* stored is the collector's exception to it — one row per `(trade, copy)` saying "not
// this one, not to this person" — and absence is availability.

import {
  copyGroupKey,
  encodeCopyGroupKey,
  type CopyGroupAxes,
  type GroupableCopy,
} from "./copy-groups";

/** Both optional axes joined. See the header: this is the key #638 values a line on, which is the
 *  whole reason a swap inside it is invisible to the balance. */
export const TRADE_CANDIDATE_AXES: CopyGroupAxes = { format: true, certificate: true };

/** What a copy has to carry to be matched — `Item`'s four key columns, and structurally what
 *  `ItemListItem` and a give line's `item` selection already are. */
export type TradeCandidateSubject = GroupableCopy;

/**
 * The bucket a copy falls in, as a string — the map key the pool is built with and the token a line
 * looks its own alternatives up by.
 *
 * Encoded rather than compared field by field because the read hands out a `Map` and a line asks it
 * one question; a hand-written four-way comparison at each call site is four chances to forget the
 * axis that makes a certified copy a different piece.
 */
export function tradeCandidateKey(copy: TradeCandidateSubject): string {
  return encodeCopyGroupKey(copyGroupKey(copy, TRADE_CANDIDATE_AXES), TRADE_CANDIDATE_AXES);
}

/** How many alternatives a give line has, and how many the collector has taken out of the pool.
 *  Two numbers rather than one: a line whose only alternative is blocked has nothing to offer the
 *  partner, but it still has something to show the collector — the decision they took. */
export interface TradeCandidateCount {
  /** Offered to the partner: eligible, and not blocked. */
  available: number;
  /** Eligible, and blocked by hand on this trade. */
  blocked: number;
}

export const NO_CANDIDATES: TradeCandidateCount = { available: 0, blocked: 0 };

/** Whether a line has anything to say about alternatives at all. A blocked-only line still does —
 *  otherwise the decision that emptied the pool would be unreachable. */
export function hasTradeCandidates(count: TradeCandidateCount): boolean {
  return count.available > 0 || count.blocked > 0;
}

/** The chip's word, in the collector's terms. Counted rather than named: which copies they are is
 *  what opening the list is for, and a row is not the place for four copy numbers. */
export function tradeCandidateLabel(count: TradeCandidateCount): string {
  if (count.available === 0) {
    return count.blocked === 1 ? "1 held back" : `${count.blocked} held back`;
  }
  return count.available === 1 ? "1 alternative" : `${count.available} alternatives`;
}

/** The hover, which is where the second number goes: the chip says what the partner would be shown,
 *  and this says what the collector decided on top of it. */
export function tradeCandidateHint(count: TradeCandidateCount): string {
  const held =
    count.blocked === 0
      ? ""
      : count.blocked === 1
        ? " One more matches and you have held it back."
        : ` ${count.blocked} more match and you have held them back.`;
  if (count.available === 0) {
    return `No other copy is offered against this line.${held}`;
  }
  const subject =
    count.available === 1
      ? "One other copy of yours answers this line exactly"
      : `${count.available} other copies of yours answer this line exactly`;
  return `${subject} — same stamp, condition, certificate and format, so sending any of them changes no figure on this trade.${held}`;
}

/** Why a copy the trade already names cannot be held back: it is the promise, not an alternative to
 *  it. Refused **by name**, the shape every other trade refusal takes (#418). */
export function describeBlockedPromise(label: string): string {
  return `${label} is what this trade promises, not an alternative to it. Remove the line, or swap the copy, to stop offering it.`;
}

/** Why the pool is closed. It is meaningful only while the trade is `preparing` or `shared`: at
 *  `agreed` the choice is settled along with everything else the lock covers, and holding a copy
 *  back there would change what the partner is looking at after they agreed to it. */
export function describeClosedPool(statusLabel: string): string {
  return `A ${statusLabel.toLowerCase()} trade's alternatives are settled along with the rest of its list.`;
}
