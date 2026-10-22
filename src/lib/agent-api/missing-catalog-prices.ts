// The pure half of `find_missing_catalogue_prices` (#2110): which cells of which stamps carry no
// catalogue price, in what order they are told, and how a page of them is grouped by issue.
//
// **Missing means not entered** — the collector's rule, and #1615's: a cell recorded as a figure, as
// `-` (the catalogue prints —) or as `?` is answered and is not a gap. Two cells the grid draws
// without anything recorded in them are read as the grid reads them, so the answer and the screen
// cannot disagree:
//
// - **A format cell derived from the single** by a multiplier (ADR-0020 §5) is priced. The valuation
//   uses it, the grid draws it, and the worklist counts it as priced (`summarizeUmbrellaCell`); asking
//   for it would ask for a figure the app already has.
// - **An umbrella with no price of its own** is priced in a cell when every fully identified variant
//   under it is — its value is the lowest of theirs (#238), complete only when they all answer. While
//   one of them does not, the umbrella is reported too, marked as one, because its own figure (which
//   outranks the rollup, #616) is the other way to close it.
//
// **A certificate cell the plain price would fill is still missing**, and says what *Fill from None*
// would write (#1242): the fill is a one-time copy a person presses, nothing derives it on read, and
// so the valuation has no figure until one is entered. The figure is `fillCertificateCell`'s, over
// the recorded plain cell only — the grid's own rule, under which a derived placeholder fills nothing.
//
// Pure: no Prisma, so `pnpm test:unit` holds every rule here.

import { catalogPriceMarkInput, type CatalogPriceMark } from "../catalog-price-mark";
import { fillCertificateCell } from "../certificate-price-fill";
import { compareCatalogSortKeys } from "../catalog-sort-key";
import { cellMark, derivedCellAmount, variantPriceCellKey } from "../variant-price-cells";

// -- Which cells are missing ---------------------------------------------------------------

/** A filled cell as `set_catalog_prices` takes it back: the figure, or a mark as `-` or `?`. */
function sendable(value: string): string {
  const mark = cellMark(value);
  if (mark === "nonexistent") return "-";
  if (mark === "undeterminable") return "?";
  return value;
}

/** One cell a price is asked about: the condition, certificate and format axes. */
export interface AskedCell {
  readonly conditionId: string;
  /** Null is *no certificate* (ADR-0006 §2). */
  readonly certificateStatusId: string | null;
  /** Null is the single (ADR-0020). */
  readonly formatId: string | null;
}

/** One stamp checked for gaps. */
export interface GapStamp {
  readonly stampId: string;
  /** The edition its prices are looked for in. */
  readonly editionId: string;
  /**
   * Its fully identified variant-kind descendants, at any depth, when it is an umbrella — the ones
   * its value is the lowest of (`variantDescendantMap` filtered to identified rows). Null for a stamp
   * a catalogue prices directly.
   */
  readonly variantIds: readonly string[] | null;
}

/** One recorded price — the five axes and what the cell holds. */
export interface GapPrice {
  readonly stampId: string;
  readonly catalogEditionId: string;
  readonly conditionId: string;
  readonly certificateStatusId: string | null;
  readonly formatId: string | null;
  /** 2-dp string; empty for a mark. */
  readonly amount: string;
  readonly mark: CatalogPriceMark | null;
}

/** A missing cell of one stamp. */
export interface MissingCell extends AskedCell {
  /** What *Fill from None* would write into a certificate cell: a figure, or `-`/`?` carried from a
   *  marked plain cell (#1242, #1615). Absent when nothing would. */
  readonly derivable?: string;
}

/**
 * Every asked cell of every stamp that carries no price, per stamp, in the order the cells were
 * asked. A stamp with nothing missing is absent from the map.
 */
export function missingCatalogPriceCells(input: {
  readonly stamps: readonly GapStamp[];
  readonly cells: readonly AskedCell[];
  readonly prices: readonly GapPrice[];
  /** The resolved format multiplier for a stamp at a format and condition, or null (ADR-0020 §5). */
  readonly factor: (stampId: string, formatId: string, conditionId: string) => number | null;
  /** A certificate status's fill percentage, or null when it has none (#1242). */
  readonly percent: (certificateStatusId: string) => number | null;
}): Map<string, MissingCell[]> {
  // As the grid holds them: a figure, or a mark as its sign.
  const recorded = new Map<string, string>();
  for (const p of input.prices) {
    recorded.set(
      variantPriceCellKey(p.stampId, p.catalogEditionId, p.conditionId, p.certificateStatusId, p.formatId),
      p.mark ? catalogPriceMarkInput(p.mark) : p.amount
    );
  }
  const own = (stampId: string, editionId: string, cell: AskedCell, formatId = cell.formatId) =>
    recorded.get(variantPriceCellKey(stampId, editionId, cell.conditionId, cell.certificateStatusId, formatId)) ?? "";
  /** Whether a stamp's cell holds anything as the grid draws it — recorded, or derived on a format. */
  const answered = (stampId: string, editionId: string, cell: AskedCell) => {
    if (own(stampId, editionId, cell).trim() !== "") return true;
    if (cell.formatId === null) return false;
    return derivedCellAmount(own(stampId, editionId, cell, null), input.factor(stampId, cell.formatId, cell.conditionId)) !== null;
  };

  const out = new Map<string, MissingCell[]>();
  for (const stamp of input.stamps) {
    const missing: MissingCell[] = [];
    for (const cell of input.cells) {
      if (answered(stamp.stampId, stamp.editionId, cell)) continue;
      const variants = stamp.variantIds;
      if (variants && variants.length > 0) {
        if (variants.every((id) => answered(id, stamp.editionId, cell))) continue;
        // An umbrella's cells are locked in the grid (#627) and the fill passes them by.
        missing.push({ ...cell });
        continue;
      }
      const derivable =
        cell.certificateStatusId === null
          ? null
          : fillCertificateCell({
              plain: recorded.get(variantPriceCellKey(stamp.stampId, stamp.editionId, cell.conditionId, null, cell.formatId)) ?? "",
              current: "",
              percent: input.percent(cell.certificateStatusId),
            });
      missing.push(derivable === null ? { ...cell } : { ...cell, derivable: sendable(derivable) });
    }
    if (missing.length > 0) out.set(stamp.stampId, missing);
  }
  return out;
}

// -- The order they are told in ------------------------------------------------------------

/** One stamp as the order reads it. */
export interface OrderedStamp {
  readonly id: string;
  readonly parentId: string | null;
  /** Its `IssueMember.sortOrder` in the issue it is told under — sibling order (#549). */
  readonly sortOrder: number | null;
  readonly sortKey: string | null;
}

/**
 * An issue's stamps in the variant price grid's order (`flattenTree`): depth first, each sibling
 * group by the collector's order, then the catalogue's, then the id. A stamp whose parent is not
 * among them is a root, so a checklist's or a list's stamps keep their tree where they have one.
 */
export function stampTreeOrder<T extends OrderedStamp>(stamps: readonly T[]): T[] {
  const present = new Set(stamps.map((s) => s.id));
  const children = new Map<string | null, T[]>();
  for (const stamp of stamps) {
    const parent = stamp.parentId && present.has(stamp.parentId) ? stamp.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), stamp]);
  }
  const compare = (a: T, b: T) => {
    if (a.sortOrder !== null && b.sortOrder !== null && a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.sortOrder !== null && b.sortOrder === null) return -1;
    if (a.sortOrder === null && b.sortOrder !== null) return 1;
    return compareCatalogSortKeys(a.sortKey, b.sortKey) || a.id.localeCompare(b.id);
  };
  for (const group of children.values()) group.sort(compare);
  const out: T[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const stamp of children.get(parentId) ?? []) {
      if (visited.has(stamp.id)) continue;
      visited.add(stamp.id);
      out.push(stamp);
      walk(stamp.id);
    }
  };
  walk(null);
  // A cycle leaves its members unreached from any root; they are still stamps to tell.
  for (const stamp of [...stamps].sort(compare)) if (!visited.has(stamp.id)) out.push(stamp);
  return out;
}

/** One issue as the order reads it. */
export interface OrderedIssue {
  readonly id: string;
  /** The issue's area's place in the area tree, depth first (`areaTreeOrder`). */
  readonly areaRank: number;
  readonly sortKey: string | null;
  readonly year: number | null;
}

/** Issues in catalogue order: by area as the Areas screen reads the tree, then catalogue number,
 *  then year, then id. */
export function compareIssues(a: OrderedIssue, b: OrderedIssue): number {
  return (
    a.areaRank - b.areaRank ||
    compareCatalogSortKeys(a.sortKey, b.sortKey) ||
    (a.year ?? Number.MAX_SAFE_INTEGER) - (b.year ?? Number.MAX_SAFE_INTEGER) ||
    a.id.localeCompare(b.id)
  );
}

/** One area as the tree order reads it. */
export interface AreaNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly sortOrder: number;
  readonly name: string;
}

/** Each area's place in the tree, depth first, siblings by `sortOrder` then name — `areaTreeOrder`'s
 *  walk over just the fields it needs. */
export function areaRanks(areas: readonly AreaNode[]): Map<string, number> {
  const children = new Map<string | null, AreaNode[]>();
  for (const area of areas) children.set(area.parentId, [...(children.get(area.parentId) ?? []), area]);
  for (const group of children.values()) group.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const ranks = new Map<string, number>();
  const walk = (parentId: string | null, depth: number) => {
    if (depth > 50) return;
    for (const area of children.get(parentId) ?? []) {
      if (ranks.has(area.id)) continue;
      ranks.set(area.id, ranks.size);
      walk(area.id, depth + 1);
    }
  };
  walk(null, 0);
  return ranks;
}

// -- A page of them, grouped -----------------------------------------------------------------

/** A stamp's place in the answer: the group it is told under, and itself. */
export interface PagedStamp<S> {
  /** The issue and edition it is grouped under — one group per run of equal keys. */
  readonly groupKey: string;
  readonly stamp: S;
}

/**
 * A page of the ordered stamps, grouped by consecutive equal `groupKey`. The window counts **stamps**,
 * not groups, so a page holds at most `limit` of them whatever the issues; an issue cut by the page
 * boundary is told on both pages.
 */
export function pageIntoGroups<S>(
  ordered: readonly PagedStamp<S>[],
  window: { readonly offset: number; readonly limit: number }
): { groupKey: string; stamps: S[] }[] {
  const groups: { groupKey: string; stamps: S[] }[] = [];
  for (const entry of ordered.slice(window.offset, window.offset + window.limit)) {
    const last = groups[groups.length - 1];
    if (last && last.groupKey === entry.groupKey) last.stamps.push(entry.stamp);
    else groups.push({ groupKey: entry.groupKey, stamps: [entry.stamp] });
  }
  return groups;
}
