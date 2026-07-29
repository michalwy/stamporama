"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  /**
   * What the bubble says. Empty content (null, undefined or "") shows no bubble at all — the
   * hint is often conditional ("explain this only when it is inherited"), and letting the
   * primitive answer that keeps callers from branching between a wrapped and an unwrapped
   * child, which would change the surrounding layout with it.
   */
  content: ReactNode;
  children: ReactNode;
  /** Tooltip placement relative to the trigger. Defaults to "top". */
  placement?: "top" | "bottom";
  /**
   * Horizontal anchoring relative to the trigger. "center" (default) centres the bubble on the
   * trigger; "end" anchors its right edge to the trigger (extends left) and "start" its left edge
   * (extends right).
   *
   * This is a *preference*, not a guard against running off screen — the bubble is clamped to the
   * viewport either way. Set it where the anchoring itself is what you want (a bubble on a
   * right-aligned control reads better hanging left than nudged left).
   */
  align?: "center" | "start" | "end";
  /**
   * Styles for the trigger wrapper, merged over its default `display: inline-flex`.
   * Wrapping an element in a tooltip inserts a span between it and its parent, so a
   * child that carried layout of its own (`flex`, `minWidth`, `alignSelf`, a margin)
   * hands that to the wrapper here — otherwise the surrounding row shifts.
   */
  style?: CSSProperties;
}

/** Gap between the trigger and the tooltip, in pixels (~0.4rem). */
const GAP = 6;

/** How close to the window edge the bubble may sit before it is pushed back in. */
const VIEWPORT_MARGIN = 8;

/**
 * How a nested tooltip tells the one wrapping it to stand down. Triggers nest routinely here —
 * a chip with its own hint inside a clickable row that has one too — and `mouseenter` does not
 * fire again on the ancestor when the pointer moves onto a descendant, so without this both
 * bubbles would be on screen at once. The innermost hint wins, which is what the native `title`
 * these replaced did.
 */
const NestedTooltip = createContext<{ enter: () => void; leave: () => void } | null>(null);

/**
 * Lightweight hover tooltip that supports rich (formatted) content. The bubble is rendered
 * in a portal to <body> and positioned with `fixed` coordinates taken from the trigger, so
 * it is never clipped by an ancestor's `overflow` (rows, cards, dialogs) — a problem the
 * old absolutely-positioned bubble had.
 *
 * It is not clipped by the **window** either: {@link TooltipBubble} flips or slides it back inside
 * after measuring. Callers therefore never have to reason about where on screen their trigger
 * happens to sit — `placement` and `align` say what is *preferred*, not what is safe.
 */
export function Tooltip({
  content,
  children,
  placement = "top",
  align = "center",
  style,
}: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [innerCount, setInnerCount] = useState(0);
  const outer = useContext(NestedTooltip);

  function show() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setRect(r);
    outer?.enter();
  }
  function hide() {
    setRect(null);
    outer?.leave();
  }

  const nest = useMemo(
    () => ({
      enter: () => {
        setInnerCount((n) => n + 1);
        outer?.enter();
      },
      leave: () => {
        setInnerCount((n) => Math.max(0, n - 1));
        outer?.leave();
      },
    }),
    [outer]
  );

  const hasContent = content !== null && content !== undefined && content !== false && content !== "";

  const bubble =
    hasContent && innerCount === 0 && rect && typeof document !== "undefined"
      ? createPortal(
          <TooltipBubble rect={rect} placement={placement} align={align}>
            {content}
          </TooltipBubble>,
          document.body
        )
      : null;

  return (
    <span
      ref={triggerRef}
      style={{ display: "inline-flex", ...style }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <NestedTooltip.Provider value={nest}>{children}</NestedTooltip.Provider>
      {bubble}
    </span>
  );
}

/**
 * The bubble, placed where `placement`/`align` ask and then **kept inside the window**.
 *
 * The clamp is not a nicety: a hint is most needed on the controls that sit at the edges of the
 * screen — the last button of a header row, a row action at the foot of a long list — and those are
 * exactly the triggers whose bubble runs off it. Leaving that to the caller meant every such site
 * had to notice the problem first, and the ones that did not shipped a hint nobody could read.
 *
 * Two passes, deliberately. The correction needs the bubble's rendered size (its text wraps, so no
 * caller knows it up front), so it is drawn at the requested position and moved in a layout effect,
 * before the browser paints. That is one extra render per hover on a `pointer-events: none` element
 * with no transition — nothing the eye can catch.
 *
 * Vertically the bubble **flips to the other side of the trigger** when it does not fit, rather than
 * sliding: sliding would put it over the very control it describes. It only slides when neither side
 * has room, which on a viewport this short is the least-bad answer. Horizontally it always slides —
 * there is no "other side" of a trigger to flip to, and the arrow-less bubble reads fine offset.
 */
function TooltipBubble({
  rect,
  placement,
  align,
  children,
}: {
  rect: DOMRect;
  placement: "top" | "bottom";
  align: "center" | "start" | "end";
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState<{ dx: number; dy: number } | null>(null);

  const top = placement === "top" ? rect.top - GAP : rect.bottom + GAP;
  const left =
    align === "center" ? rect.left + rect.width / 2 : align === "end" ? rect.right : rect.left;
  const translateX =
    align === "center" ? "translateX(-50%)" : align === "end" ? "translateX(-100%)" : "";
  const translateY = placement === "top" ? "translateY(-100%)" : "";

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measured after the base transform, so this is where the bubble actually landed.
    const r = el.getBoundingClientRect();
    const maxX = window.innerWidth - VIEWPORT_MARGIN;
    const maxY = window.innerHeight - VIEWPORT_MARGIN;

    let dx = 0;
    if (r.left < VIEWPORT_MARGIN) dx = VIEWPORT_MARGIN - r.left;
    else if (r.right > maxX) dx = maxX - r.right;
    // A bubble wider than the window would otherwise be pushed both ways; pin it to the left edge.
    if (r.width > maxX - VIEWPORT_MARGIN) dx = VIEWPORT_MARGIN - r.left;

    let dy = 0;
    if (r.top < VIEWPORT_MARGIN) {
      const below = rect.bottom + GAP;
      dy = below + r.height <= maxY ? below - r.top : VIEWPORT_MARGIN - r.top;
    } else if (r.bottom > maxY) {
      const above = rect.top - GAP - r.height;
      dy = above >= VIEWPORT_MARGIN ? above - r.top : maxY - r.bottom;
    }

    if (dx !== 0 || dy !== 0) setShift({ dx, dy });
    // Runs once per hover: the bubble unmounts on leave, so a new position is a new mount and the
    // correction cannot compound. `shift` is deliberately not a dependency.
  }, [rect, placement, align]);

  const transform =
    [translateX, translateY, shift ? `translate(${shift.dx}px, ${shift.dy}px)` : ""]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <span
      ref={ref}
      role="tooltip"
      style={{
        position: "fixed",
        top,
        left,
        transform,
        zIndex: 1000,
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        boxShadow: "0 4px 16px rgb(0 0 0 / 0.15)",
        padding: "0.5rem 0.625rem",
        fontSize: "0.75rem",
        lineHeight: 1.45,
        color: "var(--color-text-primary)",
        whiteSpace: "normal",
        width: "max-content",
        maxWidth: "16rem",
        textAlign: "left",
        pointerEvents: "none",
      }}
    >
      {children}
    </span>
  );
}
