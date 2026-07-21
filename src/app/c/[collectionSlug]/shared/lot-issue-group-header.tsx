"use client";

import { useState } from "react";
import type { AreaCatalogEntry } from "@/lib/areas";
import type { IssueHeader } from "@/lib/issues";
import { IssueTitle, IssueCatalogChips, StampCountBadge } from "./issue-view";
import { Tooltip } from "./tooltip";

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

/**
 * Collapsible issue-group header for a lot's copies, grouped by owning issue — the area chip,
 * issue title, "N in lot" count, catalog chips, and stamp-count badge, with an expand toggle.
 * Shared by the purchase-order intake view (#121) and the sale-lot composition view (#164) so
 * both group identically. Optional `onMove` / `onMarkSorted` add per-issue bulk actions
 * (purchase intake only); `countLabel` overrides the "in lot" wording.
 */
export function LotIssueGroupHeader({
  header,
  fallbackLabel,
  copyCount,
  countLabel = "in lot",
  areaName,
  primaryVendorId,
  vendorMap,
  collapsed,
  onToggle,
  onMove,
  onMarkSorted,
}: {
  header: IssueHeader | null | undefined;
  fallbackLabel: string;
  copyCount: number;
  countLabel?: string;
  areaName: string | null;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  collapsed: boolean;
  onToggle: () => void;
  onMove?: () => void;
  onMarkSorted?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onToggle}
      style={{
        padding: "0.75rem 1.25rem",
        background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
        transition: "background 0.1s ease",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
          {collapsed ? "▶" : "▼"}
        </button>

        {areaName && (
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
              background: "var(--color-bg-page)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.25rem",
              padding: "0.1rem 0.4rem",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {areaName}
          </span>
        )}

        <span
          style={{
            flex: 1,
            fontSize: "0.9375rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {header ? <IssueTitle name={header.name} year={header.year} /> : fallbackLabel}
        </span>

        <Tooltip content="Copies from this issue in the lot" align="end">
          <span style={{ ...CHIP, flexShrink: 0 }}>
            {copyCount} {countLabel}
          </span>
        </Tooltip>

        {onMove && (
          <Tooltip content="Move this issue's copies to a location" align="end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMove();
              }}
              aria-label="Move this issue's copies to a location"
              style={{ ...CHIP, flexShrink: 0, cursor: "pointer" }}
            >
              📍
            </button>
          </Tooltip>
        )}
        {onMarkSorted && (
          <Tooltip content="Mark this issue's copies sorted" align="end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMarkSorted();
              }}
              aria-label="Mark this issue's copies sorted"
              style={{ ...CHIP, flexShrink: 0, cursor: "pointer" }}
            >
              ✓
            </button>
          </Tooltip>
        )}
      </div>

      {header && (header.catalogNumbers.length > 0 || header.memberCount > 0) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            paddingLeft: "1.75rem",
            marginTop: "0.3rem",
            flexWrap: "wrap",
          }}
        >
          <IssueCatalogChips
            catalogNumbers={header.catalogNumbers}
            vendorMap={vendorMap}
            primaryVendorId={primaryVendorId}
          />
          {header.memberCount > 0 && (
            <StampCountBadge required={header.requiredCount} total={header.memberCount} />
          )}
        </div>
      )}
    </div>
  );
}
