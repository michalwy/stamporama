// `list_issues` (#2167): the issues of an area, held or not, as an agent reads them.
//
// Pure: no Prisma. The rows come off the Issues list's own read model (`listIssuesPaginated`), so an
// issue reads to an agent as it does on the screen beside it; this module decides what a row says,
// how the held copies fold into per-condition figures, and which narrowings make a call.

import { compact } from "./collection-reads";
import { invalidRequest } from "./errors";

/** Copies held of an issue's stamps in one condition. */
export interface AgentHeldInCondition {
  readonly condition: string;
  readonly copies: number;
}

export interface AgentIssueListRow {
  readonly issueId: string;
  readonly issueNo: number;
  readonly name?: string;
  /** Per-language names, keyed by ISO 639-1 code; absent when none is recorded. */
  readonly translatedNames?: Readonly<Record<string, string>>;
  readonly year?: number;
  readonly area?: string;
  /** The declared range per catalogue, `Mi·PL 1384–1388`. */
  readonly catalogRanges: readonly string[];
  /** The prefixes the issue sets itself, `"Mi: GG"` — what `update_issue` takes in `prefixes`.
   *  Absent where it follows its area. */
  readonly prefixes?: readonly string[];
  /** Stamps filed under the issue, its variants included. */
  readonly memberCount: number;
  /** Distinct stamps on any of its checklists. */
  readonly requiredCount: number;
  /** Copies held of any of its stamps. */
  readonly heldCopies: number;
  /** The same copies by condition, in the collection's order of conditions; only conditions held. */
  readonly heldByCondition: readonly AgentHeldInCondition[];
  readonly path: string;
}

/** The Issues list's row, typed structurally (`IssueListItem` carries what this needs and more). */
export interface IssueListRowSource {
  readonly id: string;
  readonly issueNo: number;
  readonly name: string | null;
  readonly nameByLanguage: Readonly<Record<string, string>>;
  readonly year: number | null;
  readonly catalogPrefixes: readonly { readonly catalogVendorId: string; readonly areaPrefix: string }[];
  readonly memberCount: number;
  readonly requiredCount: number;
}

export interface IssueListRowExtras {
  readonly area: string | null;
  readonly catalogRanges: readonly string[];
  /** Catalogue abbreviation per vendor id. */
  readonly abbrOf: ReadonlyMap<string, string>;
  readonly held: { readonly heldCopies: number; readonly heldByCondition: readonly AgentHeldInCondition[] };
  readonly path: string;
}

/** The issue's own prefixes, spelled as `update_issue` takes them and sorted as `get_issue` sorts its
 *  `catalogues.own`. */
export function ownPrefixes(
  rows: IssueListRowSource["catalogPrefixes"],
  abbrOf: ReadonlyMap<string, string>
): string[] {
  return rows
    .map((row) => `${abbrOf.get(row.catalogVendorId) ?? row.catalogVendorId}: ${row.areaPrefix}`)
    .sort((a, b) => a.localeCompare(b));
}

export function issueListRow(row: IssueListRowSource, extras: IssueListRowExtras): AgentIssueListRow {
  const prefixes = ownPrefixes(row.catalogPrefixes, extras.abbrOf);
  return compact({
    issueId: row.id,
    issueNo: row.issueNo,
    name: row.name ?? undefined,
    translatedNames: Object.keys(row.nameByLanguage).length > 0 ? { ...row.nameByLanguage } : undefined,
    year: row.year ?? undefined,
    area: extras.area ?? undefined,
    catalogRanges: [...extras.catalogRanges],
    prefixes: prefixes.length > 0 ? prefixes : undefined,
    memberCount: row.memberCount,
    requiredCount: row.requiredCount,
    heldCopies: extras.held.heldCopies,
    heldByCondition: [...extras.held.heldByCondition],
    path: extras.path,
  });
}

/**
 * Copies held of an issue's stamps, by condition. `countOf` is the held count of one stamp in one
 * condition — `countCopiesByStampAndCondition`'s, so *held* means here what it means on every badge.
 * A copy is linked to one stamp, so summing over the issue's members counts each copy once.
 */
export function heldByCondition(
  stampIds: readonly string[],
  conditions: readonly { readonly id: string; readonly name: string }[],
  countOf: (stampId: string, conditionId: string) => number
): { heldCopies: number; heldByCondition: AgentHeldInCondition[] } {
  const unique = [...new Set(stampIds)];
  const byCondition: AgentHeldInCondition[] = [];
  let heldCopies = 0;
  for (const condition of conditions) {
    const copies = unique.reduce((sum, stampId) => sum + countOf(stampId, condition.id), 0);
    if (copies === 0) continue;
    byCondition.push({ condition: condition.name, copies });
    heldCopies += copies;
  }
  return { heldCopies, heldByCondition: byCondition };
}

/** What a `list_issues` call narrows by, checked. */
export interface IssueListNarrowing {
  readonly area: string | null;
  readonly text: string | null;
  readonly yearFrom: number | null;
  readonly yearTo: number | null;
}

/** At least the area or the text, and a span that runs forwards. */
export function checkIssueListNarrowing(narrowing: IssueListNarrowing): void {
  if (narrowing.area === null && narrowing.text === null) {
    throw invalidRequest(
      'Send "area" (the issues filed under it), "text" (a name or catalogue number), or both.',
      ["area", "text"]
    );
  }
  if (narrowing.yearFrom !== null && narrowing.yearTo !== null && narrowing.yearFrom > narrowing.yearTo) {
    throw invalidRequest(
      `"year_from" (${narrowing.yearFrom}) is after "year_to" (${narrowing.yearTo}). Send the earlier year as "year_from"; for one year send it as both.`
    );
  }
}
