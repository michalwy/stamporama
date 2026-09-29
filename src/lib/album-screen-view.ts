// How the album screen arranges what the plan and the printed-card report say (#1430): the chapters,
// the filters, the summary strip, and the part of all that the address remembers.
//
// Pure, so the rules the screen is judged by — which sheets *need attention*, which chapter a row is
// in, what a summary figure counts — are testable without a component, and so the figures are
// arithmetic over the same per-sheet numbers the rows show rather than a second count of anything.
//
// ## A chapter here is the plan's chapter
//
// A chapter is a **run** of consecutive entries sharing a year (#767), not a year bucket: entries
// reordered so years interleave make two chapters headed 1938, and the album prints them that way.
// Grouping the screen into buckets would show one 1938 above sheets that are filed in two places, so
// the screen groups by runs too. A run is named by its year and, from the second run of a year on, by
// its occurrence (`1938~2`) — stable while the collector does not reorder, which is as stable as the
// thing it names.

/** What stands between a **live** sheet and the printer (#763, #765, #1308) — the page editor's own
 *  flags, counted per sheet. A printed sheet carries none: what is on a card is on it. */
export interface AlbumSheetAttention {
  /** Boxes nothing on the checklist has measured — drawn degenerate, uncuttable. */
  unmeasured: number;
  /** Boxes no strip in stock is tall enough for, which go in a pocket. */
  oversize: number;
  /** Boxes sized from a checklist neighbour rather than measured. */
  inherited: number;
  /** Texts on the sheet that would print in the default language. */
  untranslated: number;
}

export const NO_ATTENTION: AlbumSheetAttention = {
  unmeasured: 0,
  oversize: 0,
  inherited: 0,
  untranslated: 0,
};

export function needsAttention(a: AlbumSheetAttention): boolean {
  return a.unmeasured + a.oversize + a.inherited + a.untranslated > 0;
}

// -- Chapters -------------------------------------------------------------------

export interface AlbumChapterRun<T> {
  /** Stable while the order does not change: the year, then `~2`, `~3` for a later run of it. */
  id: string;
  /** The year as the plan keys it, blank for entries with no year. */
  key: string;
  items: T[];
}

export function albumChapterRuns<T>(
  items: readonly T[],
  keyOf: (item: T) => string
): AlbumChapterRun<T>[] {
  const runs: AlbumChapterRun<T>[] = [];
  const seen = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    const last = runs[runs.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
      continue;
    }
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const base = key === "" ? "none" : key;
    runs.push({ id: n === 1 ? base : `${base}~${n}`, key, items: [item] });
  }
  return runs;
}

/** An entry's chapter key, as `planAlbumFrom` computes it. */
export function entryChapterKey(entry: { year: number | null }): string {
  return entry.year === null ? "" : String(entry.year);
}

// -- What the address remembers ---------------------------------------------------

export type AlbumScreenTab = "sheets" | "entries" | "printed";
export type AlbumSheetFilter = "all" | "attention" | "live" | "printed";
/** The Printed cards tab narrowed to the cards the summary counts as out of date. */
export type AlbumCardFilter = "all" | "diverged";

export interface AlbumScreenView {
  tab: AlbumScreenTab;
  sheets: AlbumSheetFilter;
  cards: AlbumCardFilter;
  /** Chapters folded shut, by run id. Open is the default, so an album opened for the first time
   *  shows everything and the address only ever carries what the collector closed. */
  closed: ReadonlySet<string>;
}

const TABS: readonly AlbumScreenTab[] = ["sheets", "entries", "printed"];
const SHEET_FILTERS: readonly AlbumSheetFilter[] = ["all", "attention", "live", "printed"];
const CARD_FILTERS: readonly AlbumCardFilter[] = ["all", "diverged"];

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseAlbumScreenView(params: { get(name: string): string | null }): AlbumScreenView {
  const closed = params.get("closed");
  return {
    tab: oneOf(params.get("tab"), TABS, "sheets"),
    sheets: oneOf(params.get("sheets"), SHEET_FILTERS, "all"),
    cards: oneOf(params.get("cards"), CARD_FILTERS, "all"),
    closed: new Set(closed ? closed.split(",").filter(Boolean) : []),
  };
}

/** The view as a query string, defaults left out so a plain album address stays plain. Other
 *  parameters already in `base` are kept. */
export function albumScreenViewQuery(view: AlbumScreenView, base = ""): string {
  const params = new URLSearchParams(base);
  const set = (name: string, value: string, fallback: string) => {
    if (value === fallback) params.delete(name);
    else params.set(name, value);
  };
  set("tab", view.tab, "sheets");
  set("sheets", view.sheets, "all");
  set("cards", view.cards, "all");
  set("closed", [...view.closed].sort().join(","), "");
  return params.toString();
}

/**
 * The parameter that carries the album screen's view through the page editor (#1489), so the
 * editor's way back lands on the tab, filter and chapters the collector left. One parameter holding
 * the screen's own query rather than the screen's parameters themselves: the editor keeps its
 * address's other parameters as it moves between sheets, and `sheets` there would read as a filter
 * where the PDF reads it as a range.
 */
export const ALBUM_VIEW_PARAM = "view";

/** The album screen's address with a view carried back from the editor. The carried text is read
 *  through `parseAlbumScreenView`, so nothing but the view ever reaches the address; `next` sets
 *  part of it (the editor's *Printed cards* link opens that tab). */
export function albumScreenReturnHref(
  albumHref: string,
  carried: string | null,
  next: Partial<AlbumScreenView> = {}
): string {
  const view = parseAlbumScreenView(new URLSearchParams(carried ?? ""));
  const qs = albumScreenViewQuery({ ...view, ...next });
  return qs ? `${albumHref}?${qs}` : albumHref;
}

// -- Filters --------------------------------------------------------------------

export interface AlbumSheetRowFacts {
  printed: boolean;
  attention: AlbumSheetAttention;
}

export function sheetMatchesFilter(sheet: AlbumSheetRowFacts, filter: AlbumSheetFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "attention":
      return needsAttention(sheet.attention);
    case "live":
      return !sheet.printed;
    case "printed":
      return sheet.printed;
  }
}

export function cardMatchesFilter(
  card: { divergences: readonly unknown[] },
  filter: AlbumCardFilter
): boolean {
  return filter === "all" || card.divergences.length > 0;
}

// -- The summary strip ------------------------------------------------------------

export interface AlbumScreenSummary {
  entries: number;
  chapters: number;
  /** The first and last year among the entries, or null when none has one. */
  years: { from: number; to: number } | null;
  sheets: number;
  live: number;
  printed: number;
  /** Summed over the live sheets — the page editor's figures for the whole album. */
  attention: AlbumSheetAttention;
  /** Sheets that carry any of it. */
  attentionSheets: number;
  cards: number;
  /** Cards whose report lists at least one difference from what the album would now print. */
  divergedCards: number;
}

export function albumScreenSummary(
  entries: readonly { year: number | null }[],
  sheets: readonly AlbumSheetRowFacts[],
  cards: readonly { divergences: readonly unknown[] }[]
): AlbumScreenSummary {
  const years = entries.map((e) => e.year).filter((y): y is number => y !== null);
  const attention = { ...NO_ATTENTION };
  let attentionSheets = 0;
  for (const sheet of sheets) {
    attention.unmeasured += sheet.attention.unmeasured;
    attention.oversize += sheet.attention.oversize;
    attention.inherited += sheet.attention.inherited;
    attention.untranslated += sheet.attention.untranslated;
    if (needsAttention(sheet.attention)) attentionSheets += 1;
  }
  const printed = sheets.filter((s) => s.printed).length;
  return {
    entries: entries.length,
    chapters: albumChapterRuns(entries, entryChapterKey).length,
    years: years.length > 0 ? { from: Math.min(...years), to: Math.max(...years) } : null,
    sheets: sheets.length,
    live: sheets.length - printed,
    printed,
    attention,
    attentionSheets,
    cards: cards.length,
    divergedCards: cards.filter((c) => c.divergences.length > 0).length,
  };
}
