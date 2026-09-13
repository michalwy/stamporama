// At what depth of the variant tree a bulk *add missing to want list* wants a set (#1240). Pure: no
// Prisma, no I/O, so the dialog, the server that writes the wants and a unit test cannot disagree
// about which stamps a run is over.
//
// A collector goes after a set at one of two depths — *one of each stamp, any variant*, or *every
// variant* — and never both at once: a want on an umbrella beside wants on its variants counts one
// stamp twice on the list, and a copy of any variant then looks as if it met two goals. So a run
// picks one depth, and the stamps a checklist names are **mapped** to that depth rather than wanted
// as listed.
//
// *Variant* is ADR-0010 §3's edge and nothing wider: a child whose effective `actsAsVariant` is
// true. An error, a plate flaw, an overprint or a forgery is a distinct entry — its own stamp, which
// neither mode climbs out of nor expands into.

export const WANT_DEPTHS = ["main", "variants"] as const;
export type WantDepth = (typeof WANT_DEPTHS)[number];

export function isWantDepth(value: unknown): value is WantDepth {
  return (WANT_DEPTHS as readonly unknown[]).includes(value);
}

export const WANT_DEPTH_LABEL: Record<WantDepth, string> = {
  main: "Main stamps",
  variants: "Variants",
};

/** What one want of the run is *for*, as the confirmation says it: "one per missing ___". */
export const WANT_DEPTH_NOUN: Record<WantDepth, { one: string; many: string }> = {
  main: { one: "main stamp", many: "main stamps" },
  variants: { one: "variant", many: "variants" },
};

/** How deep a variant tree is walked before the walk gives up — the rollup's own bound, for the same
 *  reason: no real tree is that deep, and a cycle written by hand must not spin a read forever. */
const MAX_VARIANT_DEPTH = 8;

/**
 * The variant tree around a checklist's stamps, as far as either mode needs it.
 *
 * - `chains` — each stamp itself first, then upward while the node it came from is a variant
 *   (`loadVariantChains`). Its last element is the stamp's main stamp.
 * - `variantChildren` — each stamp's direct **variant** children, distinct entries left out.
 */
export interface WantDepthTree {
  chains: ReadonlyMap<string, readonly string[]>;
  variantChildren: ReadonlyMap<string, readonly string[]>;
}

/** The main stamp a stamp is a way of holding: the top of its variant chain, or itself. */
export function mainStampOf(stampId: string, tree: Pick<WantDepthTree, "chains">): string {
  const chain = tree.chains.get(stampId);
  return chain && chain.length > 0 ? chain[chain.length - 1] : stampId;
}

/**
 * The concrete variants a stamp stands for: the nodes of its variant subtree that have **no variants
 * of their own**, in tree order. A stamp with no variant children stands for itself — it is both the
 * main stamp and the concrete thing — and a node that has variants is never among them, however deep.
 */
export function concreteVariantsOf(
  stampId: string,
  tree: Pick<WantDepthTree, "variantChildren">
): string[] {
  const leaves: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const children = tree.variantChildren.get(id) ?? [];
    if (children.length === 0 || depth >= MAX_VARIANT_DEPTH) {
      leaves.push(id);
      return;
    }
    for (const child of children) walk(child, depth + 1);
  };
  walk(stampId, 0);
  return leaves;
}

/**
 * The stamps a run at `depth` wants for a checklist naming `stampIds` — each mapped to its depth,
 * duplicates dropped, first appearance kept.
 *
 * **Main stamps**: a variant on the checklist contributes its main stamp, once. **Variants**: an
 * umbrella contributes every concrete variant under it, including variants the checklist does not
 * name. A stamp with no variants contributes itself either way.
 */
export function wantDepthTargets(
  stampIds: readonly string[],
  depth: WantDepth,
  tree: WantDepthTree
): string[] {
  const targets = new Set<string>();
  for (const id of stampIds) {
    if (depth === "main") targets.add(mainStampOf(id, tree));
    else for (const leaf of concreteVariantsOf(id, tree)) targets.add(leaf);
  }
  return [...targets];
}
