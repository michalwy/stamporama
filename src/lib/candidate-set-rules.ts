// A copy identified as **one of several candidate stamps** (#1651, ADR-0065) — the pure rules.
//
// A copy has always pointed at one node of a variant tree, and an umbrella has meant "some variant
// of it" (ADR-0007 §2, ADR-0010 §3). A candidate set generalises that from *any variant* to *any of
// these*: *123aI or 123bI* when the type is known and the colour is not, or *Mi 85 or Mi 101* when the
// watermark that decides between two issues cannot be read on a cover.
//
// No Prisma here: the server reads the stamps a set touches and hands them in as
// {@link CandidateTreeNode}s, so the canonical form, the shape and the label are unit-testable.
//
// **A tree here is a variant tree** — what a stamp climbs to along *variant* edges (ADR-0010 §3).
// A distinct entry (an error, an overprint) is its own catalogue position, so *2 or 2 B1* spans two
// trees, exactly as *Mi 85 or Mi 101* does, and counts towards no completeness until it is settled.

/** One stamp as the candidate rules see it. */
export interface CandidateTreeNode {
  id: string;
  parentId: string | null;
  /** Whether the edge to `parentId` is a variant edge (ADR-0010 §3, `childIsVariant`). */
  isVariant: boolean;
  /** Catalogue order (`primaryCatalogSortKey`); null sorts last. */
  sortKey: string | null;
}

export type CandidateTree = ReadonlyMap<string, CandidateTreeNode>;

/** The stamp and its variant ancestors, nearest first — the chain ADR-0010 §3 lets a copy climb. */
export function variantChain(stampId: string, tree: CandidateTree): string[] {
  const chain = [stampId];
  const seen = new Set(chain);
  let node = tree.get(stampId);
  while (node?.isVariant && node.parentId && !seen.has(node.parentId)) {
    chain.push(node.parentId);
    seen.add(node.parentId);
    node = tree.get(node.parentId);
  }
  return chain;
}

/** The root of a stamp's variant tree: the last stamp of its {@link variantChain}. */
export function variantRoot(stampId: string, tree: CandidateTree): string {
  const chain = variantChain(stampId, tree);
  return chain[chain.length - 1];
}

/** Catalogue order, then id — the order a set is stored, named and pointed in. */
export function byCatalogueOrder(tree: CandidateTree): (a: string, b: string) => number {
  return (a, b) => {
    const ka = tree.get(a)?.sortKey ?? null;
    const kb = tree.get(b)?.sortKey ?? null;
    if (ka !== kb) {
      if (ka === null) return 1;
      if (kb === null) return -1;
      return ka < kb ? -1 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  };
}

/**
 * The canonical form of a set of ticked stamps, in catalogue order.
 *
 * - **A candidate under another candidate goes**: *123a or 123aI* is *123a* — "any type of a" already
 *   includes type I. Only variant edges are climbed, so *2 or 2 B1* keeps both.
 * - **Every variant of one umbrella is the umbrella** (#1651 *Decisions*), and that is applied until
 *   nothing changes: ticking all four of 123aI, aII, bI, bII is 123a and 123b, which is 123.
 *
 * A result of one stamp is not a set — the copy is an ordinary copy of it, an umbrella copy when that
 * stamp has variants. A result of none means nothing was ticked.
 */
export function canonicalCandidateSet(stampIds: readonly string[], tree: CandidateTree): string[] {
  let set = new Set(stampIds);
  for (;;) {
    // A candidate whose chain passes through another candidate is already covered by it.
    const kept = [...set].filter((id) => !variantChain(id, tree).slice(1).some((a) => set.has(a)));
    const next = new Set(kept);

    // Every variant child of a parent ticked → the parent.
    const byParent = new Map<string, string[]>();
    for (const id of next) {
      const node = tree.get(id);
      if (node?.isVariant && node.parentId) {
        byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), id]);
      }
    }
    for (const [parentId, ticked] of byParent) {
      const variants = [...tree.values()].filter((n) => n.parentId === parentId && n.isVariant);
      if (variants.length > 0 && variants.every((v) => next.has(v.id))) {
        for (const id of ticked) next.delete(id);
        next.add(parentId);
      }
    }

    if (next.size === set.size && [...next].every((id) => set.has(id))) {
      return [...next].sort(byCatalogueOrder(tree));
    }
    set = next;
  }
}

/** What a canonical set of two or more candidates means for the copy that carries it. */
export interface CandidateSetShape {
  /** How many variant trees the candidates span — `Item.candidateTrees`. */
  trees: number;
  /**
   * The stamp `Item.stampId` points at. In one tree, the candidates' **nearest common variant
   * ancestor**: the copy is then an umbrella copy of it for every count, as *123 (any variant)* would
   * be. Across trees there is none, and the pointer is the first candidate in catalogue order — never
   * read as the copy's identity, since `candidateTrees` takes the copy out of every count.
   */
  pointerStampId: string;
}

export function candidateSetShape(candidates: readonly string[], tree: CandidateTree): CandidateSetShape {
  if (candidates.length < 2) throw new Error("A candidate set has at least two stamps.");
  const ordered = [...candidates].sort(byCatalogueOrder(tree));
  const roots = new Set(ordered.map((id) => variantRoot(id, tree)));
  if (roots.size > 1) return { trees: roots.size, pointerStampId: ordered[0] };

  const chains = ordered.map((id) => variantChain(id, tree));
  const shared = chains[0].find((id) => chains.every((chain) => chain.includes(id)));
  // One root means every chain ends at it, so a shared ancestor always exists.
  return { trees: 1, pointerStampId: shared ?? chains[0][chains[0].length - 1] };
}

/** A copy's candidate set as the readers take it: the stamp ids, or null for an ordinary copy. Built
 *  off a copy selected with `candidates: { select: { stampId: true } }`. */
export function candidateIdsOf(row: { candidates: readonly { stampId: string }[] }): string[] | null {
  return row.candidates.length > 1 ? row.candidates.map((c) => c.stampId) : null;
}

// ── Naming ─────────────────────────────────────────────────────────────────────────────────────────

/** Past this length a set is named by its shared part and its differing parts. */
export const CANDIDATE_LABEL_LONG = 32;

/**
 * How a set reads wherever a copy's stamp is named (#1651): *Mi 123aI or 123bI*, *Mi 85, 101 or 110*.
 *
 * Each label is a candidate's full name in catalogue order. The vendor prefix they share is printed
 * once, as a catalogue printing a run would. Past {@link CANDIDATE_LABEL_LONG} characters the set is
 * shortened further to the shared part and the differing parts — *Mi·PL 123aI/aII/bI/bII* — never cut
 * inside a number, so *Mi 12* and *Mi 123* do not read as one stamp with suffixes *""* and *3*.
 */
export function candidateSetLabel(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];

  const vendorEnd = sharedPrefix(labels).lastIndexOf(" ") + 1;
  const rest = labels.slice(1).map((l) => l.slice(vendorEnd));
  const spoken = joinOr([labels[0], ...rest]);
  if (spoken.length <= CANDIDATE_LABEL_LONG) return spoken;

  let cut = sharedPrefix(labels).length;
  while (cut > vendorEnd && labels.some((l) => isDigit(l[cut - 1]) && isDigit(l[cut]))) cut--;
  if (cut <= vendorEnd || labels.some((l) => l.length === cut)) return spoken;
  return labels[0] + labels.slice(1).map((l) => "/" + l.slice(cut)).join("");
}

function joinOr(parts: string[]): string {
  return parts.length <= 2
    ? parts.join(" or ")
    : `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

function sharedPrefix(labels: readonly string[]): string {
  let prefix = labels[0];
  for (const l of labels.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < l.length && prefix[i] === l[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}
