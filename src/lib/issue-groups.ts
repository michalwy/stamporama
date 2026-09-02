// Grouping the Copies list by the **issue** its copies belong to (#424) — the pure half. No React,
// no Prisma, so the server read, the client panel and the unit tests share one derivation.
//
// This is the third question the list's grouping answers, beside "what do I hold in duplicate"
// (#372) and "where is it filed" (#421): *what have I got of this series* — the reading a collector
// works through a set in, and the one that says at a glance where a series is thin.
//
// A stamp's issue membership is many-to-many, but a copy is reported under **one** issue: its
// stamp's first membership, which is exactly what `ItemListItem.issueId` already says and what the
// purchase-order intake already groups on (#172). One answer per copy, so the groups partition the
// list and their counts add up to it — a copy reported under three issues would make every count on
// the screen a number that means nothing in particular.

import { compareCatalogSortKeys } from "./catalog-sort-key";

/** The `issueId` filter value standing for the copies whose stamp is in **no** issue. Null is a
 * value on this axis, and an absent filter means "any issue", which is the opposite of what the
 * issue-less group asks for. The same sentinel the lot intake's issue groups use (#172), so one
 * spelling of "no issue" reaches the server from every surface. */
export const NO_ISSUE = "__none__";

/** What an issue group needs to be ordered — the Issues list's own reading order (#181): by year,
 * then by the issue's primary catalog number, then by name. `null` throughout is the issue-less
 * bucket, which sorts last however the rest fall. */
export interface SortableIssueGroup {
  issueId: string | null;
  issueYear: number | null;
  /** The denormalized primary-catalog sort key (ADR-0012), null when the issue carries no number. */
  catalogSortKey: string | null;
  issueName: string | null;
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Reading order for issue groups: **the Issues list's own** — year ascending, then the primary
 * catalog number, then the name (#181) — because a collector scanning their copies by series is
 * reading the same list they browse the catalogue in, and two orders for one subject is two things
 * to learn. A year-less issue sorts after the dated ones, as it does there; the **issue-less** group
 * sorts last of all, being the absence of the subject rather than a thin edge of it.
 *
 * Total (ties fall through to the issue id), so paging over a sorted list can neither repeat nor
 * skip a group — which is the whole reason the ordering is applied server-side.
 */
export function compareIssueGroups(a: SortableIssueGroup, b: SortableIssueGroup): number {
  if (a.issueId === null || b.issueId === null) {
    if (a.issueId === b.issueId) return 0;
    return a.issueId === null ? 1 : -1;
  }
  if (a.issueYear !== b.issueYear) {
    if (a.issueYear === null) return 1;
    if (b.issueYear === null) return -1;
    return a.issueYear - b.issueYear;
  }
  // The primary catalog number is the implicit tiebreaker everywhere (#181, ADR-0012), and a
  // number-less issue sorts last within its year exactly as it does on the Issues list.
  const byCatalog = compareCatalogSortKeys(a.catalogSortKey, b.catalogSortKey);
  if (byCatalog !== 0) return byCatalog;
  const byName = COLLATOR.compare(a.issueName ?? "", b.issueName ?? "");
  if (byName !== 0) return byName;
  return a.issueId < b.issueId ? -1 : a.issueId > b.issueId ? 1 : 0;
}

/**
 * What an issue group is called: the issue's name and year, the way the lot intake's issue headers
 * already write it (#172) — one spelling, so a series reads identically wherever copies are grouped
 * under it. An issue with neither is `Untitled issue`: it exists and holds these copies, which is
 * more than an empty label would say.
 */
export function issueGroupLabel(
  issueId: string | null,
  name: string | null,
  year: number | null
): string {
  if (issueId === null) return "No issue";
  return (
    [name?.trim() || null, year ? `(${year})` : null].filter(Boolean).join(" ") || "Untitled issue"
  );
}
