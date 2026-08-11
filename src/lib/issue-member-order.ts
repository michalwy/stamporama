// Manual ordering of the stamps in an issue (#549) — the pure half.
//
// A reorder request names **one sibling group**, in its new order: the issue's root stamps, or one
// parent's variant children. This is what decides whether the request is one, and what each of its
// members' new `IssueMember.sortOrder` should be.

/** The shape a member has to be in for these rules — nothing about prices, names or checklists. */
export interface OrderableMember {
  stampId: string;
  /** The stamp's own `parentId`, whatever it is. Whether that parent is a *member* is this
   *  module's business, not the caller's. */
  parentId: string | null;
}

/**
 * The parent a member is filed under **in the tree** — which is not always its `parentId`.
 *
 * `buildStampTree` makes a root of any member whose parent is absent from the issue (a variant
 * whose base belongs to some other issue still has to show somewhere), and the order has to agree
 * with the tree it is ordering, or a drag would be validated against a grouping nobody can see.
 */
export function effectiveParentId(
  member: OrderableMember,
  memberIds: ReadonlySet<string>
): string | null {
  return member.parentId && memberIds.has(member.parentId) ? member.parentId : null;
}

/** Every member filed under `parentId` in the tree, in the order given. */
export function siblingsOf(
  members: readonly OrderableMember[],
  parentId: string | null
): OrderableMember[] {
  const ids = new Set(members.map((m) => m.stampId));
  return members.filter((m) => effectiveParentId(m, ids) === parentId);
}

export type SiblingGroupCheck =
  | { ok: true; parentId: string | null }
  | { ok: false; reason: string };

/**
 * Whether `orderedStampIds` is exactly one **complete** sibling group of `members`, permuted.
 *
 * Complete matters: the tree can be narrowed by the checklist filter, and a drag inside a narrowed
 * tree would move a stamp past a sibling that is not on screen. The reorder UI clears that filter
 * for exactly this reason — this is the check that makes the rule hold whatever reaches the server.
 */
export function checkSiblingGroup(
  members: readonly OrderableMember[],
  orderedStampIds: readonly string[]
): SiblingGroupCheck {
  if (orderedStampIds.length === 0) return { ok: false, reason: "The order is empty." };

  const byId = new Map(members.map((m) => [m.stampId, m]));
  const memberIds = new Set(byId.keys());

  const seen = new Set<string>();
  let parentId: string | null = null;
  for (const [i, stampId] of orderedStampIds.entries()) {
    const member = byId.get(stampId);
    if (!member) return { ok: false, reason: "A stamp in the order is not in this issue." };
    if (seen.has(stampId)) return { ok: false, reason: "The order repeats a stamp." };
    seen.add(stampId);
    const p = effectiveParentId(member, memberIds);
    if (i === 0) parentId = p;
    else if (p !== parentId) {
      return { ok: false, reason: "The order mixes stamps from different levels of the tree." };
    }
  }

  const group = siblingsOf(members, parentId);
  if (group.length !== orderedStampIds.length) {
    return { ok: false, reason: "The order leaves out some of the stamps at this level." };
  }
  return { ok: true, parentId };
}

/**
 * The new positions, one per member of the group.
 *
 * A dense `0..n-1` over **this group only**. Values are read within a sibling group and never
 * across two, so renumbering one group cannot disturb another — and a dense sequence is what keeps
 * the numbers small enough that appending at `max + 1` stays meaningful.
 */
export function sortOrderAssignments(
  orderedStampIds: readonly string[]
): { stampId: string; sortOrder: number }[] {
  return orderedStampIds.map((stampId, i) => ({ stampId, sortOrder: i }));
}

/** Move one element of a list, the way a drop does: `to` is the index it ends up at. */
export function moveInOrder<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
