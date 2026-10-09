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
// conditions, formats) is spent narrowing the pool. The listing choices (the wording, the listing
// type, the Facebook group) narrow nothing; they ride here so the commit makes the offer the screen
// showed and a preset can keep them. Splitting them across two modules would leave
// the wizard holding two half-criteria and no single thing to serialize.

import type {
  DuplicatePolicy,
  LotCriteria,
  SeriesPreference,
} from "./lot-builder-rules";
import { isOfferListingType, type OfferListingType } from "./offer-rules";

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
  /** The listing title and description this lot writes onto its offer, as **templates** (#774).
   *  Criteria like any other — they ride in the address so the commit renders exactly what the
   *  screen previewed — and part of the recipe, because how a kind of lot is *worded* repeats
   *  exactly as much as how it is picked.
   *
   *  **Three states, not two** (#1687). `null` is *not stated*: the wizard keeps the field following
   *  its own suggestion. `""` is *stated empty*: the collector cleared the field, and the offer takes
   *  the platform's own template. Anything else is the lot's own wording. A preset keeps whichever it
   *  was saved with, so a cleared field is a change it can be updated with rather than a value it can
   *  hold but never let go of. Whitespace alone is empty (ADR-0055). */
  nameTemplate: string | null;
  descriptionTemplate: string | null;
  /** How the offer is sold (#1688): `auction` or `fixed` (a quick buy), or null for *not stated* —
   *  the offer then starts as the platform says, which on Facebook is the group's own type (#1671).
   *  Not an input to the pool or the pick; it rides in the address so the commit makes what the
   *  screen showed and a preset can keep it. */
  listingType: OfferListingType | null;
  /** On Facebook, the group the offer is in (#1663, #1688), or null for *not stated* — the screen
   *  then starts on the group last used there. An id rather than a choice the server trusts: the
   *  commit still names the group through its own argument, and a group archived or deleted since
   *  is simply not chosen, which the screen says. Meaningless on every other platform. */
  facebookGroupId: string | null;
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
 * The half of the criteria a **preset** keeps (#773): how a lot of this kind is picked and where it
 * is listed, with nothing about *which* lot.
 *
 * Stating eleven controls is most of the work of building a lot, and a collector who builds the same
 * kind of lot repeatedly retypes all eleven and mistypes some. What repeats is the recipe — "about a
 * hundred pieces, used, nothing dearer than five, deepest piles first, at most two of a stamp" — so
 * that is what is named and kept.
 *
 * **The area is deliberately not in it.** The area is precisely what *varies* between two lots of
 * one kind: the same recipe is meant to be run over Germany and then over Poland, and a preset that
 * carried the area would need one copy per area. The subtree scope goes with the area.
 *
 * **The platform is** (#1688), with the two choices that depend on it — the listing type and, on
 * Facebook, the group. It was left out at first as something picked per sitting; in use a kind of
 * lot turned out to be listed on one platform, and leaving it out meant choosing it by hand on every
 * load. An empty `platformId` is a preset that states none (one saved before this), and applying it
 * leaves all three as they are on screen — see {@link applyLotRecipe}.
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
  | "duplicates"
  | "nameTemplate"
  | "descriptionTemplate"
  | LotPlatformKey;

/** The platform half of the recipe (#1688): the three choices that go together, since the listing
 *  type and the group mean nothing without the platform they were made on. */
export type LotPlatformKey = "platformId" | "listingType" | "facebookGroupId";

export type LotPlatformChoice = Pick<LotBuilderCriteria, LotPlatformKey>;

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
  "nameTemplate",
  "descriptionTemplate",
  "platformId",
  "listingType",
  "facebookGroupId",
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
    nameTemplate: criteria.nameTemplate,
    descriptionTemplate: criteria.descriptionTemplate,
    ...lotPlatformChoice(criteria),
  };
}

/** The platform, its listing type and its Facebook group, alone. */
export function lotPlatformChoice(criteria: LotPlatformChoice): LotPlatformChoice {
  return {
    platformId: criteria.platformId,
    listingType: criteria.listingType,
    facebookGroupId: criteria.facebookGroupId,
  };
}

/** No platform, and so nothing that depends on one — what a preset saved before #1688 holds. */
export const NO_LOT_PLATFORM: LotPlatformChoice = {
  platformId: "",
  listingType: null,
  facebookGroupId: null,
};

/**
 * A recipe over the criteria in force. **Whole, never merged**: applying a preset that says nothing
 * about the year span has to *clear* a year span the collector left lying about from the last lot,
 * or a preset would mean something different depending on what was on screen when it was applied —
 * which is the one thing a saved recipe must not do.
 *
 * Everything outside the recipe passes through untouched, which is what leaves the area and its
 * subtree scope exactly as the collector has them. **The platform half is the one exception to
 * *whole***: a recipe stating no platform — one saved before #1688 — leaves the platform, its listing
 * type and its group as they are on screen, because clearing them would turn every older preset into
 * one that empties the screen it is applied to.
 */
export function applyLotRecipe(
  criteria: LotBuilderCriteria,
  recipe: LotRecipe
): LotBuilderCriteria {
  const own = toLotRecipe(recipe);
  return own.platformId
    ? { ...criteria, ...own }
    : { ...criteria, ...own, ...lotPlatformChoice(criteria) };
}

/**
 * Whether two recipes say the same thing — what tells a preset from the screen it was applied to.
 * Compared through the query string rather than field by field: the criteria's own round trip is
 * what the proposal, the commit and the preset's save are all built on, so two recipes are the same
 * exactly when it says they are. That is also why a cleared field must be written to it (#1687): a
 * value the round trip loses is a change nothing can see.
 */
export function sameLotRecipe(a: LotRecipe, b: LotRecipe): boolean {
  const key = (recipe: LotRecipe) =>
    lotBuilderSearchParams({
      criteria: { ...recipe, areaId: null, areaSubtree: true },
      seed: "",
      pinnedItemIds: [],
      rejectedItemIds: [],
    }).toString();
  return key(a) === key(b);
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
      // Blank and absent are two things (#1687): absent leaves the wizard's suggestion, blank is the
      // collector's cleared field and means the platform's own template. Neither renders an empty
      // listing — the commit sends a blank text as no template of the offer's own.
      nameTemplate: template(params.get("nameTpl")),
      descriptionTemplate: template(params.get("descTpl")),
      // Anything but the two words is *not stated*, as an unknown preference is neutral: a type the
      // offer cannot be made as is one the collector has not chosen.
      listingType: listingType(params.get("type")),
      facebookGroupId: params.get("fbGroup") || null,
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
  putTemplate(params, "nameTpl", criteria.nameTemplate);
  putTemplate(params, "descTpl", criteria.descriptionTemplate);
  if (criteria.listingType) params.set("type", criteria.listingType);
  if (criteria.facebookGroupId) params.set("fbGroup", criteria.facebookGroupId);
  if (request.seed) params.set("seed", request.seed);
  for (const id of request.pinnedItemIds) params.append("pin", id);
  for (const id of request.rejectedItemIds) params.append("reject", id);
  return params;
}

function putNum(params: URLSearchParams, key: string, value: number | null): void {
  if (value !== null) params.set(key, String(value));
}

/** A listing template as the address carries it: absent is *not stated*, an empty parameter is
 *  *stated empty* (#1687), and the text is trimmed at both ends as typed text is everywhere
 *  (ADR-0055) — so whitespace alone is empty, and a trailing newline is not an edit to a preset. */
function template(raw: string | null): string | null {
  return raw === null ? null : raw.trim();
}

function putTemplate(params: URLSearchParams, key: string, value: string | null): void {
  const text = template(value);
  if (text !== null) params.set(key, text);
}

function listingType(raw: string | null): OfferListingType | null {
  return isOfferListingType(raw) ? raw : null;
}

// ── The suggested texts ─────────────────────────────────────────────────────────────────────────

/**
 * What the wizard's title and description fields are pre-filled with — **templates** (#774), in the
 * same `{token}` engine every platform template is written in.
 *
 * **Not a nicety.** Left blank, the platform's own template renders over a hundred unrelated stamps
 * and `compactCatalogNumberGroups` (#379) emits a dozen catalog ranges — comfortably past a
 * `maxTitleLength` (#403), and since #636 an over-long text blocks `preparing → ready`. A blank
 * default would land every bulk lot unable to reach ready.
 *
 * These used to be **finished text**, rendered here from the picked lot and frozen onto the offer
 * with `nameEdited`. That kept the title short and cost the collector what every other listing has:
 * wording that follows what the listing holds. Strike a copy that sold elsewhere and a frozen title
 * still claimed a hundred. As a template the text is both — short by construction, and alive.
 *
 * The consequence is that **only what the engine can still answer may appear in the default**. The
 * area, the year span, the piece count and the conditions can: `{area}`, `{year}`, `{count}` and
 * `{condition}` all resolve over the copies in scope, whenever they are asked. *How many different
 * stamps* and *how many complete sets* cannot — both mean the variant rollup and the checklist read,
 * which this pure engine deliberately knows nothing about — so they are **out of the default text**
 * rather than baked in as numbers that would go stale the first time a copy left. They are on the
 * screen a keystroke away, in the figures bar, for a collector who wants to state them as of today.
 *
 * `{condition}` is also a small correction: the old text listed the conditions the criteria
 * *allowed*, and this one lists the conditions the lot actually **has**.
 */
export interface LotTextFacts {
  /** The area the lot was drawn from, or null when it spans the collection. Used only to decide
   *  whether the template mentions an area at all — the rendered value is `{area}`, read off the
   *  copies, so a lot that loses its last Bavarian copy stops claiming Bavaria. */
  areaName: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  /** The conditions the criteria allowed. Empty = every condition, and the text then says nothing
   *  about them; non-empty puts `{condition}` in, which states the ones actually present. */
  conditionNames: readonly string[];
}

export interface LotSuggestedTexts {
  name: string;
  description: string;
}

export function suggestLotTexts(facts: LotTextFacts): LotSuggestedTexts {
  const hasYears = facts.yearFrom !== null || facts.yearTo !== null;
  const area = facts.areaName ? "{area}" : "";
  const years = hasYears ? "{year}" : "";

  // The name leads with what the lot is *of*, because that is what a buyer scans a listing index by.
  const scope = [area, years].filter(Boolean).join(" ");
  const name = scope ? `${scope}, {count} stamps` : "Bulk lot of {count} stamps";

  const opening = [
    "Bulk lot of {count} stamps",
    area ? ` from ${area}` : "",
    years ? `, issued ${years}` : "",
    ".",
  ].join("");
  // The catalogue-value sum is deliberately **not** here, and now cannot be: it is the claim a
  // job-lot buyer decides on, it reads as authoritative so nobody re-checks it, and there is no token
  // for it. The collector has the true sum on that very screen (#378) the moment they want to type
  // it, so the default saves almost nothing and risks misdescribing the goods — the failure the
  // listing kit refuses outright rather than emit (#405).
  const lines = [opening];
  if (facts.conditionNames.length > 0) lines.push("Conditions: {condition}.");
  return { name, description: lines.join("\n") };
}
