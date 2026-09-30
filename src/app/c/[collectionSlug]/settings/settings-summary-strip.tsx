"use client";

import type { ReactNode } from "react";
import { Icon } from "@/app/icons";

/**
 * The **summary strip** of a Settings page (#1475; ADR-0059 §4): a row of tiles between the header
 * and the tabs, each saying where one tab's thing stands and opening that tab — the album screen's
 * strip (#1430) brought to Settings. A shared piece, so the marketplace pages that follow (#1479,
 * #1480) say *connected* and *three profiles* the same way Allegro does.
 *
 * The tiles share the row equally, as many as the page has; a strip is a handful of figures, never
 * a list, so it does not wrap into a second row on a desktop window.
 */
export function SettingsSummaryStrip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: "grid",
        gridAutoFlow: "column",
        gridAutoColumns: "minmax(0, 1fr)",
        gap: "0.75rem",
      }}
    >
      {children}
    </div>
  );
}

/**
 * One tile: a small title, the figure, and a muted line under it. **The whole tile opens its tab** —
 * a figure is a way in, as on the album screen — and the tile of the tab being shown carries the
 * accent's edge, the navigation's own marking of *this one*. A `flagged` tile needs the collector
 * and says so in the warning tone, beside its icon, rather than by colour alone.
 */
export function SettingsSummaryTile({
  title,
  figure,
  detail,
  flagged = false,
  active = false,
  onOpen,
}: {
  title: string;
  figure: ReactNode;
  detail?: ReactNode;
  flagged?: boolean;
  active?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "0.25rem",
        minWidth: 0,
        padding: "0.75rem 1rem",
        border: `1px solid ${flagged ? "var(--color-warning-border)" : "var(--color-border)"}`,
        borderRadius: "0.75rem",
        background: flagged ? "var(--color-warning-soft)" : "var(--color-bg-elevated)",
        boxShadow: active ? "inset 0 -2px 0 var(--color-accent)" : undefined,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
        }}
      >
        {title}
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.375rem",
          maxWidth: "100%",
          fontSize: "0.9375rem",
          fontWeight: 500,
          color: flagged ? "var(--color-warning)" : "var(--color-text-primary)",
        }}
      >
        {flagged && <Icon name="warning" size="sm" />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {figure}
        </span>
      </span>
      {detail && (
        <span
          style={{
            maxWidth: "100%",
            fontSize: "0.8125rem",
            color: "var(--color-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {detail}
        </span>
      )}
    </button>
  );
}
