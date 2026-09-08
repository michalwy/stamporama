"use client";

import { useMemo, useCallback, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { CollectionAreaData } from "@/lib/areas";
import { rollUpAreaCounts, type AreaFacet } from "@/lib/area-facets";
import { getDescendantIds, flattenAreaTree, hasChildAreas } from "./area-helpers";
import { CollapsibleFilterPanel } from "./collapsible-filter-panel";
import { Tooltip } from "./tooltip";
import { SubtreeScopeToggle, useSubtreeScope } from "./subtree-scope";
import { QuickAddAreaDialog } from "./quick-add-area-dialog";
import { Icon } from "@/app/icons";

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

/**
 * A list-specific bucket that sits with the areas without being one — the bulk listing workspace's
 * **Mixed** group (#322), for offers whose copies span areas or years and so belong under no single
 * pair. It is a selection at the same level as "All areas" (it answers the same question about
 * scope), which is why it is rendered here rather than as a control elsewhere on the screen.
 */
export interface AreaExtraEntry {
  label: string;
  title?: string;
  count?: number;
  selected: boolean;
  onSelect: () => void;
}

interface AreaFilterSidebarProps {
  areas: CollectionAreaData[];
  filterAreaId: string | null;
  onNavigate: (areaId: string | null) => void;
  extraEntry?: AreaExtraEntry;
  /**
   * Per-area row counts (#843), each area's **own** rows — the roll-up onto parents happens here,
   * following the subtree-scope toggle. Counted against every filter on the screen except the area
   * selection itself, so a row promises what selecting it would list; see `@/lib/area-facets`.
   * Omit it and the rows carry no count, which is the honest rendering for a screen with no facet
   * to read (`ui-patterns.md`: a control promising a number it cannot compute is worse than a bare
   * one).
   */
  counts?: AreaFacet[];
  /**
   * Turn on the **quick-add** shortcut (#776): a `＋` in the panel header that opens the same
   * create-area dialog the areas management screen uses, with the selected area pre-filled as the
   * parent. Pass the collection the areas belong to; omit it and the panel is read-only, which is
   * what the copy pickers do — creating taxonomy is not part of picking copies, and the dialog
   * would stack a form on top of the picker's own.
   *
   * The refresh after a successful create is owned here rather than by the caller. `areas` reaches
   * every one of these screens as a server-component prop, so the new area appears on a
   * `router.refresh()` and on nothing else — and a shortcut that each screen had to remember to
   * refresh is the arrangement that produced #918.
   */
  quickAddCollectionId?: string;
}

export function AreaFilterSidebar({
  areas,
  filterAreaId,
  onNavigate,
  extraEntry,
  counts,
  quickAddCollectionId,
}: AreaFilterSidebarProps) {
  const router = useRouter();
  const [addingArea, setAddingArea] = useState(false);
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

  // The scope the selection actually filters by (#385) — also what the in-scope shading below
  // marks, so the tree shows the same set the list is showing.
  const [includeDescendants, setIncludeDescendants] = useSubtreeScope("area");
  const showScopeToggle = hasChildAreas(areas, filterAreaId);

  const activeIds = useMemo(() => {
    if (!filterAreaId) return null;
    if (!includeDescendants) return new Set([filterAreaId]);
    const desc = getDescendantIds(areas, filterAreaId);
    desc.add(filterAreaId);
    return desc;
  }, [areas, filterAreaId, includeDescendants]);

  // The number on each row (#843). It follows the same toggle the shading above does, because the
  // count and the shading are two renderings of one claim: this is the set selecting this row shows.
  const countByArea = useMemo(
    () => rollUpAreaCounts(areas, counts, includeDescendants),
    [areas, counts, includeDescendants]
  );

  return (
    <>
      <CollapsibleFilterPanel
        title="Filter by area"
        collapsedLabel="Areas"
        storageKey="stamporama:area-filter-panel-collapsed"
        expandedWidth="22rem"
        headerAction={
          quickAddCollectionId ? (
            <Tooltip
              content={
                filterAreaId
                  ? "Add an area under the selected one"
                  : "Add a top-level area"
              }
              placement="bottom"
              align="end"
            >
              <button
                type="button"
                onClick={() => setAddingArea(true)}
                aria-label="Add area"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  fontSize: "0.75rem",
                  padding: "0 0.25rem",
                }}
              >
                <Icon name="add" size="sm" />
              </button>
            </Tooltip>
          ) : undefined
        }
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

        {/* Scope of the current selection (#385). Rendered only when the selected area has
            children — on a leaf both states pick out the same areas. It sits here, under
            "All areas" and above the tree, because it qualifies the selection rather than any one
            row of it, and the tree below can be far taller than the panel. */}
        {showScopeToggle && (
          <div
            style={{
              padding: "0.4rem 1rem",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <SubtreeScopeToggle
              axis="area"
              includeDescendants={includeDescendants}
              onChange={setIncludeDescendants}
            />
          </div>
        )}

        {extraEntry && (
          <Tooltip content={extraEntry.title} placement="bottom" style={{ width: "100%" }}>
            <button
              type="button"
              // A click on the row already chosen does nothing (#843) — the rule is enforced here
              // rather than left to each caller, so a screen wiring up a toggling `onSelect` cannot
              // reintroduce the clear-on-second-click this issue exists to remove.
              onClick={() => {
                if (!extraEntry.selected) extraEntry.onSelect();
              }}
              onMouseEnter={(e) => {
                if (!extraEntry.selected)
                  e.currentTarget.style.background = "var(--color-bg-muted)";
              }}
              onMouseLeave={(e) => {
                if (!extraEntry.selected) e.currentTarget.style.background = "transparent";
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
                width: "100%",
                textAlign: "left",
                padding: "0.4rem 1rem",
                background: extraEntry.selected ? "var(--color-accent-soft)" : "transparent",
                border: "none",
                borderBottom: "1px solid var(--color-border)",
                cursor: "pointer",
                fontSize: "0.8125rem",
                fontStyle: "italic",
                fontWeight: extraEntry.selected ? 600 : 400,
                color: extraEntry.selected
                  ? "var(--color-accent)"
                  : "var(--color-text-secondary)",
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {extraEntry.label}
              </span>
              {extraEntry.count !== undefined && (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: "0.75rem",
                    fontWeight: 400,
                    fontStyle: "normal",
                    color: "var(--color-text-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {extraEntry.count}
                </span>
              )}
            </button>
          </Tooltip>
        )}

        {loaded &&
          visibleTree.map(({ area, depth, isLast, ancestorHasNextSibling }) => {
          const isSelected = filterAreaId === area.id;
          const isInScope = activeIds ? activeIds.has(area.id) : false;
          const hasChildren = parentIds.has(area.id);
          const isCollapsed = collapsed.has(area.id);
          // `undefined` — this screen supplies no facet — is not the same claim as `0`, and only
          // the second one gets a number drawn.
          const rowCount = countByArea?.get(area.id);

          return (
            <button
              key={area.id}
              type="button"
              // Selected already: nothing to do (#843). Toggle-off is the idiom for a chip standing
              // alone; this list carries an explicit "All areas" row, so the way to clear is already
              // on screen — and an accidental double click that silently widened the list back to
              // everything read as the filter failing rather than as something the collector did.
              onClick={() => {
                if (!isSelected) onNavigate(area.id);
              }}
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
                    <Icon name={isCollapsed ? "expand" : "collapse"} size="sm" />
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
                {/* Wrapped only so the count below can be pushed to the right edge. No overflow
                    rule of its own: a long area name still wraps exactly as it did as a bare text
                    node, rather than being truncated to make room for a number. */}
                <span style={{ minWidth: 0 }}>{area.name}</span>
                {rowCount !== undefined && (
                  <span
                    style={{
                      marginLeft: "auto",
                      paddingLeft: "0.5rem",
                      flexShrink: 0,
                      fontSize: "0.75rem",
                      fontWeight: 400,
                      color: "var(--color-text-muted)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {rowCount}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </CollapsibleFilterPanel>

      {/* The new area's parent is whatever the tree is filtered to, matching the management
          screen's per-row *Add sub-area*; with nothing selected it is a top-level area. The
          selection is deliberately left alone afterwards — a brand-new area holds nothing, so
          jumping the filter onto it would empty the list the collector is working in. */}
      {addingArea && quickAddCollectionId && (
        <QuickAddAreaDialog
          collectionId={quickAddCollectionId}
          areas={areas}
          defaultParentId={filterAreaId ?? undefined}
          onClose={() => setAddingArea(false)}
          onCreated={() => {
            setAddingArea(false);
            // `areas` is a server-component prop on every screen that renders this panel, so this
            // is what puts the new area in the tree — see `quickAddCollectionId`.
            router.refresh();
          }}
        />
      )}
    </>
  );
}
