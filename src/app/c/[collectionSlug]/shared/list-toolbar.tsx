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

/**
 * The one shape and the one colour for a **banner pinned above a list** — quick offer mode's
 * parameters (#537) and the bar over the ticked selection (#373). They are two states of the same
 * slot, were built a year apart, and had drifted into slightly different widths and paddings
 * (#848). Both already reached for the same tokens, so the fix is not a colour but a single style
 * neither can restyle on its own; the width now comes from the toolbar block both sit in rather
 * than from a margin one of them chose.
 */
export const LIST_BANNER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "0.75rem",
  padding: "0.5rem 0.75rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--color-accent)",
  background: "var(--color-accent-soft)",
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
  /** A last row inside the sticky block. Rendered here rather than above the rows so it is pinned
   * by the same `position: sticky` and can never overlap the toolbar it would otherwise have to sit
   * below. It is part of the block's flow, so putting one up **does** push the rows down — which is
   * right for a banner raised by a deliberate click (arming quick offer mode, #537/#848) and wrong
   * for one that appears as a side effect of working the list. For the latter, see
   * {@link ListToolbarProps.overlayFooter}. */
  footer?: React.ReactNode;
  /** A strip hanging *below* the sticky block, pinned with it but **drawn over the rows instead of
   * displacing them** (#848). For a banner that appears as a side effect of what the collector is
   * doing to the list rather than from a click aimed at the banner — the selection bar over the
   * ticked copies (#373), which used to arrive on the first ticked checkbox, grow the block, and
   * move the row the collector was reaching for next. It is absolutely positioned against the
   * block, so no height of it ever reaches the flow; it is drawn full-bleed on the block's own
   * opaque background and carries the block's bottom border (the block drops its own while a strip
   * is up, or the two would draw a double rule) so that it reads as the toolbar having grown.
   *
   * The cost is that the strip **covers** the rows underneath it while it is up. That is deliberate
   * and it is the cheaper of the two: displacing moves the list under the pointer on *every* tick,
   * wherever the collector is working, while covering only reaches the one or two rows immediately
   * under the toolbar, and a scroll notch brings them back. */
  overlayFooter?: React.ReactNode;
  /** Drop the sort control entirely. For a view whose ordering is not the list's — the duplicate
   * groups order by how many copies each holds (#372) — where leaving the control up would offer
   * a choice it cannot honour. */
  hideSort?: boolean;
  /** Put the sort control **after** `children` instead of straight after the search box. For a bar
   * whose filters read as an order the collector was given (#846 sets the Copies list's, ending
   * *grouping, sorting*), where a sort control wedged between the search and the first filter reads
   * as one of them. */
  sortLast?: boolean;
  /** Cap on the search box's width. Shortened where the row is carrying a dozen other controls and
   * the search is a lookup one finishes rather than a way of working (#846). */
  searchMaxWidth?: string;
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
  overlayFooter,
  hideSort = false,
  sortLast = false,
  searchMaxWidth = "20rem",
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

  const sortControl = (
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
  );

  return (
    <div
      style={{
        ...STICKY_TOOLBAR_STYLE,
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        padding: "0.75rem 1.25rem",
        // While an overlay strip is up it carries the bottom rule, so the block drops its own —
        // two of them a `1px` gap apart read as a double line.
        borderBottom: overlayFooter ? "none" : "1px solid var(--color-border)",
        // Opaque: rows scroll underneath it.
        background: "var(--color-bg-elevated)",
      }}
    >
      {/* Row 1: Search + Sort + the screen's filters and actions. Wraps, so a bar carrying a dozen
          controls breaks where it must instead of overflowing the card. */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 auto", minWidth: "9rem", maxWidth: searchMaxWidth }}>
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

        {!sortLast && sortControl}

        {children}

        {sortLast && sortControl}
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

      {/* Pinned with the block, but out of its flow: the rows below never move when this appears
          or goes away (#848). `top: 100%` hangs it off the block's bottom edge, so it follows the
          footer above it; `left/right: 0` and the block's own background make it read as one more
          band of the toolbar rather than a pill floating over the list. */}
      {overlayFooter && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            padding: "0 1.25rem 0.75rem",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-bg-elevated)",
          }}
        >
          {overlayFooter}
        </div>
      )}
    </div>
  );
}
