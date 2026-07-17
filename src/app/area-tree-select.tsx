"use client";

import type { CollectionAreaData } from "@/lib/areas";
import { buildTree, type TreeNode } from "@/app/tree-picker-utils";
import {
  TREE_SELECT_NONE_ID,
  TreeSelectButton,
  TreeSelectPanel,
  defaultTreeSelectButtonClassName,
  useTreeSelect,
} from "@/app/tree-select";

export type AreaTreeItem = TreeNode<CollectionAreaData>;

export function buildAreaTree(areas: CollectionAreaData[]): AreaTreeItem[] {
  return buildTree(areas);
}

export function filterAreaTree(
  areas: AreaTreeItem[],
  normalizedSearchQuery: string
): AreaTreeItem[] {
  const filtered: AreaTreeItem[] = [];

  for (const area of areas) {
    const children = filterAreaTree(area.children, normalizedSearchQuery);
    const matches = area.name.toLocaleLowerCase("en").includes(normalizedSearchQuery);

    if (matches || children.length > 0) {
      filtered.push({ ...area, children });
    }
  }

  return filtered;
}

function getAreaPath(areas: CollectionAreaData[], areaId: string): string {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const path: string[] = [];
  let current = byId.get(areaId);

  while (current) {
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return path.join(" › ");
}

export function AreaTreeSelect({
  areas,
  areaTree,
  name,
  selectedId,
  onSelectedIdChange,
  disabled,
  noneOptionLabel = "— None (top-level)",
}: {
  areas: CollectionAreaData[];
  areaTree: AreaTreeItem[];
  name: string;
  selectedId: string;
  onSelectedIdChange: (id: string) => void;
  disabled?: boolean;
  noneOptionLabel?: string;
}) {
  const buttonId = `${name}-button`;
  const searchId = `${name}-search`;
  const selectedArea = areas.find((a) => a.id === selectedId);

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
    items: areas,
    tree: areaTree,
    selectedId,
    filterTree: filterAreaTree,
    onSelectedIdChange,
    noneOptionLabel,
  });

  function commitActive() {
    if (activeId === TREE_SELECT_NONE_ID || activeId === "") {
      setSelected("");
      return;
    }
    setSelected(activeId);
  }

  const handleKeyDown = buildHandleKeyDown(commitActive);

  const triggerLabel = selectedArea
    ? getAreaPath(areas, selectedArea.id)
    : noneOptionLabel;
  const hasSelection = Boolean(selectedArea);

  return (
    <div ref={containerRef} className="relative w-full">
      <input type="hidden" name={name} value={selectedId} />
      <TreeSelectButton
        ariaExpanded={isOpen}
        buttonClassName={defaultTreeSelectButtonClassName}
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
          searchLabel="Search areas"
          searchQuery={searchQuery}
          onKeyDown={handleKeyDown}
          onNoneSelect={() => setSelected("")}
          onSearchChange={setSearchQuery}
        >
          {visibleTree.length > 0 ? (
            <ol className="grid gap-0.5">
              {visibleTree.map((area) => (
                <AreaTreeSelectNode
                  key={area.id}
                  area={area}
                  activeId={activeId}
                  expandedIds={effectiveExpandedIds}
                  level={0}
                  selectedId={selectedId}
                  onSelect={setSelected}
                  onToggleExpanded={toggleExpanded}
                />
              ))}
            </ol>
          ) : (
            <p className="px-2 py-6 text-center text-sm text-[var(--color-text-muted)]">
              No matching areas
            </p>
          )}
        </TreeSelectPanel>
      ) : null}
    </div>
  );
}

function AreaTreeSelectNode({
  area,
  activeId,
  expandedIds,
  level,
  selectedId,
  onSelect,
  onToggleExpanded,
}: {
  area: AreaTreeItem;
  activeId: string;
  expandedIds: Set<string>;
  level: number;
  selectedId: string;
  onSelect: (id: string) => void;
  onToggleExpanded: (id: string) => void;
}) {
  const hasChildren = area.children.length > 0;
  const isExpanded = expandedIds.has(area.id);
  const isSelected = selectedId === area.id;
  const isActive = activeId === area.id;

  return (
    <li>
      <div
        className="grid min-h-9 grid-cols-[1.75rem_1fr] items-center rounded-md"
        style={{ paddingLeft: `${level}rem` }}
      >
        {hasChildren ? (
          <button
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${area.name}`}
            className="grid h-7 w-7 place-items-center rounded text-[var(--color-text-muted)] transition hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring-strong)]"
            type="button"
            onClick={() => onToggleExpanded(area.id)}
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
        <button
          aria-selected={isSelected}
          className={`min-h-9 w-full rounded-md px-2 py-1.5 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-[var(--color-ring-strong)] ${
            isActive
              ? "bg-[var(--color-accent-soft)] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-accent-soft)]"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
          }`}
          role="option"
          type="button"
          onClick={() => onSelect(area.id)}
        >
          <span className="block truncate">{area.name}</span>
        </button>
      </div>
      {hasChildren && isExpanded ? (
        <ol className="mt-0.5 grid gap-0.5">
          {area.children.map((child) => (
            <AreaTreeSelectNode
              key={child.id}
              area={child}
              activeId={activeId}
              expandedIds={expandedIds}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggleExpanded={onToggleExpanded}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}
