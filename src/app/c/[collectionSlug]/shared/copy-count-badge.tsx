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
// variants hold is a **parenthesised addition inside the same chip** (#528) — "3 (+2) copies" —
// so the two questions ("how many of this do I have" and "how many of its variants") keep their
// own numbers without either being folded into a sum. One chip rather than two: a second chip on
// a line that already carries catalog numbers, a Colnect link, a subtype and a price stopped being
// readable as anything but more noise. The parenthesised half is drawn muted, and appears against
// a **zero** — "0 (+2) copies" — when the stamp has no copies of its own, which is the ordinary
// shape of an unknown-variant umbrella whose copies are all filed under specific variants; that is
// the one case where the badge shows a 0, and it is showing it *about* something you hold.
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

/** The parenthesised variant figure inside the chip (#528): the badge's own shape, drawn muted so
 * the row's own number still reads first. Green is what "you hold this" is tinted with, and these
 * copies are held of something one level down. */
const VARIANT_PART: React.CSSProperties = {
  fontWeight: 500,
  opacity: 0.8,
};

/** Human summary of what the badge counts, e.g.
 *  "3 copies held · 2 in collection · 1 for sale". Sold copies are not counted. */
function describe(copies: StampCopyCounts, variantCopies: number): string {
  const parts = [`${copies.total} ${copies.total === 1 ? "copy" : "copies"} held`];
  if (copies.inCollection) parts.push(`${copies.inCollection} in collection`);
  if (copies.forSale) parts.push(`${copies.forSale} for sale`);
  if (copies.forTrade) parts.push(`${copies.forTrade} for trade`);
  // The variant figure names its *rule* rather than repeating its number: which children count is
  // the part the chip cannot say on its own.
  const variants = variantCopies
    ? ` (+${variantCopies}) is held of this stamp's variants, at any depth — children that are` +
      ` distinct entries (errors, plate flaws, overprints) are not counted.`
    : "";
  return `${parts.join(" · ")}.${variants} Sold copies are not counted.`;
}

export function CopyCountBadge({
  copies,
  /** Copies held under this stamp's variant-kind descendants (#528). Drawn as a muted `(+2)` in
   * the same chip; zero or absent draws nothing extra. */
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
  const label = describe(copies ?? { total: 0, inCollection: 0, forSale: 0, forTrade: 0 }, variantCopies);
  return (
    <Tooltip content={label}>
      <span
        aria-label={label}
        style={{
          ...CHIP,
          fontSize: medium ? "0.75rem" : "0.6875rem",
          padding: medium ? "0.1rem 0.4rem" : "0.05rem 0.35rem",
        }}
      >
        {/* Spelled out rather than a bare number or "×3": the price sits at the other end of the
            same line, and a lone multiplier there reads as a quantity *of the price*. The noun is
            plural whenever a variant figure is present, since it then covers both numbers. */}
        {total}
        {variantCopies > 0 && <span style={VARIANT_PART}> (+{variantCopies})</span>}{" "}
        {total === 1 && variantCopies === 0 ? "copy" : "copies"}
      </span>
    </Tooltip>
  );
}
