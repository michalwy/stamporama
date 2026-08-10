"use client";

import type { StampCopyCounts } from "@/lib/copy-counts";
import { STAMP_SECONDARY_CHIP } from "./chip-styles";
import { Tooltip } from "./tooltip";

// How many copies of a stamp you hold, shown beside its catalog numbers wherever stamps are
// listed (#348): the issue tree, the flat stamp list, and the stamp pickers that reuse the tree.
//
// **A stamp you own none of shows nothing.** Most of a catalog is stamps you do not have yet, so
// a "0" on every row would be a column of noise — the same rule the subtype chip and the single
// format follow. The badge therefore only ever means "you have some", and its absence means none.
//
// The count is *this stamp's* copies exactly, never rolled up from variant children: the tree
// shows each child's own badge right below, so a rollup would show one copy on two rows. What the
// variants hold is instead a **second chip** beside it (#528) — "+2 in variants" — so the two
// questions ("how many of this do I have" and "how many of its variants") each keep their own
// number and neither is silently folded into the other. It appears on its own when the stamp has
// no copies of its own, which is the ordinary shape of an unknown-variant umbrella whose copies are
// all filed under specific variants.
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

/** The variant chip's own colours (#528): the copies badge's shape, drawn in the row's ordinary
 * muted chip palette. Green is what "you hold this" is tinted with everywhere, and a second green
 * chip would read as a second holding of the row's own stamp. */
const VARIANT_CHIP: React.CSSProperties = {
  fontWeight: 500,
  color: "var(--color-text-muted)",
  borderColor: "var(--color-border)",
  background: "transparent",
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

/** What the variant chip says on hover. Names the rule rather than the number, since "which
 *  children count" is the part that is not obvious from the chip. */
function describeVariants(n: number): string {
  return (
    `${n} ${n === 1 ? "copy" : "copies"} held of this stamp's variants, at any depth. ` +
    `Children that are distinct entries — errors, plate flaws, overprints — are not counted, ` +
    `and neither are sold copies.`
  );
}

export function CopyCountBadge({
  copies,
  /** Copies held under this stamp's variant-kind descendants (#528). Drawn as its own chip after
   * the copies badge; zero or absent draws nothing. */
  variantCopies = 0,
  /** Slightly larger variant used on the flat stamp list, which sizes its chips up (mirrors
   * `SubtypeChip` / `ColnectChip`). */
  size = "small",
}: {
  copies: StampCopyCounts | null | undefined;
  variantCopies?: number;
  size?: "small" | "medium";
}) {
  const total = copies?.total ?? 0;
  if (total === 0 && variantCopies === 0) return null;
  const medium = size === "medium";
  const chipStyle: React.CSSProperties = {
    ...CHIP,
    fontSize: medium ? "0.75rem" : "0.6875rem",
    padding: medium ? "0.1rem 0.4rem" : "0.05rem 0.35rem",
  };
  return (
    <>
      {copies && total > 0 && (
        <Tooltip content={describe(copies)}>
          <span aria-label={describe(copies)} style={chipStyle}>
            {/* Spelled out rather than a bare number or "×3": the price sits at the other end of
                the same line, and a lone multiplier there reads as a quantity *of the price*. */}
            {total} {total === 1 ? "copy" : "copies"}
          </span>
        </Tooltip>
      )}
      {variantCopies > 0 && (
        <Tooltip content={describeVariants(variantCopies)}>
          <span
            aria-label={describeVariants(variantCopies)}
            // Muted against the copies badge beside it: these copies are held of something else,
            // one level down, and the row's own number is the one being read first.
            style={{ ...chipStyle, ...VARIANT_CHIP }}
          >
            {/* The leading "+" is what makes it read as an addition to the badge before it rather
                than a competing count of the same thing. */}
            +{variantCopies} in variants
          </span>
        </Tooltip>
      )}
    </>
  );
}
