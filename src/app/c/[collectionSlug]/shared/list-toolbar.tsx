"use client";

import { useEffect, useRef, useState } from "react";
import { SEARCH_INPUT_STYLE, useDebouncedValue } from "./autocomplete";

// ── Styles ──────────────────────────────────────────────────────────────────

const INPUT_STYLE = SEARCH_INPUT_STYLE;

const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  cursor: "pointer",
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const CLEAR_BTN: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--color-text-muted)",
  fontSize: "0.75rem",
  padding: "0 0.25rem",
};

// ── Types ───────────────────────────────────────────────────────────────────

export interface SortOption {
  value: string;
  label: string;
}

export interface CatalogVendorOption {
  id: string;
  name: string;
  abbreviation: string;
}

export interface ListToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSortChange: (sortBy: string, sortDir: "asc" | "desc") => void;
  sortOptions: SortOption[];
  catalogVendors?: CatalogVendorOption[];
  catalogVendorId?: string;
  catalogNumber?: string;
  onCatalogSearchChange?: (vendorId: string, number: string) => void;
  children?: React.ReactNode;
}

// ── Component ───────────────────────────────────────────────────────────────

export function ListToolbar({
  search,
  onSearchChange,
  sortBy,
  sortDir,
  onSortChange,
  sortOptions,
  catalogVendors,
  catalogVendorId,
  catalogNumber,
  onCatalogSearchChange,
  children,
}: ListToolbarProps) {
  // Plain debounced search box (no suggestions dropdown): debounce the local input
  // and push the settled value up, skipping the initial mount so it doesn't refetch.
  const [localSearch, setLocalSearch] = useState(search);
  const debouncedSearch = useDebouncedValue(localSearch);
  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  });
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onSearchChangeRef.current(debouncedSearch);
  }, [debouncedSearch]);

  const showCatalogSearch =
    catalogVendors && catalogVendors.length > 0 && onCatalogSearchChange;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        padding: "0.75rem 1.25rem",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
      }}
    >
      {/* Row 1: Search + Sort */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: "20rem" }}>
          <input
            type="text"
            placeholder="Search..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            style={{ ...INPUT_STYLE, width: "100%", paddingRight: "1.75rem" }}
          />
          {localSearch && (
            <button
              type="button"
              onClick={() => setLocalSearch("")}
              style={{
                ...CLEAR_BTN,
                position: "absolute",
                right: "0.375rem",
                top: "50%",
                transform: "translateY(-50%)",
              }}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
          <span style={LABEL_STYLE}>Sort</span>
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value, sortDir)}
            style={SELECT_STYLE}
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onSortChange(sortBy, sortDir === "asc" ? "desc" : "asc")}
            style={{
              ...INPUT_STYLE,
              cursor: "pointer",
              padding: "0.375rem 0.5rem",
              fontSize: "0.75rem",
              lineHeight: 1,
            }}
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
        </div>

        {children}
      </div>

      {/* Row 2: Catalog search (optional) */}
      {showCatalogSearch && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={LABEL_STYLE}>Catalog</span>
          <select
            value={catalogVendorId ?? ""}
            onChange={(e) =>
              onCatalogSearchChange(e.target.value, catalogNumber ?? "")
            }
            style={{ ...SELECT_STYLE, minWidth: "8rem" }}
          >
            <option value="">All vendors</option>
            {catalogVendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.abbreviation})
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Catalog number"
            value={catalogNumber ?? ""}
            onChange={(e) =>
              onCatalogSearchChange(catalogVendorId ?? "", e.target.value)
            }
            style={{ ...INPUT_STYLE, width: "8rem" }}
            disabled={!catalogVendorId}
          />
          {(catalogVendorId || catalogNumber) && (
            <button
              type="button"
              onClick={() => onCatalogSearchChange("", "")}
              style={CLEAR_BTN}
              title="Clear catalog search"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
