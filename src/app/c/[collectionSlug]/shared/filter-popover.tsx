"use client";

import { useEffect, useRef, useState } from "react";

/** Above a list screen's chrome, below a dialog opened over one — the rank `RowActionsMenu` uses,
 *  named here too so the portaled menus of this app stack alike. */
export const FILTER_MENU_Z_INDEX = 200;

/** Where a portaled menu is drawn: under its trigger, at least as wide as it. */
export interface FilterPopoverPosition {
  top: number;
  left: number;
  minWidth: number;
}

/**
 * The dismissal behaviour every filter dropdown on a list toolbar shares (#425, #868) — extracted
 * from `MultiSelectFilter` so that the second such control is the **same** control's behaviour
 * rather than a second convention on the same bar, which is the mistake #868 exists to stop one
 * level up.
 *
 * Deliberately a **popover, not a layer** — the same call the notification centre makes: it owns
 * its own Escape and outside-click rather than joining the escape stack (#361), because it is not
 * a surface one navigates into. The menu is portaled to `<body>` with fixed positioning so a
 * toolbar's own `overflow` can never clip it, which is also why it closes when the page scrolls: a
 * fixed box does not follow its trigger. Scrolling *within* the menu is exempt — a list of options
 * longer than the menu's own height has to stay reachable.
 *
 * A pick never closes it. That is `MultiSelectFilter`'s behaviour since #425 and the tree select's
 * since #846 (`closeOnSelect: false` for a filter): the list behind the panel is what says what the
 * pick did, so there is nothing to go back to — and a panel carrying sub-controls that qualify the
 * pick must survive the pick, or those controls appear only after the interaction that dismissed
 * them and cannot be found at all.
 */
export function useFilterPopover<T extends HTMLElement>({
  disabled = false,
  onOpenChange,
}: {
  disabled?: boolean;
  /** Raised whenever the menu opens or closes. A dialog holding one of these sets its `dismissable`
   * from it: the menu has its own Escape listener and is not an escape layer (#361), so one Escape
   * would otherwise close the menu *and* the dialog under it. */
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<FilterPopoverPosition | null>(null);
  const triggerRef = useRef<T>(null);
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
    // as the page moving under a fixed box: closing on it made a long checklist unreachable.
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

  return { open, setOpen, pos, triggerRef, menuRef };
}

/** The box a portaled filter menu is drawn in — one shape for every dropdown on a toolbar. */
export function filterMenuStyle(
  pos: FilterPopoverPosition,
  zIndex: number
): React.CSSProperties {
  return {
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
  };
}

/** One option row, in the menus above. */
export const FILTER_MENU_ITEM_STYLE: React.CSSProperties = {
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
export const FILTER_MENU_HEADING_STYLE: React.CSSProperties = {
  padding: "0.4rem 0.55rem 0.15rem",
  fontSize: "0.6875rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

/** The trigger every filter dropdown on a toolbar wears, so a mixed row lines up (#425, #868).
 * `width` is what keeps the bar still: a trigger sized to its own label is a control that changes
 * width on a pick, and everything to its right moves (#868). */
export function filterTriggerStyle({
  active,
  disabled,
  width,
}: {
  active: boolean;
  disabled?: boolean;
  width?: string;
}): React.CSSProperties {
  return {
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
    display: width ? "flex" : "inline-flex",
    width,
    boxSizing: "border-box",
    alignItems: "center",
    justifyContent: width ? "space-between" : undefined,
    gap: "0.4rem",
    whiteSpace: "nowrap",
    // A long value must not stretch the control past the box it was given; the caret stays put.
    overflow: "hidden",
  };
}
