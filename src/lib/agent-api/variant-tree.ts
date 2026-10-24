// The variant tree on the agent API (#2140): what keeps a variant from being deleted, and the
// sentence an agent is refused with. Pure, so the refusal is unit-tested without the database.
//
// **The list is the collector's, and it is wider than the stamp screen's** (settled 2026-10-24). The
// screen's delete takes a variant's copies, wants, price observations and trade lines with it and
// refuses only a copy that is several stamps or might be this one; an agent deleting a variant it
// created by mistake must never take a record with it. So a variant anything below names is refused,
// and the holders are named rather than counted alone, so the assistant can tell the collector which.

/** What names a variant, as the delete reads it before writing anything. */
export interface VariantHolders {
  /** Short numbers of the copies that are this stamp, carry it, or might be it (ADR-0044, #1651). */
  readonly copyNos: readonly number[];
  /** Short numbers of the offers told by hand to list under this stamp, or holding it as an umbrella. */
  readonly offerNos: readonly number[];
  readonly wants: number;
  readonly auctionLines: number;
  readonly priceObservations: number;
  readonly tradeLines: number;
  /** Short numbers of the stamp's own variants. */
  readonly variantNos: readonly number[];
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The holders as phrases, in a fixed order — empty when nothing holds the variant. */
export function variantHolderPhrases(holders: VariantHolders): string[] {
  const phrases: string[] = [];
  if (holders.copyNos.length > 0) {
    phrases.push(`${plural(holders.copyNos.length, "copy", "copies")} (${holders.copyNos.map((no) => `#${no}`).join(", ")})`);
  }
  if (holders.offerNos.length > 0) {
    phrases.push(`${plural(holders.offerNos.length, "offer", "offers")} (${holders.offerNos.map((no) => `#${no}`).join(", ")})`);
  }
  if (holders.wants > 0) phrases.push(plural(holders.wants, "want", "wants"));
  if (holders.auctionLines > 0) phrases.push(plural(holders.auctionLines, "auction lot line", "auction lot lines"));
  if (holders.priceObservations > 0) phrases.push(plural(holders.priceObservations, "price observation", "price observations"));
  if (holders.tradeLines > 0) phrases.push(plural(holders.tradeLines, "trade line", "trade lines"));
  if (holders.variantNos.length > 0) {
    phrases.push(
      `${plural(holders.variantNos.length, "variant of its own", "variants of its own")} (${holders.variantNos.map((no) => `st ${no}`).join(", ")})`
    );
  }
  return phrases;
}

/** The refusal for a variant something holds, or null when nothing does. */
export function variantHeldMessage(stamp: string, holders: VariantHolders): string | null {
  const phrases = variantHolderPhrases(holders);
  if (phrases.length === 0) return null;
  return `${stamp} is not deleted: it is named by ${phrases.join(", ")}. A variant is deleted only when nothing names it — the collector settles those first, or deletes it on the stamp's screen. Nothing was changed.`;
}
