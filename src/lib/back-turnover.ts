// How a card's backs were made (#1555) — the vocabulary of `ScanSheet.turnover` and
// `Collection.lastBackTurnover`, and the two things each answer decides.
//
// Pure — no Prisma, no DOM. The batch line, the commit path and the unit tests all read it, and the
// first is a client component.
//
// Until #1555 a back scan was made one way: every stamp turned over **in place** and the card scanned
// again, so a back sat where its front did. Turning forty stamps one by one is slow, and a card laid
// in a transparent sleeve can be turned over **whole** instead. The scan looks the same; the
// positions are mirrored — the back of the top-left stamp is top-right after a turn left to right,
// bottom-left after a turn top to bottom.

import type { QuarterTurn } from "./tile-turn";

export type BackTurnover = "in_place" | "card_left_right" | "card_top_bottom";

/** In the order the choice is offered: today's way first. */
export const BACK_TURNOVERS: readonly BackTurnover[] = [
  "in_place",
  "card_left_right",
  "card_top_bottom",
];

export function isBackTurnover(value: unknown): value is BackTurnover {
  return value === "in_place" || value === "card_left_right" || value === "card_top_bottom";
}

/** A stored string as a turnover. Anything the application did not write reads as `in_place` — the
 * one way every back was made before the column existed. */
export function asBackTurnover(value: string | null | undefined): BackTurnover {
  return isBackTurnover(value) ? value : "in_place";
}

/** What each way is called where it is chosen. */
export const BACK_TURNOVER_LABEL: Record<BackTurnover, string> = {
  in_place: "Each stamp turned over in place",
  card_left_right: "Whole card turned left to right",
  card_top_bottom: "Whole card turned top to bottom",
};

/**
 * How far a back made this way is turned to stand the right way up beside its front.
 *
 * A stamp turned over in place, or a card turned left to right, is turned about its **vertical**
 * axis, and its back comes up the right way round. A card turned **top to bottom** is turned about
 * its horizontal axis, which is the same as turning it left to right and then a half-turn — so every
 * back on it lies upside down. The back's picture is cut turned by this much; the scan itself is
 * never touched (ADR-0049 §6).
 */
export function turnoverBackTurn(turnover: BackTurnover): QuarterTurn {
  return turnover === "card_top_bottom" ? 180 : 0;
}
