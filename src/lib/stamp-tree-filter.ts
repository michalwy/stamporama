// Narrowing an issue's stamp tree to some of its checklists (#531; ADR-0031). Pure and generic
// over the node shape, so the tree type stays where the renderers define it (`issue-view.tsx`)
// while the rule that decides what survives is testable on its own.

/** The shape this needs of a tree node: which checklists the stamp is on, and its children. */
export interface ChecklistTreeNode<T extends ChecklistTreeNode<T>> {
  node: { stampId: string; checklistIds: string[] };
  children: T[];
}

/** A narrowed tree, plus which nodes survived only as context. */
export interface FilteredStampTree<T> {
  tree: T[];
  /** Stamps kept only because a descendant matched — drawn dimmed, never as members of the set. */
  contextIds: Set<string>;
}

/**
 * Narrow a stamp tree to the stamps on `selectedChecklistIds`. An empty selection is the absence of
 * a filter, not an empty set, and returns the tree untouched — the same reading `MultiSelectFilter`
 * gives an empty selection (#425).
 *
 * A node whose **descendant** matches is kept even when it does not match itself, because a variant
 * tree is read through its ancestors: `309AP` on its own is a number nobody can place, and dropping
 * `309` to shorten the list is exactly what makes the remainder unreadable. Those ancestors come
 * back in `contextIds` so the caller can dim them — they are scaffolding, not part of the set.
 */
export function filterStampTreeByChecklists<T extends ChecklistTreeNode<T>>(
  tree: T[],
  selectedChecklistIds: string[]
): FilteredStampTree<T> {
  if (selectedChecklistIds.length === 0) return { tree, contextIds: new Set() };
  const selected = new Set(selectedChecklistIds);
  const contextIds = new Set<string>();

  function visit(node: T): T | null {
    const children = node.children.map(visit).filter((c): c is T => c !== null);
    const matches = node.node.checklistIds.some((id) => selected.has(id));
    if (!matches && children.length === 0) return null;
    if (!matches) contextIds.add(node.node.stampId);
    // Rebuilt rather than mutated: the caller's tree is shared with the unfiltered render.
    return { ...node, children };
  }

  return {
    tree: tree.map(visit).filter((n): n is T => n !== null),
    contextIds,
  };
}
