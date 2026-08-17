import { pickCatalogPriceFor, type RawCatalogPrice } from "./catalog-price";

// Which cells of a variant tree are **not priced yet** (#618) — the rule behind the variant price
// grid's worklist, and the same question `CopyValuation.unpricedVariantIds` (#617) asks of one copy,
// asked of a whole tree at once. Pure: no Prisma, no `server-only`.
//
// The unknown-variant rollup (#238, #616) is worth exactly as much as the completeness of the
// variant prices behind it — it picks the *lowest* price among a stamp's variant children, so a tree
// with three of eight variants priced answers a question about three variants while looking like an
// answer about the stamp. This is what makes that incompleteness visible before a listing hits it.
//
// Three things it deliberately does **not** vary over, each for its own reason:
//
//   - **Certificate is none.** A catalogue quotes the plain figure, and the rollup a headline price
//     and a listing are read on is the no-certificate one (`pickMainCatalogPrice`).
//   - **Format is the single.** A multiple's value is derived from the single's by a
//     `StampFormatFactor` (ADR-0020 §5), so a tree whose singles are all priced has nothing missing
//     — an explicit format row is a deliberate deviation, not a gap.
//   - **Edition is whichever is newest with a price.** `pickCatalogPriceFor` already prefers the
//     latest edition carrying one, so a variant priced only in an older edition counts as priced:
//     it *has* a figure, and asking for it again on every new edition would make every tree
//     incomplete for ever.
//
// What it does vary over is the **condition**, and only over the conditions the collection actually
// holds or lists at — never every row of the dictionary, or every tree is incomplete for ever. The
// caller supplies that set; this module only takes it as given.

/** One variant of the tree, as coverage sees it. */
export interface CoverageVariant {
  stampId: string;
  /**
   * True when the stamp is **fully identified** — it has no variant children of its own, so a
   * catalogue prices it directly. `VariantPrices.identified`'s rule, and for the same reason: an
   * intermediate node is an unknown-variant umbrella whose value *is* the lowest of its own
   * children (ADR-0010 §3), so an unpriced one is not a gap in the data.
   */
  identified: boolean;
  /** Every catalog price recorded on that stamp — any edition, condition, certificate and format. */
  prices: readonly RawCatalogPrice[];
}

/** One cell a price is missing from: a variant at a condition. */
export interface UnpricedVariantCell {
  stampId: string;
  conditionId: string;
}

/**
 * The `(variant, condition)` cells of a tree that carry no catalog price, in variant order then
 * condition order. Empty when the tree is fully priced — which is exactly when the rollup can say
 * *which* variant is the cheapest, and so exactly when a listing may rest on it (#617).
 *
 * With no primary catalog resolved for the tree's area there is nothing to be priced *in*, so the
 * answer is empty rather than "everything is missing": that is a catalog-setup gap, reported where
 * catalogs are set up, and reporting it here would fill the worklist with trees no amount of typing
 * could complete.
 */
export function unpricedVariantCells(input: {
  variants: readonly CoverageVariant[];
  /** The conditions the collection holds or lists at, in display order. */
  conditionIds: readonly string[];
  primaryCatalogNameId: string | null;
}): UnpricedVariantCell[] {
  if (!input.primaryCatalogNameId) return [];
  const cells: UnpricedVariantCell[] = [];
  for (const variant of input.variants) {
    if (!variant.identified) continue;
    for (const conditionId of input.conditionIds) {
      const picked = pickCatalogPriceFor(
        variant.prices as RawCatalogPrice[],
        input.primaryCatalogNameId,
        conditionId,
        null,
        null
      );
      if (!picked) cells.push({ stampId: variant.stampId, conditionId });
    }
  }
  return cells;
}
