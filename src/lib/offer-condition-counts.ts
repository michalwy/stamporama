// The conditions an offer's copies are in, with how many of each (#1941) — the Prepare row's
// *MNH ×3 · MH ×1*. Pure, so the counting and the order are pinned by a unit test rather than by the
// screen.

/** One condition and how many of the offer's copies are in it. */
export interface OfferConditionCount {
  id: string;
  abbreviation: string;
  name: string;
  count: number;
}

/** A copy as far as its condition goes: the dictionary row it points at. */
export interface ConditionedCopy {
  conditionId: string;
  condition: { abbreviation: string; name: string; sortOrder: number };
}

/**
 * Each condition the copies are in, once, with its count — in the collection's own dictionary order
 * (`sortOrder`), the order every condition select and chip row reads in, so *MNH* stands before *MH*
 * here as it does there. A copy is one copy whatever it holds (ADR-0044): a block on a cover counts
 * once, as it does in the row's *N copies*.
 */
export function offerConditionCounts(copies: readonly ConditionedCopy[]): OfferConditionCount[] {
  const byId = new Map<string, OfferConditionCount & { sortOrder: number }>();
  for (const copy of copies) {
    const seen = byId.get(copy.conditionId);
    if (seen) seen.count += 1;
    else
      byId.set(copy.conditionId, {
        id: copy.conditionId,
        abbreviation: copy.condition.abbreviation,
        name: copy.condition.name,
        sortOrder: copy.condition.sortOrder,
        count: 1,
      });
  }
  return [...byId.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.abbreviation.localeCompare(b.abbreviation))
    .map(({ id, abbreviation, name, count }) => ({ id, abbreviation, name, count }));
}
