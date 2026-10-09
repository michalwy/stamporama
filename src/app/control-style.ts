import type { CSSProperties } from "react";

/**
 * The height of a form control (#1686): the text field's, which is also a dialog button's
 * `minHeight` in `button-style.ts`, so a field, a select and the button beside them line up.
 */
export const CONTROL_HEIGHT = "2.25rem";

/**
 * The one control height every form control is drawn at — a text, number or time field, a select,
 * and the pickers and chip fields that stand in for them. A form's own input style spreads it first
 * rather than declaring a height of its own, so a select can no longer sit shorter than the text
 * field beside it, which is what the Facebook settings' *Every offer* row did (#1686).
 *
 * Its own module, without `"use client"`, for `baseBtn`'s reason: a server component can import a
 * plain value from it.
 *
 * A **`minHeight`**, not a `height`, and that is what lets one value serve both kinds of field:
 *
 * - every single-line control at the form font (0.875rem, at most 0.5rem of vertical padding) is
 *   naturally shorter than this, so the floor *is* its height — the text field and the select
 *   both land on it whatever their padding;
 * - a multi-line field or a chip field spread from the same style starts at it and keeps growing
 *   with its content, where a `height` would clamp a textarea to one line.
 *
 * `border-box`, because a bare `<input>` is `content-box`: the floor would otherwise be the text
 * area's, and the padding and border would land on top of it.
 *
 * Not for the compact controls, which keep their own sizes by decision on #1686: a list toolbar's
 * filters share `FILTER_CONTROL_STYLE` at 2rem, and a grid cell or an editor inside a list row is
 * smaller still.
 */
export const formControl: CSSProperties = {
  boxSizing: "border-box",
  minHeight: CONTROL_HEIGHT,
};
