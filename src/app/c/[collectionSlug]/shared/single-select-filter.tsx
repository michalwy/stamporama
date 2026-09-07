"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/app/icons";
import {
  FILTER_MENU_ITEM_STYLE,
  FILTER_MENU_Z_INDEX,
  filterMenuStyle,
  filterTriggerStyle,
  useFilterPopover,
} from "./filter-popover";

/**
 * A list toolbar's **one-of-several** dropdown, with room under the options for the controls that
 * qualify the one just picked (#868).
 *
 * It exists because a native `<select>` has nowhere to put those. The Copies list's grouping was a
 * `<select>` with its two *Split by …* switches drawn **beside** it and only once *Group duplicates*
 * was chosen, which is the defect #868 is about in its general form: a control that appears on a
 * pick cannot be discovered before the pick, it moves everything to its right at the moment the
 * collector is working the bar, and it makes the bar's width depend on what is selected. Inside the
 * panel the switches compete with nothing, so they are simply **always there** — the same
 * correction #846 made to the location subtree switch, and the reason `footer` here is spelled the
 * way `TreeSelectPanel`'s is.
 *
 * Dismissal is `useFilterPopover`'s, shared with `MultiSelectFilter`: Escape, an outside click, a
 * page scroll or a resize close it, and **a pick does not**. A footer that qualifies the choice has
 * to survive the choice, or it is on screen only after the interaction that dismissed it.
 *
 * The trigger is given a **fixed width** by its caller and ellipsises rather than growing, for the
 * same reason: `triggerLabel` may summarise what the footer holds (*Duplicates + 2 splits*) without
 * that summary shoving the bar around.
 */
export function SingleSelectFilter({
  options,
  value,
  onChange,
  triggerLabel,
  active,
  footer,
  width,
  ariaLabel,
  zIndex = FILTER_MENU_Z_INDEX,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  /** What the closed control reads. Not derived from the picked option, because a control whose
   * panel carries sub-controls has more to say than the option's own name — and saying it here is
   * worth more than a wider panel on a bar this crowded (#868). */
  triggerLabel: string;
  /** Whether to wear the accent the rest of the bar's controls wear when they are doing something.
   * The caller's call: "no grouping" is a value of this control but not an active state of it. */
  active: boolean;
  /** A strip under the options, inside the panel, **always drawn** — the switches that qualify a
   * choice rather than being one of them. Outside the `role="listbox"`, so it is not one more
   * option to arrow through. Spelled after `TreeSelectPanel`'s `footer` (#846). */
  footer?: ReactNode;
  /** Fixed width for the trigger. Required rather than optional: a toolbar dropdown that sizes to
   * its own label changes width on a pick, which is the whole of #868. */
  width: string;
  ariaLabel: string;
  zIndex?: number;
}) {
  const { open, setOpen, pos, triggerRef, menuRef } = useFilterPopover<HTMLButtonElement>();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={filterTriggerStyle({ active, width })}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{triggerLabel}</span>
        <span style={{ display: "inline-flex", opacity: 0.7, flexShrink: 0 }}>
          <Icon name="caret" size="xs" />
        </span>
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            /* The scroll moves off the box and onto the option list: the footer is the half a
               reader has to be able to find, and a shared menu style that scrolls the whole panel
               would let it slide out of view the moment the options outgrow the height. */
            style={{ ...filterMenuStyle(pos, zIndex), overflowY: "hidden" }}
          >
            <div
              role="listbox"
              aria-label={ariaLabel}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.05rem",
                minHeight: 0,
                overflowY: "auto",
              }}
            >
              {options.map((o) => {
                const picked = o.id === value;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={picked}
                    onClick={() => onChange(o.id)}
                    style={{
                      ...FILTER_MENU_ITEM_STYLE,
                      cursor: "pointer",
                      fontWeight: picked ? 600 : 500,
                      color: picked ? "var(--color-accent)" : "var(--color-text-primary)",
                      background: picked ? "var(--color-accent-soft)" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!picked) e.currentTarget.style.background = "var(--color-bg-row-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (!picked) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {footer ? (
              <div
                style={{
                  flexShrink: 0,
                  marginTop: "0.3rem",
                  paddingTop: "0.3rem",
                  borderTop: "1px solid var(--color-border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.05rem",
                }}
              >
                {footer}
              </div>
            ) : null}
          </div>,
          document.body
        )}
    </>
  );
}
