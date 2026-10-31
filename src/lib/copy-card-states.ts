// Which holding states the Copies card of a stamp's and an issue's page shows (#2281): the copies
// still held, those gone on a sale or a closed trade, and those written off — the states **Attach
// existing copies** already offers (#2120). Only Held is on by default, so the card first looks as it
// did before it had chips. Remembered per collection, the same on both pages. Pure (no React /
// Prisma), so the rules are unit-tested here and the card only draws them; the Offers card's chips
// (#2263, `offer-card-states.ts`) are the same shape.

/** Where a copy stands. *Gone* is one value for a sale and a trade because the Copies list asks it as
 *  one question (*Include sold & traded*, #644). In this order: the server counts them in it. */
export const HOLDING_STATES = ["held", "gone", "disposed"] as const;
export type HoldingState = (typeof HOLDING_STATES)[number];

export function isHoldingState(value: string): value is HoldingState {
  return (HOLDING_STATES as readonly string[]).includes(value);
}

/** The chips' labels — the attach picker's words. */
export const HOLDING_STATE_LABEL: Record<HoldingState, string> = {
  held: "Held",
  gone: "Sold & traded",
  disposed: "No longer held",
};

/** How the card names the copies a chip hides, in a sentence: *2 sold & traded, 1 written off*. */
const HIDDEN_LABEL: Record<HoldingState, string> = {
  held: "held",
  gone: "sold & traded",
  disposed: "written off",
};

/** The states shown before the collector has switched any chip. */
export const DEFAULT_SHOWN_HOLDING_STATES: readonly HoldingState[] = ["held"];

/** How "every chip switched off" is stored — `""` already means the default. */
const NONE_SHOWN = "none";

/**
 * The states a stored value shows, in {@link HOLDING_STATES}' order. Nothing stored — and a value
 * naming no state the app still has — reads as the default.
 */
export function parseShownHoldingStates(raw: string | null | undefined): HoldingState[] {
  if (!raw) return [...DEFAULT_SHOWN_HOLDING_STATES];
  if (raw === NONE_SHOWN) return [];
  const named = new Set(raw.split(",").map((s) => s.trim()));
  const shown = HOLDING_STATES.filter((s) => named.has(s));
  return shown.length === 0 ? [...DEFAULT_SHOWN_HOLDING_STATES] : shown;
}

/** How a choice is written — `""` for the default, so the default is stored as nothing. */
export function writeShownHoldingStates(shown: readonly HoldingState[]): string {
  const set = new Set(shown);
  const ordered = HOLDING_STATES.filter((s) => set.has(s));
  if (ordered.length === 0) return NONE_SHOWN;
  const isDefault =
    ordered.length === DEFAULT_SHOWN_HOLDING_STATES.length &&
    DEFAULT_SHOWN_HOLDING_STATES.every((s) => set.has(s));
  return isDefault ? "" : ordered.join(",");
}

/** Switch one state's chip on or off. Any number may be on together, none included. */
export function toggleShownHoldingState(
  shown: readonly HoldingState[],
  state: HoldingState
): HoldingState[] {
  const set = new Set(shown);
  if (set.has(state)) set.delete(state);
  else set.add(state);
  return HOLDING_STATES.filter((s) => set.has(s));
}

export type HoldingCounts = Record<HoldingState, number>;

/** One chip: a state the card has copies in, and how many. A state with none gets no chip. */
export interface HoldingStateCount {
  state: HoldingState;
  count: number;
}

/**
 * The chips of a card, from the counts of the copies that are this stamp (or of this issue) and of
 * those that only may be (#1651) — the chips filter both lists, so a state either has copies in gets
 * a chip, counting both.
 */
export function holdingStateChips(...counts: (HoldingCounts | undefined)[]): HoldingStateCount[] {
  return HOLDING_STATES.map((state) => ({
    state,
    count: counts.reduce((sum, c) => sum + (c?.[state] ?? 0), 0),
  })).filter((c) => c.count > 0);
}

/** How many of the counted copies the chips leave in view — the card's heading. */
export function countShown(counts: HoldingCounts | undefined, shown: readonly HoldingState[]): number {
  if (!counts) return 0;
  return shown.reduce((sum, state) => sum + counts[state], 0);
}

/** What the card says when its chips leave nothing in view — `2 sold & traded, 1 written off
 * hidden` — so a card with copies never reads as empty. */
export function hiddenCopiesText(
  chips: readonly HoldingStateCount[],
  shown: readonly HoldingState[]
): string {
  const on = new Set(shown);
  const parts = chips
    .filter((c) => !on.has(c.state))
    .map((c) => `${c.count} ${HIDDEN_LABEL[c.state]}`);
  return `${parts.join(", ")} hidden`;
}
