// The wording the lots toolbar's two single-select dropdowns wear (#1070), kept pure and out of the
// panel so it can be unit-tested — `describeCopyGrouping` (`lib/copy-grouping.ts`) is the same split
// for the Copies list's grouping control, and for the same reason: a trigger label that summarises
// what a panel holds is a rule, and a rule belongs where a test can read it.
//
// **Why these two controls are dropdowns at all.** Three of the toolbar's chip groups were
// single-select — signals, outcomes, closing windows — and a group of N chips of which at most one
// is ever lit is exactly what one dropdown expresses in one control (#1019, decided by the user on
// 2026-09-10). Two of the three folded; the signals did not, because their counts are the reason to
// look at the screen at all. The reasoning is in `docs/agents/auctions.md`.

import type { AuctionClosingWindow } from "@/lib/auctions";
import { AUCTION_LOT_OUTCOME_LABEL, type AuctionLotOutcome } from "@/lib/auction-rules";

/**
 * The closing windows offered on the toolbar. *Ended* is the one that earns its keep: those lots are
 * muted in the list on purpose, so this is how you go and find them — and it is the control the user
 * failed to find among sixteen chips, which is what #1019 and this change exist for.
 *
 * Two labels rather than one, because the two places they are read want different lengths. `label`
 * is the option row and the trigger, where the control's own name (*Closing*) is already beside it;
 * `bandLabel` is the narrowed-list band under the toolbar (#1018), where the filter is named in a
 * run of others with nothing to say which dimension it came from. Keeping `bandLabel` as the wording
 * that band already used is deliberate: the band's job is to name a filter so it can be found, and
 * changing what it says is a change to the one announcement #1018 bought.
 */
export const CLOSING_WINDOWS: {
  value: AuctionClosingWindow;
  label: string;
  bandLabel: string;
}[] = [
  { value: "today", label: "Today", bandLabel: "Closing today" },
  { value: "week", label: "This week", bandLabel: "This week" },
  { value: "ended", label: "Ended", bandLabel: "Ended" },
];

/** The *any* row of the closing dropdown — the absence of the filter, drawn as an option because a
 * dropdown has no "untick the lit one" gesture the way a row of chips does. */
export const CLOSING_ANY_LABEL = "Any time";

/** The *any* row of the outcome dropdown. Named after the dimension rather than "All", because
 * *All outcomes* would promise the mixed list and *Show closed* in the panel below is what actually
 * decides whether one is shown. */
export const OUTCOME_ANY_LABEL = "Any outcome";

/**
 * An option row's label with its facet count, spelled exactly as `All sellers (3)` already is on
 * this toolbar (#1029) — one spelling for a counted option, whether it lives in a native `<select>`
 * or in a portaled panel.
 *
 * `undefined` draws the label bare, which is `FilterChip`'s own rule while the first count fetch is
 * in flight: a chip that flashes a zero has said something false.
 */
export function withCount(label: string, count: number | undefined): string {
  return count === undefined ? label : `${label} (${count})`;
}

/**
 * What the closed **Closing** control reads.
 *
 * Deliberately not the picked option's own label — `SingleSelectFilter` keeps the two apart (#868)
 * — because the trigger has to name the *dimension* as well as the value: `Ended` on its own says
 * nothing about which of five controls set it, and the whole point of folding these chips is that
 * the collector can find the thing that is narrowing the list.
 */
export function describeLotClosingFilter(closing: AuctionClosingWindow | undefined): string {
  const window = CLOSING_WINDOWS.find((w) => w.value === closing);
  return `Closing: ${window ? window.label : "any"}`;
}

/**
 * What the closed **Outcome** control reads — the value, and a summary of the switch in its panel.
 *
 * `Show closed` lives inside this control (#1070) because it exists solely to relax this group's
 * single-select (#504): with no outcome picked the list holds open lots alone, and the switch is
 * what brings the finished ones back. It qualifies the choice rather than being one of the choices,
 * which is `ui-patterns.md`'s line between a footer and an option — and #868's `footer` is the
 * shape for exactly that.
 *
 * So the trigger has to say it, or the one thing a lit chip used to announce at rest is announced
 * nowhere: the band under the toolbar never names `Show closed` and never should, since it
 * **widens** the list (#1018) and a band saying lots are hidden would be saying the opposite of
 * what happened. It is stated only while it is doing something — with an outcome picked the switch
 * has no say, which is the state the panel draws it disabled in.
 */
export function describeLotOutcomeFilter(
  outcome: AuctionLotOutcome | undefined,
  includeClosed: boolean
): string {
  if (outcome) return `Outcome: ${AUCTION_LOT_OUTCOME_LABEL[outcome]}`;
  return includeClosed ? "Outcome: any + closed" : "Outcome: any";
}
