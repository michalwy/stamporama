// What the want and checklist operations answer with, and the projections that build it (#712).
//
// **Pure, and structurally typed on purpose**, exactly as `collection-reads.ts` (#710) and
// `offer-reads.ts` (#711) are and for their reason (`agent-api.md`, *The module layout is the
// Prisma-free split*): `WantListItem` carries a want's whole read model and a projection naming its
// type would stop being readable as a statement of what an agent is actually told. Everything here
// is a function of plain rows and returns plain objects — no Prisma, no `server-only` — so
// `pnpm test:unit` holds the decisions.
//
// Three of those decisions are worth the file on their own:
//
//  - **An acceptance set is spelled in words and an empty one means *any***. That is ADR-0032 §1's
//    own rule, and it is the one thing about a want an agent cannot guess from the shape.
//  - **The nullable members are spelled rather than dropped**, which is the opposite of what #710
//    does with a copy's null certificate and null format — see {@link ANY_VALUE} below for why the
//    two cases genuinely differ.
//  - **The two copy tallies are never merged**, because only one of them may say something is on
//    its way (#532).

import { catalogLabels, compact, subtypeName } from "./collection-reads";
import type { CatalogLabelRow } from "./collection-reads";

// ── Acceptance sets ──────────────────────────────────────────────────────────

/**
 * How a **null member** of an acceptance set is spelled to an agent.
 *
 * A null certificate status *is* a value — "no certificate" (ADR-0006 §2) — and a null format *is*
 * the single (ADR-0020); neither has a dictionary row, so neither has a name to send.
 *
 * **#710 drops them from a copy and this keeps them, and that is not an inconsistency.** On a copy
 * the null is the *whole* answer, so its absence says exactly what spelling it would: a row with no
 * `format` is a single. Here the null is **one member of a set**, and dropping it would change the
 * set's meaning outright — `{null, "PZF"}` means *with no certificate, or with a PZF one*, and
 * dropped it reads as *PZF only*, which is a different want.
 *
 * **The parentheses are load-bearing.** Nothing stops a collector naming a certificate status
 * literally `No certificate`, and a bare word would then be indistinguishable from that row's own
 * name. A parenthesised phrase is not a name any of these dictionaries can hold.
 */
export const NO_CERTIFICATE = "(no certificate)";
export const SINGLE_FORMAT = "(single)";

/**
 * What an empty acceptance set means, said in the response rather than left to be inferred.
 *
 * **Zero rows means *any*** (ADR-0032 §1), and that is the single most misreadable thing about a
 * want: an agent handed `"conditions": []` will read it as *accepts nothing* about half the time,
 * and then tell the collector that a want they can plainly satisfy cannot be satisfied. So the
 * empty set comes back carrying this one token instead of empty, and the operation's own result
 * description says so.
 */
export const ANY_VALUE = "(any)";

/** Resolve an acceptance axis to the names an agent reads, keeping {@link ANY_VALUE} for the empty
 *  set and `fallback` for the axis's own null member. */
export function acceptanceNames(
  ids: readonly (string | null)[],
  names: ReadonlyMap<string, string>,
  fallback: string | null
): string[] {
  if (ids.length === 0) return [ANY_VALUE];
  return ids.map((id) => (id === null ? (fallback ?? ANY_VALUE) : (names.get(id) ?? id)));
}

// ── Copy tallies ─────────────────────────────────────────────────────────────

/**
 * What the collection has of a wanted stamp, split four ways.
 *
 * **It is a split and never one number** (#532). A want stays open until the collector closes it —
 * correct, the stamp is not here — but an *ordered* copy then looks exactly like no copy, and the
 * same stamp at the next auction reads as an untouched gap. Held, on-the-desk-unsorted and
 * on-its-way are three different answers to *should I be chasing this*.
 */
export interface AgentCopyTally {
  readonly held: number;
  /** Arrived and not filed yet. Its own bucket rather than folded into `held`: *in a pile on the
   *  desk* is a different answer from *in the collection* to somebody deciding whether to buy
   *  another one. */
  readonly toSort: number;
  readonly ordered: number;
  readonly inTransit: number;
}

export interface CopyTallyRow {
  readonly held: number;
  readonly toSort: number;
  readonly ordered: number;
  readonly inTransit: number;
}

export function copyTally(row: CopyTallyRow): AgentCopyTally {
  return { held: row.held, toSort: row.toSort, ordered: row.ordered, inTransit: row.inTransit };
}

// ── list_wants ───────────────────────────────────────────────────────────────

/** What a want's catalogue figure comes to, and how much of the want is behind it. */
export interface AgentWantCatalogRange {
  readonly min: string;
  readonly max: string;
  readonly currency: string;
  /**
   * Accepted combinations carrying a usable price, over how many the want accepts at all. **The
   * pair travels with the figure or neither does** (`valuation.md`): a range built from one
   * combination in twenty-four is a real range and is not the whole story, and a figure that did
   * not say so would read as one.
   */
  readonly pricedCombinations: number;
  readonly acceptedCombinations: number;
  /** Some contributing figure was inferred — a lowest-variant estimate (#238), or a format derived
   *  from the single by a multiplier (ADR-0020) — rather than read off a catalogue. */
  readonly estimated?: boolean;
}

/**
 * One want.
 *
 * **`conditions`, `certificates` and `formats` are the whole of what a want *is***, beside the
 * stamp: ADR-0032 makes a want a stamp plus an acceptance set per axis, and "at least this grade"
 * is deliberately inexpressible — `StampCondition.sortOrder` is display order, `U` and `MNG` are
 * cancellation and gum rather than two points on a scale, and any minimum-quality rule would invent
 * an ordering the dictionary does not guarantee.
 *
 * **There is no price on a want and there never was** — one was built and dropped before it meant
 * anything (`20260811140000_want_drop_max_price`), because a want has no date and a figure on it is
 * a price opinion frozen the day it was typed. `catalogRange` is computed now, from the catalogue,
 * over the combinations the want accepts; it is not a ceiling the collector set.
 */
export interface AgentWant {
  readonly wantId: string;
  readonly stampId: string;
  readonly stamp?: string;
  /** The want points at a base stamp that has variants — any of them would do. */
  readonly unknownVariant?: boolean;
  readonly subtype?: string;
  readonly catalogNumbers: string[];
  readonly issue?: string;
  readonly issueYear?: number;
  /** `high`, `normal` or `low`. Stored as a rank so the list can order by it; the word is what
   *  crosses the wire. */
  readonly priority: string;
  readonly conditions: string[];
  readonly certificates: string[];
  readonly formats: string[];
  readonly notes?: string;
  /** Present only on a want the collector has closed. An open want carries nothing here. */
  readonly closedAt?: string;
  readonly createdAt: string;
  /**
   * Everything the collection holds **of this stamp**, whichever want it does or does not answer.
   * This is the *upgrade* context: a mint-only want against a used copy in hand counts nothing in
   * {@link copiesMatching} and *you already have one, just not that one* is exactly what somebody
   * standing at a dealer's table needs to know.
   */
  readonly copiesOfStamp: AgentCopyTally;
  /**
   * Copies that would satisfy **this** want. **The only figure allowed to say something is already
   * on its way**: a used copy in the post satisfies a want for "anything" and a mint-only want not
   * at all, so one tally over the stamp would tell a collector to stop chasing the mint copy they
   * were right to chase.
   */
  readonly copiesMatching: AgentCopyTally;
  readonly catalogRange?: AgentWantCatalogRange;
  readonly path: string;
}

/** The row shape `listWantsPaginated` states a want in, narrowed to what is published. */
export interface WantRow {
  readonly id: string;
  readonly stampId: string;
  readonly stampName: string | null;
  readonly unknownVariant: boolean;
  readonly subtype: { readonly name: string; readonly isDefault: boolean } | null;
  readonly issueName: string | null;
  readonly issueYear: number | null;
  readonly priority: string;
  readonly conditionIds: readonly string[];
  readonly certificateStatusIds: readonly (string | null)[];
  readonly formatIds: readonly (string | null)[];
  readonly notes: string | null;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly copies: CopyTallyRow;
  readonly matchingCopies: CopyTallyRow;
  readonly catalogRange: {
    readonly minBase: string;
    readonly maxBase: string;
    readonly baseCurrency: string;
    readonly pricedCombinations: number;
    readonly totalCombinations: number;
    readonly estimated: boolean;
  } | null;
}

/** The dictionaries a want's ids are read through — the vocabulary the agent was told to send. */
export interface AcceptanceNames {
  readonly conditions: ReadonlyMap<string, string>;
  readonly certificateStatuses: ReadonlyMap<string, string>;
  readonly formats: ReadonlyMap<string, string>;
}

export interface WantContext {
  readonly catalogNumbers: readonly CatalogLabelRow[];
  readonly names: AcceptanceNames;
  readonly path: string;
}

export function want(row: WantRow, context: WantContext): AgentWant {
  return compact({
    wantId: row.id,
    stampId: row.stampId,
    stamp: row.stampName ?? undefined,
    unknownVariant: row.unknownVariant || undefined,
    subtype: subtypeName(row.subtype) ?? undefined,
    catalogNumbers: catalogLabels(context.catalogNumbers),
    issue: row.issueName ?? undefined,
    issueYear: row.issueYear ?? undefined,
    priority: row.priority,
    conditions: acceptanceNames(row.conditionIds, context.names.conditions, null),
    certificates: acceptanceNames(
      row.certificateStatusIds,
      context.names.certificateStatuses,
      NO_CERTIFICATE
    ),
    formats: acceptanceNames(row.formatIds, context.names.formats, SINGLE_FORMAT),
    notes: row.notes ?? undefined,
    closedAt: row.closedAt ?? undefined,
    createdAt: row.createdAt,
    copiesOfStamp: copyTally(row.copies),
    copiesMatching: copyTally(row.matchingCopies),
    catalogRange: row.catalogRange
      ? compact({
          min: row.catalogRange.minBase,
          max: row.catalogRange.maxBase,
          currency: row.catalogRange.baseCurrency,
          pricedCombinations: row.catalogRange.pricedCombinations,
          acceptedCombinations: row.catalogRange.totalCombinations,
          estimated: row.catalogRange.estimated || undefined,
        })
      : undefined,
    path: context.path,
  });
}

// ── match_wants ──────────────────────────────────────────────────────────────

/** One open want a piece of material would satisfy, named leanly. */
export interface AgentWantHit {
  readonly wantId: string;
  readonly priority: string;
  readonly notes?: string;
}

/**
 * One stamp asked about, answered.
 *
 * **The row states whether it is wanted *and* what the collection already holds of it**, which is
 * the whole point of asking about a counterparty's material: *I want this* and *I have three
 * already* are both answers, and only the pair decides anything. It is #710's and #711's own move —
 * a holdings row states its own location, an unlisted-copy row states its own worth — so there is no
 * second verb for *do I hold this*.
 *
 * **`wants` is empty rather than absent when nothing matches**, because *no* is the answer the
 * caller asked for. A stamp that matched nothing is not a stamp that was dropped.
 */
export interface AgentWantMatch {
  readonly stampId: string;
  readonly stamp?: string;
  readonly catalogNumbers: string[];
  readonly issue?: string;
  readonly issueYear?: number;
  /** The grade the question was asked at, echoed back — an answer about a key is unreadable without
   *  the key, and the caller sent one grade for every stamp in the batch. */
  readonly condition: string;
  readonly certificate: string;
  readonly format: string;
  readonly wants: AgentWantHit[];
  readonly copiesOfStamp: AgentCopyTally;
}

export interface WantMatchRow {
  readonly stampId: string;
  readonly stampName: string | null;
  readonly issueName: string | null;
  readonly issueYear: number | null;
  readonly wants: readonly {
    readonly id: string;
    readonly priority: string;
    readonly notes: string | null;
  }[];
  readonly copies: CopyTallyRow;
}

export interface WantMatchContext {
  readonly catalogNumbers: readonly CatalogLabelRow[];
  readonly condition: string;
  readonly certificate: string;
  readonly format: string;
}

export function wantMatch(row: WantMatchRow, context: WantMatchContext): AgentWantMatch {
  return compact({
    stampId: row.stampId,
    stamp: row.stampName ?? undefined,
    catalogNumbers: catalogLabels(context.catalogNumbers),
    issue: row.issueName ?? undefined,
    issueYear: row.issueYear ?? undefined,
    condition: context.condition,
    certificate: context.certificate,
    format: context.format,
    wants: row.wants.map((hit) =>
      compact({ wantId: hit.id, priority: hit.priority, notes: hit.notes ?? undefined })
    ),
    copiesOfStamp: copyTally(row.copies),
  });
}

// ── find_checklist_gaps ──────────────────────────────────────────────────────

/** One stamp a checklist names and the collection has no copy of. */
export interface AgentChecklistGapStamp {
  readonly stampId: string;
  readonly stamp?: string;
  readonly catalogNumbers: string[];
  /**
   * An open want **on the same wide-open terms** already covers this gap, so *add what is missing*
   * would write nothing for it. Absent where there is none, which is what makes the missing list
   * readable as a shopping list.
   *
   * **Wide-open terms and not merely *some* want**, because that is the generator's own rule
   * (`wantGapForStamps`): a second want for "anything" beside a want for "anything" says nothing
   * the first does not, while a mint-only want beside it is a *different intent* about one stamp,
   * which ADR-0032 §1 makes a want-per-terms to express. Mirroring that here is what keeps this
   * answer and the button on the completeness card from disagreeing.
   */
  readonly alreadyWanted?: boolean;
}

/**
 * One checklist's gap.
 *
 * **Per checklist, never over an issue's merged membership**, and that is #531/#661's rule rather
 * than an arrangement: which member a variant copy answers for is a question about *one*
 * membership, so a `226yw` copy answers the basic list as `226` and the specialized one as itself.
 * Asked of the union it would answer for the specialized list and leave the basic list's umbrella
 * looking missing — wanting a stamp the completeness card on the same screen calls held.
 */
export interface AgentChecklistGap {
  readonly checklistId: string;
  readonly name: string;
  /** Stamps on the checklist — the denominator of everything else here. */
  readonly required: number;
  /** Members the collection has a counted copy of, **through the variant tree**: a copy filed under
   *  a variant of a listed stamp is a copy of it (#661). `required` minus `missing.length`. */
  readonly held: number;
  readonly missing: AgentChecklistGapStamp[];
}

export interface AgentChecklistGaps {
  readonly issueId: string;
  readonly issue?: string;
  readonly issueYear?: number;
  readonly checklists: AgentChecklistGap[];
  readonly path: string;
}

export interface ChecklistGapRow {
  readonly checklistId: string;
  readonly name: string;
  readonly required: number;
  readonly missing: readonly {
    readonly stampId: string;
    readonly stampName: string | null;
    readonly catalogNumbers: readonly CatalogLabelRow[];
    readonly alreadyWanted: boolean;
  }[];
}

export function checklistGap(row: ChecklistGapRow): AgentChecklistGap {
  return {
    checklistId: row.checklistId,
    name: row.name,
    required: row.required,
    held: row.required - row.missing.length,
    missing: row.missing.map((stamp) =>
      compact({
        stampId: stamp.stampId,
        stamp: stamp.stampName ?? undefined,
        catalogNumbers: catalogLabels(stamp.catalogNumbers),
        alreadyWanted: stamp.alreadyWanted || undefined,
      })
    ),
  };
}
