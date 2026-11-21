// An issue's stamps as branches, one per checklist (#1520) — the Issues list's tree mode, and the
// set a branch's actions reach. Pure and generic over the node shape, as `stamp-tree-filter.ts` is,
// so the rule is unit-tested without React or Prisma.
//
// A branch is the **checklist filter's own narrowing** (#772) with that one checklist selected: the
// checklist's stamps, with an ancestor kept as dimmed context where a listed variant hangs under a
// stamp the checklist does not list, and every variant below a listed stamp kept as dimmed context
// where the checklist does not list it (#2655). So a branch and the flat tree narrowed by the same
// chip can never disagree about which stamps belong to it. A stamp on two checklists is under both
// branches.

import {
  filterStampTree,
  filterStampTreeBy,
  type ChecklistTreeNode,
  type FilteredStampTree,
} from "./stamp-tree-filter";

export interface ChecklistBranch<T> extends FilteredStampTree<T> {
  /** The checklist, or null for the stamps on none of the issue's checklists. */
  checklistId: string | null;
}

/**
 * One branch per checklist, in the issue's order, then the stamps on none of them — that last only
 * when there are any, since an issue whose every stamp is on a checklist has nothing to put there.
 * A stamp on none that hangs below a listed stamp is not one of those: it is already drawn, dimmed,
 * under that stamp in the listed stamp's branch (#2655), and is not repeated.
 *
 * `matchedStampIds` is the list filter's stamp narrowing (#631), applied inside each branch exactly
 * as it is to the flat tree. A branch it empties is still returned; whether to draw an empty branch
 * is the caller's decision.
 *
 * Only for an issue with more than one checklist: with one, the stamps are listed straight under
 * the issue in both modes, and the caller does not ask.
 */
export function checklistBranches<T extends ChecklistTreeNode<T>>(
  tree: T[],
  checklists: readonly { id: string }[],
  matchedStampIds: ReadonlySet<string> | null
): ChecklistBranch<T>[] {
  const branches: ChecklistBranch<T>[] = checklists.map((c) => ({
    checklistId: c.id,
    ...filterStampTreeBy(tree, [c.id], matchedStampIds),
  }));
  const off = offChecklistIds(tree);
  if (off.size > 0) {
    branches.push({
      checklistId: null,
      ...filterStampTree(
        tree,
        (n) =>
          off.has(n.node.stampId) && (!matchedStampIds || matchedStampIds.has(n.node.stampId))
      ),
    });
  }
  return branches;
}

/** How many stamps the *Not on a checklist* branch holds — its heading's count. */
export function countOffChecklist<T extends ChecklistTreeNode<T>>(tree: T[]): number {
  return offChecklistIds(tree).size;
}

/**
 * The stamps that belong under *Not on a checklist*: on no checklist themselves, and with no
 * ancestor on one either — a variant below a listed stamp is drawn under that stamp's branch.
 */
function offChecklistIds<T extends ChecklistTreeNode<T>>(tree: T[]): Set<string> {
  const out = new Set<string>();
  const visit = (node: T) => {
    if (node.node.checklistIds.length > 0) return;
    out.add(node.node.stampId);
    node.children.forEach(visit);
  };
  tree.forEach(visit);
  return out;
}

/**
 * The stamps a checklist's actions reach in an issue (#1520): the ones it lists, and every ancestor
 * of one within the issue — the branch's own rows, so a grid opened from a branch draws what the
 * branch draws. An ancestor is there for the tree to hang together (`309AP` without its `309` is a
 * number nobody can place); a grid row is no harder to leave alone than a dimmed tree row.
 */
export function withIssueAncestors(
  members: readonly { stampId: string; parentId: string | null }[],
  listed: ReadonlySet<string>
): Set<string> {
  const parentOf = new Map(members.map((m) => [m.stampId, m.parentId]));
  const out = new Set<string>();
  for (const stampId of listed) {
    if (!parentOf.has(stampId)) continue;
    let at: string | null | undefined = stampId;
    // Bounded by the member count, so a cycle in bad data cannot hang the walk.
    for (let guard = 0; at && parentOf.has(at) && !out.has(at) && guard <= members.length; guard++) {
      out.add(at);
      at = parentOf.get(at);
    }
  }
  return out;
}
