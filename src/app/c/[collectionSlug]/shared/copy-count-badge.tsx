"use client";

import type { StampCopyCounts } from "@/lib/copy-counts";
import { STAMP_SECONDARY_CHIP } from "./chip-styles";

// How many copies of a stamp you hold, shown beside its catalog numbers wherever stamps are
// listed (#348): the issue tree, the flat stamp list, and the stamp pickers that reuse the tree.
//
// **A stamp you own none of shows nothing.** Most of a catalog is stamps you do not have yet, so
// a "0" on every row would be a column of noise — the same rule the subtype chip and the single
// format follow. The badge therefore only ever means "you have some", and its absence means none.
//
// The count is *this stamp's* copies exactly, never rolled up from variant children: the tree
// shows each child's own badge right below, so a rollup would show one copy on two rows.
//
// The tooltip breaks the total down by **disposition marker**. Those overlap by design — a copy
// can be in the collection and for sale at once — so they are listed, never summed.

const CHIP: React.CSSProperties = {
  ...STAMP_SECONDARY_CHIP,
  fontFamily: "inherit",
  fontWeight: 600,
  color: "var(--color-disposition-collection)",
  borderColor: "var(--color-disposition-collection-border)",
  background: "var(--color-disposition-collection-soft)",
};

/** Human summary of what the badge counts, e.g.
 *  "3 copies held · 2 in collection · 1 for sale". Sold copies are not counted. */
function describe(copies: StampCopyCounts): string {
  const parts = [`${copies.total} ${copies.total === 1 ? "copy" : "copies"} held`];
  if (copies.inCollection) parts.push(`${copies.inCollection} in collection`);
  if (copies.forSale) parts.push(`${copies.forSale} for sale`);
  if (copies.forTrade) parts.push(`${copies.forTrade} for trade`);
  return `${parts.join(" · ")}. Sold copies are not counted.`;
}

export function CopyCountBadge({
  copies,
  /** Slightly larger variant used on the flat stamp list, which sizes its chips up (mirrors
   * `SubtypeChip` / `ColnectChip`). */
  size = "small",
}: {
  copies: StampCopyCounts | null | undefined;
  size?: "small" | "medium";
}) {
  if (!copies || copies.total === 0) return null;
  const medium = size === "medium";
  return (
    <span
      title={describe(copies)}
      aria-label={describe(copies)}
      style={{
        ...CHIP,
        fontSize: medium ? "0.75rem" : "0.6875rem",
        padding: medium ? "0.1rem 0.4rem" : "0.05rem 0.35rem",
      }}
    >
      {/* Spelled out rather than a bare number or "×3": the price sits at the other end of the
          same line, and a lone multiplier there reads as a quantity *of the price*. */}
      {copies.total} {copies.total === 1 ? "copy" : "copies"}
    </span>
  );
}
