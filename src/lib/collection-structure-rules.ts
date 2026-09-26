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
 * **The values (#1402) go where the count goes.** A segment's catalogue value, market value and cost
 * are those of exactly the copies it counts, a copy in several segments carrying its values into
 * each and the total holding it once — so a value, like a count, is the Copies list's own under the
 * segment's link.
 *
 * Pure: no Prisma, no React. `collection-structure.ts` reads the copies and the dictionaries.
 */

import { DELIVERY_STATE_META, type DeliveryState } from "./delivery-state";
import { NO_AREA, decadeOf, decadeValue } from "./list-area-year-filter";
import { DEFAULT_TAG_FILTER_MODE, NO_TAGS, tagFilterFromParams, type TagFilterMode } from "./tag-filter";
import { copiesListAreaId, copiesListDecade, copiesListRailYear } from "./copies-list-url";
import type { HoldingsSummary } from "./valuation";

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
  id: string;
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

// ── Values (#1402) ───────────────────────────────────────────────────────────

/**
 * What a segment's copies are worth and cost, in the base currency — the Overview's *Holdings value*
 * figures (#650) over the segment's copies, read off the holdings summary the Copies list's own bar
 * is computed from, so nothing is valued differently here (#1402).
 *
 * **Cost is what was spent, and an opening value stands beside it** (#1324): settled with the
 * collector on 2026-09-27, as the Overview states them, rather than the one cost basis profit and
 * loss reads — so the screen's totals are the Overview's figures.
 *
 * Every figure says how many of the segment's copies it could not include and why, as the Overview
 * does: a copy unpriced or unconvertible is left out of the catalogue value, one with no auction
 * evidence out of the market value, one with its cost pending or unrecorded out of the cost — never
 * read as zero. A copy the segment counts but the collector no longer has in hand (never arrived, or
 * arrived damaged, #396) is in none of the three and counted apart as `notHeld`.
 */
export interface StructureValues {
  catalogue: { amount: string; unpriced: number; unconvertible: number };
  market: { amount: string; noEvidence: number };
  cost: { amount: string; pending: number; none: number };
  /** The copies from opening balances: their value, and the ones without one. `copies` is 0 where the
   *  segment holds none, and the screen then says nothing about it. */
  opening: { amount: string; copies: number; pending: number; none: number };
  notHeld: number;
}

/** A holdings summary as the screen states it. */
export function structureValuesOf(summary: HoldingsSummary): StructureValues {
  const opening = summary.openingValue;
  return {
    catalogue: {
      amount: summary.totalBaseAmount,
      unpriced: summary.unpricedCount,
      unconvertible: summary.unconvertibleCount,
    },
    market: { amount: summary.market.totalBaseAmount, noEvidence: summary.market.noEvidenceCount },
    cost: {
      amount: summary.cost.totalCostBasis,
      pending: summary.cost.pendingCount,
      none: summary.cost.noneCount,
    },
    opening: {
      amount: opening.totalCostBasis,
      copies: opening.knownCount + opening.pendingCount + opening.noneCount,
      pending: opening.pendingCount,
      none: opening.noneCount,
    },
    notHeld: summary.writeOff.count,
  };
}

/** The figures a segment states, in the order the screen draws them. */
export type StructureFigure = "catalogue" | "market" | "cost" | "opening";

/**
 * One figure's gaps: how many of the segment's copies it leaves out, and why in words — "2 unpriced,
 * 1 no longer in hand" — empty where it covers every copy. The screen marks the figure with the
 * number and says the reasons on hover (settled with the collector on 2026-09-27).
 *
 * A copy no longer in hand is left out of the three held figures; the opening value is stated only
 * over the held copies that came from opening balances, so it names its own gaps alone.
 */
export function structureValueGaps(
  values: StructureValues,
  figure: StructureFigure
): { count: number; reasons: string[] } {
  const parts: [number, string][] =
    figure === "catalogue"
      ? [
          [values.catalogue.unpriced, "unpriced"],
          [values.catalogue.unconvertible, "priced in a currency with no exchange rate"],
        ]
      : figure === "market"
        ? [[values.market.noEvidence, "with no auction results to value them by"]]
        : figure === "cost"
          ? [
              [values.cost.pending, "with the cost pending on an open lot"],
              [values.cost.none, "with no cost recorded"],
            ]
          : [
              [values.opening.pending, "with the opening value pending"],
              [values.opening.none, "with no opening value"],
            ];
  if (figure !== "opening") parts.push([values.notHeld, "no longer in hand"]);
  const left = parts.filter(([n]) => n > 0);
  return {
    count: left.reduce((sum, [n]) => sum + n, 0),
    reasons: left.map(([n, why]) => `${n} ${why}`),
  };
}

// ── The table ────────────────────────────────────────────────────────────────

/** A segment as the screen receives it: no `match`, its count and its values. */
export interface StructureHeading {
  key: string;
  label: string;
  noValue: boolean;
  params: Record<string, string>;
  count: number;
  /** Null where the table was counted without values. */
  values: StructureValues | null;
}

export interface StructureRow extends StructureHeading {
  /** One count per column, in the columns' order; empty with no column dimension. */
  cells: number[];
  /** The values of each cell, beside {@link cells}. */
  cellValues: (StructureValues | null)[];
}

export interface StructureTable {
  rows: StructureRow[];
  columns: StructureHeading[];
  /** Every copy on the screen, each once. */
  total: number;
  totalValues: StructureValues | null;
  /** How many of them fall in no row — the copies filed on a narrowed area itself, say. */
  outsideRows: number;
  outsideColumns: number;
}

/**
 * Count the copies into the rows, the columns and their crossings. A copy is counted in **every**
 * segment it belongs to and in the total **once** (#1399) — the counts are of copies, never of
 * copy-segment pairs, which is why the total is not a sum.
 *
 * `value`, when given, is asked for the values of each segment's copies, each crossing's and the
 * total's (#1402) — over the same copies the count counts, so a value follows its count wherever a
 * copy lands, the overlapping dimensions included.
 */
export function tabulateStructure(
  copies: StructureCopy[],
  rows: StructureSegment[],
  columns: StructureSegment[] | null,
  keepEmpty: { rows: boolean; columns: boolean },
  value?: (copies: StructureCopy[]) => StructureValues
): StructureTable {
  const cols = columns ?? [];
  const rowCopies: StructureCopy[][] = rows.map(() => []);
  const colCopies: StructureCopy[][] = cols.map(() => []);
  const cellCopies: StructureCopy[][][] = rows.map(() => cols.map(() => []));
  let outsideRows = 0;
  let outsideColumns = 0;
  for (const copy of copies) {
    const inRows = rows.flatMap((segment, i) => (segment.match(copy) ? [i] : []));
    const inCols = cols.flatMap((segment, j) => (segment.match(copy) ? [j] : []));
    if (inRows.length === 0) outsideRows++;
    if (columns && inCols.length === 0) outsideColumns++;
    for (const i of inRows) rowCopies[i].push(copy);
    for (const j of inCols) colCopies[j].push(copy);
    for (const i of inRows) for (const j of inCols) cellCopies[i][j].push(copy);
  }
  const valuesOf = (members: StructureCopy[]) => (value ? value(members) : null);
  const colKept = cols.map((_, j) => keepEmpty.columns || colCopies[j].length > 0);
  const heading = (segment: StructureSegment, members: StructureCopy[]): StructureHeading => ({
    key: segment.key,
    label: segment.label,
    noValue: segment.noValue,
    params: segment.params,
    count: members.length,
    values: valuesOf(members),
  });
  return {
    rows: rows.flatMap((segment, i) => {
      if (!keepEmpty.rows && rowCopies[i].length === 0) return [];
      const kept = cellCopies[i].filter((_, j) => colKept[j]);
      return [
        {
          ...heading(segment, rowCopies[i]),
          cells: kept.map((members) => members.length),
          cellValues: kept.map(valuesOf),
        },
      ];
    }),
    columns: cols.flatMap((segment, j) => (colKept[j] ? [heading(segment, colCopies[j])] : [])),
    total: copies.length,
    totalValues: valuesOf(copies),
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
