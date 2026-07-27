"use client";

import {
  createContext,
  useContext,
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
   * Horizontal anchoring relative to the trigger. "center" (default) can overflow the
   * viewport for triggers near a window edge; "end" anchors the tooltip's right edge to
   * the trigger (extends left) and "start" anchors its left edge (extends right).
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

  let bubble: ReactNode = null;
  if (hasContent && innerCount === 0 && rect && typeof document !== "undefined") {
    const top = placement === "top" ? rect.top - GAP : rect.bottom + GAP;
    const translateY = placement === "top" ? "translateY(-100%)" : "";
    const left =
      align === "center" ? rect.left + rect.width / 2 : align === "end" ? rect.right : rect.left;
    const translateX =
      align === "center" ? "translateX(-50%)" : align === "end" ? "translateX(-100%)" : "";
    const transform = [translateX, translateY].filter(Boolean).join(" ");

    bubble = createPortal(
      <span
        role="tooltip"
        style={{
          position: "fixed",
          top,
          left,
          transform: transform || undefined,
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
        {content}
      </span>,
      document.body
    );
  }

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
