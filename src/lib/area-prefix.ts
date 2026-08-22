import "server-only";

// Effective per-vendor area prefix resolution, shared by the stamp picker (#104) and the Colnect
// matcher (#155). A stamp's catalog number stores only the bare number; its human-facing identity
// prepends the area's prefix (e.g. Michel Poland "200" shows as "Mi·PL 200").
//
// The prefix lives at **two** levels on an area since #675: `CollectionArea.catalogPrefix` answers
// for every vendor, and `CollectionAreaVendor.areaPrefix` is the per-vendor exception. Resolving a
// (area, vendor) pair walks toward the root and stops at the **first area that says anything** —
// either a vendor row *stating* a prefix or its own `catalogPrefix` — with the vendor row winning
// inside that one area. That is `StampFormatFactor`'s rule (ADR-0020): *where* outranks *for which*.
// So Poland setting `catalogPrefix = PL` plus a Fischer row with no prefix, and a child GG setting
// `catalogPrefix = GG` and saying nothing about Fischer, resolves Fischer under GG to `GG`: the
// nearer area decided, and repeating the Fischer exception on GG is how you keep it.
//
// A vendor row states a prefix when its `areaPrefix` is non-null: `''` is the stated *no prefix*,
// and NULL is the ordinary tick, which declares the vendor and lets the prefix inherit — the area's
// own `catalogPrefix` first, then on up. Merging those two into one state is what would make ticking
// four vendors on a `PL` area silently kill `PL` four times.

export interface AreaPrefixNode {
  parentId: string | null;
  name: string;
  /** The area's own prefix for every vendor (#675); null when the area says nothing at this level. */
  catalogPrefix: string | null;
  /** Per-vendor prefix rows set directly on this area. `''` is the stated *no prefix for this
   * vendor here*, which stops both inheritance and the area's own {@link
   * AreaPrefixNode.catalogPrefix}; a null value declares the vendor without saying anything about
   * its prefix, so the question passes on. */
  vendorPrefix: Map<string, string | null>;
}

/** One area row as loaded from Prisma, carrying both prefix levels it declares. */
export interface AreaPrefixRow {
  id: string;
  name: string;
  parentId: string | null;
  catalogPrefix: string | null;
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
        catalogPrefix: a.catalogPrefix,
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

/** Resolve the effective area prefix for one vendor: walk toward the root and stop at the first
 * area that states one — a `CollectionAreaVendor` row with a non-null `areaPrefix`, or the area's
 * own `catalogPrefix` — the row winning inside that one area (#675). An empty string at either level
 * is a stated *no prefix* and stops the walk returning null. Mirrors `resolveAreaVendorPrefix` on
 * the client. Prefer {@link effectivePrefixFor} where an issue is known — an issue may override what
 * this returns (#377). */
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
    const own = node.vendorPrefix.get(vendorId);
    if (own != null) return own || null;
    if (node.catalogPrefix !== null) return node.catalogPrefix || null;
    current = node.parentId;
    depth++;
  }
  return null;
}
