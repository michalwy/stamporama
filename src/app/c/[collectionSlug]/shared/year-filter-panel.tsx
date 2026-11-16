"use client";

import { useMemo, useRef, useState } from "react";
import { CollapsibleFilterPanel } from "./collapsible-filter-panel";
import { useCollapsedSet } from "./use-collapsed-set";
import { NumericInput } from "./numeric-input";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";
import {
  decadeStretchEnd,
  groupYearsByDecade,
  readYearSelection,
  selectionTouchesDecade,
  selectsWholeDecade,
  yearRangeLabel,
  yearRangeValue,
  yearSelects,
  type YearSelection,
} from "@/lib/list-area-year-filter";

const STORAGE_KEY = "stamporama:year-filter-collapsed";
/**
 * The decades the collector has opened (#2553), by first year — per browser, like the panel's own
 * collapsed state. The set holds the *open* ones: every decade starts closed, and one appearing on
 * a list for the first time stays closed rather than inheriting a default nobody chose.
 */
const OPEN_DECADES_KEY = "stamporama:year-filter-open-decades";

export interface YearFacet {
  /** null represents the "No year" bucket. */
  year: number | null;
  count: number;
}

interface YearFilterPanelProps {
  facets: YearFacet[] | undefined;
  isLoading: boolean;
  /**
   * Active URL value: a numeric year string, "none", a span of years such as `1945-1960` (#2258,
   * read by `readYearSelection`), or null when unfiltered.
   */
  selectedYear: string | null;
  onSelect: (year: string | null) => void;
  /**
   * A span of years in force instead of one — the Copies list's decade (#1401), which the collection
   * structure screen opens its year dimension by. Drawn as a selected row under *All years*, so a
   * list narrowed to the fifties says so on the rail rather than showing every year unselected;
   * *All years* clears it, and so does picking a single year. `from` / `to` are its years, so the
   * decade rows can mark and open it as they do a span picked on the rail (#2553).
   */
  span?: { label: string; from: number; to: number } | null;
}

/** The selection value a facet maps to in the URL. */
function facetValue(year: number | null): string {
  return year === null ? "none" : String(year);
}

/**
 * The year a Shift-click stretches a span from (#2258): the year selected, or the end of the span
 * in force that the collector last clicked — remembered so a second Shift-click re-stretches from
 * the same end rather than from wherever the span happens to start. Nothing to stretch from with
 * every year, or No year, selected.
 */
function anchorOf(selection: YearSelection, remembered: number | null): number | null {
  if (selection.kind === "year") return selection.year;
  if (selection.kind !== "range") return null;
  if (remembered !== null && (remembered === selection.from || remembered === selection.to))
    return remembered;
  return selection.from ?? selection.to;
}

/** The text a year field shows for a bound: the year, or nothing for an open end. */
function boundText(year: number | null): string {
  return year === null ? "" : String(year);
}

/** What every row of the column shares, a decade's name and a year alike. */
const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.5rem",
  width: "100%",
  textAlign: "left",
  border: "none",
  cursor: "pointer",
  fontSize: "0.8125rem",
};

const COUNT_STYLE: React.CSSProperties = {
  flexShrink: 0,
  fontSize: "0.75rem",
  fontWeight: 400,
  color: "var(--color-text-muted)",
  fontVariantNumeric: "tabular-nums",
};

const FIELD_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  width: 0,
  padding: "0.3rem 0.4rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.3rem",
  fontSize: "0.8125rem",
  fontVariantNumeric: "tabular-nums",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
};

/**
 * One end of the From / To pair (#2258). Commits when it is left — Tab, a click away, or Enter —
 * never while typing, so `19` on the way to `1945` narrows nothing. Emptied, the end is open; an
 * entry that is not a year falls back to what is in force rather than sitting there looking like a
 * bound.
 */
function YearField({
  ariaLabel,
  placeholder,
  value,
  onCommit,
}: {
  ariaLabel: string;
  placeholder: string;
  value: number | null;
  onCommit: (value: number | null) => void;
}) {
  const text = boundText(value);
  const [draft, setDraft] = useState(text);
  // The bound changes from outside the field — a Shift-click, *All years*, another list — and the
  // draft follows it, adjusted during render as `NumberField` in the lot builder does.
  const [seen, setSeen] = useState(text);
  if (seen !== text) {
    setSeen(text);
    setDraft(text);
  }

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (value !== null) onCommit(null);
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      setDraft(text);
      return;
    }
    const year = parseInt(trimmed, 10);
    setDraft(String(year));
    if (year !== value) onCommit(year);
  };

  return (
    <NumericInput
      kind="number"
      inputMode="numeric"
      aria-label={ariaLabel}
      placeholder={placeholder}
      style={FIELD_STYLE}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function YearFilterPanel({
  facets,
  isLoading,
  selectedYear,
  onSelect,
  span,
}: YearFilterPanelProps) {
  const selection = readYearSelection(selectedYear);
  const range = selection.kind === "range" ? selection : null;
  const everyYear = selection.kind === "all" && !span;
  // The end of the span the collector last clicked — see `anchorOf`.
  const anchorRef = useRef<number | null>(null);

  // The From / To fields and the column say the same thing (#2258): one year selected is a span of
  // that one year in both fields, so typing the other end stretches it.
  const fromBound = selection.kind === "year" ? selection.year : (range?.from ?? null);
  const toBound = selection.kind === "year" ? selection.year : (range?.to ?? null);

  const pickYear = (year: number | null, stretch: boolean) => {
    const anchor = year === null || !stretch ? null : anchorOf(selection, anchorRef.current);
    if (year === null || anchor === null) {
      // A plain click, or a Shift-click with nothing to stretch from: that one year. No year is
      // outside every span, so it is always picked on its own.
      anchorRef.current = year;
      onSelect(facetValue(year));
      return;
    }
    anchorRef.current = anchor;
    onSelect(yearRangeValue(anchor, year));
  };

  // A decade's name (#2553): the decade whole, as typing its two ends into From / To would. A
  // Shift-click stretches from the anchor to the decade's near end; from inside the decade there
  // is no near end, and the decade is selected whole.
  const pickDecade = (start: number, stretch: boolean) => {
    const anchor = stretch ? anchorOf(selection, anchorRef.current) : null;
    const end = anchor === null ? null : decadeStretchEnd(anchor, start);
    if (anchor === null || end === null) {
      anchorRef.current = start;
      onSelect(yearRangeValue(start, start + 9));
      return;
    }
    anchorRef.current = anchor;
    onSelect(yearRangeValue(anchor, end));
  };

  // What the decade rows mark and open: the rail's own selection, or the span a screen put in force
  // instead (the structure screen's decade, #1401).
  const railSelection =
    selection.kind === "all" && span
      ? ({ kind: "range", from: span.from, to: span.to } as const)
      : selection;
  const grouped = useMemo(() => groupYearsByDecade(facets ?? []), [facets]);

  // Which decades are open (#2553). The collector's own opening and closing is remembered per
  // browser; on top of it, **the decades the selection falls in are drawn open** — after a reload,
  // when another list or the structure screen put the selection there, and on every new pick. The
  // collector can still close one: that holds until the selection changes, and is not written down,
  // so a decade opened only because a year in it was picked closes again once the year is cleared.
  const { collapsed: storedOpen, toggle: flipStored } = useCollapsedSet(OPEN_DECADES_KEY);
  const selectionDecades = new Set(
    grouped.decades
      .filter((d) => selectionTouchesDecade(railSelection, d.start))
      .map((d) => String(d.start))
  );
  const selectionKey = `${selectedYear ?? ""}|${span ? `${span.from}-${span.to}` : ""}`;
  const [closed, setClosed] = useState<{ key: string; ids: Set<string> }>({
    key: selectionKey,
    ids: new Set(),
  });
  // A new selection opens its decades again — adjusted during render, as `YearField` follows its bound.
  if (closed.key !== selectionKey) setClosed({ key: selectionKey, ids: new Set() });
  const closedNow = closed.key === selectionKey ? closed.ids : new Set<string>();
  const isDecadeOpen = (id: string) =>
    storedOpen.has(id) || (selectionDecades.has(id) && !closedNow.has(id));
  const toggleDecade = (id: string) => {
    const opening = !isDecadeOpen(id);
    if (opening !== storedOpen.has(id)) flipStored(id);
    if (selectionDecades.has(id)) {
      const ids = new Set(closedNow);
      if (opening) ids.delete(id);
      else ids.add(id);
      setClosed({ key: selectionKey, ids });
    }
  };

  const yearRow = (facet: YearFacet, indented: boolean) => {
    const value = facetValue(facet.year);
    // The one year chosen, as against a year highlighted for lying inside a span (#2258).
    const isPicked = selectedYear === value;
    const isSelected = isPicked || (range !== null && yearSelects(selectedYear, facet.year));
    const label = facet.year === null ? "No year" : String(facet.year);
    return (
      <button
        key={value}
        type="button"
        // A Shift-click would otherwise select the text of every row between the two clicks.
        onMouseDown={(e) => {
          if (e.shiftKey) e.preventDefault();
        }}
        // Selected already: nothing to do (#843). The panel has its own "All years" row, so
        // clearing is on screen and unambiguous; a second click on the year just chosen used
        // to widen the list back to everything, which reads as the filter failing. A year
        // inside a span is not chosen on its own, so a plain click narrows to it.
        onClick={(e) => {
          if (e.shiftKey) pickYear(facet.year, true);
          else if (!isPicked) pickYear(facet.year, false);
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = "var(--color-bg-muted)";
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = "transparent";
        }}
        style={{
          ...ROW_STYLE,
          // Indented under its decade's name, past the arrow.
          padding: indented ? "0.35rem 1rem 0.35rem 2.25rem" : "0.4rem 1rem",
          background: isSelected ? "var(--color-accent-soft)" : "transparent",
          fontWeight: isSelected ? 600 : 400,
          fontStyle: facet.year === null ? "italic" : "normal",
          color: isSelected ? "var(--color-accent)" : "var(--color-text-secondary)",
        }}
      >
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <span style={COUNT_STYLE}>{facet.count}</span>
      </button>
    );
  };

  const rangeLabel = range ? yearRangeLabel(range.from, range.to) : (span?.label ?? null);

  return (
    <CollapsibleFilterPanel
      title="Year"
      storageKey={STORAGE_KEY}
      expandedWidth="12rem"
      borderLeft
      subheader={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.3rem",
            padding: "0.4rem 0.75rem",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <YearField
            ariaLabel="From year"
            placeholder="From"
            value={fromBound}
            onCommit={(from) => onSelect(yearRangeValue(from, toBound))}
          />
          <span style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>–</span>
          <YearField
            ariaLabel="To year"
            placeholder="To"
            value={toBound}
            onCommit={(to) => onSelect(yearRangeValue(fromBound, to))}
          />
        </div>
      }
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        onMouseEnter={(e) => {
          if (!everyYear)
            e.currentTarget.style.background = "var(--color-bg-muted)";
        }}
        onMouseLeave={(e) => {
          if (!everyYear) e.currentTarget.style.background = "transparent";
        }}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          padding: "0.5rem 1rem",
          background: everyYear ? "var(--color-accent-soft)" : "transparent",
          border: "none",
          borderBottom: "1px solid var(--color-border)",
          cursor: "pointer",
          fontSize: "0.875rem",
          fontWeight: everyYear ? 600 : 400,
          color: everyYear
            ? "var(--color-text-primary)"
            : "var(--color-text-secondary)",
        }}
      >
        All years
      </button>

      {rangeLabel !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
            padding: "0.4rem 0.5rem 0.4rem 1rem",
            background: "var(--color-accent-soft)",
            borderBottom: "1px solid var(--color-border)",
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "var(--color-accent)",
          }}
        >
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
            {rangeLabel}
          </span>
          <Tooltip content="Back to all years" placement="bottom">
            <button
              type="button"
              aria-label="Clear the years"
              onClick={() => onSelect(null)}
              style={{
                display: "inline-flex",
                flexShrink: 0,
                padding: "0.15rem",
                border: "none",
                borderRadius: "0.25rem",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              <Icon name="clear" size="sm" />
            </button>
          </Tooltip>
        </div>
      )}

      {isLoading && (
        <div
          style={{
            padding: "0.75rem 1rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-muted)",
          }}
        >
          Loading…
        </div>
      )}

      {!isLoading &&
        grouped.decades.map((decade) => {
          const id = String(decade.start);
          const isOpen = isDecadeOpen(id);
          const isWhole = selectsWholeDecade(railSelection, decade.start);
          // Marked, not filled: some of the selection is in here, but not the decade as a whole.
          const holdsSelection = !isWhole && selectionTouchesDecade(railSelection, decade.start);
          const name = `${decade.start}s`;
          return (
            <div key={id}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: "0.5rem",
                  background: isWhole ? "var(--color-accent-soft)" : "transparent",
                }}
              >
                <Tooltip content={isOpen ? `Close ${name}` : `Open ${name}`} placement="bottom">
                  <button
                    type="button"
                    aria-label={isOpen ? `Close ${name}` : `Open ${name}`}
                    aria-expanded={isOpen}
                    onClick={() => toggleDecade(id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "1rem",
                      height: "1rem",
                      marginRight: "0.25rem",
                      flexShrink: 0,
                      padding: 0,
                      border: "none",
                      borderRadius: "2px",
                      background: "transparent",
                      color: "var(--color-text-muted)",
                      cursor: "pointer",
                    }}
                  >
                    <Icon name={isOpen ? "collapse" : "expand"} size="sm" />
                  </button>
                </Tooltip>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    if (e.shiftKey) e.preventDefault();
                  }}
                  // The name selects the decade whole (#2553); only the arrow opens and closes it.
                  // Selected whole already: nothing to do, as on a year (#843).
                  onClick={(e) => {
                    if (e.shiftKey) pickDecade(decade.start, true);
                    else if (!isWhole) pickDecade(decade.start, false);
                  }}
                  onMouseEnter={(e) => {
                    if (!isWhole) e.currentTarget.style.background = "var(--color-bg-muted)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isWhole) e.currentTarget.style.background = "transparent";
                  }}
                  style={{
                    ...ROW_STYLE,
                    flex: 1,
                    minWidth: 0,
                    padding: "0.4rem 1rem 0.4rem 0",
                    background: "transparent",
                    fontWeight: isWhole || holdsSelection ? 600 : 400,
                    color:
                      isWhole || holdsSelection
                        ? "var(--color-accent)"
                        : "var(--color-text-secondary)",
                  }}
                >
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {name}
                  </span>
                  <span style={COUNT_STYLE}>{decade.count}</span>
                </button>
              </div>
              {isOpen && decade.years.map((facet) => yearRow(facet, true))}
            </div>
          );
        })}

      {!isLoading && grouped.noYear && yearRow(grouped.noYear, false)}

      {!isLoading && (facets ?? []).length === 0 && (
        <div
          style={{
            padding: "0.75rem 1rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-muted)",
          }}
        >
          No years.
        </div>
      )}
    </CollapsibleFilterPanel>
  );
}
