// What the collector typed into the bulk-lot wizard (#759, the server half of #756): the criteria
// vocabulary, its round trip through a query string, and the texts derived from it.
//
// Pure — no Prisma, no React — for the same reason `lot-builder-rules.ts` is: the wizard (#760)
// writes these into the URL, the proposal endpoint and the commit read them back out, and the three
// must agree to the character. State lives in the URL because **the commit re-plans** (#717): there
// is nothing stored between opening the wizard and pressing commit, so the query string *is* the
// proposal, and a parameter parsed loosely at one end would plan a different lot at the other.
//
// The structural axes live here beside the pure ones deliberately. `LotCriteria` in the rules module
// is what survives the SQL — the pick's own inputs — and everything else (platform, area, years,
// conditions, formats) is spent narrowing the pool. Splitting them across two modules would leave
// the wizard holding two half-criteria and no single thing to serialize.

import type {
  DuplicatePolicy,
  LotCriteria,
  SeriesPreference,
} from "./lot-builder-rules";

/** Everything the wizard holds: the structural narrowing and the pick's own targets. */
export interface LotBuilderCriteria {
  /** The platform the lot is for. Every availability clause is judged against it (#259, #334,
   *  #506), so it is an input to the pool read and not a choice made at commit. */
  platformId: string;
  /** The area the lot is drawn from, or null for the whole collection. **One** area, resolved
   *  server-side — unlike the Copies list, which is handed the resolved set by its sidebar, the lot
   *  needs the root itself to name the lot after it. */
  areaId: string | null;
  /** Whether {@link areaId} brings everything under it (#385). The area rail's *+ sub-areas / this
   *  area only* toggle, which every other screen resolves on the client into a list of ids — this
   *  one cannot, because it keeps the root to name the lot after and because **the commit re-plans
   *  from the query string alone** (#717): a scope the client resolved away would be a criterion the
   *  server never saw, and the lot committed would not be the lot on screen. Absent from the address
   *  when true, so it is what a link written before this existed still means. */
  areaSubtree: boolean;
  /** Inclusive bounds on `stamp.issuedYear` (#142/#322). Either alone; a stamp with no year is
   *  outside every span. */
  yearFrom: number | null;
  yearTo: number | null;
  /** Allowed conditions — an OR, empty meaning every condition. */
  conditionIds: string[];
  /** Allowed physical formats — an OR, empty meaning every format. `"single"` is a value like any
   *  other and matches the copies with no format (ADR-0020). */
  formatIds: string[];
  /** Per-copy catalog-value ceiling, applied in the rules and not in the `where` (#758). */
  maxCatalogValue: number | null;
  countMin: number | null;
  countMax: number | null;
  valueMin: number | null;
  valueMax: number | null;
  series: SeriesPreference;
  /** How many copies of one stamp — rolled up through variants — the lot may hold. */
  maxPerStamp: number | null;
  duplicates: DuplicatePolicy;
}

/** The whole proposal request: the criteria, plus the three things a round of closing in adds. */
export interface LotBuilderRequest {
  criteria: LotBuilderCriteria;
  /** The pick is randomized; the seed is what makes it reproducible, and a re-roll is a new one. */
  seed: string;
  pinnedItemIds: string[];
  rejectedItemIds: string[];
}

const SERIES_PREFERENCES: readonly SeriesPreference[] = [
  "preferComplete",
  "preferSingles",
  "neutral",
];

const DUPLICATE_POLICIES: readonly DuplicatePolicy[] = ["preferDuplicates", "neutral"];

/** The pick's own inputs, extracted from the criteria the wizard holds. Everything left behind was
 *  spent on the `where`. */
export function toLotCriteria(criteria: LotBuilderCriteria): LotCriteria {
  return {
    maxCatalogValue: criteria.maxCatalogValue,
    count: range(criteria.countMin, criteria.countMax),
    catalogValue: range(criteria.valueMin, criteria.valueMax),
    series: criteria.series,
    maxPerStamp: criteria.maxPerStamp,
    duplicates: criteria.duplicates,
  };
}

/** An axis with neither bound is "no opinion" and must stay null — the rules read a null range as
 *  nothing to fill toward, and `{min: null, max: null}` would say the same thing in a shape that
 *  reads as a target. */
function range(min: number | null, max: number | null) {
  return min === null && max === null ? null : { min, max };
}

// ── The recipe ──────────────────────────────────────────────────────────────────────────────────

/**
 * The half of the criteria a **preset** keeps (#773): how a lot of this kind is picked, with nothing
 * about *which* lot.
 *
 * Stating eleven controls is most of the work of building a lot, and a collector who builds the same
 * kind of lot repeatedly retypes all eleven and mistypes some. What repeats is the recipe — "about a
 * hundred pieces, used, nothing dearer than five, deepest piles first, at most two of a stamp" — so
 * that is what is named and kept.
 *
 * **The platform and the area are deliberately not in it.** The area is precisely what *varies*
 * between two lots of one kind: the same recipe is meant to be run over Germany and then over
 * Poland, and a preset that carried the area would need one copy per area. The platform is a select
 * the collector must state anyway before the screen says anything at all, and it is picked per
 * sitting rather than per kind of lot. The subtree scope goes with the area for the same reason.
 *
 * The seed, the pins and the rejections are not criteria at all — they are one lot's own closing-in
 * (#760), and a preset carrying them would propose the same hundred copies for ever.
 *
 * Declared here, beside the criteria it is drawn from, so *which fields are the recipe* is stated
 * **once**: the preset table's columns, the save and the apply all read it off this one type, and a
 * criterion added to the wizard is a compile error here rather than a field that silently stops
 * being remembered.
 */
export type LotRecipeKey =
  | "yearFrom"
  | "yearTo"
  | "conditionIds"
  | "formatIds"
  | "maxCatalogValue"
  | "countMin"
  | "countMax"
  | "valueMin"
  | "valueMax"
  | "series"
  | "maxPerStamp"
  | "duplicates";

export type LotRecipe = Pick<LotBuilderCriteria, LotRecipeKey>;

/** The keys, as a value — what the mapping to and from a stored preset iterates. */
export const LOT_RECIPE_KEYS: readonly LotRecipeKey[] = [
  "yearFrom",
  "yearTo",
  "conditionIds",
  "formatIds",
  "maxCatalogValue",
  "countMin",
  "countMax",
  "valueMin",
  "valueMax",
  "series",
  "maxPerStamp",
  "duplicates",
];

/** What the collector is looking at, as a recipe worth keeping. Takes anything carrying the recipe's
 *  keys — the whole criteria, or a recipe being copied — and answers with the recipe alone. */
export function toLotRecipe(criteria: LotRecipe): LotRecipe {
  return {
    yearFrom: criteria.yearFrom,
    yearTo: criteria.yearTo,
    conditionIds: [...criteria.conditionIds],
    formatIds: [...criteria.formatIds],
    maxCatalogValue: criteria.maxCatalogValue,
    countMin: criteria.countMin,
    countMax: criteria.countMax,
    valueMin: criteria.valueMin,
    valueMax: criteria.valueMax,
    series: criteria.series,
    maxPerStamp: criteria.maxPerStamp,
    duplicates: criteria.duplicates,
  };
}

/**
 * A recipe over the criteria in force. **Whole, never merged**: applying a preset that says nothing
 * about the year span has to *clear* a year span the collector left lying about from the last lot,
 * or a preset would mean something different depending on what was on screen when it was applied —
 * which is the one thing a saved recipe must not do.
 *
 * Everything outside the recipe passes through untouched, which is what leaves the platform, the
 * area and its subtree scope exactly as the collector has them.
 */
export function applyLotRecipe(
  criteria: LotBuilderCriteria,
  recipe: LotRecipe
): LotBuilderCriteria {
  return { ...criteria, ...toLotRecipe(recipe) };
}

// ── The query string ────────────────────────────────────────────────────────────────────────────

/** A finite number, or null for blank / absent / unparseable. Anything unrecognised is dropped
 *  rather than refused: a criterion that fails to parse is one the collector has not set yet, and
 *  the wizard is answered live while it is being typed into. */
function num(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Read a proposal request off a query string. */
export function parseLotBuilderRequest(params: URLSearchParams): LotBuilderRequest {
  const series = params.get("series") as SeriesPreference | null;
  const duplicates = params.get("duplicates") as DuplicatePolicy | null;
  return {
    criteria: {
      platformId: params.get("platform") ?? "",
      areaId: params.get("area") || null,
      // Only the exact word turns it off. Anything else — absent, empty, a typo — is the tree, which
      // is both the toggle's own default and the reading every existing link was written under.
      areaSubtree: params.get("areaScope") !== "self",
      yearFrom: num(params.get("yearFrom")),
      yearTo: num(params.get("yearTo")),
      conditionIds: params.getAll("condition").filter(Boolean),
      formatIds: params.getAll("format").filter(Boolean),
      maxCatalogValue: num(params.get("maxValue")),
      countMin: num(params.get("countMin")),
      countMax: num(params.get("countMax")),
      valueMin: num(params.get("valueMin")),
      valueMax: num(params.get("valueMax")),
      series: series && SERIES_PREFERENCES.includes(series) ? series : "neutral",
      maxPerStamp: num(params.get("maxPerStamp")),
      duplicates:
        duplicates && DUPLICATE_POLICIES.includes(duplicates) ? duplicates : "neutral",
    },
    seed: params.get("seed") ?? "",
    pinnedItemIds: params.getAll("pin").filter(Boolean),
    rejectedItemIds: params.getAll("reject").filter(Boolean),
  };
}

/** The same request written back out — what the wizard puts in the URL and what the commit is
 *  handed. Round-trips {@link parseLotBuilderRequest}: an unset criterion is an absent parameter
 *  rather than an empty one, so two identical requests produce one identical address. */
export function lotBuilderSearchParams(request: LotBuilderRequest): URLSearchParams {
  const { criteria } = request;
  const params = new URLSearchParams();
  params.set("platform", criteria.platformId);
  if (criteria.areaId) params.set("area", criteria.areaId);
  // Written only when it is *not* the default, and only when there is an area for it to be about:
  // `areaScope=self` with no area is a narrowing of the whole collection to nothing in particular.
  if (criteria.areaId && !criteria.areaSubtree) params.set("areaScope", "self");
  putNum(params, "yearFrom", criteria.yearFrom);
  putNum(params, "yearTo", criteria.yearTo);
  for (const id of criteria.conditionIds) params.append("condition", id);
  for (const id of criteria.formatIds) params.append("format", id);
  putNum(params, "maxValue", criteria.maxCatalogValue);
  putNum(params, "countMin", criteria.countMin);
  putNum(params, "countMax", criteria.countMax);
  putNum(params, "valueMin", criteria.valueMin);
  putNum(params, "valueMax", criteria.valueMax);
  params.set("series", criteria.series);
  putNum(params, "maxPerStamp", criteria.maxPerStamp);
  params.set("duplicates", criteria.duplicates);
  if (request.seed) params.set("seed", request.seed);
  for (const id of request.pinnedItemIds) params.append("pin", id);
  for (const id of request.rejectedItemIds) params.append("reject", id);
  return params;
}

function putNum(params: URLSearchParams, key: string, value: number | null): void {
  if (value !== null) params.set(key, String(value));
}

// ── The suggested texts ─────────────────────────────────────────────────────────────────────────

/**
 * What the wizard's title and description fields are pre-filled with.
 *
 * **Not a nicety.** Left blank, the platform's own template renders over a hundred unrelated stamps
 * and `compactCatalogNumberGroups` (#379) emits a dozen catalog ranges — comfortably past a
 * `maxTitleLength` (#403), and since #636 an over-long text blocks `preparing → ready`. A blank
 * default would land every bulk lot unable to reach ready, so the offer is created with these and
 * `nameEdited` / `descriptionEdited` set: the flag means *do not regenerate this*, and regeneration
 * is precisely what produces the unusable title. The `edited` chip then says why the name stops
 * following later composition changes.
 *
 * Both are a starting point the collector types over, so this states only what it can keep saying.
 */
export interface LotTextFacts {
  /** The area the lot was drawn from, or null when it spans the collection. */
  areaName: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  /** The conditions the criteria allowed, in the collection's own order. Empty = every condition,
   *  which the text then says nothing about. */
  conditionNames: readonly string[];
  /** Copies **actually picked** — never the count target. The pick stops at the floor of the range
   *  and an atomic series overshoots it, so a target of 100 routinely lands at 103; a title saying
   *  100 over a 103-piece lot is wrong the moment it is written. */
  pieceCount: number;
  /** Distinct stamps in the lot, rolled up through variants — the variety a job-lot buyer is
   *  buying, and the one figure worth stating beyond the count. */
  distinctStamps: number;
  /** Complete series the lot carries whole. */
  completeSets: number;
}

export interface LotSuggestedTexts {
  name: string;
  description: string;
}

export function suggestLotTexts(facts: LotTextFacts): LotSuggestedTexts {
  const span = yearSpan(facts.yearFrom, facts.yearTo);
  const pieces = `${facts.pieceCount} ${plural(facts.pieceCount, "stamp")}`;

  // The name leads with what the lot is *of*, because that is what a buyer scans a listing index by.
  const scope = [facts.areaName, span].filter(Boolean).join(" ");
  const name = scope ? `${scope}, ${pieces}` : `Bulk lot of ${pieces}`;

  const opening = [
    `Bulk lot of ${pieces}`,
    facts.areaName ? ` from ${facts.areaName}` : "",
    span ? `, issued ${span}` : "",
    ".",
  ].join("");
  const variety =
    `${facts.distinctStamps} different ${plural(facts.distinctStamps, "stamp")}` +
    (facts.completeSets > 0
      ? `, including ${facts.completeSets} complete ${plural(facts.completeSets, "set")}.`
      : ".");
  // The catalogue-value sum is deliberately **not** here. It is the claim a job-lot buyer decides
  // on and it reads as authoritative, so nobody re-checks it — and frozen with
  // `descriptionEdited = true` it never refreshes: `listingContentChangedAt` (#542/#700) fires only
  // for listed states, so trimming copies while the offer is still `preparing` would drift the
  // figure with no signal anywhere. The collector has the true sum on that very screen (#378) the
  // moment they want to type it, so the default saves almost nothing and risks misdescribing the
  // goods — the failure the listing kit refuses outright rather than emit (#405). Variety stays:
  // the drift is bounded and non-monetary.
  const lines = [opening, variety];
  if (facts.conditionNames.length > 0) {
    lines.push(`Conditions: ${facts.conditionNames.join(", ")}.`);
  }
  return { name, description: lines.join("\n") };
}

/** `1950`, `1950–1960`, `from 1950`, `to 1960`, or "" when neither bound was set. */
function yearSpan(from: number | null, to: number | null): string {
  if (from !== null && to !== null) return from === to ? String(from) : `${from}–${to}`;
  if (from !== null) return `from ${from}`;
  if (to !== null) return `to ${to}`;
  return "";
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
