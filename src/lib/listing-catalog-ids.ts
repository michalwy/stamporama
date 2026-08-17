import "server-only";
import { prisma } from "./db";
import { valuateItemRows, type ValuationRow } from "./item-valuation";
import { STAMP_LABEL_SELECT, type OfferLabeller } from "./offer-labels";

// Which catalogue entry a copy is **listed under** on the platform (#616, part of #155).
//
// Colnect keys its marketplace on the most precise catalogue number it knows, and a sale attaches to
// one specific variant. A large part of a collection cannot be resolved that far — a colour needs
// comparison material, a gum variety is unidentifiable in principle on a used stamp — and the
// established practice there is to list such a piece under its **cheapest** variant.
//
// The app already answers that question, for a different reason: `valuateCopy` values a copy of an
// unknown-variant umbrella at the lowest price among its variant descendants (#238), at that copy's
// own `condition × certificate × format`. What was missing is that the listing side did not read the
// same answer — the kit took its item-ID off `Stamp.colnectId`, an umbrella carries none, and the
// offer was refused.
//
// So the item-ID is **derived, never stored**, and derived by the very function that values the copy:
// what a listing stands under and what it is valued at cannot then drift apart. Pasting the cheapest
// variant's item-ID onto every umbrella by hand would be a great deal of work *and* a figure frozen
// the day it was pasted, silently invalidated by the next catalogue correction.
//
// Two rules follow from it being a claim about a *listing* rather than about the stamp:
//
//   - **Never written back.** Recording a resolved id on the umbrella would assert that the umbrella
//     *is* that variant, which is exactly what is not known. Only the matcher writes `colnectId`.
//   - **Per condition.** The cheapest variant MNH need not be the cheapest used, so two copies of one
//     umbrella can resolve to two item-IDs — and two umbrellas to one, which `colnect/listing.ts`
//     already deduplicates when declaring a komplet (#410).
//
// What happens when the cheapest variant carries no item-ID of its own, or when no variant is priced
// at all, is deliberately unchanged: the copy resolves to nothing and the existing
// `missing-catalog-id` precondition (#406) refuses the listing, naming it.

/** One copy as the derivation sees it: the axes the rollup is resolved at, plus the id its own stamp
 *  already carries. */
export interface ListingCatalogCopy {
  /** The key the answer comes back under — the caller's own `OfferSetItem.itemId`. */
  itemId: string;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
  /** True when the copy links to a base stamp that has variants (ADR-0010 §3). Only such a copy can
   *  resolve to anything: a stamp with no variants has nothing to stand under but itself. */
  unknownVariant: boolean;
  /** The stamp's own `Stamp.colnectId`, trimmed, or null. */
  ownCatalogItemId: string | null;
}

/** Which catalogue entry one copy is listed under. */
export interface ResolvedCatalogItemId {
  /** The item-ID the form points at, or null when neither the stamp nor a priced variant has one. */
  catalogItemId: string | null;
  /** The variant it was derived from, and **null whenever the copy's own stamp carried the id** —
   *  an umbrella matched by hand still wins, the same precedence `valuateCopy` gives an own price
   *  over the rollup. Non-null is exactly the case a surface marks as inferred (#238's `~`). */
  sourceStampId: string | null;
  /** That variant's leading catalog number with its vendor prefix (`Mi·PL 865a`), for the surfaces
   *  that name what the listing went under. Null with `sourceStampId`. */
  sourceLabel: string | null;
}

/**
 * Resolve every copy's catalogue item-ID, deriving an unknown-variant umbrella's from its cheapest
 * variant (#616).
 *
 * Reads **nothing** unless a copy actually needs it: an offer whose stamps are all matched, and a
 * platform whose module lists against no catalogue at all, pay for one `Map`. Where a derivation is
 * needed, the whole batch is valued in a single `valuateItemRows` call — the workspace resolves a
 * posting session's forty offers at once for the same reason it loads one condition map.
 *
 * The caller has already resolved the collection for its owner, and supplies the labeller it already
 * built for the surface's other labels.
 */
export async function resolveListingCatalogItemIds(
  collectionId: string,
  copies: readonly ListingCatalogCopy[],
  labeller: OfferLabeller
): Promise<Map<string, ResolvedCatalogItemId>> {
  const resolved = new Map<string, ResolvedCatalogItemId>(
    copies.map((c) => [
      c.itemId,
      { catalogItemId: c.ownCatalogItemId, sourceStampId: null, sourceLabel: null },
    ])
  );

  // Only an unmatched umbrella has anything to derive. A matched one keeps its own id: it is a
  // recorded fact about this stamp, and a rollup is an inference about a listing.
  const pending = copies.filter((c) => !c.ownCatalogItemId && c.unknownVariant);
  if (pending.length === 0) return resolved;

  const rows: ValuationRow[] = pending.map((c) => ({
    id: c.itemId,
    stampId: c.stampId,
    conditionId: c.conditionId,
    certificateStatusId: c.certificateStatusId,
    formatId: c.formatId,
    unknownVariant: true,
  }));
  const valuations = await valuateItemRows(collectionId, rows);

  const sourceIds = new Set<string>();
  for (const copy of pending) {
    const sourceStampId = valuations.get(copy.itemId)?.sourceStampId;
    if (sourceStampId) sourceIds.add(sourceStampId);
  }
  if (sourceIds.size === 0) return resolved;

  // The winning variants are stamps the offer does not hold, so their ids and names are read here —
  // a handful of rows per offer, and none at all for a batch that resolved nothing.
  const sources = await prisma.stamp.findMany({
    where: { id: { in: [...sourceIds] } },
    select: { id: true, colnectId: true, ...STAMP_LABEL_SELECT.stamp.select },
  });
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  for (const copy of pending) {
    const sourceStampId = valuations.get(copy.itemId)?.sourceStampId ?? null;
    const source = sourceStampId ? sourceById.get(sourceStampId) : undefined;
    const catalogItemId = source?.colnectId?.trim() || null;
    // A variant that is itself unmatched leaves the copy exactly where it was — unlisted, and named
    // by the existing precondition. Nothing is invented, and no *other* variant is tried: the
    // cheapest one is what the listing would stand under, and the second-cheapest is a different
    // claim about the goods.
    if (!source || !catalogItemId) continue;
    resolved.set(copy.itemId, {
      catalogItemId,
      sourceStampId: source.id,
      // Prefixed with its vendor (`Mi·PL 865a`), unlike a copy's bare number: this names a stamp
      // that is not in the offer, read against the platform's own catalogue (#423's reasoning).
      sourceLabel: labeller.catalogNumbers(source)[0] ?? labeller.copy(source),
    });
  }
  return resolved;
}
