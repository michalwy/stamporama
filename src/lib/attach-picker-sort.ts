/**
 * The **Attach existing copies…** picker's sort (#2147): catalogue number, copy number, date
 * added or catalogue value, each either way. Pure, so the dialog and the unit suite read one
 * definition; the picker is one unpaginated read, so the order is applied client-side over the
 * fetched rows, beside the filters (`attach-picker-filters.ts`).
 *
 * **Catalogue number is catalogue order**, not the catalogue number as text: area (the rail's
 * order), year, issue (as the Issues list orders them — by its catalogue sort key, then name),
 * then the stamp's place in the issue's tree, the order the issue's own page draws it in
 * (`flattenMemberTree`). A copy is placed by its stamp — a multi-stamp piece by its leading stamp,
 * which is what the row's area, year and issue already describe. The issue's key and the stamp's
 * place are read server-side into {@link AttachCatalogueOrder}; the area's rank is the client's,
 * which holds the tree.
 *
 * A copy missing a key — no area, no year, no issue, no value — sorts **last in either
 * direction**, the rule `copy-sort.ts` already keeps for the lot views, so blanks never lead.
 */

import { compareCatalogSortKeys } from "./catalog-sort-key";

export const ATTACH_SORT_KEYS = ["catalogue", "copyNo", "added", "value"] as const;
export type AttachSortKey = (typeof ATTACH_SORT_KEYS)[number];

export const ATTACH_SORT_LABEL: Record<AttachSortKey, string> = {
  catalogue: "Catalogue number",
  copyNo: "Copy number",
  added: "Date added",
  value: "Catalogue value",
};

export type AttachSortDir = "asc" | "desc";

/** Where a copy's stamp stands in the catalogue, beyond what its row already carries. */
export interface AttachCatalogueOrder {
  /** The issue's `primaryCatalogSortKey`, or null for no issue or a number-less one. */
  issueSortKey: string | null;
  /** The stamp's position in its issue's tree read down the page, or null when it is in none. */
  memberRank: number | null;
  /** The stamp's own `primaryCatalogSortKey` — the order among copies of no issue. */
  stampSortKey: string | null;
}

/** The fields of a copy the sort reads. */
export interface AttachSortCopy {
  itemNo: number;
  /** A `Date` on the server, an ISO string once it has crossed the route. */
  createdAt: Date | string;
  areaId: string | null;
  issueId: string | null;
  issueName: string | null;
  issueYear: number | null;
  issuedYear: number | null;
  value: { baseAmount: number | null };
  catalogueOrder: AttachCatalogueOrder;
}

/** Null last in both directions; `dir` applies only between two values. */
function nullsLast<T>(a: T | null, b: T | null, dir: number, cmp: (a: T, b: T) => number): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return cmp(a, b) * dir;
}

const byNumber = (a: number, b: number) => a - b;
const byKey = (a: string, b: string) => compareCatalogSortKeys(a, b);
const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function addedAt(copy: AttachSortCopy): number {
  return typeof copy.createdAt === "string" ? Date.parse(copy.createdAt) : copy.createdAt.getTime();
}

/** Catalogue order: area, year, issue, place in the issue, then the stamp's own number. */
function compareCatalogue(
  a: AttachSortCopy,
  b: AttachSortCopy,
  dir: number,
  areaRank: ReadonlyMap<string, number>
): number {
  const rankOf = (c: AttachSortCopy) => (c.areaId ? (areaRank.get(c.areaId) ?? null) : null);
  // The year the Issues list orders an issue by; a stamp in no issue falls back to its own.
  const yearOf = (c: AttachSortCopy) => c.issueYear ?? c.issuedYear ?? null;
  return (
    nullsLast(rankOf(a), rankOf(b), dir, byNumber) ||
    nullsLast(yearOf(a), yearOf(b), dir, byNumber) ||
    // Copies of no issue follow every issue of their year.
    nullsLast(a.issueId, b.issueId, 1, () => 0) ||
    nullsLast(a.catalogueOrder.issueSortKey, b.catalogueOrder.issueSortKey, dir, byKey) ||
    nullsLast(a.issueName, b.issueName, dir, (x, y) => NAME_COLLATOR.compare(x, y)) ||
    nullsLast(a.issueId, b.issueId, dir, (x, y) => (x < y ? -1 : x > y ? 1 : 0)) ||
    nullsLast(a.catalogueOrder.memberRank, b.catalogueOrder.memberRank, dir, byNumber) ||
    nullsLast(a.catalogueOrder.stampSortKey, b.catalogueOrder.stampSortKey, dir, byKey)
  );
}

/**
 * `copies` in the chosen order, without mutating the input. Every key ends on the copy number, so
 * two copies of one stamp — or two with no value — keep a fixed order between them.
 *
 * `areaOrder` is the area rail read down the page (`flattenAreaTree`); an area it does not hold
 * sorts with the copies of no area.
 */
export function sortAttachableCopies<T extends AttachSortCopy>(
  copies: readonly T[],
  sortBy: AttachSortKey,
  sortDir: AttachSortDir,
  areaOrder: readonly string[]
): T[] {
  const dir = sortDir === "desc" ? -1 : 1;
  const areaRank = new Map(areaOrder.map((id, i) => [id, i]));
  const primary = (a: T, b: T): number => {
    switch (sortBy) {
      case "catalogue":
        return compareCatalogue(a, b, dir, areaRank);
      case "added":
        return (addedAt(a) - addedAt(b)) * dir;
      case "value":
        return nullsLast(a.value.baseAmount, b.value.baseAmount, dir, byNumber);
      case "copyNo":
        return 0;
    }
  };
  return [...copies].sort((a, b) => primary(a, b) || (a.itemNo - b.itemNo) * dir);
}

export function isAttachSortKey(value: unknown): value is AttachSortKey {
  return typeof value === "string" && (ATTACH_SORT_KEYS as readonly string[]).includes(value);
}
