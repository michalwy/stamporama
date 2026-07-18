"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { getDescendantIds, flattenAreaTree } from "./area-helpers";

const STORAGE_KEY = "stamporama:area-tree-collapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // ignore
  }
  return new Set();
}

function saveCollapsed(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

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

  const parentIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of areas) {
      if (a.parentId) set.add(a.parentId);
    }
    return set;
  }, [areas]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const saved = loadCollapsed();
    if (saved.size > 0) return saved;
    const defaults = new Set<string>();
    for (const { area, depth } of flatTree) {
      if (depth > 0 && parentIds.has(area.id)) {
        defaults.add(area.id);
      }
    }
    return defaults;
  });

  useEffect(() => {
    saveCollapsed(collapsed);
  }, [collapsed]);

  const toggleCollapse = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    []
  );

  const visibleTree = useMemo(() => {
    const hidden = new Set<string>();
    for (const { area } of flatTree) {
      if (collapsed.has(area.id)) {
        for (const id of getDescendantIds(areas, area.id)) {
          hidden.add(id);
        }
      }
    }
    return flatTree.filter(({ area }) => !hidden.has(area.id));
  }, [flatTree, collapsed, areas]);

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

        {visibleTree.map(({ area, depth }) => {
          const isSelected = filterAreaId === area.id;
          const isInScope = activeIds ? activeIds.has(area.id) : false;
          const hasChildren = parentIds.has(area.id);
          const isCollapsed = collapsed.has(area.id);

          return (
            <button
              key={area.id}
              type="button"
              onClick={() => onNavigate(isSelected ? null : area.id)}
              style={{
                display: "flex",
                alignItems: "center",
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
              {hasChildren ? (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => toggleCollapse(area.id, e)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "1rem",
                    height: "1rem",
                    marginRight: "0.25rem",
                    flexShrink: 0,
                    fontSize: "0.625rem",
                    color: "var(--color-text-muted)",
                    borderRadius: "2px",
                    cursor: "pointer",
                  }}
                >
                  {isCollapsed ? "▶" : "▼"}
                </span>
              ) : (
                <span
                  style={{
                    width: "1rem",
                    marginRight: "0.25rem",
                    flexShrink: 0,
                  }}
                />
              )}
              {area.name}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
