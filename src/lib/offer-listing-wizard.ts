/**
 * What the listing wizard (#730) counts as still missing from an offer's items.
 *
 * The wizard's first step is the item list (#423/#669) and its whole question is "is anything here
 * still unanswered?" — which is the same question the card's own header chips answer, in the same
 * two words: a stamp with no catalogue entry behind it, and a `stamp × condition` with no catalog
 * value. The rule lives here rather than in either surface so the two cannot disagree: a card
 * heading saying "2 not matched" beside a wizard step saying "everything is linked" is the one
 * failure this module exists to prevent.
 *
 * Deliberately **counts only** — no reasons, no rows. Both surfaces already draw the rows; what the
 * wizard adds is the summary above them, and the collector fixes a gap in the same list either way.
 *
 * The parameter types are structural subsets of `OfferPlatformItem` and of the copy rows the offer
 * screen holds, so this module imports nothing: it is pure arithmetic over two lists, and a lib
 * module with no imports cannot take part in a cycle.
 */

/** The part of an `OfferPlatformItem` the gap rule reads. */
export interface WizardItem {
  stampId: string;
  conditionId: string;
  /** The platform's catalogue page for whatever this row stands under — null when unmatched. */
  catalogUrl: string | null;
  /** Set where the row's operative figure belongs to a variant tree that carries no price (#617). */
  unpricedVariantStampId: string | null;
}

/** The part of a copy row the gap rule reads. */
export interface WizardCopy {
  stampId: string;
  conditionId: string;
  value: { unpriced: boolean };
}

export interface ListingItemGaps {
  /** Rows whose entry was never matched to the platform's catalogue (#247). */
  unlinked: number;
  /** Rows with no catalog value recorded for their `stamp × condition` (#720). */
  unpriced: number;
  /** How many rows were judged, so a summary can say "3 of 12". */
  total: number;
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
export function listingItemGaps(items: WizardItem[], copies: WizardCopy[]): ListingItemGaps {
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
  return { unlinked, unpriced, total: items.length };
}

/** Whether the wizard's item step has anything left to report. */
export function hasItemGaps(gaps: ListingItemGaps): boolean {
  return gaps.unlinked > 0 || gaps.unpriced > 0;
}

/**
 * The gaps as one sentence, or null when there are none.
 *
 * One line rather than a list: each half is already a counted chip in the item card below it, and
 * the step's summary is read before the rows, not instead of them.
 */
export function itemGapSummary(gaps: ListingItemGaps): string | null {
  const parts: string[] = [];
  if (gaps.unlinked > 0) parts.push(`${gaps.unlinked} not matched`);
  if (gaps.unpriced > 0) {
    parts.push(`${gaps.unpriced} without a catalog value`);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}
