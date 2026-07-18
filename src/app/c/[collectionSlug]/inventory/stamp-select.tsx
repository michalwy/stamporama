"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StampNodeData } from "@/lib/issues";
import { buildTree, type TreeNode } from "@/app/tree-picker-utils";
import {
  TreeSelectButton,
  TreeSelectPanel,
  defaultTreeSelectButtonClassName,
  useTreeSelect,
} from "@/app/tree-select";
import { useIssueSearch } from "@/app/c/[collectionSlug]/stamps/use-stamps-query";
import { useIssueMembers } from "./use-inventory-query";

// A stamp node as a tree-select item: `id`/`parentId`/`name` are what the generic
// primitive needs; `name` is the display label (catalog numbers + stamp name).
interface StampItem {
  id: string;
  parentId: string | null;
  name: string;
}

export function stampNodeLabel(node: StampNodeData): string {
  const cn = node.catalogNumbers.map((c) => c.number).join(", ");
  const parts = [cn || null, node.name || null].filter(Boolean);
  return parts.join(" · ") || "(unnamed)";
}

function toStampItems(nodes: StampNodeData[]): StampItem[] {
  return nodes.map((n) => ({
    id: n.stampId,
    parentId: n.parentId,
    name: stampNodeLabel(n),
  }));
}

function filterStampTree(
  tree: TreeNode<StampItem>[],
  query: string
): TreeNode<StampItem>[] {
  const out: TreeNode<StampItem>[] = [];
  for (const node of tree) {
    const children = filterStampTree(node.children, query);
    if (node.name.toLocaleLowerCase("en").includes(query) || children.length > 0) {
      out.push({ ...node, children });
    }
  }
  return out;
}

export interface StampSelectInitial {
  issueId: string;
  issueName: string | null;
  issueYear: number | null;
}

const INPUT_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2rem",
  width: "100%",
};

const DROPDOWN_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  zIndex: 30,
  marginTop: "0.25rem",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
  maxHeight: "12rem",
  overflowY: "auto",
};

function issueLabel(name: string | null, year: number | null): string {
  return [name ?? "(unnamed)", year ? `(${year})` : null].filter(Boolean).join(" ");
}

/** Copy stamp picker: search an issue, then pick a base stamp (unknown variant) or a
 * specific variant from that issue's stamp tree. Writes the chosen id to a hidden
 * `stampId` input for the form action. */
export function StampSelect({
  collectionId,
  selectedStampId,
  onSelectedStampIdChange,
  initial,
}: {
  collectionId: string;
  selectedStampId: string;
  onSelectedStampIdChange: (id: string) => void;
  initial?: StampSelectInitial;
}) {
  const [issue, setIssue] = useState<StampSelectInitial | null>(initial ?? null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <IssuePicker
        collectionId={collectionId}
        issue={issue}
        onPick={(next) => {
          setIssue(next.issueId ? next : null);
          onSelectedStampIdChange(""); // stamp selection is only valid within an issue
        }}
      />
      {issue && (
        <StampTreeSelect
          collectionId={collectionId}
          issueId={issue.issueId}
          selectedStampId={selectedStampId}
          onSelectedStampIdChange={onSelectedStampIdChange}
        />
      )}
      <input type="hidden" name="stampId" value={selectedStampId} />
    </div>
  );
}

function IssuePicker({
  collectionId,
  issue,
  onPick,
}: {
  collectionId: string;
  issue: StampSelectInitial | null;
  onPick: (issue: StampSelectInitial) => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: suggestions = [] } = useIssueSearch(collectionId, debouncedQuery);

  const handleInput = useCallback((value: string) => {
    setInputValue(value);
    setIsOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  }, []);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (issue) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-text-primary)",
            fontWeight: 500,
            padding: "0.25rem 0.5rem",
            background: "var(--color-bg-page)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.375rem",
          }}
        >
          {issueLabel(issue.issueName, issue.issueYear)}
        </span>
        <button
          type="button"
          onClick={() => {
            setInputValue("");
            setDebouncedQuery("");
            onPick({ issueId: "", issueName: null, issueYear: null });
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-accent)",
            fontSize: "0.75rem",
          }}
        >
          Change issue
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        type="text"
        placeholder="Search for an issue…"
        value={inputValue}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => { if (inputValue) setIsOpen(true); }}
        style={INPUT_STYLE}
      />
      {isOpen && suggestions.length > 0 && (
        <div style={DROPDOWN_STYLE}>
          {suggestions.map((s) => (
            <div
              key={s.id}
              onClick={() => {
                setIsOpen(false);
                setInputValue("");
                onPick({ issueId: s.id, issueName: s.name, issueYear: s.year });
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "var(--color-bg-page)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
              style={{
                padding: "0.375rem 0.625rem",
                fontSize: "0.8125rem",
                cursor: "pointer",
                color: "var(--color-text-primary)",
              }}
            >
              {issueLabel(s.name, s.year)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StampTreeSelect({
  collectionId,
  issueId,
  selectedStampId,
  onSelectedStampIdChange,
}: {
  collectionId: string;
  issueId: string;
  selectedStampId: string;
  onSelectedStampIdChange: (id: string) => void;
}) {
  const { data: members = [], isLoading } = useIssueMembers(collectionId, issueId);

  const items = useMemo(() => toStampItems(members), [members]);
  const tree = useMemo(() => buildTree(items), [items]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

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
  } = useTreeSelect<StampItem>({
    items,
    tree,
    selectedId: selectedStampId,
    filterTree: filterStampTree,
    onSelectedIdChange: onSelectedStampIdChange,
  });

  const handleKeyDown = buildHandleKeyDown(() => {
    if (activeId) setSelected(activeId);
  });

  const selected = byId.get(selectedStampId);
  const buttonId = "copy-stamp-button";
  const searchId = "copy-stamp-search";

  if (isLoading) {
    return (
      <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
        Loading stamps…
      </p>
    );
  }

  if (members.length === 0) {
    return (
      <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
        This issue has no stamps yet. Add stamps to it from the Issues page first.
      </p>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <TreeSelectButton
        ariaExpanded={isOpen}
        buttonClassName={defaultTreeSelectButtonClassName}
        buttonId={buttonId}
        hasSelection={Boolean(selected)}
        selectedLabel={selected ? selected.name : "Select stamp or variant…"}
        onKeyDown={handleKeyDown}
        onToggle={() => (isOpen ? setIsOpen(false) : openSelect())}
      />
      {isOpen ? (
        <TreeSelectPanel
          activeId={activeId}
          listboxAriaLabelledby={buttonId}
          panelMinWidth={320}
          panelRef={panelRef}
          panelStyle={panelStyle}
          portalTarget={portalTarget}
          searchId={searchId}
          searchLabel="Search stamps"
          searchQuery={searchQuery}
          onKeyDown={handleKeyDown}
          onSearchChange={setSearchQuery}
        >
          {visibleTree.length > 0 ? (
            <ol className="grid gap-0.5">
              {visibleTree.map((node) => (
                <StampNode
                  key={node.id}
                  node={node}
                  activeId={activeId}
                  expandedIds={effectiveExpandedIds}
                  level={0}
                  selectedId={selectedStampId}
                  onSelect={setSelected}
                  onToggleExpanded={toggleExpanded}
                />
              ))}
            </ol>
          ) : (
            <p className="px-2 py-6 text-center text-sm text-[var(--color-text-muted)]">
              No matching stamps
            </p>
          )}
        </TreeSelectPanel>
      ) : null}
    </div>
  );
}

function StampNode({
  node,
  activeId,
  expandedIds,
  level,
  selectedId,
  onSelect,
  onToggleExpanded,
}: {
  node: TreeNode<StampItem>;
  activeId: string;
  expandedIds: Set<string>;
  level: number;
  selectedId: string;
  onSelect: (id: string) => void;
  onToggleExpanded: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const isActive = activeId === node.id;
  // A base stamp (top level) that has variants can itself be picked as "unknown variant".
  const isBaseWithVariants = level === 0 && hasChildren;

  return (
    <li>
      <div
        className="grid min-h-9 grid-cols-[1.75rem_1fr] items-center rounded-md"
        style={{ paddingLeft: `${level}rem` }}
      >
        {hasChildren ? (
          <button
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.name}`}
            className="grid h-7 w-7 place-items-center rounded text-[var(--color-text-muted)] transition hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring-strong)]"
            type="button"
            onClick={() => onToggleExpanded(node.id)}
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
          onClick={() => onSelect(node.id)}
        >
          <span className="block truncate">
            {node.name}
            {isBaseWithVariants ? (
              <span className="text-[var(--color-text-muted)]"> — unknown variant</span>
            ) : null}
          </span>
        </button>
      </div>
      {hasChildren && isExpanded ? (
        <ol className="mt-0.5 grid gap-0.5">
          {node.children.map((child) => (
            <StampNode
              key={child.id}
              node={child}
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
