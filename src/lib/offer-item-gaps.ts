/**
 * What an offer's Items card (#423/#669) counts as still missing from its rows.
 *
 * Two gaps, in the card heading's own two words: a stamp with no catalogue entry behind it, and a
 * `stamp × condition` with no catalog value. The rule lives here rather than inline in the card so it
 * is pure arithmetic a unit test can reach, and so the `+ CV all` chip and anything else that counts
 * the same rows cannot disagree about it.
 *
 * The parameter types are structural subsets of `OfferPlatformItem` and of the copy rows the offer
 * screen holds, so this module imports nothing: it is pure arithmetic over two lists, and a lib
 * module with no imports cannot take part in a cycle.
 */

/** The part of an `OfferPlatformItem` the gap rule reads. */
export interface GapItem {
  stampId: string;
  conditionId: string;
  /** The platform's catalogue page for whatever this row stands under — null when unmatched. */
  catalogUrl: string | null;
  /** Set where the row's operative figure belongs to a variant tree that carries no price (#617). */
  unpricedVariantStampId: string | null;
}

/** The part of a copy row the gap rule reads. */
export interface GapCopy {
  stampId: string;
  conditionId: string;
  value: { unpriced: boolean };
}

export interface ListingItemGaps {
  /** Rows whose entry was never matched to the platform's catalogue (#247). */
  unlinked: number;
  /** Rows with no catalog value recorded for their `stamp × condition` (#720). */
  unpriced: number;
}

/**
 * The two gaps across an offer's item rows.
 *
 * A row is `stamp × condition`, which is exactly what a catalog value is recorded against, so the
 * copies are consulted on that key. A row whose value would come from a **variant tree** that
 * carries no price of its own (#617) is not counted as unpriced: pricing the umbrella there does
 * not close anything, the rollup reading the variants instead, and the item card marks that row with
 * the variant price grid rather than with `+ CV`.
 */
export function listingItemGaps(items: GapItem[], copies: GapCopy[]): ListingItemGaps {
  const unpricedKeys = new Set<string>();
  for (const copy of copies) {
    if (copy.value.unpriced) unpricedKeys.add(`${copy.stampId}|${copy.conditionId}`);
  }
  let unlinked = 0;
  let unpriced = 0;
  for (const item of items) {
    if (!item.catalogUrl) unlinked++;
    if (!item.unpricedVariantStampId && unpricedKeys.has(`${item.stampId}|${item.conditionId}`)) {
      unpriced++;
    }
  }
  return { unlinked, unpriced };
}
