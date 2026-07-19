"use client";

import type { TreeNode } from "@/app/tree-picker-utils";

/** A node the {@link SelectableStampTree} can render: anything with a stable id and a
 * display name (variant items, issue members). Children come from `buildTree`. */
export type SelectableTreeItem = { id: string; name: string };

/** Single-select stamp/variant tree, shared by the "Identify variant" dialog (#100) and the
 * issue-scoped stamp picker for adding copies from the issue list (#111). Renders a recursive
 * list of selectable nodes; one node is selected at a time. */
export function SelectableStampTree<T extends SelectableTreeItem>({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: TreeNode<T>[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ol style={LIST_STYLE}>
      {nodes.map((node) => (
        <SelectableNode
          key={node.id}
          node={node}
          level={0}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </ol>
  );
}

const LIST_STYLE: React.CSSProperties = {
  display: "grid",
  gap: "0.25rem",
  margin: 0,
  padding: 0,
  listStyle: "none",
};

function SelectableNode<T extends SelectableTreeItem>({
  node,
  level,
  selectedId,
  onSelect,
}: {
  node: TreeNode<T>;
  level: number;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const isSelected = selectedId === node.id;
  return (
    <li>
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={() => onSelect(node.id)}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          minHeight: "2.25rem",
          padding: "0.5rem 0.625rem",
          marginLeft: `${level}rem`,
          borderRadius: "0.375rem",
          fontSize: "0.875rem",
          cursor: "pointer",
          color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          fontWeight: isSelected ? 600 : 400,
          background: isSelected ? "var(--color-accent-soft)" : "var(--color-bg-page)",
          border: `1px solid ${isSelected ? "var(--color-accent)" : "var(--color-border-strong)"}`,
        }}
      >
        {node.name}
      </button>
      {node.children.length > 0 && (
        <ol style={{ ...LIST_STYLE, margin: "0.25rem 0 0" }}>
          {node.children.map((child) => (
            <SelectableNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ol>
      )}
    </li>
  );
}
