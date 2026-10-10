"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { placeAnchored, type AnchorRect, type Placement } from "./anchored-placement";

/**
 * The position of a portaled, `position: fixed` menu or popover opened from a control, measured so
 * it always fits inside the window (#1765) — the rule is `placeAnchored`'s.
 *
 * The box is drawn hidden on the first frame, measured at its natural size, and placed before
 * anything is painted, so it never shows where it did not fit. It is measured again whenever its
 * own size changes — a popover whose content arrives after it opens may need the other side — and
 * whenever the page scrolls or the window is resized, for a box that stays open through either.
 *
 * The caller renders the box whenever `open` is true (not gated on a position), spreads the returned
 * `style` into it, and sets its own `overflowY` — usually `auto`, which is what lets a box cut short
 * by the window scroll inside itself. A box whose own list scrolls instead (a filter menu with a
 * footer) keeps `overflowY: hidden` and gives that list `minHeight: 0`. A ceiling of the box's own
 * goes in `maxHeightRem`, never in its style, which this replaces.
 */
export function useAnchoredPlacement({
  open,
  anchor,
  floatingRef,
  side,
  align,
  maxHeightRem,
}: {
  open: boolean;
  /** The control it opened from, or that control's box when the caller has only the box. */
  anchor: RefObject<HTMLElement | null> | AnchorRect | null;
  floatingRef: RefObject<HTMLElement | null>;
  side?: "below" | "right";
  align?: "start" | "end";
  /** The box's own ceiling, short of the window's. */
  maxHeightRem?: number;
}): {
  style: CSSProperties;
  /** The control's width, for a box drawn at least as wide as it; 0 until it is measured. */
  anchorWidth: number;
} {
  const [placement, setPlacement] = useState<(Placement & { anchorWidth: number }) | null>(null);
  // Read through a ref so a caller passing a fresh object each render does not re-run the effect.
  const latest = useRef({ anchor, side, align, maxHeightRem });
  useLayoutEffect(() => {
    latest.current = { anchor, side, align, maxHeightRem };
  });

  useLayoutEffect(() => {
    const floating = floatingRef.current;
    if (!open || !floating) {
      setPlacement(null);
      return;
    }
    function update() {
      const { anchor, side, align, maxHeightRem } = latest.current;
      const rect = anchor && "current" in anchor ? anchor.current?.getBoundingClientRect() : anchor;
      if (!rect || !floating) return;
      // The natural height, with the cut this hook applied lifted for the reading: `scrollHeight`
      // alone would not do, since a box whose inner list scrolls reports only what it was cut to.
      const cut = floating.style.maxHeight;
      floating.style.maxHeight = "none";
      const size = { width: floating.offsetWidth, height: floating.offsetHeight };
      floating.style.maxHeight = cut;
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const next = {
        ...placeAnchored({
          anchor: rect,
          size,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          side,
          align,
          maxHeight: maxHeightRem == null ? undefined : maxHeightRem * rem,
        }),
        anchorWidth: rect.right - rect.left,
      };
      // A content-box box's `max-height` leaves out its padding and border, so they come off here.
      const style = getComputedStyle(floating);
      if (style.boxSizing === "content-box") {
        const px = (...vs: string[]) => vs.reduce((sum, v) => sum + (Number.parseFloat(v) || 0), 0);
        const vertical = px(
          style.paddingTop,
          style.paddingBottom,
          style.borderTopWidth,
          style.borderBottomWidth
        );
        const horizontal = px(
          style.paddingLeft,
          style.paddingRight,
          style.borderLeftWidth,
          style.borderRightWidth
        );
        next.maxHeight = Math.max(0, next.maxHeight - vertical);
        next.maxWidth = Math.max(0, next.maxWidth - horizontal);
      }
      setPlacement((prev) =>
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.maxHeight === next.maxHeight &&
        prev.maxWidth === next.maxWidth &&
        prev.anchorWidth === next.anchorWidth
          ? prev
          : next
      );
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(floating);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [open, floatingRef]);

  return placement
    ? {
        style: {
          position: "fixed",
          top: placement.top,
          left: placement.left,
          maxHeight: placement.maxHeight,
          maxWidth: placement.maxWidth,
        },
        anchorWidth: placement.anchorWidth,
      }
    : { style: { position: "fixed", top: 0, left: 0, visibility: "hidden" }, anchorWidth: 0 };
}
