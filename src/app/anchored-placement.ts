/**
 * Where a menu or popover opened from a control is drawn, so that it always fits inside the window
 * (#1765). Pure geometry — the hook that measures and applies it is `use-anchored-placement.ts`.
 *
 * The rule, for every dropdown and popover in the app:
 *
 * - It opens **below** its control when it fits there, and on **whichever side has more room**
 *   when it does not — above, usually, for a row near the bottom of the window.
 * - It is **never taller than the room on the side it opened to**: what does not fit scrolls inside
 *   it, so every item stays reachable. A row menu that ran past the bottom edge could not be
 *   scrolled into view at all — the page scrolling under a fixed box closes it.
 * - It **keeps to the window's edges horizontally** too, sliding along rather than running off.
 */

/** A box on screen, as `getBoundingClientRect` reports it. */
export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Placement {
  top: number;
  left: number;
  /** The room on the side it opened to; anything taller scrolls inside it. */
  maxHeight: number;
  maxWidth: number;
}

/** Between the control and what it opened. */
export const ANCHOR_GAP = 4;
/** Kept clear between a floating box and the window's edge. */
export const VIEWPORT_MARGIN = 8;

export function placeAnchored({
  anchor,
  size,
  viewport,
  side = "below",
  align = "start",
  maxHeight: cap,
  gap = ANCHOR_GAP,
  margin = VIEWPORT_MARGIN,
}: {
  anchor: AnchorRect;
  /** The box's natural size — what it would take with nothing cutting it short. */
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  /** `below` drops it under the control (flipping above when that has more room); `right` sets it
   * beside the control, for a trigger in the full-height sidebar with nothing under it. */
  side?: "below" | "right";
  /** For `below`: which edge of the control it lines up with. `end` hangs it leftwards from a
   * trigger at a row's right end. */
  align?: "start" | "end";
  /** Its own ceiling, where it has one short of the window. */
  maxHeight?: number;
  gap?: number;
  margin?: number;
}): Placement {
  const maxWidth = Math.max(0, viewport.width - 2 * margin);
  const width = Math.min(size.width, maxWidth);
  const wanted = cap == null ? size.height : Math.min(size.height, cap);
  const capped = (room: number) => Math.max(0, cap == null ? room : Math.min(cap, room));
  const clampLeft = (left: number) =>
    Math.max(margin, Math.min(left, viewport.width - margin - width));

  if (side === "right") {
    const roomRight = viewport.width - anchor.right - gap - margin;
    const roomLeft = anchor.left - gap - margin;
    const toRight = width <= roomRight || roomRight >= roomLeft;
    const maxHeight = capped(viewport.height - 2 * margin);
    const drawn = Math.min(wanted, maxHeight);
    return {
      top: Math.max(margin, Math.min(anchor.top, viewport.height - margin - drawn)),
      left: clampLeft(toRight ? anchor.right + gap : anchor.left - gap - width),
      maxHeight,
      maxWidth,
    };
  }

  const roomBelow = viewport.height - anchor.bottom - gap - margin;
  const roomAbove = anchor.top - gap - margin;
  const down = wanted <= roomBelow || roomBelow >= roomAbove;
  const maxHeight = capped(down ? roomBelow : roomAbove);
  const drawn = Math.min(wanted, maxHeight);
  return {
    top: down ? anchor.bottom + gap : anchor.top - gap - drawn,
    left: clampLeft(align === "start" ? anchor.left : anchor.right - width),
    maxHeight,
    maxWidth,
  };
}
