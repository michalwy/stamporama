import type { CSSProperties } from "react";

/**
 * The height of a form control (#1686, #1751): the text field's, which is also a dialog button's
 * `minHeight` in `button-style.ts`, so a field, a select and the button beside them line up.
 */
export const CONTROL_HEIGHT = "2.25rem";

/**
 * The one height every single-line form control is drawn at — a text, number or time field, a
 * select, and the pickers that stand in for them. A form's own input style spreads it first rather
 * than declaring a height of its own, so a select can no longer sit shorter than the text field
 * beside it, which is what the Facebook settings' *Every offer* row did (#1686).
 *
 * Its own module, without `"use client"`, for `baseBtn`'s reason: a server component can import a
 * plain value from it.
 *
 * **A `height`, not a `minHeight`** (#1751). #1686 shipped it as a floor, reasoning that every
 * single-line control at the form font is naturally shorter than it — and on screen that was not so:
 * a text field inherits the page's line height, and its 0.5rem of padding put it a few pixels over
 * the floor, while a select with 0.4rem landed on it, so the two still stood at different heights
 * side by side. Exact, the padding, border, font and line height a style carries no longer decide
 * anything; `border-box` puts the padding and the border inside it.
 *
 * A field that grows with its content — a `TextArea`, a chip field, a box showing a text that may
 * wrap — spreads `multiLineFormControl` after it, which starts it at the same height and lets it
 * grow. `tests/unit/form-control-height.test.ts` is what keeps both true: no style spread from this
 * one sets a height of its own, and no multi-line field is left clamped to one line.
 *
 * Not for the compact controls, which keep their own sizes by decision on #1686: a list toolbar's
 * filters share `FILTER_CONTROL_STYLE` at 2rem, and a grid cell or an editor inside a list row is
 * smaller still. They do not spread this style at all — never spread it and shrink it back.
 */
export const formControl: CSSProperties = {
  boxSizing: "border-box",
  height: CONTROL_HEIGHT,
};

/**
 * What turns a form control's style into a field that grows (#1751): spread **after** the form's
 * own input style, it releases the exact height and keeps the shared one as the floor, so a
 * multi-line field or a chip field starts level with the single-line controls beside it and grows
 * with its content. A field that wants a taller start states its own larger `minHeight` after it.
 */
export const multiLineFormControl: CSSProperties = {
  boxSizing: "border-box",
  height: "auto",
  minHeight: CONTROL_HEIGHT,
};
