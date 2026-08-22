import { TRADE_STATUS_LABEL, type TradeStatus } from "./trade-rules";

// **The partner's pick of which copy they receive** (#658; ADR-0039 §15) — the pure half, with no
// database and no React, so the window, the wording on both sides of the link and every refusal are
// one reading shared by the page that offers the choice, the route that takes it, the row that draws
// it and the unit tests.
//
// The decision the whole module follows from: **a proposal moves nothing.** `TradeLine.itemId` is the
// effective copy and stays the only reference the reservation gate (#639), the balance (#638), the
// packing list (#643) and the exit record (#644) read; `proposedItemId` is a suggestion, and the
// collector accepts it into the effective copy or dismisses it. That is one rule and not a rule with
// an exception — everything arriving through the shared link is advisory and the collector settles it
// (`trade-feedback-rules.ts`, ADR-0039 §10).
//
// The copies in #657's pool are interchangeable **by construction** — same stamp, condition,
// certificate and format, so a swap moves no figure — and an earlier draft of the issue had the pick
// write the line directly on exactly that argument. It was wrong: interchangeable is a judgement made
// in advance about a *set*, and the collector may have a reason about one particular piece that the
// set never encoded (a thin spot noticed on the second look, a copy promised out loud to somebody
// else). One click keeps that reason expressible.

/**
 * Whether the partner may still say which copy they want.
 *
 * **`shared` and nothing else**, which is narrower than the pool's own window (`preparing` or
 * `shared`) and narrower than what the link takes in remarks (`preparing`, `shared`, `agreed`).
 *
 * A pick is an answer to a list that has been **handed over**: while the trade is `preparing` the
 * collector is still composing, and a partner choosing between copies of a line that may not survive
 * the afternoon is answering a question nobody has asked yet. From `agreed` on the list is locked for
 * both sides — the picker becomes a statement of which copy was chosen, and a suggestion left
 * unanswered is closed out with the trade.
 */
export function canProposeTradeCopy(status: TradeStatus): boolean {
  return status === "shared";
}

/** Said on the partner's page in place of the picker, so a reader who cannot choose is told why
 *  rather than left looking for a control that is not there. */
export function describeTradeProposalClosed(status: TradeStatus): string {
  if (status === "preparing") {
    return "This list is still being put together, so which copy travels is not open yet.";
  }
  return `This exchange is ${TRADE_STATUS_LABEL[status].toLowerCase()}, so which copy travels is settled.`;
}

// ── What the partner reads ──────────────────────────────────────────────────────────────────────

/** The heading over one line's copies. Stated as a question, because that is what it is — and with
 *  the count, so a reader knows how many pictures to compare before they start. */
export function tradeProposalPrompt(options: number): string {
  return options === 2
    ? "Two of these would do — which would you like?"
    : `${options} of these would do — which would you like?`;
}

/**
 * What one copy is called on the partner's page.
 *
 * **Nothing the collection knows it by.** The copy number, where it is filed and what it cost are
 * internal handles and are kept out of the payload entirely (`readTradeShareView`'s rule), so what
 * is left to tell two pictures of the same stamp apart is their order on the row. That is enough:
 * the partner is comparing perforations, not looking anything up.
 */
export function tradeProposalOptionLabel(index: number): string {
  return `Copy ${index + 1}`;
}

/** The copy the line names today — what every other option is an alternative *to*. Always first. */
export const TRADE_PROPOSAL_CURRENT_LABEL = "Chosen now";

/** The partner's own standing suggestion, drawn **beside** the current choice rather than replacing
 *  it: the two are different things and a page that showed only the pick would suggest the swap had
 *  already happened. */
export const TRADE_PROPOSAL_PICKED_LABEL = "You asked for this one";

/** How the partner takes a suggestion back. There is deliberately no second control for it: picking
 *  the copy that is already chosen *is* withdrawing the request, so the choice is one radio group
 *  rather than a radio group and a clear button that can disagree with it. Said in words, because a
 *  gesture that is obvious once you know it is not obvious the first time. */
export const TRADE_PROPOSAL_CLEAR_HINT =
  "Nothing is decided by choosing here — it is a request, and your partner confirms it. Picking the copy that is already chosen takes the request back.";

/** A suggestion the collector never answered, on a list that has since been locked. Said once, on
 *  the row, because the alternative is a partner who thinks a swap is coming. */
export function tradeProposalUnansweredNote(status: TradeStatus): string {
  return `You asked for a different copy; this exchange was ${TRADE_STATUS_LABEL[
    status
  ].toLowerCase()} with the one shown.`;
}

// ── What the collector reads ────────────────────────────────────────────────────────────────────

/** The chip on the give row. *Pick* rather than *choice*: what the partner did was ask, and the row
 *  is where the asking is answered. */
export const TRADE_PROPOSAL_CHIP_LABEL = "Partner's pick";

/** The hover behind that chip, which is a **button**: the chip names the copy, and the one place
 *  the collector can actually look at it is the alternatives list, so that is where it goes. */
export function tradeProposalHint(copyLabel: string): string {
  return `Your partner would rather have ${copyLabel}. Open the alternatives to compare the scans and decide.`;
}

/** The request, said at the head of the alternatives list — where the copies it is about are
 *  drawn, so the sentence and the pictures are read together. */
export function tradeProposalBanner(copyLabel: string): string {
  return `Your partner asked for ${copyLabel}. It answers this line exactly — same stamp, condition, certificate and format — so sending it changes no figure on this trade.`;
}

/**
 * The request when the copy it names has **left the pool** — sold, disposed of, held back, promised
 * elsewhere.
 *
 * Said rather than hidden. The request is still standing and the collector still has to answer it;
 * dropping the banner along with the copy would leave a chip on the row pointing at a screen with
 * nothing on it about the thing the chip named.
 */
export function tradeProposalLapsedBanner(copyLabel: string): string {
  return `Your partner asked for ${copyLabel}, which is no longer one of this line's alternatives — it has been sold, held back or promised elsewhere since. Drop the request, or send one of the copies below instead.`;
}

/**
 * The two answers, on the alternatives list itself.
 *
 * Named after what they **do**, `tradeFeedbackActionLabels`'s move: accepting swaps the copy the
 * line promises, and declining leaves the promise exactly where it was.
 */
export function tradeProposalActionLabels(copyLabel: string): {
  accept: string;
  dismiss: string;
} {
  return { accept: `Send ${copyLabel} instead`, dismiss: "Keep the copy I chose" };
}

// ── Refusals ────────────────────────────────────────────────────────────────────────────────────

/** Why the copy the partner picked is not one of this line's alternatives. Covers the tampered id
 *  and the ordinary race alike — a copy sold in the minute the page was open is not a candidate any
 *  more, and neither is one that never was. */
export const TRADE_PROPOSAL_NOT_OFFERED =
  "That copy is not one of the alternatives offered on this line.";

/** Two lines of one trade sharing a key cannot both be answered with the same piece. Refused **by
 *  name** here and again by a partial unique index in the database. */
export const TRADE_PROPOSAL_ALREADY_TAKEN =
  "You have already asked for that copy on another line of this exchange.";
