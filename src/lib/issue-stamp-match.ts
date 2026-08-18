// Which stamps *inside* an issue an active filter matched (#186/#631).
//
// The server decides which **issues** a filter returns, and it matches an issue by things its row
// already draws (name, year, its short number, its declared range) as well as by the stamps inside
// it. Telling those two apart is what both consumers hang on: a row that surfaced only through a
// stamp says so about its tree — the picker dims the rest (#186), the Issues list drops it (#631) —
// and a row that matched on its own reads normally. Nothing has to come back from the server for
// that: the row carries every header field the query could have hit, so it works it out for itself
// and only the *inner* case pays for reading the issue's stamps.
//
// Pure and shaped by structural types rather than by `IssueListItem`/`StampNodeData`, so the rule
// stays testable without Prisma and the two surfaces cannot drift apart.

import { catalogKeyMatches, catalogMatchKey } from "./catalog-number";
import { parseEntityNoSearch } from "./quick-jump";

/** What a number needs of its vendor to be keyed — structural, so the UI's `AreaCatalogEntry`
 *  map is passed straight in and this module keeps `server-only` out of `test:unit`. */
export interface MatchVendorEntry {
  vendorAbbreviation: string;
  prefix: string | null;
}

/** Per-area vendor lookup, as every catalog-number renderer already takes it. */
export type MatchVendorMap = ReadonlyMap<string, MatchVendorEntry>;

/** What this needs of an issue row: exactly the fields its header draws. */
export interface MatchableIssue {
  name: string | null;
  year: number | null;
  issueNo: number | null;
  catalogNumbers: readonly {
    catalogVendorId: string;
    firstNumber: string;
    lastNumber: string | null;
  }[];
}

/** What this needs of a stamp in the tree. */
export interface MatchableStamp {
  stampId: string;
  name: string | null;
  catalogNumbers: readonly { catalogVendorId: string; number: string }[];
}

/**
 * The stamp-level half of a list's filter set — the parts that can be satisfied by a *member
 * stamp* rather than by the issue itself. Area and year are the issue's own and are not here.
 */
export interface StampFilterQuery {
  /** The quick-search box's text (#289's prefixed numbers included — they normalize the same). */
  search?: string;
  /** The catalog filter's number (#146), matched **exactly**, as the server matches it. */
  catalogNumber?: string;
  /** Narrows {@link catalogNumber} to one vendor; without it the number matches across all. */
  catalogVendorId?: string;
}

/** Normalized catalog keys for one stamp's numbers — vendor abbreviation + area prefix + number. */
function stampKeys(stamp: MatchableStamp, vendorMap: MatchVendorMap): string[] {
  return stamp.catalogNumbers.map((cn) => {
    const v = vendorMap.get(cn.catalogVendorId);
    return catalogMatchKey(v?.vendorAbbreviation ?? "", v?.prefix, cn.number);
  });
}

/**
 * Does the issue's *own* header explain why the search returned this row?
 *
 * Numbers are matched on their normalized key (vendor abbreviation + area prefix + number), so a
 * prefixed query resolves in any spacing — `Mi PL 200`, `MiPL200`, `PL200` and bare `200` all
 * reach the same issue (#146).
 */
export function issueHeaderMatchesSearch(
  issue: MatchableIssue,
  search: string,
  vendorMap: MatchVendorMap
): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  if ((issue.name ?? "").toLowerCase().includes(q)) return true;
  if (issue.year != null && String(issue.year).includes(q)) return true;
  if (parseEntityNoSearch(search) === issue.issueNo) return true;
  const keys = issue.catalogNumbers.flatMap((cn) => {
    const v = vendorMap.get(cn.catalogVendorId);
    const abbr = v?.vendorAbbreviation ?? "";
    return [cn.firstNumber, cn.lastNumber]
      .filter((n): n is string => !!n)
      .map((n) => catalogMatchKey(abbr, v?.prefix, n));
  });
  return catalogKeyMatches(search, keys);
}

/** Which of an issue's stamps a search matched — by name or by catalog number (#186). */
export function matchStampsBySearch(
  stamps: readonly MatchableStamp[],
  search: string,
  vendorMap: MatchVendorMap
): Set<string> {
  const q = search.trim().toLowerCase();
  const out = new Set<string>();
  if (!q) return out;
  for (const s of stamps) {
    const nameHit = (s.name ?? "").toLowerCase().includes(q);
    if (nameHit || catalogKeyMatches(search, stampKeys(s, vendorMap))) out.add(s.stampId);
  }
  return out;
}

/**
 * Does the issue's declared range (#146) explain the catalog filter?
 *
 * Exact equality on the stored number, and on the *vendor* when the filter names one — the very
 * `where` the server builds, so the row and its tree cannot disagree about what matched.
 */
export function issueHeaderMatchesCatalogFilter(
  issue: MatchableIssue,
  query: Pick<StampFilterQuery, "catalogNumber" | "catalogVendorId">
): boolean {
  const number = query.catalogNumber;
  if (!number) return true;
  return issue.catalogNumbers.some(
    (cn) =>
      (!query.catalogVendorId || cn.catalogVendorId === query.catalogVendorId) &&
      (cn.firstNumber === number || cn.lastNumber === number)
  );
}

/** Which of an issue's stamps carry the catalog filter's exact number (#146). */
export function matchStampsByCatalogFilter(
  stamps: readonly MatchableStamp[],
  query: Pick<StampFilterQuery, "catalogNumber" | "catalogVendorId">
): Set<string> {
  const out = new Set<string>();
  if (!query.catalogNumber) return out;
  for (const s of stamps) {
    const hit = s.catalogNumbers.some(
      (cn) =>
        (!query.catalogVendorId || cn.catalogVendorId === query.catalogVendorId) &&
        cn.number === query.catalogNumber
    );
    if (hit) out.add(s.stampId);
  }
  return out;
}

/** True when any part of the query narrows on a *stamp* — the cheap test before reading a tree. */
export function hasStampFilter(query: StampFilterQuery): boolean {
  return !!query.search?.trim() || !!query.catalogNumber;
}

/**
 * Whether this issue's stamps have to be read at all: true when some active filter is **not**
 * accounted for by the row's own header, so the hit can only have come from a stamp inside.
 */
export function needsInnerStampMatch(
  issue: MatchableIssue,
  query: StampFilterQuery,
  vendorMap: MatchVendorMap
): boolean {
  if (!hasStampFilter(query)) return false;
  if (query.search?.trim() && !issueHeaderMatchesSearch(issue, query.search, vendorMap)) return true;
  if (query.catalogNumber && !issueHeaderMatchesCatalogFilter(issue, query)) return true;
  return false;
}

/**
 * The stamps in this issue that the filter picked out, or **null** for "the filter says nothing
 * about this tree" — no stamp-level filter, every active one explained by the issue's own header,
 * or nothing inside matched after all.
 *
 * Several active filters **intersect**, because the server ANDs them: an issue returned by a search
 * *and* a catalog number was returned for stamps satisfying both. A filter the header already
 * explains contributes nothing — narrowing on it would hide the whole tree of a row that matched on
 * its name. Null rather than an empty set for the no-match case: showing the tree whole beats
 * showing an empty issue, which reads as data loss rather than as a filter.
 */
export function matchedStampsInIssue(
  issue: MatchableIssue,
  stamps: readonly MatchableStamp[],
  query: StampFilterQuery,
  vendorMap: MatchVendorMap
): Set<string> | null {
  const sets: Set<string>[] = [];
  if (query.search?.trim() && !issueHeaderMatchesSearch(issue, query.search, vendorMap)) {
    sets.push(matchStampsBySearch(stamps, query.search, vendorMap));
  }
  if (query.catalogNumber && !issueHeaderMatchesCatalogFilter(issue, query)) {
    sets.push(matchStampsByCatalogFilter(stamps, query));
  }
  if (sets.length === 0) return null;
  const [first, ...rest] = sets;
  const matched = new Set([...first].filter((id) => rest.every((s) => s.has(id))));
  return matched.size > 0 ? matched : null;
}
