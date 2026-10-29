"use client";

import { useRef, useState } from "react";
import { CollapsibleFilterPanel } from "./collapsible-filter-panel";
import { NumericInput } from "./numeric-input";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";
import {
  readYearSelection,
  yearRangeLabel,
  yearRangeValue,
  yearSelects,
  type YearSelection,
} from "@/lib/list-area-year-filter";

const STORAGE_KEY = "stamporama:year-filter-collapsed";

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
   * *All years* clears it, and so does picking a single year.
   */
  span?: { label: string } | null;
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
        (facets ?? []).map((facet) => {
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
                if (!isSelected)
                  e.currentTarget.style.background = "var(--color-bg-muted)";
              }}
              onMouseLeave={(e) => {
                if (!isSelected)
                  e.currentTarget.style.background = "transparent";
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
                width: "100%",
                textAlign: "left",
                padding: "0.4rem 1rem",
                background: isSelected
                  ? "var(--color-accent-soft)"
                  : "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: "0.8125rem",
                fontWeight: isSelected ? 600 : 400,
                fontStyle: facet.year === null ? "italic" : "normal",
                color: isSelected
                  ? "var(--color-accent)"
                  : "var(--color-text-secondary)",
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {label}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: "0.75rem",
                  fontWeight: 400,
                  color: "var(--color-text-muted)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {facet.count}
              </span>
            </button>
          );
        })}

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
