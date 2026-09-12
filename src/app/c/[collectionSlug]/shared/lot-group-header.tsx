"use client";

import { useState } from "react";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";

/**
 * A plain collapsible heading over part of a lot's item list (#1189) — an area, or a year of
 * issue.
 *
 * Deliberately **not** `LotIssueGroupHeader`. That one carries an issue's whole identity: its
 * area chip, its catalogue numbers, a stamp count and a per-checklist completeness figure, all of
 * them answers to *what is this issue and how much of it do I have*. An area or a year is a pile
 * the collector made, not a thing in the catalogue, and there is nothing further to say about it
 * than its name and how many copies fell into it. Reusing the issue header would have meant a
 * header shaped for six facts drawn with one.
 *
 * It is the **outer** heading wherever both appear, so it reads heavier than the issue headings
 * nested beneath it: the name at full weight over their muted one, and no second line at all.
 */
export function LotGroupHeader({
  label,
  copyCount,
  countLabel = "in lot",
  collapsed,
  onToggle,
}: {
  label: string;
  copyCount: number;
  /** Wording for the count. `shown` while a filter is narrowing the list (#623), where the number
   * is the matching copies rather than the pile's whole size. */
  countLabel?: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 1.25rem",
        background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
        transition: "background 0.1s ease",
        cursor: "pointer",
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={collapsed ? "Expand" : "Collapse"}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--color-text-muted)",
          fontSize: "0.75rem",
          padding: "0.25rem",
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        <Icon name={collapsed ? "expand" : "collapse"} size="sm" />
      </button>

      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "0.9375rem",
          fontWeight: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>

      <Tooltip content="Copies under this heading" align="end">
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 500,
            padding: "0.125rem 0.5rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-secondary)",
            background: "var(--color-bg-page)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {copyCount} {countLabel}
        </span>
      </Tooltip>
    </div>
  );
}
