/**
 * The **Copies list's** sort (#2300): date added, the Stamps list's four catalogue keys, copy number,
 * and the two figures a copy's row shows — its catalogue value and its cost. Each goes either way.
 * Pure, so the route, the toolbar and the unit suite read one list of keys.
 *
 * The catalogue keys are the **Stamps list's own** (`listStampsPaginated`): catalogue number is the
 * stored `primaryCatalogSortKey`, so *Fi 2* precedes *Fi 10* and a variant (`200a`) follows its
 * umbrella (`200`); issue date is the stamp's year, month and day. A copy is placed by its stamp —
 * a piece of several stamps by its leading one, which is what its row's area, year and issue
 * already describe.
 *
 * Most keys are columns and order the read in SQL ({@link listItemsPaginated}). Three are not —
 * the issue's name (across the to-many membership, as on the Stamps list), and the two figures,
 * which are a valuation and a cost resolution — so those order the whole matching set in memory
 * through {@link sortCopySortRows} before the page is cut, and only the page is enriched.
 *
 * **A blank sorts last in either direction** — no value, no cost, no issue, no catalogue number —
 * so a descending value sort leads with the dearest copy rather than with the unpriced ones. **Ties
 * follow catalogue number, then copy number**, both ascending whichever way the sort runs, so a run
 * of equal figures still reads in catalogue order and a page boundary can neither repeat nor skip.
 */

import { compareCatalogSortKeys } from "./catalog-sort-key";

export const COPY_LIST_SORT_KEYS = [
  "created",
  "catalogNumber",
  "issueDate",
  "name",
  "issueName",
  "copyNo",
  "catalogueValue",
  "cost",
] as const;
export type CopyListSortKey = (typeof COPY_LIST_SORT_KEYS)[number];

export type CopyListSortDir = "asc" | "desc";

/** The toolbar's options, in the order the select lists them. `firstDir` is the direction a key
 *  starts in when it is picked — the useful one: catalogue reading forwards, newest and dearest
 *  first. */
export const COPY_LIST_SORT_OPTIONS: readonly {
  value: CopyListSortKey;
  label: string;
  firstDir: CopyListSortDir;
}[] = [
  { value: "created", label: "Date added", firstDir: "desc" },
  { value: "catalogNumber", label: "Catalog number", firstDir: "asc" },
  { value: "issueDate", label: "Issue date", firstDir: "asc" },
  { value: "name", label: "Stamp name", firstDir: "asc" },
  { value: "issueName", label: "Issue name", firstDir: "asc" },
  { value: "copyNo", label: "Copy number", firstDir: "asc" },
  { value: "catalogueValue", label: "Catalog value", firstDir: "desc" },
  { value: "cost", label: "Cost", firstDir: "desc" },
];

export function isCopyListSortKey(value: unknown): value is CopyListSortKey {
  return typeof value === "string" && (COPY_LIST_SORT_KEYS as readonly string[]).includes(value);
}

/** The keys no column carries, ordered over the whole matching set in memory. */
export type InMemoryCopySortKey = "issueName" | "catalogueValue" | "cost";

export function isInMemoryCopySort(key: CopyListSortKey): key is InMemoryCopySortKey {
  return key === "issueName" || key === "catalogueValue" || key === "cost";
}

/** One copy as the in-memory sort reads it. */
export interface CopySortRow {
  id: string;
  itemNo: number;
  /** The stamp's `primaryCatalogSortKey` — the tiebreak. */
  catalogSortKey: string | null;
  /** The sorted-by value: the issue's name, or a base-currency figure. Null sorts last. */
  value: string | number | null;
}

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return NAME_COLLATOR.compare(String(a), String(b));
}

/** `rows` in the chosen order, without mutating the input. */
export function sortCopySortRows<T extends CopySortRow>(
  rows: readonly T[],
  sortDir: CopyListSortDir
): T[] {
  const dir = sortDir === "desc" ? -1 : 1;
  const primary = (a: T, b: T): number => {
    if (a.value == null && b.value == null) return 0;
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    return compareValues(a.value, b.value) * dir;
  };
  return [...rows].sort(
    (a, b) =>
      primary(a, b) ||
      compareCatalogSortKeys(a.catalogSortKey, b.catalogSortKey) ||
      a.itemNo - b.itemNo ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
