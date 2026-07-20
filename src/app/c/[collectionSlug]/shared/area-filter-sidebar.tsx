"use client";

import { useMemo, useCallback, useSyncExternalStore } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { getDescendantIds, flattenAreaTree } from "./area-helpers";
import { CollapsibleFilterPanel } from "./collapsible-filter-panel";

const STORAGE_KEY = "stamporama:area-tree-collapsed";

// The persisted collapsed set lives in localStorage (not a cookie, which would
// be sent on every request). It's exposed as an external store so it can be read
// with useSyncExternalStore: the server snapshot is null — a "not yet loaded"
// sentinel that lets the tree hold off rendering until the real state is known,
// avoiding a flash of the wrong expansion on refresh.
const collapsedListeners = new Set<() => void>();

function subscribeCollapsed(onChange: () => void) {
  collapsedListeners.add(onChange);
  return () => collapsedListeners.delete(onChange);
}

/** Client snapshot: the raw JSON string, or "" when nothing is saved yet. */
function getCollapsedRaw(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Server / pre-hydration snapshot: null means "not loaded yet". */
function getCollapsedServerRaw(): string | null {
  return null;
}

function writeCollapsed(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
  for (const listener of collapsedListeners) listener();
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

  // null until localStorage has been read on the client (see server snapshot).
  const collapsedRaw = useSyncExternalStore(
    subscribeCollapsed,
    getCollapsedRaw,
    getCollapsedServerRaw
  );
  const loaded = collapsedRaw !== null;

  const collapsed = useMemo<Set<string>>(() => {
    if (collapsedRaw) {
      try {
        return new Set<string>(JSON.parse(collapsedRaw));
      } catch {
        // fall through to defaults
      }
    }
    // Default: collapse all nested parents.
    const defaults = new Set<string>();
    for (const { area, depth } of flatTree) {
      if (depth > 0 && parentIds.has(area.id)) {
        defaults.add(area.id);
      }
    }
    return defaults;
  }, [collapsedRaw, flatTree, parentIds]);

  const toggleCollapse = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const next = new Set(collapsed);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      writeCollapsed(next);
    },
    [collapsed]
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
    <CollapsibleFilterPanel
      title="Filter by area"
      collapsedLabel="Areas"
      storageKey="stamporama:area-filter-panel-collapsed"
      expandedWidth="22rem"
    >
        <button
          type="button"
          onClick={() => onNavigate(null)}
          onMouseEnter={(e) => {
            if (filterAreaId)
              e.currentTarget.style.background = "var(--color-bg-muted)";
          }}
          onMouseLeave={(e) => {
            if (filterAreaId) e.currentTarget.style.background = "transparent";
          }}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "0.5rem 1rem",
            background: !filterAreaId ? "var(--color-accent-soft)" : "transparent",
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

        {loaded &&
          visibleTree.map(({ area, depth, isLast, ancestorHasNextSibling }) => {
          const isSelected = filterAreaId === area.id;
          const isInScope = activeIds ? activeIds.has(area.id) : false;
          const hasChildren = parentIds.has(area.id);
          const isCollapsed = collapsed.has(area.id);

          return (
            <button
              key={area.id}
              type="button"
              onClick={() => onNavigate(isSelected ? null : area.id)}
              onMouseEnter={(e) => {
                if (!isSelected)
                  e.currentTarget.style.background = "var(--color-bg-muted)";
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = "transparent";
              }}
              style={{
                display: "flex",
                alignItems: "stretch",
                width: "100%",
                textAlign: "left",
                paddingLeft: "0.75rem",
                background: isSelected ? "var(--color-accent-soft)" : "transparent",
                border: "none",
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
              {Array.from({ length: depth }).map((_, i) => {
                const isNodeLevel = i === depth - 1;
                // Cell i sits under the depth-i ancestor's chevron, so its
                // pass-through rail continues while the next ancestor on the
                // path (i+1) still has siblings below. Node level: draw the
                // elbow — a rail down to the tick (stopping there when this
                // node is the last child).
                const showRail = isNodeLevel || ancestorHasNextSibling[i + 1];
                return (
                  <span
                    key={i}
                    aria-hidden
                    style={{
                      position: "relative",
                      display: "block",
                      width: "1.25rem",
                      flexShrink: 0,
                    }}
                  >
                    {/* Vertical rail, centered under the parent's chevron */}
                    {showRail && (
                      <span
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: isNodeLevel && isLast ? "50%" : 0,
                          left: "0.5rem",
                          borderLeft: "1px solid var(--color-border-strong)",
                        }}
                      />
                    )}
                    {/* Horizontal tick connecting the rail to this node */}
                    {isNodeLevel && (
                      <span
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: "0.5rem",
                          width: "0.75rem",
                          borderTop: "1px solid var(--color-border-strong)",
                        }}
                      />
                    )}
                  </span>
                );
              })}
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  flex: 1,
                  minWidth: 0,
                  padding: "0.4rem 1rem 0.4rem 0",
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
              </span>
            </button>
          );
        })}
    </CollapsibleFilterPanel>
  );
}
