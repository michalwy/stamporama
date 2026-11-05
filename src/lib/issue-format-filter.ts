// The issue-format filter (#2440) — the rules every screen that filters stamps or copies shares, pure
// so the server `where` builders, the URL parsers and the client-side filters all read one spelling.
//
// A stamp's issue format (#2439) is a dictionary row or null, and **null is an ordinary stamp**. So
// the filter is a multi-select whose null is a value of its own — `"stamp"`, labelled *Stamp (none)*
// — exactly as `"single"` is a copy format's (ADR-0020): ticking it beside a real value is two
// branches ORed together, and ticking it alone is the null test.
//
// A copy is filtered by its **stamp's** issue format. Unlike the area and the year, which read only
// the leading stamp, a copy holding several stamps (ADR-0044) matches when **any** of its stamps
// does — the reading #2440 settled: the cover bearing a souvenir sheet is found by *Souvenir sheet*.

/** The tickable value for "no issue format" — an ordinary stamp. */
export const ORDINARY_STAMP_ISSUE_FORMAT = "stamp";

/** The URL key every list and picker carries the filter under, repeated-free CSV. */
export const ISSUE_FORMAT_FILTER_PARAM = "issueFormatIds";

/** What the control's sentinel row reads. */
export const ORDINARY_STAMP_ISSUE_FORMAT_LABEL = "Stamp (none)";

/** The options of the filter control: the sentinel first, then the collection's issue formats in
 *  their dictionary order. */
export function issueFormatFilterOptions(
  formats: readonly { id: string; name: string }[]
): { id: string; label: string }[] {
  return [
    { id: ORDINARY_STAMP_ISSUE_FORMAT, label: ORDINARY_STAMP_ISSUE_FORMAT_LABEL },
    ...formats.map((f) => ({ id: f.id, label: f.name })),
  ];
}

/** Reads the filter from a CSV value; blanks dropped, duplicates folded. Empty is *every value*. */
export function parseIssueFormatIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

/**
 * The `Stamp` `where` fragment for the filter, or null when it is off. Returned as a plain object so
 * this module stays pure; it is a valid `Prisma.StampWhereInput`. An `OR` goes to the caller's AND
 * list, never to the top level, where a search's own `OR` would collide with it.
 */
export function issueFormatStampWhere(
  ids: readonly string[] | undefined
): Record<string, unknown> | null {
  if (!ids || ids.length === 0) return null;
  const wantsOrdinary = ids.includes(ORDINARY_STAMP_ISSUE_FORMAT);
  const real = ids.filter((id) => id !== ORDINARY_STAMP_ISSUE_FORMAT);
  if (!wantsOrdinary) return { issueFormatId: { in: real } };
  if (real.length === 0) return { issueFormatId: null };
  return { OR: [{ issueFormatId: null }, { issueFormatId: { in: real } }] };
}

/**
 * The `Item` `where` fragment: the leading stamp matches, or any stamp the copy carries does
 * (ADR-0044 §3 — the carried entries include the leading one; the first branch still reaches a copy
 * an older build left with no entry at all, as the search does). Null when the filter is off.
 */
export function issueFormatItemWhere(
  ids: readonly string[] | undefined
): Record<string, unknown> | null {
  const stamp = issueFormatStampWhere(ids);
  if (!stamp) return null;
  return { OR: [{ stamp }, { stamps: { some: { stamp } } }] };
}

/** The same filter, for a screen that filters rows it already holds: does a thing whose stamps
 *  carry these issue formats (null = an ordinary stamp) pass? Any one of them is enough. */
export function matchesIssueFormatFilter(
  stampIssueFormatIds: readonly (string | null)[],
  ids: readonly string[] | undefined
): boolean {
  if (!ids || ids.length === 0) return true;
  const wanted = new Set(ids);
  return stampIssueFormatIds.some((id) => wanted.has(id ?? ORDINARY_STAMP_ISSUE_FORMAT));
}

/** Writes the filter onto a query string — nothing when it is off. */
export function appendIssueFormatParam(
  params: URLSearchParams,
  ids: readonly string[] | undefined
): void {
  if (ids && ids.length > 0) params.set(ISSUE_FORMAT_FILTER_PARAM, ids.join(","));
}

/** The issue formats a copy's stamps carry, as {@link matchesIssueFormatFilter} reads them: the
 *  leading stamp's and every carried stamp's — the server's `issueFormatItemWhere`, for a row
 *  already read. */
export function copyStampIssueFormatIds(copy: {
  issueFormatId: string | null;
  carriedStamps: readonly { issueFormatId: string | null }[];
}): (string | null)[] {
  return [copy.issueFormatId, ...copy.carriedStamps.map((s) => s.issueFormatId)];
}
