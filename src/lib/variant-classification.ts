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
 * Prisma `select` fragment for the two fields {@link childIsVariant} needs. Spread
 * into a stamp/`variants` selection so the resolver can run server-side.
 */
export const VARIANT_FLAG_SELECT = {
  actsAsVariantOverride: true,
  subtype: { select: { actsAsVariant: true } },
} as const;
