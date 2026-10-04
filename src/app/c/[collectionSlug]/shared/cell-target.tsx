"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Icon, type IconSize } from "@/app/icons";

/**
 * **The expand caret and the selection checkbox on a list row are clickable across their whole
 * cell** (#1589) — the full height of the row and the full width of the caret's or the box's column,
 * not the glyph alone, where a near miss did something else or nothing.
 *
 * Both cells are a **`<label>`**, and that one choice carries every rule the issue sets:
 *
 * - **A click anywhere in the cell is a click on the control** — the browser forwards it, so it does
 *   exactly what clicking the glyph does, modifier keys included. A `<button>` is as labelable as a
 *   checkbox, which is what lets the caret use the same element.
 * - **It never also reaches the row**: the cell stops the click — its own and the one it forwards,
 *   which bubbles back through it — so a row that opens, picks or toggles on click sees neither.
 *   Nothing here listens for clicks above a row (the outside-click closers are `mousedown`).
 * - **Focus and the screen-reader name stay on the control itself**: the label is not focusable and
 *   carries no text, so the caret's `aria-label` and the checkbox's are what is read.
 *
 * Hovering anywhere in the cell lights the glyph (`.cell-target` in `globals.css`) and shows a hand,
 * so the larger target can be found rather than stumbled on.
 *
 * A row pads its content, and a cell that is merely `alignSelf: stretch` stops at that padding.
 * `bleed` is the row's padding on the cell's sides, and half the gap to a neighbour: the cell takes
 * it as a negative margin and gives it back as padding, so it reaches the row's edge while the glyph
 * — and everything beside it — stays exactly where it was.
 */
export interface CellBleed {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
}

/** The bleed as style, for a control that is its own cell — a heading whose whole name toggles. */
export function cellBleedStyle(bleed: CellBleed | undefined): CSSProperties {
  if (!bleed) return {};
  const style: CSSProperties = {};
  if (bleed.top) Object.assign(style, { marginTop: `calc(-1 * ${bleed.top})`, paddingTop: bleed.top });
  if (bleed.bottom)
    Object.assign(style, { marginBottom: `calc(-1 * ${bleed.bottom})`, paddingBottom: bleed.bottom });
  if (bleed.left) Object.assign(style, { marginLeft: `calc(-1 * ${bleed.left})`, paddingLeft: bleed.left });
  if (bleed.right)
    Object.assign(style, { marginRight: `calc(-1 * ${bleed.right})`, paddingRight: bleed.right });
  return style;
}

function stopAtCell(event: MouseEvent<HTMLLabelElement>) {
  event.stopPropagation();
}

const CELL: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  alignSelf: "stretch",
  flexShrink: 0,
  cursor: "pointer",
};

/** The width of a caret's glyph box — what a row with nothing to expand reserves in its place, so its
 *  neighbours line up with the rows that have one. A `sm` icon and the box's padding. */
export const CARET_GLYPH_WIDTH = "1.125rem";

/** The box the hover lights, around the glyph — padded so the highlight has a shape of its own. */
export const CELL_GLYPH: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "0.25rem",
  padding: "0.125rem",
  lineHeight: 1,
};

const CARET_BUTTON: CSSProperties = {
  ...CELL_GLYPH,
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--color-text-muted)",
};

/**
 * A row's expand caret, in a cell the whole of which expands or collapses the row. `children`
 * replaces the default collapse/expand glyph where a list draws its caret differently (a rotating
 * arrow); the button and its cell stay this component's.
 */
export function CaretCell({
  expanded,
  onToggle,
  label,
  iconSize = "sm",
  bleed,
  style,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  /** The control's accessible name; `Expand` / `Collapse` by default. */
  label?: string;
  iconSize?: IconSize;
  bleed?: CellBleed;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <label
      className="cell-target"
      onClick={stopAtCell}
      style={{ ...CELL, ...cellBleedStyle(bleed), ...style }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={label ?? (expanded ? "Collapse" : "Expand")}
        aria-expanded={expanded}
        className="cell-target-glyph"
        style={CARET_BUTTON}
      >
        {children ?? <Icon name={expanded ? "collapse" : "expand"} size={iconSize} />}
      </button>
    </label>
  );
}

/**
 * A row's selection checkbox, in a cell the whole of which toggles it. The caller passes the
 * `<input type="checkbox">` itself — its `ref`, `indeterminate` state and any hint around it stay
 * where they are — and `disabled` takes the hand and the highlight away with it.
 */
export function CheckCell({
  disabled,
  bleed,
  style,
  children,
}: {
  disabled?: boolean;
  bleed?: CellBleed;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <label
      className={disabled ? undefined : "cell-target"}
      onClick={stopAtCell}
      style={{ ...CELL, cursor: disabled ? "default" : "pointer", ...cellBleedStyle(bleed), ...style }}
    >
      <span className="cell-target-glyph" style={CELL_GLYPH}>
        {children}
      </span>
    </label>
  );
}
