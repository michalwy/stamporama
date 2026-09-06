"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  /** A last row like {@link ListToolbarProps.footer}, in the block's flow and below it — but one
   * whose arrival and departure **do not move the list** (#848). For a banner that appears as a
   * side effect of what the collector is doing to the list rather than from a click aimed at the
   * banner: the selection bar over the ticked copies (#373), which used to arrive on the first
   * ticked checkbox, grow the block, and move the row the collector was reaching for next.
   *
   * It holds still by moving the **viewport** rather than by leaving the flow — see the layout
   * effect below for how, and for why the overlay this was first built as was the wrong answer. */
  stableFooter?: React.ReactNode;
  /** Drop the sort control entirely. For a view whose ordering is not the list's — the duplicate
   * groups order by how many copies each holds (#372) — where leaving the control up would offer
   * a choice it cannot honour. */
  hideSort?: boolean;
  /** Put the sort control **after** `children` instead of straight after the search box. For a bar
   * whose filters read as an order the collector was given (#846 sets the Copies list's, ending
   * *grouping, sorting*), where a sort control wedged between the search and the first filter reads
   * as one of them. */
  sortLast?: boolean;
  /** The screen's own actions, as **one** trailing group pinned to the right of the row — the shape
   * `offers-list-panel.tsx` uses, and where the Copies list's three went when they came off its
   * header (#847). The filter half (`children`) grows into whatever the actions leave and wraps
   * within itself first; only when even that is exhausted does this group drop to a line of its
   * own, still right-aligned. Actions, never filters: this group is what the screen *does*, and a
   * control that narrows the list belongs among the ones beside it. */
  actions?: React.ReactNode;
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
  stableFooter,
  hideSort = false,
  sortLast = false,
  searchMaxWidth = "20rem",
  actions,
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

  // ── Keeping the list still while `stableFooter` comes and goes (#848) ────────────────────────
  //
  // The footer is an ordinary row of the block, so putting it up grows the block and pushes every
  // row below it down by its height. That is the jump this exists to remove: it lands on the first
  // ticked checkbox, which is exactly when the collector is going fast, and the row they were about
  // to tick second is no longer under the pointer.
  //
  // The repair is to move the **viewport** by the same amount in the same paint. The document grows
  // by H at a point above the scroll position and the scroll position grows by H, so the rows do
  // not move at all — and the scrollable range is now H longer, which is the half the first attempt
  // got wrong.
  //
  // **That first attempt was an overlay**, and it is worth saying why it failed, because it looked
  // right. Hanging the strip out of the flow moved nothing either, but it *covered* the row beneath
  // it, and the argument for accepting that — "a scroll notch brings the row back" — is false in
  // the one place it matters: at the top of the list `scrollTop` is already `0`, so there is nothing
  // to scroll back, and the first row stayed half-hidden for as long as anything was selected. The
  // top of the list is where a person starts ticking checkboxes. Growing the scrollable range
  // instead has no such edge — the row is never covered in the first place, at any scroll position.
  //
  // What *does* move is whatever sits **above** the toolbar: the page scrolls, so the summary bar
  // slides up by H. The height has to go somewhere, and this is the right side of the trade — it is
  // away from the pointer, and past roughly a toolbar's worth of scrolling there is nothing up
  // there on screen and the compensation cannot be seen at all.
  //
  // Written against `window` deliberately: this app has **no inner scroll container**, which is the
  // same fact `STICKY_TOOLBAR_STYLE` relies on for `top: 0`. It runs in a layout effect so the DOM
  // change and the scroll land in one paint — the other way round the list would jump by H and then
  // jump back, which is worse than the bug.
  const blockRef = useRef<HTMLDivElement>(null);
  const stableFooterRef = useRef<HTMLDivElement>(null);
  /** The block height the footer accounts for: its own box plus the flex row gap above it. */
  const stableFooterHeight = useRef(0);
  const hadStableFooter = useRef(false);
  const measuredOnce = useRef(false);
  const hasStableFooter = !!stableFooter;

  function measureStableFooter(): number {
    const strip = stableFooterRef.current;
    const block = blockRef.current;
    if (!strip || !block) return stableFooterHeight.current;
    const gap = parseFloat(getComputedStyle(block).rowGap);
    return strip.offsetHeight + (Number.isFinite(gap) ? gap : 0);
  }

  useLayoutEffect(() => {
    if (stableFooterRef.current) stableFooterHeight.current = measureStableFooter();
    // The first paint is not a transition: a screen that renders with the footer already up has not
    // moved anything, and compensating for it would scroll the collector down for nothing.
    if (!measuredOnce.current) {
      measuredOnce.current = true;
      hadStableFooter.current = hasStableFooter;
      return;
    }
    if (hasStableFooter === hadStableFooter.current) return;
    hadStableFooter.current = hasStableFooter;
    const delta = hasStableFooter ? stableFooterHeight.current : -stableFooterHeight.current;
    // `scrollBy` clamps at 0, which is the one case where the compensation cannot be paid in full:
    // the collector had scrolled up into the space the footer occupies, so removing it genuinely
    // does lift the rows. That is the footer's own space closing, not a jump.
    if (delta !== 0) window.scrollBy({ top: delta, behavior: "instant" });
  });

  // The height the way out is compensated by is the one that was actually on screen. Selection
  // changes re-render the footer and refresh it anyway; this covers what does not — a window
  // resize wrapping its buttons onto another line while the selection is simply held.
  useEffect(() => {
    const strip = stableFooterRef.current;
    if (!strip) return;
    const observer = new ResizeObserver(() => {
      stableFooterHeight.current = measureStableFooter();
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [hasStableFooter]);

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
      ref={blockRef}
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

        {actions && (
          <div
            style={{
              marginLeft: "auto",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            {actions}
          </div>
        )}
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

      {stableFooter && <div ref={stableFooterRef}>{stableFooter}</div>}
    </div>
  );
}
