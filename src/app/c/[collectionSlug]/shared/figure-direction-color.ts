import type { FigureDirection } from "@/lib/summary-figure";

/** A gain in the success colour, a loss in the error one — one pair of tokens wherever a profit or a
 * return is shown, so a gain on a sale looks the same as on a purchase or in an offer's price table
 * (#559, #1883, #2227). Neither takes no colour of its own: it did not go any way. */
export const DIRECTION_COLOR: Record<FigureDirection, string | undefined> = {
  gain: "var(--color-success)",
  loss: "var(--color-error)",
  none: undefined,
};
