"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
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
}

/** Gap between the trigger and the tooltip, in pixels (~0.4rem). */
const GAP = 6;

/**
 * Lightweight hover tooltip that supports rich (formatted) content. The bubble is rendered
 * in a portal to <body> and positioned with `fixed` coordinates taken from the trigger, so
 * it is never clipped by an ancestor's `overflow` (rows, cards, dialogs) — a problem the
 * old absolutely-positioned bubble had.
 */
export function Tooltip({ content, children, placement = "top", align = "center" }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  function show() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setRect(r);
  }
  function hide() {
    setRect(null);
  }

  let bubble: ReactNode = null;
  if (rect && typeof document !== "undefined") {
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
      style={{ display: "inline-flex" }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {bubble}
    </span>
  );
}
