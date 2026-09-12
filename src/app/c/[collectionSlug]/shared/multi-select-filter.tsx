"use client";

import { Fragment, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/app/icons";
import {
  FILTER_MENU_HEADING_STYLE,
  FILTER_MENU_ITEM_STYLE,
  FILTER_MENU_Z_INDEX,
  filterMenuStyle,
  filterTriggerStyle,
  useFilterPopover,
} from "./filter-popover";

/**
 * A list filter that takes **several** values at once (#425) — the shape a `<select>` cannot have
 * without becoming a scrolling box that eats a toolbar's height. It is a control that reads like the
 * single-selects beside it (the same size, the same accent when it is narrowing something) and opens
 * a checkbox list under itself.
 *
 * Its dismissal behaviour is `useFilterPopover`'s (`filter-popover.tsx`), shared since #868 with the
 * single-choice dropdown beside it so the bar has one convention rather than two: a popover rather
 * than a layer, portaled to `<body>`, closing on Escape, an outside click, a page scroll or a
 * resize — and never on a pick.
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
  triggerLabel,
  itemNoun,
  ariaLabel,
  disabled = false,
  fullWidth = false,
  footer,
  zIndex = FILTER_MENU_Z_INDEX,
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
  /** Overrides what the closed control reads, for a filter whose panel carries a {@link footer}
   * saying something the count cannot (#1182): two tags ticked reads the same under *any of these*
   * and *all of these*, and the reader cannot tell the two apart from the list. Left off, the label
   * is the count rule below — which is what every caller without a footer wants. Spelled after
   * `SingleSelectFilter`'s own `triggerLabel`, for the same reason it exists there. */
  triggerLabel?: string;
  /** What several selected values are counted in, e.g. `conditions` → `3 conditions`. */
  itemNoun: string;
  ariaLabel: string;
  /** A precondition elsewhere has fixed this axis, so the control is shown greyed rather than
   *  hidden (#273) — the caller supplies the tooltip saying why. */
  disabled?: boolean;
  /** Fills the width it is given, with the caret pushed to the right edge and a long label
   *  ellipsised rather than allowed to stretch the box.
   *
   *  For a **form** field, where the control sits in a grid cell beside inputs and selects and has
   *  to line up with them — and, since #868, for a **toolbar slot of a fixed width** too. Counting
   *  several values instead of listing them (below) stops the trigger growing without bound, but it
   *  does not hold it *still*: `All conditions`, `Mint` and `3 conditions` are three widths, and on
   *  a bar where a pick must not move anything, the caller gives the control a fixed box and this
   *  makes it fill it. Left off, the control sizes to its own label and its neighbours shift when
   *  that label changes. */
  fullWidth?: boolean;
  /** A strip under the checklist, inside the panel, **always drawn** — a control that *qualifies*
   * the selection rather than being one more thing to tick (#1182's any/all mode, the tag filter's
   * whole second half). Outside the `role="listbox"`, so it is not one more option to arrow
   * through; spelled after `SingleSelectFilter`'s and `TreeSelectPanel`'s `footer` (#846, #868), and
   * it survives a tick for the reason they do — a sub-control that qualifies a pick must outlive the
   * pick, or it is on screen only after the interaction that dismissed it. */
  footer?: ReactNode;
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
  const { open, setOpen, pos, triggerRef, menuRef } = useFilterPopover<HTMLButtonElement>({
    disabled,
    onOpenChange,
  });

  const chosen = new Set(selected);
  // One value names itself; several are counted, because a toolbar control that grows with the
  // selection pushes everything beside it around.
  const label =
    triggerLabel ??
    (chosen.size === 0
      ? allLabel
      : chosen.size === 1
        ? (options.find((o) => chosen.has(o.id))?.label ?? allLabel)
        : `${chosen.size} ${itemNoun}`);

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
        style={filterTriggerStyle({
          active,
          disabled,
          width: fullWidth ? "100%" : undefined,
        })}
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
            /* The **checklist** scrolls, not the box — `SingleSelectFilter`'s arrangement, adopted
               here when this control gained a footer (#1182). A shared menu style that scrolled the
               whole panel would let the footer slide out of view the moment the options outgrew the
               height, and the footer is the half a reader has to be able to find. Done the same way
               with or without one, so there is one shape rather than two. */
            style={{ ...filterMenuStyle(pos, zIndex), overflowY: "hidden" }}
          >
            <div
              role="listbox"
              aria-multiselectable
              aria-label={ariaLabel}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.05rem",
                minHeight: 0,
                overflowY: "auto",
              }}
            >
              {/* Clearing is the same act as unticking everything, so it is the list's first row
                  rather than a separate control beside the trigger. */}
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={!active}
                style={{
                  ...FILTER_MENU_ITEM_STYLE,
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
                    <span style={FILTER_MENU_HEADING_STYLE}>{o.group}</span>
                  )}
                  <label
                    style={{ ...FILTER_MENU_ITEM_STYLE, cursor: "pointer" }}
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
