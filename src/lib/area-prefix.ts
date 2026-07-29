import "server-only";

// Effective per-vendor area prefix resolution, shared by the stamp picker (#104) and the Colnect
// matcher (#155). A stamp's catalog number stores only the bare number; its human-facing identity
// prepends the area's per-vendor prefix (e.g. Michel Poland "200" shows as "Mi·PL 200"). The prefix
// is set on `CollectionAreaVendor.areaPrefix` and inherited down the area tree, so resolving it for
// a given (area, vendor) walks toward the root until an area sets one.

export interface AreaPrefixNode {
  parentId: string | null;
  name: string;
  /** Per-vendor prefix rows set directly on this area (value may be null). */
  vendorPrefix: Map<string, string | null>;
}

/** One area row as loaded from Prisma, carrying its direct per-vendor prefix entries. */
export interface AreaPrefixRow {
  id: string;
  name: string;
  parentId: string | null;
  collectionAreaVendors: { catalogVendorId: string; areaPrefix: string | null }[];
}

/** Build the id → {@link AreaPrefixNode} lookup used by {@link resolveEffectivePrefix}. */
export function buildAreaPrefixNodes(
  areaRows: readonly AreaPrefixRow[]
): Map<string, AreaPrefixNode> {
  return new Map(
    areaRows.map((a) => [
      a.id,
      {
        parentId: a.parentId,
        name: a.name,
        vendorPrefix: new Map(
          a.collectionAreaVendors.map((v) => [v.catalogVendorId, v.areaPrefix])
        ),
      },
    ])
  );
}

/**
 * The prefix a stamp's catalog number actually carries: its issue's override when it sets one for
 * this vendor (#377), else the area-resolved prefix. This is the *catalog identity* prefix, so it
 * is what duplicate detection (#85) and the Colnect strict full-key match (#155) key on, not only
 * what the label prints — the two must never disagree, or a stamp reads as `Mi·SP 1` while the
 * duplicate checker still treats it as `Mi·PL 1`.
 *
 * `issuePrefixes` is the collection's whole override map (see `issue-prefix.ts`); an absent issue
 * or an absent vendor within it means "inherit", which is the ordinary case.
 */
export function effectivePrefixFor(
  areaId: string | null,
  vendorId: string,
  nodes: Map<string, AreaPrefixNode>,
  issueId: string | null,
  issuePrefixes: Map<string, Map<string, string>>
): string | null {
  const override = issueId ? issuePrefixes.get(issueId)?.get(vendorId) : undefined;
  if (override !== undefined) return override;
  return areaId ? resolveEffectivePrefix(areaId, vendorId, nodes) : null;
}

/** Resolve the effective per-vendor area prefix, inheriting from the nearest ancestor area that
 * sets one (mirrors `effectiveVendorsForArea` on the client). Prefer {@link effectivePrefixFor}
 * where an issue is known — an issue may override what this returns (#377). */
export function resolveEffectivePrefix(
  areaId: string,
  vendorId: string,
  nodes: Map<string, AreaPrefixNode>
): string | null {
  let current: string | null = areaId;
  let depth = 0;
  while (current && depth < 50) {
    const node: AreaPrefixNode | undefined = nodes.get(current);
    if (!node) break;
    if (node.vendorPrefix.has(vendorId)) return node.vendorPrefix.get(vendorId) ?? null;
    current = node.parentId;
    depth++;
  }
  return null;
}
