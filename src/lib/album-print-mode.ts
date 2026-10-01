// How an album entry is printed relative to its issue (#1509): as an issue of its own, or as a
// subset of its issue under the issue's heading.
//
// **Pure.** No Prisma, no React: the plan reads the default rule here, the Entries tab and the page
// editor offer the same three words, and the unit suite pins the rule on plain values.
//
// ## Why this exists
//
// An album prints each checklist as a block under its own heading. When an issue has several
// checklists in one album — the issue itself, *Watermark X*, *Watermark Y*, *Imperforate* — they read
// on the page as separate issues. The collector's own AlbumEasy pages set them the other way: one
// `STAMP_H1 12` heading for the issue, then a `STAMP_H2 10` sub-heading per variety (44 of them, 30 in
// `DA.txt` alone). So each entry states how it is printed:
//
// 1. **`own`** — a block of its own under its own heading, as every entry printed before #1509;
// 2. **`within`** — its stamps under the **issue's** heading, with no heading of its own;
// 3. **`within-subheading`** — under the issue's heading, with the checklist's name as a sub-heading.
//
// The mode is on the **album entry**, not on the checklist: the same checklist can be grouped in one
// album and printed on its own in another (settled with the collector on 2026-09-30).
//
// ## The default, when the collector has said nothing
//
// - A checklist **spanning issues** has no issue to be a subset of. It is always `own`, and the other
//   two are not offered.
// - An issue with **one** checklist in the album prints it as today: `own`.
// - An issue with **several**: the checklist named after the issue — its main checklist — takes
//   `within`, and the others take `within-subheading`. So the issue's title prints once, the main
//   checklist's stamps directly under it, then each other checklist under its own sub-heading.
//   Rejected: the main checklist in `own` with the others grouped under a second copy of the title.
//
// Only **neighbours** are grouped, and that is the layout's rule, not this module's: consecutive
// entries of one issue in the two `within` modes share one heading, and another issue between them
// prints the heading again. Nothing is reordered to bring an issue's checklists together.

export const ALBUM_PRINT_MODES = [
  { key: "own", label: "As its own issue", hint: "Its own block under its own heading" },
  { key: "within", label: "Within its issue", hint: "Under the issue's heading, no heading of its own" },
  {
    key: "within-subheading",
    label: "Within its issue, under a checklist heading",
    hint: "Under the issue heading, its name as a checklist heading",
  },
] as const;

export type AlbumPrintMode = (typeof ALBUM_PRINT_MODES)[number]["key"];

/** A stored or submitted mode, or null for anything this build does not know — which a reader takes
 *  as *not set* and a writer refuses. */
export function asAlbumPrintMode(raw: string | null | undefined): AlbumPrintMode | null {
  return ALBUM_PRINT_MODES.some((m) => m.key === raw) ? (raw as AlbumPrintMode) : null;
}

export function albumPrintModeLabel(mode: AlbumPrintMode): string {
  return ALBUM_PRINT_MODES.find((m) => m.key === mode)?.label ?? mode;
}

/** Whether the mode prints the entry under its issue's heading. */
export function albumPrintedWithinIssue(mode: AlbumPrintMode): boolean {
  return mode !== "own";
}

/** What the rule reads of an entry. */
export interface AlbumPrintModeEntry {
  id: string;
  /** Null for a checklist that spans issues. */
  issueId: string | null;
  issueName: string | null;
  checklistName: string;
  /** The collector's own choice, or null to follow the default. */
  printMode: AlbumPrintMode | null;
}

/** Whether the collector may choose a mode at all: never for a checklist spanning issues. */
export function albumPrintModeOffered(entry: Pick<AlbumPrintModeEntry, "issueId">): boolean {
  return entry.issueId !== null;
}

/** A checklist named after its issue — the issue's **main** checklist, which `ensureIssueChecklist`
 *  creates under the issue's own name. Compared as typed, trimmed. */
function isMainChecklist(entry: AlbumPrintModeEntry): boolean {
  const issue = entry.issueName?.trim();
  return !!issue && entry.checklistName.trim() === issue;
}

/** One entry's mode as it prints, and whether that is the default rather than the collector's own. */
export interface AlbumEffectivePrintMode {
  mode: AlbumPrintMode;
  defaulted: boolean;
}

/**
 * Every entry's mode as the album prints it, by entry id — the collector's own where he set one, the
 * default otherwise. The default reads the **whole album**: how many checklists of the entry's issue
 * the album holds, wherever they stand.
 */
export function albumEffectivePrintModes(
  entries: readonly AlbumPrintModeEntry[]
): Map<string, AlbumEffectivePrintMode> {
  const perIssue = new Map<string, number>();
  for (const entry of entries) {
    if (entry.issueId) perIssue.set(entry.issueId, (perIssue.get(entry.issueId) ?? 0) + 1);
  }
  const out = new Map<string, AlbumEffectivePrintMode>();
  for (const entry of entries) {
    if (!entry.issueId) {
      out.set(entry.id, { mode: "own", defaulted: entry.printMode === null });
      continue;
    }
    if (entry.printMode) {
      out.set(entry.id, { mode: entry.printMode, defaulted: false });
      continue;
    }
    const several = (perIssue.get(entry.issueId) ?? 0) > 1;
    out.set(entry.id, {
      mode: !several ? "own" : isMainChecklist(entry) ? "within" : "within-subheading",
      defaulted: true,
    });
  }
  return out;
}

/**
 * The runs of entries printed under one issue heading: consecutive entries of one issue whose modes
 * are both `within` ones. Another issue between them, or an entry of the same issue printed `own`,
 * ends a run — the next one prints the heading again. Returned as lists of entry ids in album order;
 * an entry in no run is in none of them.
 */
export function albumIssueRuns(
  entries: readonly AlbumPrintModeEntry[],
  modes: ReadonlyMap<string, AlbumEffectivePrintMode>
): string[][] {
  const runs: string[][] = [];
  let open: { issueId: string; ids: string[] } | null = null;
  for (const entry of entries) {
    const mode = modes.get(entry.id)?.mode ?? "own";
    if (!entry.issueId || !albumPrintedWithinIssue(mode)) {
      open = null;
      continue;
    }
    if (open && open.issueId === entry.issueId) {
      open.ids.push(entry.id);
      continue;
    }
    open = { issueId: entry.issueId, ids: [entry.id] };
    runs.push(open.ids);
  }
  return runs;
}
