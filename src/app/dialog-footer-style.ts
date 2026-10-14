import type { CSSProperties } from "react";

/**
 * How a dialog footer lays out its buttons — **they fit on one line or wrap onto the next, and never
 * draw over each other** (#1908).
 *
 * A button's label never wraps and the button never shrinks (`baseBtn`, #1553), so a footer whose
 * buttons are wider than the dialog has to put the excess somewhere. It used to put it on top of the
 * neighbouring button: `DialogActions` gave its `leading` group `minWidth: 0`, the group shrank below
 * the button inside it, and on *Move to Packed?* (#973) *Move to Packed anyway* overflowed onto *Do
 * nothing* — unreadable and half unclickable. Now the row wraps, and no group in it may be squeezed
 * below the buttons it holds.
 *
 * Its own module, without `"use client"`, so the unit suite can hold the contract without a browser.
 */

/** The row of the footer: right-aligned, and a group that does not fit moves to a line of its own. */
export const DIALOG_FOOTER_ROW: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "flex-end",
  columnGap: "0.75rem",
  rowGap: "0.5rem",
};

/**
 * What stands at the left of a footer — `DialogActions`' `leading` group, or a line of text a
 * hand-built footer sets before its buttons.
 *
 * It takes **whatever room the buttons leave** (a zero basis that grows), and its narrowest is its
 * own content's narrowest: the longest word of a line of text, all of a button. So a hint keeps
 * wrapping beside the buttons as #1553 wanted, while a button here is never squeezed under the next
 * one — when it does not fit, the buttons to its right go down a line instead.
 *
 * Only the flex item's sizing, nothing about its own layout: a line of text spreads it as it is (made
 * a flex container, its words and `<kbd>`s would become separate items), and `DialogActions` adds the
 * row it lays its group out in.
 */
export const DIALOG_FOOTER_LEADING: CSSProperties = {
  flex: "1 1 0",
};

/** Cancel and the action: kept together, and wrapped onto two lines only in a dialog too narrow
 *  for the pair. */
export const DIALOG_FOOTER_ACTIONS: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "0.5rem",
};
