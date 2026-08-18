// Narrowing an issue's stamp tree — to some of its checklists (#531; ADR-0031), or to the stamps
// an active list filter matched (#631). Pure and generic over the node shape, so the tree type
// stays where the renderers define it (`issue-view.tsx`) while the rule that decides what survives
// is testable on its own.
//
// One rule serves both, because both answer the same question about a *tree*: a variant is read
// through its ancestors, so a node whose descendant survives survives with it — as **context**,
// which is scaffolding rather than an answer. What a surface does with that scaffolding is its own
// decision: the picker fades it (#186), the Issues list and the issue detail page draw it plainly
// muted, and nothing pretends it is part of the set.

/** The children a tree node hangs onto. The rest of the node is whatever the caller's type is. */
export interface StampTreeLike<T extends StampTreeLike<T>> {
  node: { stampId: string };
  children: T[];
}

/** The shape the checklist filter needs: which checklists the stamp is on, and its children. */
export interface ChecklistTreeNode<T extends ChecklistTreeNode<T>> {
  node: { stampId: string; checklistIds: string[] };
  children: T[];
}

/** A narrowed tree, plus which nodes survived only as context. */
export interface FilteredStampTree<T> {
  tree: T[];
  /** Stamps kept only because a descendant matched — drawn as context, never as members of the set. */
  contextIds: Set<string>;
}

/**
 * Narrow a stamp tree to the nodes `matches` accepts, keeping every ancestor of a survivor.
 *
 * A node whose **descendant** matches is kept even when it does not match itself, because a variant
 * tree is read through its ancestors: `309AP` on its own is a number nobody can place, and dropping
 * `309` to shorten the list is exactly what makes the remainder unreadable. Those ancestors come
 * back in `contextIds` so the caller can mark them — they are scaffolding, not part of the set.
 */
export function filterStampTree<T extends StampTreeLike<T>>(
  tree: T[],
  matches: (node: T) => boolean
): FilteredStampTree<T> {
  const contextIds = new Set<string>();

  function visit(node: T): T | null {
    const children = node.children.map(visit).filter((c): c is T => c !== null);
    const hit = matches(node);
    if (!hit && children.length === 0) return null;
    if (!hit) contextIds.add(node.node.stampId);
    // Rebuilt rather than mutated: the caller's tree is shared with the unfiltered render.
    return { ...node, children };
  }

  return {
    tree: tree.map(visit).filter((n): n is T => n !== null),
    contextIds,
  };
}

/**
 * Narrow a stamp tree to the stamps on `selectedChecklistIds`. An empty selection is the absence of
 * a filter, not an empty set, and returns the tree untouched — the same reading `MultiSelectFilter`
 * gives an empty selection (#425).
 */
export function filterStampTreeByChecklists<T extends ChecklistTreeNode<T>>(
  tree: T[],
  selectedChecklistIds: string[]
): FilteredStampTree<T> {
  if (selectedChecklistIds.length === 0) return { tree, contextIds: new Set() };
  const selected = new Set(selectedChecklistIds);
  return filterStampTree(tree, (n) => n.node.checklistIds.some((id) => selected.has(id)));
}

/**
 * Both narrowings at once, as the Issues list applies them: the checklist selection and the filter
 * match are independent questions, and a tree under both must satisfy both.
 *
 * Composing the two calls would be wrong — the first pass's *context* ancestors would go into the
 * second pass as ordinary survivors and could keep a branch the filter never matched. So the
 * predicate is combined and the tree walked once, which also leaves one `contextIds` set that
 * really does mean "kept only for a descendant".
 *
 * A null `matchedStampIds` is the absence of a filter and narrows nothing, exactly as an empty
 * checklist selection does; {@link matchedStampsInIssue} returns null for that case on purpose.
 *
 * The match narrowing **hides**, it does not fade (#631). #186 settled the same question the other
 * way for the picker, where a tree is a chooser and a stamp you were about to pick going missing is
 * worse than one drawn faintly. On the Issues list it is a catalogue being read: an Infla tree runs
 * to dozens of variants, and a page of grey around three matches is a page nobody can scan.
 */
export function filterStampTreeBy<T extends ChecklistTreeNode<T>>(
  tree: T[],
  selectedChecklistIds: string[],
  matchedStampIds: ReadonlySet<string> | null
): FilteredStampTree<T> {
  if (selectedChecklistIds.length === 0 && !matchedStampIds) {
    return { tree, contextIds: new Set() };
  }
  const selected = new Set(selectedChecklistIds);
  return filterStampTree(
    tree,
    (n) =>
      (selected.size === 0 || n.node.checklistIds.some((id) => selected.has(id))) &&
      (!matchedStampIds || matchedStampIds.has(n.node.stampId))
  );
}
