import type { CSSProperties } from "react";
import { placeAnchored } from "./anchored-placement";

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
  // Honor a custom sibling `sortOrder` when the items carry one (#78, collection areas);
  // ties — and item types without it (e.g. locations) — fall back to alphabetical name.
  nodes.sort((left, right) => {
    const leftOrder = (left as { sortOrder?: number }).sortOrder;
    const rightOrder = (right as { sortOrder?: number }).sortOrder;
    if (leftOrder !== undefined && rightOrder !== undefined && leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
  });

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
  anchor: HTMLElement | null,
  minWidth = 0
): CSSProperties | null {
  if (!anchor) {
    return null;
  }

  // The panel's height is not known before it is drawn, so it asks for a usable minimum and takes
  // the room on whichever side it opens to; inside that room it is never cut off (#1765). Hung by its
  // bottom edge when it opens upwards, so a panel shorter than the room still meets its trigger.
  const gap = 4;
  const minimumHeight = 220;
  const rect = anchor.getBoundingClientRect();
  const placement = placeAnchored({
    anchor: rect,
    size: { width: Math.max(rect.width, minWidth), height: minimumHeight },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    gap,
    margin: 16
  });
  const opensDown = placement.top >= rect.bottom;

  return {
    left: placement.left,
    width: rect.width,
    maxHeight: Math.floor(placement.maxHeight),
    maxWidth: placement.maxWidth,
    ...(opensDown
      ? { top: placement.top }
      : { bottom: window.innerHeight - rect.top + gap })
  };
}
