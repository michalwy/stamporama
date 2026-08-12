"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/app/icons";

/**
 * The Valuation dialog's section box — a titled, bordered panel that opens and closes.
 *
 * Split out of `price-details-dialog.tsx` when the market-value sections (#457) joined it: every
 * answer that dialog gives is one of these, and a section that drew its own heading instead would
 * read as a caption on the page rather than as one more thing to open and close.
 */
export function CollapsibleSection({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        marginBottom: "0.75rem",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          width: "100%",
          padding: "0.6rem 0.75rem",
          border: "none",
          background: "var(--color-bg-page)",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--color-text-primary)",
          fontSize: "0.875rem",
          fontWeight: 600,
        }}
        aria-expanded={open}
      >
        <span style={{ display: "inline-flex", color: "var(--color-text-muted)" }}>
          <Icon name={open ? "collapse" : "expand"} size="sm" />
        </span>
        <span>{title}</span>
        {subtitle && (
          <span style={{ color: "var(--color-text-muted)", fontWeight: 500, fontSize: "0.8125rem" }}>
            {subtitle}
          </span>
        )}
        {badge && (
          <span
            style={{
              fontSize: "0.6875rem",
              fontWeight: 500,
              color: "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.25rem",
              padding: "0 0.3rem",
            }}
          >
            {badge}
          </span>
        )}
      </button>
      {open && <div style={{ padding: "0.75rem" }}>{children}</div>}
    </div>
  );
}
