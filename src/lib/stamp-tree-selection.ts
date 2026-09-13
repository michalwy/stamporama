// Multi-select on the Issues list's stamp tree (#808) — the pure half: what a tick reaches, which
// rows it carries with it, and how the bar says so.
//
// ## A ticked stamp carries its whole subtree
//
// Ticking `309` selects `309`, `309A`, `309AP`, `309APa` and a plate flaw filed under `309` — every
// descendant at any depth, variant or distinct entry alike. That is ADR-0048 §7's rule for a preset
// write, adopted by the selection rather than answered differently, because the selection's first
// consumer (#809) *is* that write: a bar saying *3 stamps* over a write reaching twelve would be the
// count shown and the count written disagreeing, which §4 names as the thing to avoid. A later
// consumer that wants a parent without its children is asking a different question and should say
// so on its own button, not by changing what a tick means here.
//
// The rows a tick carries are drawn ticked and locked, so the rule is visible where it acts rather
// than only in a sentence; and the bar says the reach in words when it is larger than the ticks.
//
// ## Ticked, in view, still existing
//
// `ui-patterns.md`'s three sets, unchanged: what is **ticked** outlives every filter; what is **in
// view** — the ticks the current filter set is drawing — is what the bar counts and an action is
// handed; what still **exists** is the only one computed over the unfiltered data, and it is the
// only thing that ever prunes a tick. The reach is computed from the ticks **in view** only: a
// hidden tick acts on nothing, so its subtree reaches nothing either.
//
// The descendant map comes from the server (`getStampSelectionSubtrees`) because the client cannot
// see all of it — a variant whose base belongs to another issue is drawn as a root of *its* issue,
// and the base's tree never shows it — and the write walks the same edges with the same query.

/** For each ticked stamp that exists, every stamp below it at any depth. */
export type StampSubtrees = Readonly<Record<string, readonly string[]>>;

/** The server's answer for one set of ticks: which of the ids it was asked about still exist, and
 *  what each of those carries. `asked` is kept beside it so a tick made after the question is never
 *  mistaken for one the server reported gone. */
export interface StampSelectionAnswer {
  asked: readonly string[];
  existingIds: readonly string[];
  subtrees: StampSubtrees;
}

/** The tree shape this needs — `buildStampTree`'s nodes, and anything narrowed from them. */
export interface StampSelectionTreeNode<T extends StampSelectionTreeNode<T>> {
  node: { stampId: string };
  children: T[];
}

/** Every stamp a (possibly narrowed) tree is drawing, in tree order — what an issue row reports as
 *  in view. Collapsed nodes count: a fold is a way of reading rows the screen already has, not a
 *  filter (`ui-patterns.md`). */
export function stampIdsInTree<T extends StampSelectionTreeNode<T>>(tree: readonly T[]): string[] {
  const ids: string[] = [];
  const visit = (n: T) => {
    ids.push(n.node.stampId);
    for (const c of n.children) visit(c);
  };
  for (const n of tree) visit(n);
  return ids;
}

/** The stamps below `stampId` among one issue's members, at any depth. What a tick on a parent
 *  absorbs on the spot, before the server has been asked. */
export function descendantsAmongMembers(
  members: readonly { stampId: string; parentId: string | null }[],
  stampId: string
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const m of members) {
    if (!m.parentId) continue;
    const list = childrenOf.get(m.parentId);
    if (list) list.push(m.stampId);
    else childrenOf.set(m.parentId, [m.stampId]);
  }
  const out: string[] = [];
  const seen = new Set<string>([stampId]);
  const stack = [...(childrenOf.get(stampId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

/**
 * Ticking or unticking one stamp.
 *
 * **Ticking a parent absorbs ticks already standing below it** (`absorbed`), so the subtree has one
 * tick rather than several: otherwise unticking the parent would leave a child ticked that the
 * collector last saw drawn as *carried*, and the branch would not clear with the click that
 * visibly cleared it. Unticking touches only the stamp itself.
 */
export function toggleStampTick(
  ticked: ReadonlySet<string>,
  stampId: string,
  absorbed: readonly string[]
): Set<string> {
  const next = new Set(ticked);
  if (next.has(stampId)) {
    next.delete(stampId);
    return next;
  }
  for (const id of absorbed) next.delete(id);
  next.add(stampId);
  return next;
}

/**
 * The ticks that still exist. A tick is dropped only when the server was **asked about it** and did
 * not find it — a stamp deleted, or taken out of the collection by a merge. Never narrowed by what
 * is in view: pruning is about existence, and narrowing it to the filter would delete a selection
 * because a filter changed (`ui-patterns.md`, #853).
 */
export function existingTicks(
  ticked: readonly string[],
  answer: StampSelectionAnswer | undefined
): string[] {
  if (!answer) return [...ticked];
  const asked = new Set(answer.asked);
  const existing = new Set(answer.existingIds);
  return ticked.filter((id) => !asked.has(id) || existing.has(id));
}

/**
 * Every stamp the in-view ticks reach: themselves, and everything below each of them. Null while the
 * server has not answered for one of them — the bar then says only what is ticked, rather than a
 * reach it has half of.
 */
export function selectionReach(
  tickedInView: readonly string[],
  subtrees: StampSubtrees | undefined
): Set<string> | null {
  if (!subtrees) return null;
  const reach = new Set<string>();
  for (const id of tickedInView) {
    const below = subtrees[id];
    if (!below) return null;
    reach.add(id);
    for (const d of below) reach.add(d);
  }
  return reach;
}

/** The stamps carried by an in-view tick above them — drawn ticked and locked. A stamp that is
 *  ticked itself and also below another tick is carried: the upper tick is the one that acts. */
export function carriedByTick(
  tickedInView: readonly string[],
  subtrees: StampSubtrees | undefined
): Set<string> {
  const carried = new Set<string>();
  if (!subtrees) return carried;
  for (const id of tickedInView) for (const d of subtrees[id] ?? []) carried.add(d);
  return carried;
}

const stamps = (n: number) => (n === 1 ? "1 stamp" : `${n} stamps`);

/** What the bar says. */
export interface StampSelectionWording {
  /** `3 stamps selected`, or `2 of 5 ticked stamps in view` while a filter hides some. */
  headline: string;
  /** `12 with their variants and child stamps` — only when the reach is larger than the ticks. */
  reach: string | null;
  /** What became of the hidden ticks, drawn only while there are any. */
  hidden: string | null;
  /** The hint on *Clear*, which reaches the hidden ticks too — empty when none are hidden. */
  clearHint: string;
}

export function describeStampSelection(
  tickedCount: number,
  inViewCount: number,
  reachCount: number | null
): StampSelectionWording {
  const hiddenCount = tickedCount - inViewCount;
  return {
    // The noun follows the total, as on the Copies list: `0 of 1 ticked stamps` reads as a template.
    headline:
      hiddenCount > 0
        ? `${inViewCount} of ${tickedCount} ticked stamp${tickedCount === 1 ? "" : "s"} in view`
        : `${stamps(tickedCount)} selected`,
    reach:
      reachCount !== null && reachCount > inViewCount
        ? `${reachCount} with their variants and child stamps`
        : null,
    hidden:
      hiddenCount <= 0
        ? null
        : hiddenCount === 1
          ? "The other one is still ticked and comes back when the filter is released."
          : `The other ${hiddenCount} are still ticked and come back when the filter is released.`,
    clearHint:
      hiddenCount > 0
        ? `Untick all ${tickedCount}, including the ${hiddenCount} the filter is hiding`
        : "",
  };
}
