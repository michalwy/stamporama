// The moves an offer's phone screen offers (#2008, ADR-0072 §5): pause, resume and withdraw — the
// three that come up during the day, away from the desk. Preparing, publishing and editing an offer
// stay at the desk, so a move here is only ever one of these three.
//
// Pure, so the unit suite holds it. Each is read off the desk's own manual transitions, never a list
// of its own: the phone offers a move exactly when the desk would allow it, and the server refuses
// anything else in the same words (`setOfferStateAction`).

import { manualTransitions, type OfferState } from "./offer-rules";

export type PhoneOfferMove = "pause" | "resume" | "withdraw";

/** The state each move takes the offer to. */
export const PHONE_OFFER_MOVE_TARGET: Record<PhoneOfferMove, "paused" | "active" | "withdrawn"> = {
  pause: "paused",
  resume: "active",
  withdraw: "withdrawn",
};

/**
 * The moves the phone offers on an offer in `state`, in the order the screen draws them.
 *
 * **Resume is `paused → active` only.** `active` is also reached from Ready (publishing) and from
 * Pending (a post's approval), and both are desk work — they ask for the listing's link — so neither
 * is a resume.
 */
export function phoneOfferMoves(state: OfferState): PhoneOfferMove[] {
  const allowed = manualTransitions(state);
  const moves: PhoneOfferMove[] = [];
  if (allowed.includes("paused")) moves.push("pause");
  if (state === "paused" && allowed.includes("active")) moves.push("resume");
  if (allowed.includes("withdrawn")) moves.push("withdraw");
  return moves;
}
