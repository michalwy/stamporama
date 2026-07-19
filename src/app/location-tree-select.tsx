"use client";

import type { LocationData } from "@/lib/locations";
import { buildTree, type TreeNode } from "@/app/tree-picker-utils";
import {
  TREE_SELECT_NONE_ID,
  TreeSelectButton,
  TreeSelectPanel,
  defaultTreeSelectButtonClassName,
  useTreeSelect,
} from "@/app/tree-select";

export type LocationTreeItem = TreeNode<LocationData>;

export function buildLocationTree(locations: LocationData[]): LocationTreeItem[] {
  return buildTree(locations);
}

export function filterLocationTree(
  locations: LocationTreeItem[],
  normalizedSearchQuery: string
): LocationTreeItem[] {
  const filtered: LocationTreeItem[] = [];

  for (const location of locations) {
    const children = filterLocationTree(location.children, normalizedSearchQuery);
    const matches = location.name
      .toLocaleLowerCase("en")
      .includes(normalizedSearchQuery);

    if (matches || children.length > 0) {
      filtered.push({ ...location, children });
    }
  }

  return filtered;
}

function getLocationPath(locations: LocationData[], locationId: string): string {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const path: string[] = [];
  let current = byId.get(locationId);

  while (current) {
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return path.join(" › ");
}

/**
 * Tree-select over storage locations (#56), mirroring {@link AreaTreeSelect}. When
 * `onlyAssignableSelectable` is set (the copy-assignment case) grouping-only nodes
 * (`assignable = false`) are shown for context and can be expanded, but cannot be
 * chosen — only leaf storage that can hold copies is selectable. The filter case
 * leaves every node selectable (a subtree filter).
 */
export function LocationTreeSelect({
  locations,
  locationTree,
  name,
  selectedId,
  onSelectedIdChange,
  disabled,
  onlyAssignableSelectable = false,
  noneOptionLabel = "— None",
  buttonClassName = defaultTreeSelectButtonClassName,
}: {
  locations: LocationData[];
  locationTree: LocationTreeItem[];
  name: string;
  selectedId: string;
  onSelectedIdChange: (id: string) => void;
  disabled?: boolean;
  onlyAssignableSelectable?: boolean;
  noneOptionLabel?: string;
  /** Override the trigger button class, e.g. to match a taller input row. */
  buttonClassName?: string;
}) {
  const buttonId = `${name}-button`;
  const searchId = `${name}-search`;
  const selectedLocation = locations.find((l) => l.id === selectedId);

  const {
    containerRef,
    panelRef,
    isOpen,
    setIsOpen,
    searchQuery,
    setSearchQuery,
    panelStyle,
    portalTarget,
    activeId,
    visibleTree,
    effectiveExpandedIds,
    openSelect,
    setSelected,
    toggleExpanded,
    buildHandleKeyDown,
  } = useTreeSelect({
    items: locations,
    tree: locationTree,
    selectedId,
    filterTree: filterLocationTree,
    onSelectedIdChange,
    noneOptionLabel,
  });

  function isSelectable(id: string): boolean {
    if (!onlyAssignableSelectable) return true;
    return locations.find((l) => l.id === id)?.assignable ?? false;
  }

  function commitActive() {
    if (activeId === TREE_SELECT_NONE_ID || activeId === "") {
      setSelected("");
      return;
    }
    // Ignore Enter on a grouping-only node in assignment mode.
    if (isSelectable(activeId)) setSelected(activeId);
  }

  const handleKeyDown = buildHandleKeyDown(commitActive);

  const triggerLabel = selectedLocation
    ? getLocationPath(locations, selectedLocation.id)
    : noneOptionLabel;
  const hasSelection = Boolean(selectedLocation);

  return (
    <div ref={containerRef} className="relative w-full">
      <input type="hidden" name={name} value={selectedId} />
      <TreeSelectButton
        ariaExpanded={isOpen}
        buttonClassName={buttonClassName}
        buttonId={buttonId}
        disabled={disabled}
        hasSelection={hasSelection}
        selectedLabel={triggerLabel}
        onKeyDown={handleKeyDown}
        onToggle={() => (isOpen ? setIsOpen(false) : openSelect())}
      />
      {isOpen ? (
        <TreeSelectPanel
          activeId={activeId}
          listboxAriaLabelledby={buttonId}
          noneOptionLabel={noneOptionLabel}
          panelMinWidth={280}
          panelRef={panelRef}
          panelStyle={panelStyle}
          portalTarget={portalTarget}
          searchId={searchId}
          searchLabel="Search locations"
          searchQuery={searchQuery}
          onKeyDown={handleKeyDown}
          onNoneSelect={() => setSelected("")}
          onSearchChange={setSearchQuery}
        >
          {visibleTree.length > 0 ? (
            <ol className="grid gap-0.5">
              {visibleTree.map((location) => (
                <LocationTreeSelectNode
                  key={location.id}
                  location={location}
                  activeId={activeId}
                  expandedIds={effectiveExpandedIds}
                  level={0}
                  selectedId={selectedId}
                  selectable={isSelectable(location.id)}
                  onlyAssignableSelectable={onlyAssignableSelectable}
                  onSelect={setSelected}
                  onToggleExpanded={toggleExpanded}
                />
              ))}
            </ol>
          ) : (
            <p className="px-2 py-6 text-center text-sm text-[var(--color-text-muted)]">
              No matching locations
            </p>
          )}
        </TreeSelectPanel>
      ) : null}
    </div>
  );
}

function LocationTreeSelectNode({
  location,
  activeId,
  expandedIds,
  level,
  selectedId,
  selectable,
  onlyAssignableSelectable,
  onSelect,
  onToggleExpanded,
}: {
  location: LocationTreeItem;
  activeId: string;
  expandedIds: Set<string>;
  level: number;
  selectedId: string;
  selectable: boolean;
  onlyAssignableSelectable: boolean;
  onSelect: (id: string) => void;
  onToggleExpanded: (id: string) => void;
}) {
  const hasChildren = location.children.length > 0;
  const isExpanded = expandedIds.has(location.id);
  const isSelected = selectedId === location.id;
  const isActive = activeId === location.id;

  return (
    <li>
      <div
        className="grid min-h-9 grid-cols-[1.75rem_1fr] items-center rounded-md"
        style={{ paddingLeft: `${level}rem` }}
      >
        {hasChildren ? (
          <button
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${location.name}`}
            className="grid h-7 w-7 place-items-center rounded text-[var(--color-text-muted)] transition hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring-strong)]"
            type="button"
            onClick={() => onToggleExpanded(location.id)}
          >
            <span
              aria-hidden="true"
              className={`text-xs leading-none transition-transform ${isExpanded ? "rotate-90" : ""}`}
            >
              ▶
            </span>
          </button>
        ) : (
          <span />
        )}
        {selectable ? (
          <button
            aria-selected={isSelected}
            className={`min-h-9 w-full rounded-md px-2 py-1.5 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-[var(--color-ring-strong)] ${
              isActive
                ? "bg-[var(--color-accent-soft)] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-accent-soft)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
            }`}
            role="option"
            type="button"
            onClick={() => onSelect(location.id)}
          >
            <span className="block truncate">{location.name}</span>
          </button>
        ) : (
          // Grouping-only node in assignment mode: a non-selectable header. Clicking
          // it toggles expansion so the user can drill into its assignable children.
          <button
            className="min-h-9 w-full cursor-default rounded-md px-2 py-1.5 text-left text-sm font-medium text-[var(--color-text-muted)] transition"
            type="button"
            title="Grouping location — pick an assignable child"
            onClick={() => hasChildren && onToggleExpanded(location.id)}
          >
            <span className="block truncate">{location.name}</span>
          </button>
        )}
      </div>
      {hasChildren && isExpanded ? (
        <ol className="mt-0.5 grid gap-0.5">
          {location.children.map((child) => (
            <LocationTreeSelectNode
              key={child.id}
              location={child}
              activeId={activeId}
              expandedIds={expandedIds}
              level={level + 1}
              selectedId={selectedId}
              selectable={!onlyAssignableSelectable || child.assignable}
              onlyAssignableSelectable={onlyAssignableSelectable}
              onSelect={onSelect}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}
