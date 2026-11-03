// The arithmetic of a variant price cell (#618) — what one is keyed on, what an empty one on a
// format tab is derived as, and what an umbrella is worth as the lowest of its variants (#238, #627).
//
// Pure — no DOM, no React, no Prisma — and shared by the two surfaces that draw these cells: the
// variant price grid and the identification step's variant section (#1337). They must not disagree
// about an umbrella's value, so neither computes it on its own.

import { formatAmountInput, normalizeDecimalInput } from "./decimal-input";
import { deriveFormatPrice } from "./format-factor";
import { rolledUpCatalogPriceMark } from "./catalog-price";
import {
  catalogPriceMarkInput,
  parsePriceCellInput,
  type CatalogPriceMark,
} from "./catalog-price-mark";

/** How a cell is identified in a surface's own maps — every axis a `StampCatalogPrice` is keyed on.
 *  Nothing crosses the wire under it: a write names its axes in full. */
export function variantPriceCellKey(
  stampId: string,
  editionId: string,
  conditionId: string,
  certId: string | null,
  formatId: string | null
): string {
  return `${stampId}~${editionId}~${conditionId}~${certId ?? ""}~${formatId ?? ""}`;
}

/** The fields of a grid row this module reads — `VariantPriceRow`'s, kept structural so the pure
 *  side never names a type from the server-only module that builds the rows. */
export interface VariantTreeRow {
  stampId: string;
  depth: number;
  /** Has no variant children of its own — a row a catalogue prices directly. */
  identified: boolean;
  /** Rolls up into its parent (ADR-0010 §3), as against a distinct entry merely filed under it. */
  isVariant: boolean;
}

/**
 * The variant-kind descendants of every row, at any depth — whose lowest price an umbrella row is
 * worth (#238). Read off the flattened tree: the rows are a depth-first walk, so a row's subtree is
 * the run of deeper rows that follows it. The filter is `isVariant` **flat**, not pruned at the first
 * non-variant: that is exactly the set `valuateItemRows` rolls up, and the figure has to be the one
 * the rest of the app prints.
 */
export function variantDescendantMap(rows: readonly VariantTreeRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  rows.forEach((row, i) => {
    const ids: string[] = [];
    for (let j = i + 1; j < rows.length && rows[j].depth > row.depth; j++) {
      if (rows[j].isVariant) ids.push(rows[j].stampId);
    }
    map.set(row.stampId, ids);
  });
  return map;
}

/** A typed amount as a number, or null when there is none — blank, a mark (#1615), or not an amount
 *  at all. */
export function parseCellAmount(raw: string): number | null {
  const typed = raw.trim();
  if (typed === "") return null;
  if (parsePriceCellInput(typed).kind === "mark") return null;
  const amount = Number(normalizeDecimalInput(typed));
  return Number.isFinite(amount) ? amount : null;
}

/** A cell as it settles when left: blank, a mark as its sign (`-` → `—`, #1615), or the amount at
 *  two places (#1231). Shared by the two surfaces that write cells, so they settle alike. */
export function settleCellInput(raw: string): string {
  const cell = parsePriceCellInput(raw);
  if (cell.kind === "empty") return "";
  if (cell.kind === "mark") return catalogPriceMarkInput(cell.mark);
  return formatAmountInput(raw.trim());
}

/** What a settled cell writes: a figure, a mark, or null to clear it. */
export function cellWriteValue(settled: string): number | CatalogPriceMark | null {
  const cell = parsePriceCellInput(settled);
  if (cell.kind === "empty") return null;
  if (cell.kind === "mark") return cell.mark;
  return Number(settled);
}

/** The mark a cell holds as typed (`—`/`-`, `?`), or null (#1615). */
export function cellMark(raw: string): CatalogPriceMark | null {
  const cell = parsePriceCellInput(raw);
  return cell.kind === "mark" ? cell.mark : null;
}

/**
 * The state an umbrella cell takes when none of its variants is priced and every fully identified
 * one is marked (#1615), as a cell shows it (`—`, `?`) — `rolledUpCatalogPriceMark`'s rule, read off
 * the grid's own cells. Null otherwise.
 */
export function rolledUpCellMark(
  rows: readonly VariantTreeRow[],
  umbrellaId: string,
  markOf: (stampId: string) => CatalogPriceMark | null
): string | null {
  const descendants = variantDescendantMap(rows).get(umbrellaId) ?? [];
  const identified = new Set(rows.filter((r) => r.identified).map((r) => r.stampId));
  const mark = rolledUpCatalogPriceMark(
    descendants.map((id) => ({ mark: markOf(id), identified: identified.has(id) }))
  );
  return mark ? catalogPriceMarkInput(mark) : null;
}

/**
 * What an empty cell on a format tab is worth: the single's figure times the stamp's multiplier, as
 * a 2-dp string. Null with no multiplier and with no single price — a derived figure is an inference
 * from two facts and says nothing without both. A marked single (#1615) gives its mark instead,
 * multiplier or not: a multiple of a stamp that does not exist does not exist either.
 */
export function derivedCellAmount(single: string, factor: number | null | undefined): string | null {
  const mark = cellMark(single);
  if (mark) return catalogPriceMarkInput(mark);
  if (!factor) return null;
  const amount = parseCellAmount(single);
  if (amount === null) return null;
  return deriveFormatPrice(amount, factor).toFixed(2);
}

/** What a cell is worth as drawn: the figure typed into it, or failing that the derived one. */
export function shownCellAmount(own: string, derived: string | null): number | null {
  if (own.trim() !== "") return parseCellAmount(own);
  return derived == null ? null : parseCellAmount(derived);
}

/** The lowest of the given stamps' amounts, as a 2-dp string — an umbrella's rolled-up value — or
 *  null when none of them is priced. */
export function lowestVariantAmount(
  stampIds: readonly string[],
  amountOf: (stampId: string) => number | null
): string | null {
  let lowest: number | null = null;
  for (const id of stampIds) {
    const amount = amountOf(id);
    if (amount !== null && (lowest === null || amount < lowest)) lowest = amount;
  }
  return lowest === null ? null : lowest.toFixed(2);
}

/** What the identification step's variant section says about its umbrella while it is closed. */
export interface UmbrellaCellSummary {
  /** The umbrella's value in this cell: its own recorded figure, else the lowest of its variants'.
   *  Null when neither exists. */
  value: string | null;
  /** True when {@link value} is the rollup rather than a figure recorded on the umbrella itself —
   *  drawn `≈`-prefixed, #238's marking for *inferred, not recorded*. */
  rolledUp: boolean;
  /** The fully identified variants under it, at any depth — the ones a catalogue prices directly. */
  variantCount: number;
  /** How many of those have no figure in this cell, typed or derived, and are not marked as giving
   *  none (#1615). */
  unpricedCount: number;
}

/**
 * The umbrella's value and its gap count in one cell — the section heading's two figures (#1337).
 *
 * The value follows the grid's locked row (#627): a figure recorded on the umbrella itself is the
 * operative one (#616) and is shown plainly; only in its absence is the rollup taken.
 *
 * The count is over the **variants that roll up into the value** and are fully identified: an
 * intermediate umbrella is valued by its own children, so it is never a gap of its own (the
 * worklist's rule, `unpricedVariantCells`), and an entry merely filed under the stamp does not move
 * its value. A derived figure on a format tab counts as priced, since the valuation uses it too
 * (ADR-0020 §5).
 */
export function summarizeUmbrellaCell(input: {
  rows: readonly VariantTreeRow[];
  umbrellaId: string;
  /** What the umbrella's own cell holds, as typed — blank when nothing is recorded on it. */
  own: string;
  /** What each stamp's cell is worth as drawn — see {@link shownCellAmount}. */
  amountOf: (stampId: string) => number | null;
  /** The mark each stamp's cell holds, if any (#1615). Absent reads as none. */
  markOf?: (stampId: string) => CatalogPriceMark | null;
}): UmbrellaCellSummary {
  const markOf = input.markOf ?? (() => null);
  const descendants = variantDescendantMap(input.rows).get(input.umbrellaId) ?? [];
  const identified = new Set(input.rows.filter((r) => r.identified).map((r) => r.stampId));
  const variants = descendants.filter((id) => identified.has(id));
  const unpricedCount = variants.filter(
    (id) => input.amountOf(id) === null && markOf(id) === null
  ).length;

  const own = parseCellAmount(input.own);
  if (own !== null) {
    return { value: own.toFixed(2), rolledUp: false, variantCount: variants.length, unpricedCount };
  }
  const ownMark = cellMark(input.own);
  if (ownMark) {
    return {
      value: catalogPriceMarkInput(ownMark),
      rolledUp: false,
      variantCount: variants.length,
      unpricedCount,
    };
  }
  const rolled =
    lowestVariantAmount(descendants, input.amountOf) ??
    rolledUpCellMark(input.rows, input.umbrellaId, markOf);
  return { value: rolled, rolledUp: rolled !== null, variantCount: variants.length, unpricedCount };
}
