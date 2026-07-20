"use client";

import { CollapsibleFilterPanel } from "./collapsible-filter-panel";

const STORAGE_KEY = "stamporama:year-filter-collapsed";

export interface YearFacet {
  /** null represents the "No year" bucket. */
  year: number | null;
  count: number;
}

interface YearFilterPanelProps {
  facets: YearFacet[] | undefined;
  isLoading: boolean;
  /** Active URL value: a numeric year string, "none", or null when unfiltered. */
  selectedYear: string | null;
  onSelect: (year: string | null) => void;
}

/** The selection value a facet maps to in the URL. */
function facetValue(year: number | null): string {
  return year === null ? "none" : String(year);
}

export function YearFilterPanel({
  facets,
  isLoading,
  selectedYear,
  onSelect,
}: YearFilterPanelProps) {
  return (
    <CollapsibleFilterPanel
      title="Year"
      storageKey={STORAGE_KEY}
      expandedWidth="12rem"
      borderLeft
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        onMouseEnter={(e) => {
          if (selectedYear)
            e.currentTarget.style.background = "var(--color-bg-muted)";
        }}
        onMouseLeave={(e) => {
          if (selectedYear) e.currentTarget.style.background = "transparent";
        }}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          padding: "0.5rem 1rem",
          background: !selectedYear ? "var(--color-accent-soft)" : "transparent",
          border: "none",
          borderBottom: "1px solid var(--color-border)",
          cursor: "pointer",
          fontSize: "0.875rem",
          fontWeight: !selectedYear ? 600 : 400,
          color: !selectedYear
            ? "var(--color-text-primary)"
            : "var(--color-text-secondary)",
        }}
      >
        All years
      </button>

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
          const isSelected = selectedYear === value;
          const label = facet.year === null ? "No year" : String(facet.year);
          return (
            <button
              key={value}
              type="button"
              onClick={() => onSelect(isSelected ? null : value)}
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
