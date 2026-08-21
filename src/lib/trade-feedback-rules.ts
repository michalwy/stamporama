import { TRADE_STATUS_LABEL, type TradeSide, type TradeStatus } from "./trade-rules";

// **What the partner is allowed to say, and what the two sides call it** (#641; ADR-0039 §10) — the
// pure half, with no database and no `server-only`, so the rules can be reasoned about and tested on
// their own, exactly as `trade-share-rules.ts` is.
//
// Four questions live here and nowhere else: when a link still takes feedback, what a submission has
// to contain to be worth a row, how long a note may be, and what striking a line out is *called* on
// each side of the table.

/**
 * How long a note may run.
 *
 * A cap rather than a limit anybody will meet: a partner writes *"already have this one"*, not an
 * essay. It exists because this is the one surface in the app that takes text from someone with no
 * account, so the size of what they can post is stated rather than left to whatever the database
 * will hold.
 */
export const TRADE_FEEDBACK_NOTE_MAX = 2000;

/** What the collector did about a piece of feedback. Kept because *I removed the line* and *I
 *  decided to keep it* are different answers to give a partner who asks again. */
export type TradeFeedbackResolution = "applied" | "dismissed";

export function isTradeFeedbackResolution(value: unknown): value is TradeFeedbackResolution {
  return value === "applied" || value === "dismissed";
}

/**
 * Whether the partner may still say something, given where the trade is.
 *
 * **Every live status takes feedback, and `closed` does not.** `preparing` and `shared` are the
 * negotiation, and at `agreed` the list is locked — which is exactly why input there is still worth
 * taking: it is a request to reopen rather than a change, and the collector is the one who decides
 * whether to step the trade back. A `closed` exchange has happened; annotating the record of it
 * would be writing on a receipt. `cancelled` never reaches this question — the link refuses before
 * the page is built (`resolveTradeShareAccess`).
 */
export function canLeaveTradeFeedback(status: TradeStatus): boolean {
  return status === "preparing" || status === "shared" || status === "agreed";
}

/** Said on the page in place of the controls, so a partner who cannot type is told why rather than
 *  left looking for a box that is not there. */
export function tradeFeedbackClosedMessage(status: TradeStatus): string {
  if (status === "closed") {
    return "This exchange is finished, so this list no longer takes comments. Anything already said is shown below.";
  }
  return `This exchange is ${TRADE_STATUS_LABEL[status].toLowerCase()} and no longer takes comments.`;
}

/**
 * What striking a line out is called, per side.
 *
 * One flag underneath and two words on top, for `tradeShareSideHeading`'s reason: the vocabulary
 * inverts across the table. Of the collector's material the partner says *I do not want this*; of
 * their own they say *I cannot send this*. One label for both would be wrong on one side of every
 * list.
 */
export function tradeFeedbackRejectLabel(side: TradeSide): string {
  return side === "give" ? "Not wanted" : "Cannot send";
}

/** The same distinction as a sentence, for the places a line is read **out of** its column — the
 *  hover on the row's own mark, and anywhere the item is named away from the side it sits on. */
export function tradeFeedbackRejectSentence(side: TradeSide): string {
  return side === "give"
    ? "Does not want this line."
    : "Cannot send this line.";
}

/**
 * What answering a piece of feedback is called — the two entries on the row's `⋮` (#662), and the
 * two buttons on the note about the whole exchange, which has no row.
 *
 * A rejection has something to *apply* — the line comes off the list — so its accept is named after
 * what it does. A note has nothing mechanical behind it: the collector reads it, does whatever it
 * asked, and marks it done. Both write a resolution, and the words differ because the acts do.
 */
export function tradeFeedbackActionLabels(rejected: boolean): { accept: string; dismiss: string } {
  return rejected
    ? { accept: "Remove the line", dismiss: "Keep it" }
    : { accept: "Done", dismiss: "Ignore" };
}

/** What the partner submitted for one subject, before it is judged. */
export interface TradeFeedbackInput {
  note?: string | null;
  rejected?: boolean;
}

/** What a valid submission amounts to: a row to write, or `null` for "nothing said" — which is a
 *  perfectly ordinary thing to submit, and means the row goes. */
export type TradeFeedbackValue = { note: string | null; rejected: boolean } | null;

export type TradeFeedbackParse =
  | { ok: true; value: TradeFeedbackValue }
  | { ok: false; message: string };

/**
 * Read one submission.
 *
 * **Clearing is saying nothing, and saying nothing deletes the row.** A partner who unticks the mark
 * and empties the box has withdrawn what they said; leaving an empty row behind would keep a mark on
 * the collector's line that reads as feedback and says none.
 *
 * `allowReject` is false for the whole-trade note: there is no such thing as rejecting an entire
 * exchange through a note box, and the database says so too.
 */
export function parseTradeFeedback(
  input: TradeFeedbackInput,
  { allowReject }: { allowReject: boolean }
): TradeFeedbackParse {
  const raw = typeof input.note === "string" ? input.note : "";
  const note = raw.trim();
  if (note.length > TRADE_FEEDBACK_NOTE_MAX) {
    return {
      ok: false,
      message: `A note can be at most ${TRADE_FEEDBACK_NOTE_MAX} characters.`,
    };
  }
  const rejected = input.rejected === true;
  if (rejected && !allowReject) {
    return { ok: false, message: "A note about the whole exchange cannot reject anything." };
  }
  if (!rejected && note.length === 0) return { ok: true, value: null };
  return { ok: true, value: { note: note.length > 0 ? note : null, rejected } };
}
