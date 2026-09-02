"use client";

import { useEffect, useRef, useState } from "react";
import { SEARCH_INPUT_STYLE, useDebouncedValue } from "./autocomplete";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";

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

// The ✕ that empties the field it sits in. Auxiliary to that input and therefore out of the tab
// order everywhere it appears (#446) — a keyboard already clears a field it is standing in.
const CLEAR_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--color-text-muted)",
  padding: "0 0.25rem",
};

/**
 * Pins a list's filter row to the top of the viewport while the rows scroll under it (#358) —
 * the whole page scrolls (there is no inner scroll container), so `top: 0` is the app's own top
 * edge. The z-index sits above the rows but below the portalled row-action menus (200) and
 * dialogs (100), which must still cover it. A panel that builds its own toolbar row instead of
 * using {@link ListToolbar} spreads this together with an opaque background of its own.
 */
export const STICKY_TOOLBAR_STYLE: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 5,
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
  /** A last row inside the sticky block — a bulk action bar over the current selection (#373).
   * Rendered here rather than above the rows so it is pinned by the same `position: sticky` and
   * can never overlap the toolbar it would otherwise have to sit below. */
  footer?: React.ReactNode;
  /** Drop the sort control entirely. For a view whose ordering is not the list's — the duplicate
   * groups order by how many copies each holds (#372) — where leaving the control up would offer
   * a choice it cannot honour. */
  hideSort?: boolean;
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
  footer,
  hideSort = false,
}: ListToolbarProps) {
  // Plain debounced search box (no suggestions dropdown): debounce the local input
  // and push the settled value up, skipping the initial mount so it doesn't refetch.
  const [localSearch, setLocalSearch] = useState(search);
  const debouncedSearch = useDebouncedValue(localSearch);
  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  });
  // The last value this box itself sent upwards. It is what tells an **echo** of our own push apart
  // from a change made somewhere else, which is the whole of what makes the resync below safe.
  const pushedRef = useRef(search);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Nothing to say when the settled value is already the one in force — which is what a resync
    // below leaves behind once its own debounce catches up.
    if (debouncedSearch === pushedRef.current) return;
    pushedRef.current = debouncedSearch;
    onSearchChangeRef.current(debouncedSearch);
  }, [debouncedSearch]);

  // A `search` the box did not write is an external change — the Copies list's *Reset filters*
  // (#733) is the one that does it — and the input has to follow it, or the field goes on showing a
  // phrase that is no longer narrowing anything. Guarded on `pushedRef` rather than compared with
  // `localSearch`, because the prop lags the input by the debounce for the whole time somebody is
  // typing: a plain `search !== localSearch` resync would pull half-typed text back out from under
  // them. A value we pushed comes back equal and is ignored.
  useEffect(() => {
    if (search === pushedRef.current) return;
    pushedRef.current = search;
    setLocalSearch(search);
  }, [search]);

  const showCatalogSearch =
    catalogVendors && catalogVendors.length > 0 && onCatalogSearchChange;

  return (
    <div
      style={{
        ...STICKY_TOOLBAR_STYLE,
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        padding: "0.75rem 1.25rem",
        borderBottom: "1px solid var(--color-border)",
        // Opaque: rows scroll underneath it.
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
            <Tooltip
              content="Clear search"
              style={{
                position: "absolute",
                right: "0.375rem",
                top: "50%",
                transform: "translateY(-50%)",
              }}
            >
              <button
                type="button"
                onClick={() => setLocalSearch("")}
                aria-label="Clear search"
                tabIndex={-1}
                style={CLEAR_BTN}
              >
                <Icon name="clear" size="sm" />
              </button>
            </Tooltip>
          )}
        </div>

        <div
          style={{
            display: hideSort ? "none" : "flex",
            gap: "0.375rem",
            alignItems: "center",
          }}
        >
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
          <Tooltip content={sortDir === "asc" ? "Ascending" : "Descending"}>
            <button
              type="button"
              onClick={() => onSortChange(sortBy, sortDir === "asc" ? "desc" : "asc")}
              aria-label={sortDir === "asc" ? "Ascending" : "Descending"}
              style={{
                ...INPUT_STYLE,
                cursor: "pointer",
                padding: "0.375rem 0.5rem",
                fontSize: "0.75rem",
                lineHeight: 1,
              }}
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </Tooltip>
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
          {/* Accepts a bare number or a prefixed one ("Mi PL 200", "MiPL200"); a
              recognized vendor prefix overrides the dropdown (#146). Always enabled
              so a number can be searched across all vendors without picking one. */}
          <input
            type="text"
            placeholder="e.g. 200 or Mi PL 200"
            value={catalogNumber ?? ""}
            onChange={(e) =>
              onCatalogSearchChange(catalogVendorId ?? "", e.target.value)
            }
            style={{ ...INPUT_STYLE, width: "10rem" }}
          />
          {(catalogVendorId || catalogNumber) && (
            <Tooltip content="Clear catalog search">
              <button
                type="button"
                onClick={() => onCatalogSearchChange("", "")}
                aria-label="Clear catalog search"
                tabIndex={-1}
                style={CLEAR_BTN}
              >
                <Icon name="clear" size="sm" />
              </button>
            </Tooltip>
          )}
        </div>
      )}

      {footer}
    </div>
  );
}
