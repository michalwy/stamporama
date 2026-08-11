// What a want accepts, and what a copy satisfies (#532; ADR-0032 §8). Pure: no Prisma, no I/O, so
// the intake review, the want list and any later consumer — the browser assistant, trade — cannot
// disagree about what "could satisfy" means.
//
// The one rule the whole module is built on: **an empty acceptance set means "any"**, and a `null`
// *member* of a set is a value of its own — "no certificate" (ADR-0006 §2) and "single" (see
// `StampFormat`). Those two are different states and the shape has to keep them apart.

/**
 * `high` | `normal` | `low` — what to chase first, not a queue position. Several wants share a
 * priority and nothing orders within one.
 *
 * Here rather than in `wants.ts` because the want form, the list toolbar and the row all render it,
 * and `wants.ts` is `server-only`.
 *
 * **Stored as its rank**, an `Int`, not as the word. The list is ordered by priority and paged on
 * the server, so the database has to sort it — and the only order Postgres can put a `text` column
 * in is its spelling, where `high < low < normal` is not what anybody means. A rank column sorts
 * correctly and indexes with the rest of the ordering; the word never reaches the database, and the
 * wire, the form and the filter all keep speaking it. One column, not a word plus a rank that must
 * agree with it.
 */
export const WANT_PRIORITIES = ["high", "normal", "low"] as const;
export type WantPriority = (typeof WANT_PRIORITIES)[number];

export function isWantPriority(value: string): value is WantPriority {
  return (WANT_PRIORITIES as readonly string[]).includes(value);
}

export const WANT_PRIORITY_LABEL: Record<WantPriority, string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
};

/**
 * The colour a priority chip is drawn in, as the app's own semantic tokens.
 *
 * Three **visibly different** steps, which is the whole job of the colour: a scale whose middle and
 * bottom look alike is a scale you have to read the word off, and then the colour is decoration.
 * So each rank gets its own token rather than a shade of one — amber, blue, grey.
 *
 * `high` borrows **warning**, not error: chasing this first is an intention, not a fault, and error
 * red is what this app spends on things that are wrong. `normal` takes **info**, the neutral-but-
 * present blue. `low` is the plain muted chip the other facts on the row use — the one rank that
 * genuinely has nothing to say gets the colour that says nothing.
 */
export const WANT_PRIORITY_CHIP: Record<
  WantPriority,
  { background: string; color: string; border: string }
> = {
  high: {
    background: "var(--color-warning-soft)",
    color: "var(--color-warning)",
    border: "var(--color-warning-border)",
  },
  normal: {
    background: "var(--color-info-soft)",
    color: "var(--color-info)",
    border: "var(--color-info-border)",
  },
  low: {
    background: "var(--color-bg-muted)",
    color: "var(--color-text-muted)",
    border: "transparent",
  },
};

/** The stored value. Ascending rank *is* descending urgency, so a plain `ORDER BY` reads right. */
export const WANT_PRIORITY_RANK: Record<WantPriority, number> = { high: 0, normal: 1, low: 2 };

/** Rank → word. An unknown rank reads as `normal` rather than throwing: a row is not worth losing
 *  over a value a future migration left behind. */
export function wantPriorityFromRank(rank: number): WantPriority {
  return WANT_PRIORITIES.find((p) => WANT_PRIORITY_RANK[p] === rank) ?? "normal";
}

/** A want's acceptance, as the three sets. Ids only — nothing here needs a dictionary row. */
export interface WantAcceptance {
  stampId: string;
  /** Acceptable conditions. Empty = any. Never contains null: `Item.conditionId` is required. */
  conditionIds: string[];
  /** Acceptable certificate statuses. Empty = any; `null` is the "no certificate" member. */
  certificateStatusIds: (string | null)[];
  /** Acceptable formats. Empty = any; `null` is the "single" member. */
  formatIds: (string | null)[];
}

/** The four facts about a copy that a want is answered against. */
export interface WantCandidateCopy {
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
}

/**
 * A copy that has just been taken in, as the intake review knows it (ADR-0032 §7).
 *
 * Declared here, in the pure module, so `lots.ts` can hand its freshly created copies straight to
 * the review without either side importing the other's I/O.
 */
export interface ArrivingCopy extends WantCandidateCopy {
  /** The created `Item`, so the dialog can name the copy the wants are being judged against. */
  itemId: string;
  /** Internal copy number (#268), for that same naming — `#00123` reads better than an id. */
  itemNo: number;
}

/** One axis: an empty set narrows nothing, and a set contains its `null` member as a value. */
function axisAccepts<T extends string | null>(accepted: T[], value: T): boolean {
  return accepted.length === 0 || accepted.includes(value);
}

/**
 * Whether this copy is one the want would take.
 *
 * Not "is the want now met" — that is the collector's call at intake (ADR-0032 §7). This answers
 * only which wants are worth putting in front of them.
 */
export function wantMatchesCopy(want: WantAcceptance, copy: WantCandidateCopy): boolean {
  if (want.stampId !== copy.stampId) return false;
  if (!axisAccepts(want.conditionIds, copy.conditionId)) return false;
  if (!axisAccepts(want.certificateStatusIds, copy.certificateStatusId)) return false;
  if (!axisAccepts(want.formatIds, copy.formatId)) return false;
  return true;
}

/**
 * What the narrow editor opens with when a copy arrives against an open want (ADR-0032 §7).
 *
 * A **seed, not a rule**. The app cannot know that MNH is "better than" used — nothing in the
 * condition dictionary says so, and §2 is the reason it never will. What it can do is take the one
 * step that is certainly right: the condition that just arrived is no longer wanted.
 *
 * - Set already narrower than "anything" → returned unchanged. The collector has answered this
 *   question once already, and overwriting that answer is what a seed must never do.
 * - Set empty ("anything") → every condition **except** the arrived one, from the dictionary's
 *   membership and never from its order.
 *
 * Every box is editable before saving, and a seed that empties the set (a one-condition dictionary)
 * is returned empty — which reads as "anything" again, and is honest: there is nothing left to
 * narrow to.
 */
export function narrowConditionSeed(
  allConditionIds: string[],
  arrivedConditionId: string,
  currentConditionIds: string[]
): string[] {
  if (currentConditionIds.length > 0) return [...currentConditionIds];
  return allConditionIds.filter((id) => id !== arrivedConditionId);
}
