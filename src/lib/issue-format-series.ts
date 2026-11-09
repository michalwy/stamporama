// Whether a stamp counts towards the series it sits in (#2470, ADR-0080). Pure and import-free, so
// every module that reads a series can use it without an import cycle (`docs/agents/platform.md`).
//
// A piece a catalogue prices as a whole — postal stationery, an FDC with a set — is an ordinary
// catalogue entry with an issue format, in the issue beside the stamps. Its issue format says whether
// entries in it count towards the series; off, the entry can still be held, wanted individually,
// valued and offered, without disturbing the series around it.
//
// **A switch read, never written through.** A `ChecklistStamp` row of a non-counting entry stays
// where it is, so turning the switch back on restores exactly what was there — a checklist's editor
// reads the raw membership. **Everything that reads a checklist as a series** spreads
// {@link COUNTING_CHECKLIST_MEMBER}: completeness and missing counts, price and value totals, what a
// complete set is, a whole-set fan-out, a declared range, an album page.

/** The `where` a stamp must match to count towards a series: an ordinary stamp (no issue format), or
 *  an issue format that says so. */
export const COUNTS_TOWARDS_SERIES_STAMP = {
  OR: [{ issueFormatId: null }, { issueFormat: { is: { countsTowardsSeries: true } } }],
};

/** The `where` for a `ChecklistStamp` read as a member of the series. */
export const COUNTING_CHECKLIST_MEMBER = { stamp: COUNTS_TOWARDS_SERIES_STAMP };

/** What {@link stampCountsTowardsSeries} reads off a selected stamp. */
export const SERIES_FLAG_SELECT = {
  issueFormat: { select: { countsTowardsSeries: true } },
} as const;

/** Whether a stamp selected with {@link SERIES_FLAG_SELECT} counts; an ordinary stamp always does. */
export function stampCountsTowardsSeries(stamp: {
  issueFormat: { countsTowardsSeries: boolean } | null;
}): boolean {
  return stamp.issueFormat?.countsTowardsSeries ?? true;
}
