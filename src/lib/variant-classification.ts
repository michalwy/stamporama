// Pure helpers for the "does this child act as a variant?" decision (ADR-0010 §3).
// No Prisma / server-only imports, so both the server (queries) and client (tree
// nodes) can share one source of truth.

/**
 * A child stamp's effective actsAsVariant: its per-stamp override when set
 * (ADR-0010 §2a), otherwise the subtype's flag; `false` when unclassified.
 */
export function effectiveActsAsVariant(
  override: boolean | null,
  subtypeActsAsVariant: boolean | null | undefined
): boolean {
  return override ?? subtypeActsAsVariant ?? false;
}

/** Effective flag for a stamp row selected with {@link VARIANT_FLAG_SELECT}. */
export function childIsVariant(child: {
  actsAsVariantOverride: boolean | null;
  subtype: { actsAsVariant: boolean } | null;
}): boolean {
  return effectiveActsAsVariant(child.actsAsVariantOverride, child.subtype?.actsAsVariant ?? null);
}

/**
 * True when a stamp is an unknown-variant umbrella: it has at least one direct child
 * whose effective actsAsVariant is true (ADR-0010 §3). This holds at **any** depth in
 * the variant tree — an intermediate node with variant children is just as much an
 * "unknown which specific child" umbrella as a top-level base stamp (#239). `variants`
 * is the direct-children relation selected with {@link VARIANT_FLAG_SELECT}.
 */
export function isUnknownVariantStamp(stamp: {
  variants: {
    actsAsVariantOverride: boolean | null;
    subtype: { actsAsVariant: boolean } | null;
  }[];
}): boolean {
  return stamp.variants.some(childIsVariant);
}

/** A subtype as the lists and pickers display it (#340): its name, and whether it is the
 * collection's default — the default renders nothing, see `SubtypeChip`. */
export interface SubtypeLabel {
  name: string;
  isDefault: boolean;
}

/** The display label of a stamp selected with {@link VARIANT_FLAG_SELECT}, or null for a base
 * stamp (which carries no subtype). The default-renders-nothing rule lives in the chip, not here:
 * a read model reports what is stored and the surface decides what to draw. */
export function subtypeLabel(stamp: {
  subtype: { name: string; isDefault: boolean } | null;
}): SubtypeLabel | null {
  return stamp.subtype ? { name: stamp.subtype.name, isDefault: stamp.subtype.isDefault } : null;
}

/**
 * Prisma `select` fragment for the fields {@link childIsVariant} needs, plus the name and
 * default-ness {@link subtypeLabel} needs (#340). Spread into a stamp/`variants` selection so both
 * resolvers can run server-side. Two extra scalars off a small per-collection dictionary table is
 * cheaper than a second select fragment every caller would have to remember to spread as well.
 */
export const VARIANT_FLAG_SELECT = {
  actsAsVariantOverride: true,
  subtype: { select: { actsAsVariant: true, name: true, isDefault: true } },
} as const;
