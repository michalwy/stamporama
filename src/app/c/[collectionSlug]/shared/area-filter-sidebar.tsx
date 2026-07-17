"use client";

import { useMemo } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { getDescendantIds, flattenAreaTree } from "./area-helpers";

interface AreaFilterSidebarProps {
  areas: CollectionAreaData[];
  filterAreaId: string | null;
  onNavigate: (areaId: string | null) => void;
}

export function AreaFilterSidebar({
  areas,
  filterAreaId,
  onNavigate,
}: AreaFilterSidebarProps) {
  const flatTree = useMemo(() => flattenAreaTree(areas), [areas]);

  const activeIds = useMemo(() => {
    if (!filterAreaId) return null;
    const desc = getDescendantIds(areas, filterAreaId);
    desc.add(filterAreaId);
    return desc;
  }, [areas, filterAreaId]);

  return (
    <aside
      style={{
        width: "14rem",
        flexShrink: 0,
        borderRight: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Filter by area
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <button
          type="button"
          onClick={() => onNavigate(null)}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "0.5rem 1rem",
            background: !filterAreaId ? "var(--color-bg-subtle)" : "transparent",
            border: "none",
            borderBottom: "1px solid var(--color-border)",
            cursor: "pointer",
            fontSize: "0.875rem",
            fontWeight: !filterAreaId ? 600 : 400,
            color: !filterAreaId
              ? "var(--color-text-primary)"
              : "var(--color-text-secondary)",
          }}
        >
          All areas
        </button>

        {flatTree.map(({ area, depth }) => {
          const isSelected = filterAreaId === area.id;
          const isInScope = activeIds ? activeIds.has(area.id) : false;

          return (
            <button
              key={area.id}
              type="button"
              onClick={() => onNavigate(isSelected ? null : area.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "0.4rem 1rem",
                paddingLeft: `${1 + depth * 0.875}rem`,
                background: isSelected ? "var(--color-bg-subtle)" : "transparent",
                border: "none",
                borderBottom: "1px solid var(--color-border)",
                cursor: "pointer",
                fontSize: "0.8125rem",
                fontWeight: isSelected ? 600 : 400,
                color: isSelected
                  ? "var(--color-accent)"
                  : isInScope
                    ? "var(--color-text-primary)"
                    : "var(--color-text-secondary)",
              }}
            >
              {depth > 0 && (
                <span
                  style={{
                    color: "var(--color-text-muted)",
                    marginRight: "0.25rem",
                  }}
                >
                  {"·".repeat(depth)}
                </span>
              )}
              {area.name}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
