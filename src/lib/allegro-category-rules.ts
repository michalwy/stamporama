/**
 * What learning an Allegro category needs **on top of** the shared register — kept pure.
 *
 * The key, the relaxation ladder, the matching and the "Learned from …" sentence all moved to
 * `platform-category-rules.ts` when the register went platform-generic (#609): they are decisions
 * about *this collection's* stamps and relax the same way whichever marketplace is being asked.
 * What is left here is the part that is genuinely Allegro's — the **parameters** a category demands
 * (ADR-0026 §1), which Delcampe has none of, and the wording for the one suggestion source no other
 * platform has, Allegro's own guess at the listing title.
 */

import {
  type LearnedCategoryMatchFacts,
  NOTHING_LEARNED_SENTENCE,
  explainLearnedCategoryMatch,
} from "./platform-category-rules";

// ---------------------------------------------------------------------------
// What a match says it was matched on
// ---------------------------------------------------------------------------

/** Where a suggestion came from. `learned` is a row of the register; `allegro` is Allegro's own
 *  `matching-categories` guess from the title; `none` is a manual pick and no suggestion at all.
 *
 *  Allegro's own three, not the register's: the middle one exists because Allegro has an endpoint
 *  that will guess from a title, and a marketplace without one (Delcampe) simply has two. */
export type CategorySuggestionSource = "learned" | "allegro" | "none";

/** The facts a sentence is built from, so the wording lives in one place rather than in every screen
 *  that shows a suggestion. */
export interface CategoryMatchFacts extends LearnedCategoryMatchFacts {
  source: CategorySuggestionSource;
}

/**
 * One sentence saying where an Allegro suggestion came from.
 *
 * Always says something: a suggestion the collector cannot account for is one they have to check by
 * hand every time, which costs more than it saves. Two of the three answers are the shared ones —
 * only Allegro's own guess is Allegro's to word.
 */
export function explainCategoryMatch(facts: CategoryMatchFacts): string {
  if (facts.source === "none") return NOTHING_LEARNED_SENTENCE;
  if (facts.source === "allegro") return "Allegro's own suggestion from the listing title.";
  return explainLearnedCategoryMatch(facts);
}

// ---------------------------------------------------------------------------
// Parameter values
// ---------------------------------------------------------------------------

/** A value as Allegro takes it in `parameters[]`. Every member is optional because which one applies
 *  is the parameter's type's business, and this app has no reason to decide that for it. */
export interface AllegroParameterValue {
  valuesIds?: string[];
  values?: string[];
  rangeValue?: { from: string | null; to: string | null };
}

/** Whether a remembered value says anything. An empty one is not worth recalling and is not worth
 *  storing — a parameter the collector left blank last time teaches nothing about this time. */
export function isBlankParameterValue(value: AllegroParameterValue): boolean {
  const empty = (list?: string[]) => !list || list.length === 0 || list.every((v) => !v.trim());
  if (!empty(value.valuesIds) || !empty(value.values)) return false;
  const range = value.rangeValue;
  return !range || (!range.from?.trim() && !range.to?.trim());
}

/** Narrow whatever came back out of the register's JSON column to a value this app will send. A row
 *  written by an older shape, or hand-edited in the database, is dropped rather than trusted: the
 *  cost of ignoring it is one parameter to fill in, and the cost of sending it is a refused publish. */
export function readParameterValue(raw: unknown): AllegroParameterValue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;

  const strings = (input: unknown): string[] | undefined =>
    Array.isArray(input) && input.every((v) => typeof v === "string") ? (input as string[]) : undefined;

  const value: AllegroParameterValue = {};
  const valuesIds = strings(row.valuesIds);
  if (valuesIds) value.valuesIds = valuesIds;
  const values = strings(row.values);
  if (values) value.values = values;

  const range = row.rangeValue;
  if (range && typeof range === "object" && !Array.isArray(range)) {
    const r = range as Record<string, unknown>;
    value.rangeValue = {
      from: typeof r.from === "string" ? r.from : null,
      to: typeof r.to === "string" ? r.to : null,
    };
  }

  if (Object.keys(value).length === 0) return null;
  return isBlankParameterValue(value) ? null : value;
}

/** One parameter's answer while a field is open. Kept as strings, which is what every input gives
 *  back and what Allegro takes for everything but a dictionary's ids. */
export interface AllegroParameterDraft {
  valuesIds: string[];
  values: string[];
  from: string;
  to: string;
}

/** A stored value as a field opens on it. Shared by the two surfaces that answer a parameter — the
 *  category picker's form (#488) and the offer card's inline edit (#494) — so the same stored value
 *  opens the same way in both. */
export function parameterDraft(value: AllegroParameterValue | null | undefined): AllegroParameterDraft {
  return {
    valuesIds: value?.valuesIds ?? [],
    values: value?.values ?? [],
    from: value?.rangeValue?.from ?? "",
    to: value?.rangeValue?.to ?? "",
  };
}

/** A draft as Allegro takes it, or null where nothing was answered — a blank parameter is left out
 *  rather than sent empty, which is what a category's optional fields expect. Which member applies is
 *  the parameter's own business: a dictionary answers by option id, a range by a pair. */
export function parameterValueFromDraft(
  parameter: { type: string; range: boolean },
  draft: AllegroParameterDraft
): AllegroParameterValue | null {
  if (parameter.type === "dictionary") {
    const ids = draft.valuesIds.filter((id) => id.trim());
    return ids.length > 0 ? { valuesIds: ids } : null;
  }
  if (parameter.range) {
    const from = draft.from.trim();
    const to = draft.to.trim();
    return from || to ? { rangeValue: { from: from || null, to: to || null } } : null;
  }
  const values = draft.values.filter((value) => value.trim());
  return values.length > 0 ? { values } : null;
}
