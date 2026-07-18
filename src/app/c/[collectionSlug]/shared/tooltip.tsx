"use client";

import { useState, type ReactNode } from "react";

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

/** Lightweight hover tooltip that supports rich (formatted) content. */
export function Tooltip({ content, children, placement = "top", align = "center" }: TooltipProps) {
  const [open, setOpen] = useState(false);

  const vertical =
    placement === "top"
      ? { bottom: "calc(100% + 0.4rem)" }
      : { top: "calc(100% + 0.4rem)" };

  const horizontal =
    align === "center"
      ? { left: "50%", transform: "translateX(-50%)" }
      : align === "end"
        ? { right: 0 }
        : { left: 0 };

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            ...vertical,
            ...horizontal,
            zIndex: 50,
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
        </span>
      )}
    </span>
  );
}
