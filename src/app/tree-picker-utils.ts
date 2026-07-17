import type { CSSProperties } from "react";

export type TreeNode<T> = T & { children: TreeNode<T>[] };

export function buildTree<T extends { id: string; parentId: string | null; name: string }>(
  items: T[]
): TreeNode<T>[] {
  const nodesById = new Map<string, TreeNode<T>>();

  for (const item of items) {
    nodesById.set(item.id, { ...item, children: [] });
  }

  const roots: TreeNode<T>[] = [];

  for (const item of items) {
    const node = nodesById.get(item.id);

    if (!node) {
      continue;
    }

    const parent = item.parentId ? nodesById.get(item.parentId) : undefined;

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortTree(roots);

  return roots;
}

function sortTree<T extends { name: string }>(nodes: TreeNode<T>[]) {
  nodes.sort((left, right) =>
    left.name.localeCompare(right.name, "en", { sensitivity: "base" })
  );

  for (const node of nodes) {
    sortTree(node.children);
  }
}

export function getAncestorIds<T extends { id: string; parentId: string | null }>(
  items: T[],
  targetId: string
): Set<string> {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const ancestorIds = new Set<string>();
  let current = itemsById.get(targetId);

  while (current?.parentId) {
    ancestorIds.add(current.parentId);
    current = itemsById.get(current.parentId);
  }

  return ancestorIds;
}

export function getExpandableIds<T extends { id: string }>(tree: TreeNode<T>[]): Set<string> {
  const expandableIds = new Set<string>();

  for (const node of tree) {
    if (node.children.length > 0) {
      expandableIds.add(node.id);
    }

    for (const childId of getExpandableIds(node.children)) {
      expandableIds.add(childId);
    }
  }

  return expandableIds;
}

export function getVisibleOptions<T extends { id: string }>(
  tree: TreeNode<T>[],
  expandedIds: Set<string>
): TreeNode<T>[] {
  const visible: TreeNode<T>[] = [];

  for (const node of tree) {
    visible.push(node);

    if (expandedIds.has(node.id)) {
      visible.push(...getVisibleOptions(node.children, expandedIds));
    }
  }

  return visible;
}

export function getFloatingPanelStyle(
  anchor: HTMLElement | null
): CSSProperties | null {
  if (!anchor) {
    return null;
  }

  const viewportPadding = 16;
  const gap = 4;
  const minimumHeight = 220;
  const rect = anchor.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
  const spaceAbove = rect.top - viewportPadding - gap;
  const opensDown = spaceBelow >= minimumHeight || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(160, Math.floor(opensDown ? spaceBelow : spaceAbove));

  return {
    left: rect.left,
    width: rect.width,
    maxHeight,
    ...(opensDown
      ? { top: rect.bottom + gap }
      : { bottom: window.innerHeight - rect.top + gap })
  };
}
