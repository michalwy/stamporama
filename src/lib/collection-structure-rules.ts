/**
 * The collection structure screen's arithmetic (#1401; ADR-0056): which segments a dimension has,
 * which copies fall in each, and the cross-tabulation of two of them.
 *
 * **Every segment is a narrowing of the Copies list.** It carries the list's own URL parameters
 * (`params`), and the screen links its count to the list under the screen's filters with those laid
 * over them. So a segment's `match` must agree with what `buildItemWhere` selects under those
 * parameters, copy for copy — the integration suite (`collection-structure.test.ts`) holds every
 * count to `countItems` of the list its link opens. Two rules make that hold:
 *
 * - **A segment only ever narrows what the screen already shows.** Where the screen is filtered on
 *   the dimension itself, its segments are the values the filter admits (a condition filter on
 *   *Mint, Used* offers those two), and a hierarchical dimension offers the levels *under* the node
 *   the screen is narrowed to. Laying a segment's parameters over the filter then selects the
 *   screen's copies in that segment, which is what `match` counts among them.
 * - **Area, year and subtype are read off the copy's leading stamp**, as the list's filters read
 *   them — settled with the collector on 2026-09-27. A cover carrying stamps from two areas sits in
 *   the area of the stamp that leads it, exactly where the list files it.
 *
 * Pure: no Prisma, no React. `collection-structure.ts` reads the copies and the dictionaries.
 */

import { DELIVERY_STATE_META, type DeliveryState } from "./delivery-state";
import { NO_AREA, decadeOf, decadeValue } from "./list-area-year-filter";
import { DEFAULT_TAG_FILTER_MODE, NO_TAGS, tagFilterFromParams, type TagFilterMode } from "./tag-filter";
import { copiesListAreaId, copiesListDecade, copiesListRailYear } from "./copies-list-url";

/** The copies filed nowhere — `location-groups.ts`' `NO_LOCATION`, spelled here so this module does
 *  not pull that one's sort helpers in with it. Held equal by the unit suite. */
export const NOT_FILED = "none";

// ── Dimensions ───────────────────────────────────────────────────────────────

export const STRUCTURE_DIMENSIONS = [
  "disposition",
  "condition",
  "certificate",
  "format",
  "subtype",
  "area",
  "year",
  "tags",
  "location",
] as const;

export type StructureDimension = (typeof STRUCTURE_DIMENSIONS)[number];

export function isStructureDimension(value: unknown): value is StructureDimension {
  return typeof value === "string" && (STRUCTURE_DIMENSIONS as readonly string[]).includes(value);
}

export const STRUCTURE_DIMENSION_LABEL: Record<StructureDimension, string> = {
  disposition: "Disposition",
  condition: "Condition",
  certificate: "Certificate",
  format: "Format",
  subtype: "Subtype",
  area: "Area",
  year: "Year of issue",
  tags: "Tags",
  location: "Storage location",
};

/**
 * Why a dimension's segments need not add up to the total, or null where they do.
 *
 * Three overlap — a copy can be in the collection *and* for sale, can carry several tags, and its
 * stamp can be filed in several areas — so a copy is counted in each segment it belongs to and the
 * total counts it once (#1399). The screen says so beside them, as the holdings tile does (#1398).
 */
export const STRUCTURE_OVERLAP_NOTE: Record<StructureDimension, string | null> = {
  disposition:
    "A copy can be in more than one of these — kept in the collection and for sale, say — so they do not add up to the total.",
  condition: null,
  certificate: null,
  format: null,
  subtype: null,
  area: "A stamp filed in several areas counts under each of them, so the areas can add up to more than the total.",
  year: null,
  tags: "A copy carrying several tags counts under each of them, so the tags can add up to more than the total.",
  location: null,
};

/** The dimension a freshly opened screen shows (#1401): what the holdings tile shows, a level deeper. */
export const DEFAULT_ROW_DIMENSION: StructureDimension = "disposition";

// ── Copies ───────────────────────────────────────────────────────────────────

/** What the screen needs to know about one copy — its own facts and its **leading** stamp's. */
export interface StructureCopy {
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  deliveryState: string;
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
  subtypeId: string | null;
  issuedYear: number | null;
  areaIds: string[];
  tagIds: string[];
  locationId: string | null;
}

// ── The screen's own narrowing, per dimension ────────────────────────────────

/**
 * What the screen is already filtered to on each dimension — the Copies list's URL values, read
 * once so the segments can be restricted to what the filter admits. Empty lists and nulls are *not
 * narrowed*.
 */
export interface StructureNarrowing {
  dispositions: string[];
  deliveryStates: string[];
  conditionIds: string[];
  certificateStatusIds: string[];
  formatIds: string[];
  subtypeIds: string[];
  tagIds: string[];
  tagMode: TagFilterMode;
  /** An area id or {@link NO_AREA}. */
  areaId: string | null;
  /** The rail's single year: a year or `none`. */
  year: string | null;
  /** The first year of a decade. */
  decade: number | null;
  /** A location id or {@link NOT_FILED}. */
  locationId: string | null;
}

function csv(url: URLSearchParams, key: string): string[] {
  return (url.get(key) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}

/** The screen's narrowing off its own address — the Copies list's URL names, read as the list reads
 *  them (`copies-list-url.ts`). */
export function readStructureNarrowing(
  url: URLSearchParams,
  areas: readonly { id: string }[]
): StructureNarrowing {
  const tags = tagFilterFromParams(url);
  return {
    dispositions: DISPOSITION_MARKS.map((m) => m.key).filter((key) => url.get(key) === "true"),
    deliveryStates: csv(url, "deliveryStates"),
    conditionIds: csv(url, "conditionIds"),
    certificateStatusIds: csv(url, "certificateStatusIds"),
    formatIds: csv(url, "formatIds"),
    subtypeIds: csv(url, "subtypeIds"),
    tagIds: tags.tagIds ?? [],
    tagMode: tags.tagMode ?? DEFAULT_TAG_FILTER_MODE,
    areaId: copiesListAreaId(url, areas),
    year: copiesListRailYear(url),
    decade: copiesListDecade(url),
    locationId: url.get("locationId") || null,
  };
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

export interface NamedEntry {
  id: string;
  name: string;
}

export interface TreeEntry extends NamedEntry {
  parentId: string | null;
}

/** The collection's dictionaries, **each in the order it already has** — the settings' order for
 *  conditions, certificates, formats and subtypes, the tree's for areas and locations, the name for
 *  tags (#1401). */
export interface StructureVocabulary {
  conditions: NamedEntry[];
  certificateStatuses: NamedEntry[];
  formats: NamedEntry[];
  subtypes: NamedEntry[];
  areas: TreeEntry[];
  locations: TreeEntry[];
  tags: NamedEntry[];
  includeSubAreas: boolean;
  includeSubLocations: boolean;
}

// ── Segments ─────────────────────────────────────────────────────────────────

export interface StructureSegment {
  /** Unique within its dimension; also the React key. */
  key: string;
  label: string;
  /** The segment for copies **without** a value on the dimension — *No certificate*, *Not filed*. */
  noValue: boolean;
  /** The Copies list's URL parameters that select this segment, laid over the screen's own. */
  params: Record<string, string>;
  match: (copy: StructureCopy) => boolean;
}

const INTAKE_STATES: readonly DeliveryState[] = ["ordered", "in_transit", "to_sort"];

const DISPOSITION_MARKS = [
  { key: "inCollection", label: "In collection" },
  { key: "forSale", label: "For sale" },
  { key: "forTrade", label: "For trade" },
] as const;

/** A dictionary dimension: the values the filter admits, each selected by the list's multi-select. */
function dictionarySegments(
  entries: NamedEntry[],
  admitted: string[],
  param: string,
  read: (copy: StructureCopy) => string | null,
  noValue: { id: string; label: string } | null
): StructureSegment[] {
  const all: { id: string; label: string; noValue: boolean }[] = [
    ...(noValue ? [{ id: noValue.id, label: noValue.label, noValue: true }] : []),
    ...entries.map((e) => ({ id: e.id, label: e.name, noValue: false })),
  ];
  const allowed = admitted.length > 0 ? new Set(admitted) : null;
  return all
    .filter((entry) => !allowed || allowed.has(entry.id))
    .map((entry) => ({
      key: entry.id,
      label: entry.label,
      noValue: entry.noValue,
      params: { [param]: entry.id },
      match: (copy) => (read(copy) ?? noValue?.id) === entry.id,
    }));
}

/** The node's children in the tree's order, or the roots for no node. */
function childrenOf(tree: TreeEntry[], parentId: string | null): TreeEntry[] {
  return tree.filter((entry) => entry.parentId === parentId);
}

function subtree(tree: TreeEntry[], id: string): Set<string> {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) {
    for (const entry of tree) if (entry.parentId === ids[i]) ids.push(entry.id);
  }
  return new Set(ids);
}

/**
 * A tree dimension (area, storage location): the levels under the node the screen is narrowed to.
 *
 * With *+ sub-areas* on (the default, #385) each child stands for its whole subtree, which is what
 * the list shows for it — and, being inside the node, it narrows the screen's own copies. With *this
 * area only* the list reads a picked node alone, so a child would select copies the narrowed screen
 * does not show; the dimension then offers the node itself and nothing under it, and at the top
 * level each root on its own.
 */
function treeSegments(
  tree: TreeEntry[],
  node: string | null,
  includeDescendants: boolean,
  param: string,
  none: string,
  noneLabel: string,
  read: (copy: StructureCopy) => string[]
): StructureSegment[] {
  if (node === none) {
    return [
      {
        key: none,
        label: noneLabel,
        noValue: true,
        params: { [param]: none },
        match: (copy) => read(copy).length === 0,
      },
    ];
  }
  const nodeEntry = node ? tree.find((entry) => entry.id === node) : undefined;
  const children = nodeEntry ? childrenOf(tree, nodeEntry.id) : childrenOf(tree, null);
  const levels =
    nodeEntry && (!includeDescendants || children.length === 0) ? [nodeEntry] : children;
  const segments: StructureSegment[] = levels.map((entry) => {
    const ids = includeDescendants ? subtree(tree, entry.id) : new Set([entry.id]);
    return {
      key: entry.id,
      label: entry.name,
      noValue: false,
      params: { [param]: entry.id },
      match: (copy) => read(copy).some((id) => ids.has(id)),
    };
  });
  if (!nodeEntry) {
    segments.push({
      key: none,
      label: noneLabel,
      noValue: true,
      params: { [param]: none },
      match: (copy) => read(copy).length === 0,
    });
  }
  return segments;
}

/**
 * The year dimension (#1401): by decade, a decade opening into its years, a year standing alone.
 * Only the decades and years some copy has are offered — the dimension is a timeline, not a
 * dictionary — with *No year* last, where the rail puts it.
 */
function yearSegments(copies: StructureCopy[], narrowing: StructureNarrowing): StructureSegment[] {
  const noYear: StructureSegment = {
    key: "none",
    label: "No year",
    noValue: true,
    params: { year: "none", decade: "" },
    match: (copy) => copy.issuedYear === null,
  };
  if (narrowing.year === "none") return [noYear];
  if (narrowing.year) {
    const year = Number(narrowing.year);
    return [
      {
        key: narrowing.year,
        label: narrowing.year,
        noValue: false,
        params: { year: narrowing.year, decade: "" },
        match: (copy) => copy.issuedYear === year,
      },
    ];
  }
  const years = [
    ...new Set(copies.map((c) => c.issuedYear).filter((y): y is number => y !== null)),
  ].sort((a, b) => a - b);
  if (narrowing.decade !== null) {
    const from = narrowing.decade;
    return years
      .filter((y) => y >= from && y <= from + 9)
      .map((year) => ({
        key: String(year),
        label: String(year),
        noValue: false,
        params: { year: String(year), decade: "" },
        match: (copy) => copy.issuedYear === year,
      }));
  }
  const decades = [...new Set(years.map(decadeOf))];
  return [
    ...decades.map((start) => ({
      key: decadeValue(start),
      label: decadeValue(start),
      noValue: false,
      params: { year: "all", decade: decadeValue(start) },
      match: (copy: StructureCopy) =>
        copy.issuedYear !== null && copy.issuedYear >= start && copy.issuedYear <= start + 9,
    })),
    noYear,
  ];
}

/**
 * The tag dimension. Under *any* (or no tag filter) a tag segment is the list narrowed to that one
 * tag. Under *all* of two or more, every copy on screen carries every ticked tag, so a ticked tag's
 * segment is the screen's own filter again — its parameters restate it rather than replacing it
 * with one tag, which would select copies the screen does not show.
 */
function tagSegments(vocab: StructureVocabulary, narrowing: StructureNarrowing): StructureSegment[] {
  const real = narrowing.tagIds.filter((id) => id !== NO_TAGS);
  const allOfSeveral = narrowing.tagMode === "all" && real.length > 1;
  const admitted = narrowing.tagIds.length > 0 ? new Set(narrowing.tagIds) : null;
  const segments: StructureSegment[] = vocab.tags
    .filter((tag) => !admitted || admitted.has(tag.id))
    .map((tag) => ({
      key: tag.id,
      label: tag.name,
      noValue: false,
      params: allOfSeveral
        ? { tagIds: real.join(","), tagMode: "all" }
        : { tagIds: tag.id, tagMode: "" },
      match: (copy) => copy.tagIds.includes(tag.id),
    }));
  if (!admitted || admitted.has(NO_TAGS)) {
    segments.push({
      key: NO_TAGS,
      label: "No tags",
      noValue: true,
      params: { tagIds: NO_TAGS, tagMode: "" },
      match: (copy) => copy.tagIds.length === 0,
    });
  }
  return segments;
}

/**
 * The disposition dimension: the three marks and the three intake stages, as the holdings tile
 * shows them (#1398). A mark segment adds its mark to the screen's — the marks are independent flags
 * and the list ANDs them — while an intake segment is one delivery state, offered only where the
 * screen's delivery filter admits it.
 */
function dispositionSegments(narrowing: StructureNarrowing): StructureSegment[] {
  const admitted = narrowing.deliveryStates.length > 0 ? new Set(narrowing.deliveryStates) : null;
  return [
    ...DISPOSITION_MARKS.map((mark) => ({
      key: mark.key,
      label: mark.label,
      noValue: false,
      params: { [mark.key]: "true" },
      match: (copy: StructureCopy) => copy[mark.key],
    })),
    ...INTAKE_STATES.filter((state) => !admitted || admitted.has(state)).map((state) => ({
      key: state,
      label: DELIVERY_STATE_META[state].label,
      noValue: false,
      params: { deliveryStates: state },
      match: (copy: StructureCopy) => copy.deliveryState === state,
    })),
  ];
}

/** A dimension's segments over the screen's copies, in the dimension's own order. */
export function structureSegments(
  dimension: StructureDimension,
  copies: StructureCopy[],
  vocab: StructureVocabulary,
  narrowing: StructureNarrowing
): StructureSegment[] {
  switch (dimension) {
    case "disposition":
      return dispositionSegments(narrowing);
    case "condition":
      return dictionarySegments(vocab.conditions, narrowing.conditionIds, "conditionIds", (c) => c.conditionId, null);
    case "certificate":
      return dictionarySegments(
        vocab.certificateStatuses,
        narrowing.certificateStatusIds,
        "certificateStatusIds",
        (c) => c.certificateStatusId,
        { id: "none", label: "No certificate" }
      );
    case "format":
      return dictionarySegments(vocab.formats, narrowing.formatIds, "formatIds", (c) => c.formatId, {
        id: "single",
        label: "Single",
      });
    case "subtype":
      return dictionarySegments(vocab.subtypes, narrowing.subtypeIds, "subtypeIds", (c) => c.subtypeId, {
        id: "none",
        label: "No subtype",
      });
    case "area":
      return treeSegments(
        vocab.areas,
        narrowing.areaId,
        vocab.includeSubAreas,
        "areaId",
        NO_AREA,
        "No area",
        (c) => c.areaIds
      );
    case "year":
      return yearSegments(copies, narrowing);
    case "tags":
      return tagSegments(vocab, narrowing);
    case "location":
      return treeSegments(
        vocab.locations,
        narrowing.locationId,
        vocab.includeSubLocations,
        "locationId",
        NOT_FILED,
        "Not filed",
        (c) => (c.locationId ? [c.locationId] : [])
      );
  }
}

/**
 * Whether a dimension offers every segment even when it counts nothing. The dictionaries do — a
 * condition holding no copies is part of the answer, and the holdings tile's six rows are always
 * there — while the open-ended ones (areas, years, tags, locations) offer only what the copies
 * reach, or a collection with a hundred areas would answer with a hundred zeros.
 */
export function showsEmptySegments(dimension: StructureDimension): boolean {
  return (
    dimension === "disposition" ||
    dimension === "condition" ||
    dimension === "certificate" ||
    dimension === "format" ||
    dimension === "subtype"
  );
}

// ── The table ────────────────────────────────────────────────────────────────

/** A segment as the screen receives it: no `match`, and its count. */
export interface StructureHeading {
  key: string;
  label: string;
  noValue: boolean;
  params: Record<string, string>;
  count: number;
}

export interface StructureRow extends StructureHeading {
  /** One count per column, in the columns' order; empty with no column dimension. */
  cells: number[];
}

export interface StructureTable {
  rows: StructureRow[];
  columns: StructureHeading[];
  /** Every copy on the screen, each once. */
  total: number;
  /** How many of them fall in no row — the copies filed on a narrowed area itself, say. */
  outsideRows: number;
  outsideColumns: number;
}

/**
 * Count the copies into the rows, the columns and their crossings. A copy is counted in **every**
 * segment it belongs to and in the total **once** (#1399) — the counts are of copies, never of
 * copy-segment pairs, which is why the total is not a sum.
 */
export function tabulateStructure(
  copies: StructureCopy[],
  rows: StructureSegment[],
  columns: StructureSegment[] | null,
  keepEmpty: { rows: boolean; columns: boolean }
): StructureTable {
  const cols = columns ?? [];
  const rowCounts = rows.map(() => 0);
  const colCounts = cols.map(() => 0);
  const cells = rows.map(() => cols.map(() => 0));
  let outsideRows = 0;
  let outsideColumns = 0;
  for (const copy of copies) {
    const inRows = rows.flatMap((segment, i) => (segment.match(copy) ? [i] : []));
    const inCols = cols.flatMap((segment, j) => (segment.match(copy) ? [j] : []));
    if (inRows.length === 0) outsideRows++;
    if (columns && inCols.length === 0) outsideColumns++;
    for (const i of inRows) rowCounts[i]++;
    for (const j of inCols) colCounts[j]++;
    for (const i of inRows) for (const j of inCols) cells[i][j]++;
  }
  const colKept = cols.map((_, j) => keepEmpty.columns || colCounts[j] > 0);
  const heading = (segment: StructureSegment, count: number): StructureHeading => ({
    key: segment.key,
    label: segment.label,
    noValue: segment.noValue,
    params: segment.params,
    count,
  });
  return {
    rows: rows.flatMap((segment, i) =>
      keepEmpty.rows || rowCounts[i] > 0
        ? [{ ...heading(segment, rowCounts[i]), cells: cells[i].filter((_, j) => colKept[j]) }]
        : []
    ),
    columns: cols.flatMap((segment, j) => (colKept[j] ? [heading(segment, colCounts[j])] : [])),
    total: copies.length,
    outsideRows,
    outsideColumns,
  };
}

// ── The drill-down (#1401) ───────────────────────────────────────────────────

/**
 * One drill-down step as the screen's address records it: what the breadcrumb calls it, the Copies
 * list parameters the click laid over the filters, and what those parameters said **before** it —
 * so stepping back puts the screen exactly where the click found it, a filter set on the bar before
 * the click included.
 */
export interface StructureStep {
  label: string;
  params: Record<string, string>;
  /** Each key of `params` as it stood before the step; `""` where the address did not name it. */
  prev: Record<string, string>;
}

/** The address parameter the steps ride in. */
export const STEPS_PARAM = "steps";

/** The steps as one URL value — JSON, since a label is the collector's own text. */
export function encodeSteps(steps: StructureStep[]): string {
  return steps.length === 0 ? "" : JSON.stringify(steps.map((s) => [s.label, s.params, s.prev]));
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (kv): kv is [string, string] => typeof kv[1] === "string"
    )
  );
}

/** The steps back off the address. Anything malformed is no steps, not an error: a hand-edited link
 *  should still open the screen. */
export function decodeSteps(value: string | null): StructureStep[] {
  if (!value) return [];
  try {
    const raw: unknown = JSON.parse(value);
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry) => {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") return [];
      const params = stringRecord(entry[1]);
      const prev = stringRecord(entry[2]);
      return params && prev ? [{ label: entry[0], params, prev }] : [];
    });
  } catch {
    return [];
  }
}

/**
 * The filter parameters to write when stepping back to just after step `keep` (-1 for before the
 * first): each step after it is undone, the latest first, so a key two of them set ends where the
 * earlier one found it.
 */
export function stepBackUpdates(steps: StructureStep[], keep: number): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const step of steps.slice(keep + 1).reverse()) Object.assign(updates, step.prev);
  return updates;
}
