import { nameFew, type TradeSide, type TradeStatus } from "./trade-rules";

// **What actually happened, as opposed to what was agreed** (#642; ADR-0039 §11) — the pure half,
// with no database, no React and no `server-only`, so the domain, the trade screen, the partner's
// page and the tests all read one vocabulary instead of each spelling it out. The same split
// `trade-feedback-rules.ts` and `trade-reservation-rules.ts` make.
//
// The decision the whole shape follows from: **a trade list is a plan, not a fact, and the two are
// two layers rather than two versions of one.** The agreement freezes at `agreed` and the partner is
// holding a copy of it, so nothing here rewrites a quantity, a key or a frozen valuation. A verdict
// is recorded beside them, the realised balance is the agreement minus what was struck off, and the
// difference between the two is what the collector decides on — go back to the partner, or let it go.
//
// What is deliberately **not** here, and never became a field: a substituted variant (the receive
// line says what was promised, the copy created from the scan tile says what came, and the
// difference is derived — `trade-intake-rules.ts`), and a bonus, which is a copy with no line and
// whose arithmetic is already right, the pool splitting pro-rata by catalogue value so extra
// material simply lowers the unit cost of everything else. Both shipped with #644, which is what
// gave a trade the purchase those tiles hang on.
//
// One judgement here is read from outside the realisation story: `hasLeftInTrade`, the third exit
// path a copy can take out of the collection (#644). It belongs here because what it turns on is a
// verdict, and the same rule that decides whether a copy is back on the shelf decides whether it
// ever left.

/**
 * What became of one line.
 *
 * - `pending` — nobody has said yet. Every line is born here, and `closed` refuses while any line
 *   still is: a trade closed with lines nobody ever answered for is a record that says nothing about
 *   the parcel.
 * - `fulfilled` — it went, or it came. The ordinary end.
 * - `withdrawn` — pulled before the parcel left: found damaged, could not be located, thought better
 *   of. This is the one verdict that **releases** the copy from its commitment (#639).
 * - `missing` — the parcel arrived without it.
 *
 * `withdrawn` and `missing` are the same fact told from two ends of the post, which is why both are
 * offered on **both** sides and worded per side below. A give parcel that arrived two short is as
 * ordinary as a receive parcel that did.
 */
export const TRADE_FULFILLMENTS = ["pending", "fulfilled", "missing", "withdrawn"] as const;

export type TradeFulfillment = (typeof TRADE_FULFILLMENTS)[number];

const VALID_TRADE_FULFILLMENT = new Set<string>(TRADE_FULFILLMENTS);

export function isTradeFulfillment(value: unknown): value is TradeFulfillment {
  return typeof value === "string" && VALID_TRADE_FULFILLMENT.has(value);
}

/** A column read back from the database, which is `String` and could be anything. Anything it should
 *  not be reads as `pending` — the state a line is born in — for `readStatus`'s reason: a row with an
 *  unreadable verdict is a row nobody has answered for, not a crash. */
export function readTradeFulfillment(value: string): TradeFulfillment {
  return isTradeFulfillment(value) ? value : "pending";
}

/**
 * What a verdict is **called**, per side.
 *
 * One flag underneath and two words on top, `tradeFeedbackRejectLabel`'s reason: the vocabulary
 * inverts across the table. Of the collector's own material *I withdrew it*; of the partner's
 * *Partner withdrew it*. One label for both would be wrong on one side of every list.
 *
 * `missing` reads the same on both sides on purpose — *never arrived* is the same sentence whichever
 * parcel it is about, and inventing a second phrasing would suggest a distinction that is not there.
 */
export function tradeFulfillmentLabel(
  fulfillment: TradeFulfillment,
  side: TradeSide
): string {
  switch (fulfillment) {
    case "fulfilled":
      return side === "give" ? "Sent" : "Arrived";
    case "withdrawn":
      return side === "give" ? "I withdrew it" : "Partner withdrew it";
    case "missing":
      return "Never arrived";
    default:
      return "No verdict yet";
  }
}

/** The same distinction as a sentence, for the hover on the row's mark and anywhere a line is named
 *  away from the column it sits in. */
export function tradeFulfillmentSentence(
  fulfillment: TradeFulfillment,
  side: TradeSide
): string {
  switch (fulfillment) {
    case "fulfilled":
      return side === "give"
        ? "This one went in the parcel."
        : "This one arrived as agreed.";
    case "withdrawn":
      return side === "give"
        ? "I did not send this one. The agreed figures are unchanged, and the copy is free again."
        : "My partner did not send this one. The agreed figures are unchanged.";
    case "missing":
      return side === "give"
        ? "My parcel arrived without this one."
        : "My partner's parcel arrived without this one.";
    default:
      return "Nobody has said what became of this one yet.";
  }
}

/**
 * What a verdict is called on the **partner's** page (#640's surface), or null for nothing to say.
 *
 * Neutral, and only for what changed. The per-side wording above is written from the collector's end
 * — *I withdrew it* — and would be a lie read from the other side of the table; the partner's page
 * heads its two sides **by name** already (*From Anna*, *From Karel*), so a plain word under the
 * right heading is unambiguous without inverting anything.
 *
 * `fulfilled` and `pending` print nothing. What the partner opens that page for after the handshake
 * is what has **changed** since, and a mark on every unchanged line would bury the two that did.
 */
export function tradeShareFulfillmentLabel(fulfillment: TradeFulfillment): string | null {
  if (fulfillment === "withdrawn") return "Withdrawn";
  if (fulfillment === "missing") return "Never arrived";
  return null;
}

/** The colour a verdict's chip is drawn in, as the app's own semantic tokens. A struck-off line
 *  warns; a fulfilled one is muted, because the ordinary outcome has nothing to announce and a
 *  green tick on every row of a finished trade is a row of green ticks nobody reads. */
export const TRADE_FULFILLMENT_TONE: Record<TradeFulfillment, "muted" | "warning" | null> = {
  pending: null,
  fulfilled: "muted",
  missing: "warning",
  withdrawn: "warning",
};

/** Somebody has answered for this line. What `closed` requires of every one of them. */
export function hasTradeVerdict(fulfillment: TradeFulfillment): boolean {
  return fulfillment !== "pending";
}

/** The fulfillments nobody has answered for, as a list the closing gate narrows its query on —
 *  derived from the judgement above rather than spelled a second time in a `where`. */
export const UNANSWERED_FULFILLMENTS: readonly TradeFulfillment[] = TRADE_FULFILLMENTS.filter(
  (f) => !hasTradeVerdict(f)
);

/**
 * Whether this line counts toward the **realised** figures.
 *
 * `pending` counts. At the moment a trade is agreed every line is pending, so a realised total that
 * counted only the `fulfilled` ones would start at zero and report the whole trade as its own
 * difference — noise on every screen until the last verdict was in. What the realised figures mean is
 * *the agreement minus what was struck off*, and each strike-off moves them by exactly that line.
 */
export function isRealisedFulfillment(fulfillment: TradeFulfillment): boolean {
  return fulfillment !== "missing" && fulfillment !== "withdrawn";
}

/**
 * Whether a give line still commits its copy (#639).
 *
 * **Only a withdrawal releases it**, and that is the whole point of the verdict: a copy the collector
 * decided not to send is back on the shelf and free to be listed, which is exactly what resolves the
 * departure warning #639 raises. A `fulfilled` line's copy has gone in the envelope and a `missing`
 * one's went too — neither is back, and treating them as released would offer a stranger a stamp that
 * is in the post.
 */
export function isCommittingFulfillment(fulfillment: TradeFulfillment): boolean {
  return fulfillment !== "withdrawn";
}

/** The fulfillments that release a copy, as a list the database half narrows on. */
export const RELEASED_FULFILLMENTS: readonly TradeFulfillment[] = TRADE_FULFILLMENTS.filter(
  (f) => !isCommittingFulfillment(f)
);

/** The fulfillments that still commit one. */
export const COMMITTING_FULFILLMENTS: readonly TradeFulfillment[] = TRADE_FULFILLMENTS.filter(
  isCommittingFulfillment
);

/**
 * Whether this give line has taken its copy **out of the collection** (#644).
 *
 * The third exit path, beside a `SaleLineItem` and a `disposedAt` — and, like the other two, a fact
 * read off a record rather than a flag somebody remembers to set. A copy has left when a give line of
 * a **closed** trade names it and that line still commits it: `closed` is the point at which the
 * agreement stopped being a plan, and a withdrawn line's copy never went anywhere.
 *
 * It is deliberately narrower than {@link isCommittingFulfillment} on its own, which answers a
 * different question — *is this copy free to be promised elsewhere* — and wider than nothing at all,
 * which is what an exit written on the copy would have cost: a column to keep in step with a verdict
 * that can still be edited right up to the close.
 */
export function hasLeftInTrade(status: TradeStatus, fulfillment: TradeFulfillment): boolean {
  return status === "closed" && isCommittingFulfillment(fulfillment);
}

/**
 * Whether this give line has **promised** its copy away without its having gone yet (#639).
 *
 * The twin of {@link hasLeftInTrade}, one status earlier: at `agreed` the copy is committed and may
 * not go live on a marketplace, at `closed` it is gone. Named beside it rather than left as two
 * comparisons at each reader, because the pair is what a row is drawn from — *Promised · #7* and
 * *Traded away · #7* are the same sentence in two tenses, and they must never both be true.
 */
export function isPromisedInTrade(status: TradeStatus, fulfillment: TradeFulfillment): boolean {
  return status === "agreed" && isCommittingFulfillment(fulfillment);
}

/**
 * Whether a verdict may be recorded at all, given where the trade is.
 *
 * **`agreed` and nothing else.** Before it, nothing has happened: a list still being composed or one
 * the partner has not answered describes a parcel that has not been packed, and a verdict there would
 * be a fact about a future. After it, `closed` is history and `cancelled` is a trade that never took
 * place — writing on either would be writing on a receipt.
 */
export function canRecordTradeRealisation(status: TradeStatus): boolean {
  return status === "agreed";
}

/**
 * Whether there is a realised balance to show at all.
 *
 * Wider than the window a verdict may be *written* in, and deliberately: `closed` is where the two
 * balances matter most, since what the collector is reading then is the record of what the exchange
 * actually was. Narrower than every status, because before the agreement the realised figures would
 * be a second copy of the agreed ones with nothing to say — two identical columns and a row of
 * zeroes for the difference, on every trade being composed.
 *
 * A reopened trade (`agreed → shared`) drops out of it on purpose: the list is unlocked and being
 * renegotiated, so what is on it is a plan again. The verdicts stay on the lines and come back into
 * view the moment it is agreed afresh — which is exactly *showing the partner the change*.
 */
export function isTradeRealisationVisible(status: TradeStatus): boolean {
  return status === "agreed" || status === "closed";
}

/** Said when the verdict is refused, naming the one status that takes one. Refused **by name**, like
 *  every other trade rule: a menu entry that appears to do nothing reads as a broken button. */
export function tradeRealisationClosedMessage(status: TradeStatus): string {
  if (status === "closed") {
    return "This trade is closed, so what happened to it is already recorded.";
  }
  if (status === "cancelled") {
    return "This trade was cancelled, so nothing happened to record.";
  }
  return "Nothing has happened yet — record what became of a line once both sides have agreed the list.";
}

/**
 * How long the note may run.
 *
 * A cap rather than a limit anybody will meet: the collector writes *"gum toned, kept it back"*, not
 * an essay. It exists so the size of what a line can carry is stated rather than left to whatever the
 * database will hold, exactly as the partner's note is.
 */
export const TRADE_FULFILLMENT_NOTE_MAX = 2000;

/** What one verdict amounts to, once read. */
export interface TradeFulfillmentValue {
  fulfillment: TradeFulfillment;
  note: string | null;
}

export type TradeFulfillmentParse =
  | { ok: true; value: TradeFulfillmentValue }
  | { ok: false; message: string };

/**
 * Read one submission.
 *
 * **Clearing the verdict clears the note with it.** A note is why a line was struck off; kept beside
 * a `pending` line it would be an explanation of something nobody has claimed, which reads as a
 * verdict and is none.
 */
export function parseTradeFulfillment(
  fulfillment: unknown,
  note: unknown
): TradeFulfillmentParse {
  if (!isTradeFulfillment(fulfillment)) {
    return { ok: false, message: "Unknown verdict for this line." };
  }
  const raw = typeof note === "string" ? note.trim() : "";
  if (raw.length > TRADE_FULFILLMENT_NOTE_MAX) {
    return {
      ok: false,
      message: `A note can be at most ${TRADE_FULFILLMENT_NOTE_MAX} characters.`,
    };
  }
  if (fulfillment === "pending") return { ok: true, value: { fulfillment, note: null } };
  return { ok: true, value: { fulfillment, note: raw.length > 0 ? raw : null } };
}

/** How many lines are in each state — what the panel reads out and what the closing gate counts. */
export interface TradeRealisationCounts {
  pending: number;
  fulfilled: number;
  missing: number;
  withdrawn: number;
}

export const EMPTY_REALISATION_COUNTS: TradeRealisationCounts = {
  pending: 0,
  fulfilled: 0,
  missing: 0,
  withdrawn: 0,
};

export function countTradeRealisation(
  fulfillments: readonly TradeFulfillment[]
): TradeRealisationCounts {
  const counts = { ...EMPTY_REALISATION_COUNTS };
  for (const fulfillment of fulfillments) counts[fulfillment] += 1;
  return counts;
}

/** What was struck off, in a phrase: `2 withdrawn · 1 never arrived`. Null when nothing was — a
 *  reassurance drawn on every trade is a line a collector stops reading. */
export function describeStruckOff(counts: TradeRealisationCounts): string | null {
  const parts: string[] = [];
  if (counts.withdrawn > 0) parts.push(`${counts.withdrawn} withdrawn`);
  if (counts.missing > 0) parts.push(`${counts.missing} never arrived`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Why this trade cannot be closed yet, or null.
 *
 * Named **by catalogue number** through the same labeller the valuation gate names its lines with
 * (#638), and cut at the same length by the same `nameFew`, so a line named in this refusal and the
 * same line named in that one are recognisably the same line. "4 lines have no verdict" and nothing
 * more sends the collector hunting through both sides of every section.
 */
export function tradeClosingBlockerMessage(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  const subject = labels.length === 1 ? "One line has" : `${labels.length} lines have`;
  return `${subject} no verdict yet: ${nameFew(labels)}. Say what became of each — sent, arrived, withdrawn or never arrived — before closing.`;
}
