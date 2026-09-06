/**
 * The area rail's counts (#843).
 *
 * A facet count answers one question — *what would clicking this row show?* — so it is counted
 * against every other filter in force but **not against its own dimension**, which is the rule the
 * year rail and the bulk listing workspace already follow (`ui-patterns.md`, #322). Mirrored onto
 * the area axis that means the counts arrive per area, over the whole tree, with the area selection
 * left out of the query and everything else (search, catalog number, year, status…) left in.
 *
 * That is also what makes the two rails agree rather than merely coexist: with no year selected,
 * an area's count **is** the sum of the year counts shown under it, because both are `groupBy`s over
 * one `where`. Select a year and each rail drops its own dimension, so the area row shows that
 * year's rows — which is what the list beside it is showing. The identity holds exactly where the
 * collector can see both numbers at once.
 *
 * Deliberately *not* `CollectionAreaData.stampCount`: that is a catalog count with filter semantics
 * of its own, it ignores every filter on the screen, and on the Copies list it is not even counting
 * the same thing as the list. A count that disagrees with the rows under it is worse than no count.
 *
 * Pure by design — no Prisma, no React — so the roll-up rule is testable without a database or a
 * mounted sidebar.
 */

/** One area's own rows: what the query counted **on** that node, descendants excluded. */
export interface AreaFacet {
  areaId: string;
  count: number;
}

/** The shape the roll-up needs of an area; `CollectionAreaData` satisfies it structurally. */
export interface AreaFacetNode {
  id: string;
  parentId: string | null;
}

/**
 * The number each area row shows, keyed by area id.
 *
 * `includeDescendants` is the collector's subtree scope (#385, `useSubtreeScope("area")`), and the
 * count follows it for the same reason the in-scope shading does: the row has to promise what
 * selecting it would actually list. With the scope on, a parent carries its subtree's rows; with it
 * off, only the rows filed on the node itself.
 *
 * Every area in `areas` gets an entry, **zero included** — "nothing here" is the answer the rail is
 * being asked for most often, and an empty cell reads as a count that failed to load rather than as
 * a zero. Facets naming an area outside `areas` are ignored: a count with no row to sit on cannot
 * be shown, and rolling it into an ancestor would inflate a number nobody could reconcile.
 *
 * Returns `null` for absent facets — "not counted", which is not the same claim as "counted, none"
 * and must not render as `0`.
 */
export function rollUpAreaCounts(
  areas: AreaFacetNode[],
  facets: AreaFacet[] | undefined,
  includeDescendants: boolean
): Map<string, number> | null {
  if (!facets) return null;

  const own = new Map<string, number>();
  for (const { id } of areas) own.set(id, 0);
  for (const { areaId, count } of facets) {
    if (!own.has(areaId)) continue;
    own.set(areaId, (own.get(areaId) ?? 0) + count);
  }
  if (!includeDescendants) return own;

  const childrenByParent = new Map<string | null, string[]>();
  for (const { id, parentId } of areas) {
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(id);
    childrenByParent.set(parentId, siblings);
  }

  // Post-order over the roots, iteratively rather than recursively: `flattenAreaTree` renders the
  // tree from `parentId === null` down, so the roll-up walks exactly the nodes the rail draws.
  // Anything hanging off a parent that is not in `areas` is unreachable from a root and keeps its
  // own count — the same thing the rail does with it, which is not to draw it.
  const total = new Map<string, number>(own);
  const stack: { id: string; expanded: boolean }[] = (childrenByParent.get(null) ?? []).map(
    (id) => ({ id, expanded: false })
  );
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const children = childrenByParent.get(frame.id) ?? [];
    if (!frame.expanded) {
      stack.push({ id: frame.id, expanded: true });
      for (const child of children) stack.push({ id: child, expanded: false });
      continue;
    }
    let sum = own.get(frame.id) ?? 0;
    for (const child of children) sum += total.get(child) ?? 0;
    total.set(frame.id, sum);
  }

  return total;
}
