"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/app/icons";

/** Above a list screen's chrome, below a dialog opened over one — the rank `RowActionsMenu` uses,
 *  named here too so the two portaled menus of this app stack alike. */
const DEFAULT_MENU_Z_INDEX = 200;

/**
 * A list filter that takes **several** values at once (#425) — the shape a `<select>` cannot have
 * without becoming a scrolling box that eats a toolbar's height. It is a control that reads like the
 * single-selects beside it (the same size, the same accent when it is narrowing something) and opens
 * a checkbox list under itself.
 *
 * Deliberately a **popover, not a layer** — the same call the notification centre makes: it owns its
 * own Escape and outside-click rather than joining the escape stack (#361), because it is not a
 * surface one navigates into. It is portaled to `<body>` with fixed positioning so the toolbar's own
 * `overflow` can never clip it, and it closes when the page scrolls for the same reason a row menu
 * does: a fixed box does not follow the trigger. Scrolling *within* the menu is exempt — a list of
 * options longer than the menu's own height has to stay reachable.
 *
 * Selection is **applied as it is made**, with no Apply button: the list behind it is what says what
 * a tick did, and a staged selection would make the collector confirm something they can already see.
 */
export function MultiSelectFilter({
  options,
  selected,
  onChange,
  allLabel,
  clearLabel,
  itemNoun,
  ariaLabel,
  disabled = false,
  fullWidth = false,
  zIndex = DEFAULT_MENU_Z_INDEX,
  onOpenChange,
}: {
  /** `group` puts the option under a heading in the menu (#846). Options carrying the same heading
   * must be **adjacent** — the menu draws a heading whenever the value changes, so the caller's
   * order is the grouping. Used where one control holds options that do not all pull the same way:
   * the Copies list's spare filters both narrow the list and widen it, and the headings are what
   * say which is which. Leave it off and the menu is a flat checklist as before. */
  options: { id: string; label: string; group?: string }[];
  /** The selected ids. Empty is "every value" — the absence of a filter, not an empty set. */
  selected: string[];
  onChange: (ids: string[]) => void;
  /** What the control reads when nothing is selected, e.g. `All conditions`. */
  allLabel: string;
  /** What the menu's clear row reads, when "everything" and "nothing selected" are not the same
   * sentence. A condition filter clears to *All conditions* and the trigger says so too; a control
   * holding a handful of unrelated switches has no "all" to offer, so its trigger names the control
   * (*More filters*) and its clear row says what clearing does. Defaults to {@link allLabel}. */
  clearLabel?: string;
  /** What several selected values are counted in, e.g. `conditions` → `3 conditions`. */
  itemNoun: string;
  ariaLabel: string;
  /** A precondition elsewhere has fixed this axis, so the control is shown greyed rather than
   *  hidden (#273) — the caller supplies the tooltip saying why. */
  disabled?: boolean;
  /** Fills the width it is given, with the caret pushed to the right edge. For a **form** field,
   *  where the control sits in a grid cell beside inputs and selects and has to line up with them;
   *  a toolbar leaves this off, where a control that grew with its label would shove its neighbours
   *  around. */
  fullWidth?: boolean;
  /** Rank of the portaled menu. One of these **inside a dialog** must be raised above that dialog's
   * own `zIndexBase + 1`, or it opens behind the panel: invisible, with the click that should have
   * ticked a box landing on the backdrop instead. Same knob `RowActionsMenu` carries, for the same
   * reason. */
  zIndex?: number;
  /** Raised whenever the menu opens or closes. A dialog holding one of these sets its `dismissable`
   * from it: the menu has its own Escape listener and is not an escape layer (#361), so one Escape
   * would otherwise close the menu *and* the dialog under it. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Reported from one place rather than at every setter, and through a ref so a caller passing a
  // fresh closure each render does not re-fire it.
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });
  useEffect(() => {
    onOpenChangeRef.current?.(open && !disabled);
  }, [open, disabled]);

  const chosen = new Set(selected);
  // One value names itself; several are counted, because a toolbar control that grows with the
  // selection pushes everything beside it around.
  const label =
    chosen.size === 0
      ? allLabel
      : chosen.size === 1
        ? (options.find((o) => chosen.has(o.id))?.label ?? allLabel)
        : `${chosen.size} ${itemNoun}`;

  useEffect(() => {
    if (!open || disabled) return;
    const el = triggerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, minWidth: rect.width });
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      // Stopped here, not merely handled: inside a dialog the same keypress would otherwise reach
      // the escape stack and take the dialog with it.
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    // A list longer than `maxHeight` scrolls **inside** the menu, and that scroll must not be read
    // as the page moving under a fixed box: closing on it made a long checklist list unreachable.
    function onScroll(e: Event) {
      const t = e.target;
      if (t instanceof Node && menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, disabled]);

  function toggle(id: string) {
    onChange(chosen.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  const active = chosen.size > 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...(disabled ? { opacity: 0.5 } : null),
          padding: "0.375rem 0.625rem",
          border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border-strong)"}`,
          borderRadius: "0.375rem",
          fontSize: "0.8125rem",
          fontWeight: active ? 600 : 400,
          color: active ? "var(--color-accent)" : "var(--color-text-primary)",
          background: active ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
          minHeight: "2rem",
          cursor: disabled ? "default" : "pointer",
          display: fullWidth ? "flex" : "inline-flex",
          width: fullWidth ? "100%" : undefined,
          boxSizing: "border-box",
          alignItems: "center",
          justifyContent: fullWidth ? "space-between" : undefined,
          gap: "0.4rem",
          whiteSpace: "nowrap",
          // A long value must not stretch a form field past its column; the caret stays put.
          overflow: "hidden",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <span style={{ display: "inline-flex", opacity: 0.7, flexShrink: 0 }}>
          <Icon name="caret" size="xs" />
        </span>
      </button>
      {open &&
        !disabled &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-multiselectable
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              minWidth: Math.max(pos.minWidth, 176),
              maxHeight: "20rem",
              overflowY: "auto",
              padding: "0.3rem",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              boxShadow: "0 8px 24px rgb(0 0 0 / 0.16)",
              zIndex,
              display: "flex",
              flexDirection: "column",
              gap: "0.05rem",
            }}
          >
            {/* Clearing is the same act as unticking everything, so it is the list's first row
                rather than a separate control beside the trigger. */}
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={!active}
              style={{
                ...ITEM_STYLE,
                color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
                fontWeight: active ? 500 : 600,
                cursor: active ? "pointer" : "default",
                borderBottom: "1px solid var(--color-border)",
                borderRadius: 0,
              }}
            >
              {clearLabel ?? allLabel}
            </button>
            {options.map((o, i) => (
              <Fragment key={o.id}>
                {o.group && o.group !== options[i - 1]?.group && (
                  <span style={GROUP_HEADING_STYLE}>{o.group}</span>
                )}
                <label
                  style={{ ...ITEM_STYLE, cursor: "pointer" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--color-bg-row-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <input
                    type="checkbox"
                    checked={chosen.has(o.id)}
                    onChange={() => toggle(o.id)}
                    style={{ cursor: "pointer" }}
                  />
                  {o.label}
                </label>
              </Fragment>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

const ITEM_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.55rem",
  width: "100%",
  padding: "0.4rem 0.55rem",
  border: "none",
  borderRadius: "0.3rem",
  background: "transparent",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
  fontWeight: 500,
  textAlign: "left",
  whiteSpace: "nowrap",
};

/** A heading over a run of options that pull the same way (#846). Deliberately not a control: it is
 * a label on the group below it, so it takes no tick and no hover. */
const GROUP_HEADING_STYLE: React.CSSProperties = {
  padding: "0.4rem 0.55rem 0.15rem",
  fontSize: "0.6875rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};
