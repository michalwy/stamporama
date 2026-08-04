/**
 * The decisions behind learning an Allegro category from what was already listed (#488; ADR-0026),
 * kept pure.
 *
 * Same split as `allegro-sale-rules.ts` beside `allegro-sale.ts`: what an offer's key *is*, which
 * order the lookup relaxes in, and what a match should say it was matched on are **rules**, and
 * rules that live inside the module doing the reads and writes are rules nobody tests.
 * `allegro-category.ts` is the half that queries and records; it makes no judgement of its own.
 *
 * Nothing here knows Allegro's taxonomy. It knows what the collection knows about a stamp — its
 * area, year, condition and subtype — and how to ask progressively broader questions with it.
 */

// ---------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------

/** One copy of an offer, narrowed to the four facts the key is derived from. `areaId` is the
 *  stamp's **primary** area (`StampCollectionArea.isPrimary`), which is the node the tree is walked
 *  up from. */
export interface CategoryKeyCopy {
  areaId: string | null;
  issuedYear: number | null;
  conditionId: string | null;
  subtypeId: string | null;
}

/**
 * The key an offer looks its category up by.
 *
 * Every part is nullable, and null means **absent from this key** rather than "no value"
 * (ADR-0026 §2). Two different things produce one and both mean the same thing to lookup: the offer
 * is mixed on that axis, or the fact simply does not exist — a stamp with no year, a stamp on the
 * collection's default subtype.
 */
export interface AllegroCategoryKey {
  areaId: string | null;
  issuedYear: number | null;
  conditionId: string | null;
  subtypeId: string | null;
}

/** Which axes the copies disagreed about, so a screen can say why a key is narrower than it looks
 *  rather than leaving the collector to guess that the bundle is mixed. */
export interface AllegroCategoryKeyDerivation {
  key: AllegroCategoryKey;
  /** The axes present in the copies but not agreed on. Empty for a homogeneous offer. */
  mixedOn: CategoryKeyAxis[];
}

export type CategoryKeyAxis = "area" | "year" | "condition" | "subtype";

/** The value every copy agrees on, or null where they do not — the whole of the mixed-offer rule,
 *  applied to one axis at a time. A copy carrying null on the axis counts as a disagreement with a
 *  copy that carries a value: "some of them have a year" is not a year. */
function agreedValue<T extends string | number>(values: (T | null)[]): { value: T | null; mixed: boolean } {
  if (values.length === 0) return { value: null, mixed: false };
  const first = values[0];
  for (const value of values) {
    if (value !== first) return { value: null, mixed: true };
  }
  return { value: first, mixed: false };
}

/**
 * Derive an offer's key from its copies.
 *
 * Each of the four facts is derived **independently**: a fact the copies agree on enters the key,
 * one they disagree on is left null and is treated by lookup as already relaxed. A bundle of 1935
 * and 1938 Polish used definitives still asks a useful question — it just does not ask it about a
 * year — which is a great deal better than the all-or-nothing rule, under which a mixed offer would
 * never be able to learn anything at all.
 */
export function deriveAllegroCategoryKey(copies: CategoryKeyCopy[]): AllegroCategoryKeyDerivation {
  const area = agreedValue(copies.map((c) => c.areaId));
  const year = agreedValue(copies.map((c) => c.issuedYear));
  const condition = agreedValue(copies.map((c) => c.conditionId));
  const subtype = agreedValue(copies.map((c) => c.subtypeId));

  const mixedOn: CategoryKeyAxis[] = [];
  if (area.mixed) mixedOn.push("area");
  if (year.mixed) mixedOn.push("year");
  if (condition.mixed) mixedOn.push("condition");
  if (subtype.mixed) mixedOn.push("subtype");

  return {
    key: {
      areaId: area.value,
      issuedYear: year.value,
      conditionId: condition.value,
      subtypeId: subtype.value,
    },
    mixedOn,
  };
}

/** Whether a key asks anything at all. A key with nothing in it matches every row ever recorded,
 *  which is not a suggestion but a coin toss — lookup skips straight to Allegro's own guess. */
export function isEmptyCategoryKey(key: AllegroCategoryKey): boolean {
  return (
    key.areaId === null &&
    key.issuedYear === null &&
    key.conditionId === null &&
    key.subtypeId === null
  );
}

// ---------------------------------------------------------------------------
// The relaxation ladder
// ---------------------------------------------------------------------------

/**
 * One rung of the ladder — a **filter over rows**, not a row lookup.
 *
 * Lessons are recorded with the fullest key the offer supported, so a rung that has dropped the year
 * still has to match rows that *have* one: `issuedYear: null` here means "any year", never "rows
 * whose year is null". For the same reason `areaIds` is a node **and all of its descendants**, which
 * is what makes a lesson learned on Poland → Provinces reach a stamp filed under Poland → Republic.
 */
export interface CategoryLookupTier {
  /** The area node this rung asks about, and every area below it. Empty when the key has no area. */
  areaIds: string[];
  /** The node itself, for reporting and for ranking a match by how close it was. Null with `areaIds`
   *  empty. */
  areaId: string | null;
  /** How far up the tree this rung is: 0 is the offer's own area, 1 its parent, and so on. */
  areaDistance: number;
  issuedYear: number | null;
  conditionId: string | null;
  subtypeId: string | null;
  /** Which axes this rung has given up, in the order it gave them up. */
  relaxed: CategoryKeyAxis[];
}

/**
 * The ordered rungs a key is looked up by (ADR-0026 §3).
 *
 * The exact key, then without the year, then without the subtype as well, then one level up the area
 * tree and the same three again, until the root runs out.
 *
 * The year goes first because it is by far the sparsest part of the key: exact years are what make
 * the register slow to become useful, and a 1936 stamp learning nothing from a 1935 one is the
 * failure this whole feature exists to avoid. **The condition is never dropped** — used and mint are
 * different categories on Allegro far more often than they are the same one, and a suggestion that
 * crosses that line is worse than no suggestion.
 *
 * @param areaPath the offer's area and its ancestors, **nearest first**. Empty for a key with no
 *                 area, which leaves one rung per year/subtype combination and nothing to walk.
 * @param descendantsOf every area's own id together with its descendants'.
 */
export function categoryLookupTiers(
  key: AllegroCategoryKey,
  areaPath: string[],
  descendantsOf: (areaId: string) => string[]
): CategoryLookupTier[] {
  const areaRungs: { areaId: string | null; areaIds: string[]; distance: number; relaxed: boolean }[] =
    areaPath.length > 0
      ? areaPath.map((areaId, index) => ({
          areaId,
          areaIds: descendantsOf(areaId),
          distance: index,
          // Anything above the offer's own node is a broader question than the key asked.
          relaxed: index > 0,
        }))
      : [{ areaId: null, areaIds: [], distance: 0, relaxed: false }];

  // Within one area: the year first, then the subtype. A part that is already null is not something
  // this can give up, so the rung it would have produced is dropped rather than repeated.
  const drops: CategoryKeyAxis[][] = [[], ["year"], ["year", "subtype"]];

  const tiers: CategoryLookupTier[] = [];
  const seen = new Set<string>();

  for (const area of areaRungs) {
    for (const dropped of drops) {
      const dropsYear = dropped.includes("year");
      const dropsSubtype = dropped.includes("subtype");
      const issuedYear = dropsYear ? null : key.issuedYear;
      const subtypeId = dropsSubtype ? null : key.subtypeId;

      const relaxed: CategoryKeyAxis[] = [];
      if (dropsYear && key.issuedYear !== null) relaxed.push("year");
      if (dropsSubtype && key.subtypeId !== null) relaxed.push("subtype");
      if (area.relaxed) relaxed.push("area");

      const tier: CategoryLookupTier = {
        areaIds: area.areaIds,
        areaId: area.areaId,
        areaDistance: area.distance,
        issuedYear,
        conditionId: key.conditionId,
        subtypeId,
        relaxed,
      };

      // A key with no year and no subtype produces the same question three times over; asking it
      // once is the same answer and two fewer round-trips.
      const fingerprint = `${area.areaId ?? ""}|${issuedYear ?? ""}|${key.conditionId ?? ""}|${subtypeId ?? ""}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      tiers.push(tier);
    }
  }

  return tiers;
}

// ---------------------------------------------------------------------------
// Matching rows against the ladder
// ---------------------------------------------------------------------------

/** One learned row, narrowed to what matching and ranking need. */
export interface MatchableLesson {
  id: string;
  areaId: string | null;
  issuedYear: number | null;
  conditionId: string | null;
  subtypeId: string | null;
  categoryId: string;
  timesUsed: number;
  /** Epoch milliseconds, so ranking never depends on how a caller spells a date. */
  lastUsedAt: number;
}

/**
 * Whether one recorded row answers one rung.
 *
 * A rung constrains only the parts it still asks about: `issuedYear: null` on the rung means "any
 * year", and a row's own null on a part the rung *does* ask about does not match — a row recorded
 * off a mixed offer says nothing about the axis it was mixed on, so it must not be offered as an
 * answer for a stamp that has one.
 */
export function lessonMatchesTier(row: MatchableLesson, tier: CategoryLookupTier): boolean {
  if (tier.areaIds.length > 0 && (row.areaId === null || !tier.areaIds.includes(row.areaId))) {
    return false;
  }
  if (tier.issuedYear !== null && row.issuedYear !== tier.issuedYear) return false;
  if (tier.conditionId !== null && row.conditionId !== tier.conditionId) return false;
  if (tier.subtypeId !== null && row.subtypeId !== tier.subtypeId) return false;
  return true;
}

/**
 * The best row the ladder reaches, and the rung it was reached on.
 *
 * The rungs are already in order, so the first one with any match wins outright — that is what
 * "relaxes rather than fails" means, and a broader rung must never outrank a narrower one however
 * well backed its rows are. Within a rung the row recorded on the rung's **own** area comes first
 * (a lesson from this very branch beats one from a sibling), then the best-supported, then the most
 * recent: correcting a suggestion and publishing again is a lesson, and the newer choice is the one
 * the collector meant.
 */
export function pickLessonForTiers(
  rows: MatchableLesson[],
  tiers: CategoryLookupTier[]
): { lesson: MatchableLesson; tier: CategoryLookupTier } | null {
  for (const tier of tiers) {
    const matches = rows.filter((row) => lessonMatchesTier(row, tier));
    if (matches.length === 0) continue;
    matches.sort((a, b) => {
      const own = (row: MatchableLesson) => (tier.areaId !== null && row.areaId === tier.areaId ? 0 : 1);
      return own(a) - own(b) || b.timesUsed - a.timesUsed || b.lastUsedAt - a.lastUsedAt;
    });
    return { lesson: matches[0], tier };
  }
  return null;
}

// ---------------------------------------------------------------------------
// What a match says it was matched on
// ---------------------------------------------------------------------------

/** Where a suggestion came from. `learned` is a row of the register; `allegro` is Allegro's own
 *  `matching-categories` guess from the title; `none` is a manual pick and no suggestion at all. */
export type CategorySuggestionSource = "learned" | "allegro" | "none";

/** The facts a sentence is built from, so the wording lives in one place rather than in every screen
 *  that shows a suggestion. */
export interface CategoryMatchFacts {
  source: CategorySuggestionSource;
  /** Names of the key parts that *were* matched on, in key order — "Poland", "1935", "used". */
  matchedOn: string[];
  relaxed: CategoryKeyAxis[];
  timesUsed: number | null;
}

const AXIS_WORDS: Record<CategoryKeyAxis, string> = {
  area: "area",
  year: "year",
  condition: "condition",
  subtype: "subtype",
};

/**
 * One sentence saying where a suggestion came from.
 *
 * Always says something: a suggestion the collector cannot account for is one they have to check by
 * hand every time, which costs more than it saves.
 */
export function explainCategoryMatch(facts: CategoryMatchFacts): string {
  if (facts.source === "none") return "Nothing learned yet for this kind of stamp — pick a category.";
  if (facts.source === "allegro") return "Allegro's own suggestion from the listing title.";

  const matched = facts.matchedOn.length > 0 ? facts.matchedOn.join(" · ") : "anything listed here";
  const support =
    facts.timesUsed && facts.timesUsed > 1 ? `, used ${facts.timesUsed} times` : ", used once";

  if (facts.relaxed.length === 0) return `Learned from ${matched}${support}.`;

  const widened = facts.relaxed.map((axis) => AXIS_WORDS[axis]).join(" and ");
  return `Learned from ${matched}${support} — no exact match, so the ${widened} was widened.`;
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
