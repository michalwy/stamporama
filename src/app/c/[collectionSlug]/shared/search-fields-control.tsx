"use client";

import { createPortal } from "react-dom";
import { Icon } from "@/app/icons";
import { searchFieldsLabel, toggleSearchField, type SearchField } from "@/lib/search-fields";
import {
  FILTER_MENU_HEADING_STYLE,
  FILTER_MENU_ITEM_STYLE,
  FILTER_MENU_Z_INDEX,
  filterMenuStyle,
  filterTriggerStyle,
  useFilterPopover,
} from "./filter-popover";

/** The control's fixed width (#868): sized for its longest single field on the Copies list,
 *  *Catalogue number*, so a tick never moves the bar. A list whose field names run longer lets them
 *  ellipsise. Exported for `ListToolbar`, which holds the box and this control together. */
export const SEARCH_FIELDS_WIDTH = "10rem";

/**
 * The fields a search box matches, ticked beside the box (#2238) — one control for every list's
 * search box (#2239–#2245), each passing its own fields and remembering the choice through
 * `usePersistedSearchFields`.
 *
 * `MultiSelectFilter`'s look and popover, not that control: there, nothing ticked is *every value*
 * and the clear row unticks; here every field starts **ticked**, the last one cannot be unticked,
 * and the first row ticks them all again. The trigger wears the accent while the search is narrowed
 * and names what it is narrowed to, so a search that finds nothing because of it reads at a glance.
 */
export function SearchFieldsControl<K extends string>({
  fields,
  ticked,
  onChange,
}: {
  fields: readonly SearchField<K>[];
  ticked: readonly K[];
  onChange: (next: K[]) => void;
}) {
  const { open, setOpen, pos, triggerRef, menuRef } = useFilterPopover<HTMLButtonElement>();
  const keys = fields.map((f) => f.key);
  const chosen = new Set(ticked);
  const narrowed = chosen.size < fields.length;

  return (
    <div style={{ width: SEARCH_FIELDS_WIDTH, flexShrink: 0 }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Fields the search matches"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={filterTriggerStyle({ active: narrowed, width: "100%" })}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {searchFieldsLabel(ticked, fields)}
        </span>
        <span style={{ display: "inline-flex", opacity: 0.7, flexShrink: 0 }}>
          <Icon name="caret" size="xs" />
        </span>
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div ref={menuRef} style={filterMenuStyle(pos, FILTER_MENU_Z_INDEX)}>
            <span style={FILTER_MENU_HEADING_STYLE}>Search in</span>
            <div role="listbox" aria-multiselectable aria-label="Fields the search matches">
              <button
                type="button"
                onClick={() => onChange([...keys])}
                disabled={!narrowed}
                style={{
                  ...FILTER_MENU_ITEM_STYLE,
                  color: narrowed ? "var(--color-text-primary)" : "var(--color-text-muted)",
                  fontWeight: narrowed ? 500 : 600,
                  cursor: narrowed ? "pointer" : "default",
                  borderBottom: "1px solid var(--color-border)",
                  borderRadius: 0,
                }}
              >
                All fields
              </button>
              {fields.map((f) => {
                // The last ticked field stays ticked: a box searching nothing would be broken.
                const last = chosen.has(f.key) && chosen.size === 1;
                return (
                  <label
                    key={f.key}
                    style={{ ...FILTER_MENU_ITEM_STYLE, cursor: last ? "default" : "pointer" }}
                    onMouseEnter={(e) => {
                      if (!last) e.currentTarget.style.background = "var(--color-bg-row-hover)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={chosen.has(f.key)}
                      disabled={last}
                      onChange={() => onChange(toggleSearchField(ticked, f.key, keys))}
                      style={{ cursor: last ? "default" : "pointer" }}
                    />
                    {f.label}
                  </label>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
