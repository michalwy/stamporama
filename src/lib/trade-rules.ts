// The trade vocabulary (#646; ADR-0039): statuses and their legal transitions, the two sides, and
// how a section's balance rule resolves against its trade's.
//
// Pure — no Prisma, no I/O, no `server-only` — so the domain module, the index screen, the trade
// screen (#637) and the balancing engine (#638) all read the same rules instead of each spelling
// them out. Nothing anywhere reads a status column's *spelling* for meaning; it comes from here.

/**
 * A trade's lifecycle, in order.
 *
 * - `preparing` — composing. Nothing has left the building.
 * - `shared` — the partner's link is live (#640). *Partner has responded* is deliberately **not** a
 *   status but a derived badge (#641): a round of negotiation would otherwise mean clicking a state
 *   back and forth by hand.
 * - `agreed` — both sides have committed. Valuations freeze and the list locks against editing,
 *   because the partner is holding a copy of it and silently changing what was agreed is how a
 *   trade turns into an argument.
 * - `closed` — both parcels have arrived and the incoming material has been identified (#644).
 *
 * `cancelled` sits outside the line and is reachable from anywhere before `closed`.
 *
 * **Shipping is not in here.** `sentAt` / `receivedAt` are two timestamps because the parcels cross
 * in the post and arrive in either order; folding them into this list would force an ordering the
 * world does not have. The same split `Purchase` makes between its delivery status and its lot
 * lifecycle.
 */
export const TRADE_STATUSES = [
  "preparing",
  "shared",
  "agreed",
  "closed",
  "cancelled",
] as const;

export type TradeStatus = (typeof TRADE_STATUSES)[number];

const VALID_TRADE_STATUS = new Set<string>(TRADE_STATUSES);

export function isTradeStatus(value: string): value is TradeStatus {
  return VALID_TRADE_STATUS.has(value);
}

export const TRADE_STATUS_LABEL: Record<TradeStatus, string> = {
  preparing: "Preparing",
  shared: "Shared",
  agreed: "Agreed",
  closed: "Closed",
  cancelled: "Cancelled",
};

/**
 * Where each status can go next.
 *
 * Forwards along the line, and **one step back** at every stage that has not yet been settled —
 * un-sharing a list, or undoing an agreement both sides have since reconsidered, are things that
 * really happen, and an app that only moves forward gets worked around by deleting the trade and
 * retyping it. `closed` is the exception and is terminal here: closing carries the incoming material
 * into the collection with a cost basis (#644), so what un-closing would have to undo is that issue's
 * decision to make, not this one's.
 *
 * `cancelled` is reachable from every live status and leads back to `preparing`: a partner who goes
 * quiet for three months and then writes is not a reason to retype the list.
 */
export const TRADE_STATUS_TRANSITIONS: Record<TradeStatus, readonly TradeStatus[]> = {
  preparing: ["shared", "cancelled"],
  shared: ["agreed", "preparing", "cancelled"],
  agreed: ["closed", "shared", "cancelled"],
  closed: [],
  cancelled: ["preparing"],
};

export function canTransitionTrade(from: TradeStatus, to: TradeStatus): boolean {
  return TRADE_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * The one transition that takes a settled list apart again: `agreed → shared` (#642).
 *
 * It is named apart from the rest because it is a **decision, not a fact**. Recording that a piece
 * was withdrawn or never arrived leaves the trade agreed — the agreement stands and reality is noted
 * beside it — while this reopens the negotiation, unlocks the list and shows the partner that it has
 * moved. Two different moves, and the menu says which is which; calling this one *Mark shared* would
 * make undoing a handshake read like a filing action.
 *
 * Every other backward step (`shared → preparing`, `cancelled → preparing`) is not this: nothing was
 * settled to reopen.
 */
export function isTradeReopen(from: TradeStatus, to: TradeStatus): boolean {
  return from === "agreed" && to === "shared";
}

/** What a transition is called on the menu. */
export function tradeTransitionLabel(from: TradeStatus, to: TradeStatus): string {
  if (isTradeReopen(from, to)) return "Reopen the negotiation";
  return `Mark ${TRADE_STATUS_LABEL[to].toLowerCase()}`;
}

/** What it says it will do, where that is not obvious from the word. */
export function tradeTransitionHint(from: TradeStatus, to: TradeStatus): string | undefined {
  if (isTradeReopen(from, to)) {
    return "Unlocks the list and shows your partner that it has changed. What you have recorded about the parcels stays on the lines.";
  }
  if (to === "closed") {
    return "Both parcels are accounted for. Every line needs a verdict first — sent, arrived, withdrawn or never arrived.";
  }
  return undefined;
}

/**
 * Whether the trade's contents — its sections and its lines — may still be edited (#637).
 *
 * `agreed` locks the list: the partner holds a copy of it. Recording that reality diverged from the
 * agreement is a different act with its own shape (#642), never an edit made quietly to the thing
 * both sides shook hands on. `closed` and `cancelled` are history and are read-only for the same
 * reason.
 *
 * The trade's own header — the partner, the notes, the shipping timestamps — is **not** governed by
 * this: recording that the parcel went out is not a change to what was agreed.
 */
export function isTradeContentEditable(status: TradeStatus): boolean {
  return status === "preparing" || status === "shared";
}

/** The colour a status chip is drawn in, as the app's own semantic tokens. `preparing` is the plain
 * muted chip — a trade being composed has nothing to announce — and `cancelled` takes the same, not
 * error red: calling a trade off is a decision, not a fault. */
export const TRADE_STATUS_TONE: Record<TradeStatus, "muted" | "info" | "accent" | "success"> = {
  preparing: "muted",
  shared: "info",
  agreed: "accent",
  closed: "success",
  cancelled: "muted",
};

/**
 * Which side of the trade a line is on.
 *
 * The two are **not symmetric**, and that is why this is an axis rather than two optional columns on
 * one row: a `give` line names a concrete copy in the collection, a `receive` line cannot, because
 * the partner's stamps are in nobody's inventory. There is no pairing between them either — two
 * independent bags, and the counts routinely differ.
 */
export const TRADE_SIDES = ["give", "receive"] as const;
export type TradeSide = (typeof TRADE_SIDES)[number];

const VALID_TRADE_SIDE = new Set<string>(TRADE_SIDES);

export function isTradeSide(value: string): value is TradeSide {
  return VALID_TRADE_SIDE.has(value);
}

/** Named from the collector's end, because that is whose screen this is. */
export const TRADE_SIDE_LABEL: Record<TradeSide, string> = {
  give: "I give",
  receive: "I receive",
};

/**
 * How a trade is judged balanced (#638 computes the verdict; this is the rule it computes against).
 *
 * `countTolerance` is in **pieces**, `valueTolerancePct` and `ownValueWarnPct` in **percent** — two
 * units, so two fields, never one number whose meaning depends on the mode.
 */
export interface TradeBalanceRule {
  balanceByValue: boolean;
  countTolerance: number;
  valueTolerancePct: number;
  ownValueWarnPct: number;
}

/** A section's rule as stored: either wholly absent, or wholly present. */
export interface TradeBalanceOverride {
  balanceByValue: boolean | null;
  countTolerance: number | null;
  valueTolerancePct: number | null;
  ownValueWarnPct: number | null;
}

/**
 * The rule in force for one section.
 *
 * **A section inherits the trade's rule whole or states its own** — there is no per-field fallback.
 * Two half-inherited settings would be two things to keep in step for no gain, and "tolerance 0
 * because the trade said so" and "tolerance 0 because this section says so" would be indistinguish-
 * able on screen. `balanceByValue` is the column that says which: null means inherit everything.
 *
 * Pass `null` for the section to get the trade's own rule, which is what the whole-trade totals are
 * judged against.
 */
export function resolveBalanceRule(
  trade: TradeBalanceRule,
  section: TradeBalanceOverride | null
): TradeBalanceRule & { inherited: boolean } {
  if (!section || section.balanceByValue === null) return { ...trade, inherited: true };
  return {
    balanceByValue: section.balanceByValue,
    countTolerance: section.countTolerance ?? 0,
    valueTolerancePct: section.valueTolerancePct ?? 0,
    ownValueWarnPct: section.ownValueWarnPct ?? trade.ownValueWarnPct,
    inherited: false,
  };
}

/**
 * How the trade's balance rule reads on a row, in a few words: "By value ±5%" / "By count ±2".
 *
 * One sentence rather than two chips, because the mode and its tolerance are one fact — a tolerance
 * with no mode beside it is a number nobody can interpret.
 */
export function describeBalanceRule(rule: TradeBalanceRule): string {
  if (rule.balanceByValue) {
    const pct = trimNumber(rule.valueTolerancePct);
    return pct === "0" ? "By value" : `By value ±${pct}%`;
  }
  return rule.countTolerance === 0
    ? "By count"
    : `By count ±${rule.countTolerance}`;
}

/** `5.00` → `5`, `5.50` → `5.5`. The tolerances arrive as 2-dp strings from a DECIMAL column and
 * almost always end in zeros; printing them raw would put "±5.00%" on every row. */
function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Whether both parcels are accounted for — the derived half of the shipping pair.
 *
 * Derived and never stored: two timestamps already say everything, and a third column agreeing with
 * them is a third column that can disagree with them.
 */
export function isTradeShippingComplete(sentAt: unknown, receivedAt: unknown): boolean {
  return sentAt != null && receivedAt != null;
}

/**
 * How a trade names a handful of subjects in one sentence: `#00012 Chopin, #00013 Kopernik, and 4
 * more`.
 *
 * Five is what fits in a sentence; past that the count is the useful half and the collector opens
 * the screen anyway. One implementation, because every refusal a trade makes names its offenders
 * this way — the unvalued lines (#638), the copies a listing collides with and the ones that have
 * left (#639) — and two of them counting differently would read as two different kinds of fault.
 */
export function nameFew(labels: readonly string[]): string {
  const named = labels.slice(0, NAMED_LIMIT);
  const rest = labels.length - named.length;
  if (rest <= 0) return named.join(", ");
  return `${named.join(", ")}, and ${rest} more`;
}

/** How many subjects {@link nameFew} names before it starts counting. */
const NAMED_LIMIT = 5;
