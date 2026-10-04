import type { CSSProperties } from "react";

/**
 * The one button shape: every dialog button is drawn from it, so the variants are the same shape and
 * only their colours differ. A screen with a button of its own spreads it rather than declaring its
 * own copy (#792).
 *
 * Its own module, without `"use client"`, so that any component — a server component included — can
 * import a plain value from it; exported from `dialog-shell.tsx` it would reach a server component as
 * a client reference.
 *
 * Two details exist to keep a footer's buttons the **same height**, which they were not:
 *
 * - `inline-flex` centring rather than the default inline layout. `Icon` is an inline-block with a
 *   `vertical-align` below the baseline, so an icon inside a button stretches its line box and the
 *   button grows — leaving *Discard* and *Assign…* a couple of pixels taller than a plain-text
 *   primary beside them. Laid out as a centred flex row, the icon no longer participates in a line
 *   box at all. Deliberately **no `gap`**: call sites write `<Icon /> Label`, and that literal space
 *   is their spacing — adding a gap would silently widen every one of them.
 * - a **transparent** border rather than none. The secondary and destructive variants draw a 1px
 *   border; without a placeholder here the primary would be 2px shorter whenever the content
 *   exceeds `minHeight`.
 *
 * And a **label never wraps** (#1553). A footer is a flex row, and a flex item shrinks to its
 * longest word: beside a long hint line the cut editor's *Cut 33 tiles* broke into *Cut 33* /
 * *tiles* and stood taller than *Cancel*. `nowrap` with `flexShrink: 0` leaves the shrinking to
 * whatever text sits beside the buttons, which wraps onto more lines instead.
 */
export const baseBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  whiteSpace: "nowrap",
  minHeight: "2.25rem",
  padding: "0.375rem 1rem",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  cursor: "pointer",
  border: "1px solid transparent",
};
