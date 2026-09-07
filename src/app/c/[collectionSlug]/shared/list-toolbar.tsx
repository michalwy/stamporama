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
  /** The last rows inside the sticky block — quick offer mode's parameters and the bar over the
   * ticked selection, in that order, both on the Copies list (#537/#373/#848). Rendered here rather
   * than above the rows so they are pinned by the same `position: sticky` and can never overlap the
   * toolbar they would otherwise have to sit below. Pass several as a fragment; the block is a
   * flex column, so each becomes one of its rows.
   *
   * **Putting one up pushes the rows down, and that is the accepted behaviour — deliberately, on
   * every list, however long (#885).** It is not right; it is uniform, which the alternatives were
   * not. Do not add a second slot that compensates for the height. Two mechanisms have been built
   * and both were rejected by the user after he had used them:
   *
   * 1. **Out of flow — a second slot hanging the bar off the block's bottom edge, drawn over the
   *    rows** (#848, first attempt). It moved nothing, but it *covered* the row beneath it. The
   *    argument for accepting that was "a scroll notch brings the row back", and it is false in the
   *    one place it matters: at the top of the list `scrollTop` is already `0`, there is nothing to
   *    scroll back, and the first row stayed half-hidden for as long as anything was selected. The
   *    top of the list is where a person starts ticking.
   * 2. **In flow, paid for by scrolling the viewport** (#848, second attempt). The block grew by
   *    `H` and `window.scrollBy` moved the scroll position by `H` in the same layout effect, so the
   *    rows held still. That works — on a page long enough to scroll. `scrollBy` clamps at zero, so
   *    a list shorter than the viewport has nothing to pay with and its rows shift anyway (#884).
   *    **The screen's behaviour then depended on how many rows happened to be on it**: one kind of
   *    list jumped, the other did not, and the collector could not tell which he was looking at
   *    until he ticked something.
   *
   * (2) was removed for that reason and no other — it was not broken, and a way to make the short
   * list work was proposed on #884 and left unbuilt. **A uniform flaw is easier to work with than
   * an unpredictable one**: consistency is a property of the whole screen, and a fix that wins one
   * case by trading it away is the worse deal. That is the user's judgement, made after living with
   * both, and it is what this slot now encodes.
   *
   * The answer is expected to be a **redesign of the selection bar** (#849) — somewhere it does not
   * have to be paid for at all — rather than a cleverer compensation. If you are about to write
   * one, that issue is where the work belongs. */
  footer?: React.ReactNode;
  /** Why the list's ordering is not this control's to set — grey the control and say so, instead
   * of taking it off the bar.
   *
   * A view whose ordering is its own (the Copies list under any grouping: duplicate groups by how
   * many copies each holds, filing groups by location, issue groups by the Issues list's order)
   * cannot honour a sort choice. Until #868 the control was **removed** in that case, and that was
   * the wrong half of the trade twice over: about ten characters of bar width came and went as the
   * grouping was picked, moving every control to its right at the moment the collector was working
   * them — and the collector was left to work out for themselves where their ordering had gone.
   * A control that is still there, greyed, wearing the reason on hover, answers both. */
  sortDisabledReason?: string | null;
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
  sortDisabledReason = null,
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

  // Still on the bar when it cannot be honoured, greyed and carrying the reason (#868) — see
  // `sortDisabledReason`. The reason is hung on the **whole group** rather than on the select: a
  // disabled control is the one a collector reaches for to find out why it is disabled, and half of
  // what they can point at (the *Sort* label, the arrow) is not the select. The arrow keeps its own
  // hint only while it is live, where the group has nothing to say and the arrow does.
  const sortDisabled = !!sortDisabledReason;
  const sortGroup = (
    <div
      style={{
        display: "flex",
        gap: "0.375rem",
        alignItems: "center",
        ...(sortDisabled ? { opacity: 0.5 } : null),
      }}
    >
      <span style={LABEL_STYLE}>Sort</span>
      <select
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value, sortDir)}
        disabled={sortDisabled}
        style={{ ...SELECT_STYLE, cursor: sortDisabled ? "default" : "pointer" }}
      >
        {sortOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {sortDisabled ? (
        <span style={{ ...INPUT_STYLE, padding: "0.375rem 0.5rem", fontSize: "0.75rem", lineHeight: 1 }}>
          {sortDir === "asc" ? "↑" : "↓"}
        </span>
      ) : (
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
      )}
    </div>
  );
  const sortControl = sortDisabled ? (
    <Tooltip content={sortDisabledReason}>{sortGroup}</Tooltip>
  ) : (
    sortGroup
  );

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

      {/* Rows of the block like the ones above, so putting one up pushes the list down. That is
          the accepted behaviour on every list alike (#885) — read the prop's doc before reaching
          for a way to hold the rows still, because two have been built and both were rejected. */}
      {footer}
    </div>
  );
}
