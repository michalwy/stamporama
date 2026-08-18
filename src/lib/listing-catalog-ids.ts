import "server-only";
import { prisma } from "./db";
import { valuateItemRows, type ValuationRow } from "./item-valuation";
import { STAMP_LABEL_SELECT, type OfferLabeller } from "./offer-labels";
import type { CatalogRollupGap } from "./listing-preconditions";

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
// **A listing may only be derived from a tree that is fully priced** (#617). The rollup picks the
// lowest among the variants that *have* a price, which is a sound estimate — it is flagged uncertain
// and shown as such (#238) — but it is not an answer to "which variant is the cheapest": a collector
// who has so far recorded a price on the dearest variant alone would have every such copy listed
// under exactly that variant, silently. So a copy whose tree has an unpriced variant resolves to
// nothing, however much of the tree is priced. The valuation side is deliberately left as it is: an
// estimate may be marked as an estimate, while a sale attaches to one specific catalogue entry.
//
// When the derivation comes back empty the copy is refused — nothing is ever substituted — and
// **which** way it came back empty is reported, because the two are fixed on different screens: an
// unpriced variant is a gap in the catalogue prices, fixed in that variant's own price grid, while a
// cheapest variant carrying no item-ID is a gap in matching. See {@link CatalogRollupGap}.
//
// ── Saying it by hand ────────────────────────────────────────────────────────
//
// All of the above is a **default**, and a default needs an override. A collector who can rule a
// variant out from the piece in front of them, or who would rather sell under the variant that is
// actually being traded, or who does not want to price a whole tree (#617) to post one offer, records
// the answer on the offer: `OfferListedVariant`, keyed on `offer × stamp × condition`. It reaches
// this function folded onto the copy as {@link ListingCatalogCopy.listedAsStampId}, because the
// caller is the one that knows which offer these copies are being listed by — and the workspace
// resolves forty offers in a single call.
//
// A chosen variant **short-circuits the rollup entirely**: no valuation is asked for that copy, which
// is what makes it an answer where an unpriced tree had none. It resolves off that variant's own
// `colnectId` exactly as the derived one does, so a choice that is not matched is refused in the same
// words, against the stamp the collector picked. What it does *not* do is win over the copy's own
// stamp: an umbrella carrying its own item-ID is a recorded identity, and a listing choice does not
// overrule one — the collector who wants a different entry unmatches the stamp.
//
// The one thing a choice cannot claim is the **valuation**. It was true of a derivation that a
// listing and its value could never drift apart; it cannot be true of a choice. What a copy is worth
// is a fact about the stamp and goes on being the rollup's lowest-variant answer, while what it is
// sold as is a fact about one listing — and the collector overriding this is choosing that drift.
// Which is also why {@link ResolvedCatalogItemId.sourceChosen} exists: a surface that marks a derived
// variant `~` for *inferred* must not mark a recorded decision the same way.

/** The key one hand-picked variant is recorded under — the On Colnect card's own row. */
export function listedVariantKey(
  offerId: string,
  stampId: string,
  conditionId: string
): string {
  return `${offerId}|${stampId}|${conditionId}`;
}

/**
 * The variants these offers name by hand (`OfferListedVariant`), keyed by {@link listedVariantKey}.
 *
 * One query for however many offers the caller holds — the workspace resolves a posting session's
 * whole batch at once, and forty round trips to answer "did anyone override this" would undo the
 * point of resolving the batch in one pass. An offer with no overrides costs nothing beyond the
 * query, and a caller with no offers at all costs not even that.
 */
export async function loadOfferListedVariants(
  offerIds: readonly string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(offerIds)];
  if (ids.length === 0) return new Map();
  const rows = await prisma.offerListedVariant.findMany({
    where: { offerId: { in: ids } },
    select: { offerId: true, stampId: true, conditionId: true, variantStampId: true },
  });
  return new Map(
    rows.map((r) => [listedVariantKey(r.offerId, r.stampId, r.conditionId), r.variantStampId])
  );
}

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
  /** The variant the **offer** says to list this copy under, where the collector has chosen one
   *  (`OfferListedVariant`) — null on every copy that takes the derivation. Folded on by the caller,
   *  which is the half that knows the offer; this function is asked over several offers' copies at
   *  once and has no offer of its own to look one up by. Ignored on a copy whose own stamp carries an
   *  item-ID: that is a recorded identity, and a listing choice does not overrule one. */
  listedAsStampId?: string | null;
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
  /** Whether `sourceStampId` was **chosen by hand on this offer** rather than derived from the price
   *  rollup. False on every derived answer, so the surfaces that mark a derivation `~` for *inferred,
   *  not recorded* (#238) can tell a decision from an inference and stop calling it a guess. */
  sourceChosen: boolean;
  /** Why the derivation resolved nothing (#617), and null whenever it resolved something or was never
   *  asked. It is what lets the preconditions state the two gaps apart. */
  gap: CatalogRollupGap | null;
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
      {
        catalogItemId: c.ownCatalogItemId,
        sourceStampId: null,
        sourceLabel: null,
        sourceChosen: false,
        gap: null,
      },
    ])
  );

  // Only an unmatched umbrella has anything to resolve at all. A matched one keeps its own id: it is
  // a recorded fact about this stamp, which neither a rollup nor a listing choice overrules.
  const open = copies.filter((c) => !c.ownCatalogItemId && c.unknownVariant);
  if (open.length === 0) return resolved;

  // A copy the **offer** names a variant for takes it and asks the rollup nothing — which is what
  // makes a choice an answer where an unpriced tree (#617) had none. Split first, so the valuation
  // below is paid for only by the copies still taking the derivation.
  const chosen = open.filter((c) => c.listedAsStampId);
  const pending = open.filter((c) => !c.listedAsStampId);

  const rows: ValuationRow[] = pending.map((c) => ({
    id: c.itemId,
    stampId: c.stampId,
    conditionId: c.conditionId,
    certificateStatusId: c.certificateStatusId,
    formatId: c.formatId,
    unknownVariant: true,
  }));
  // `rows` is empty when every open copy was chosen by hand, and `valuateItemRows` answers an empty
  // batch without reading anything — so a fully overridden offer pays for no valuation at all.
  const valuations = await valuateItemRows(collectionId, rows);

  // Every stamp whose name this answer may have to state: the variant a copy resolved to, the
  // variants that left it unresolvable by carrying no price (#617), and the ones the offer named
  // itself. One read for all three — they are looked up in exactly the same way.
  const namedIds = new Set<string>();
  for (const copy of chosen) namedIds.add(copy.listedAsStampId!);
  for (const copy of pending) {
    const valuation = valuations.get(copy.itemId);
    if (valuation?.sourceStampId) namedIds.add(valuation.sourceStampId);
    for (const id of valuation?.unpricedVariantIds ?? []) namedIds.add(id);
  }

  // These are stamps the offer does not hold, so their ids and names are read here — a handful of
  // rows per offer, and none at all for a batch that resolved nothing.
  const named =
    namedIds.size === 0
      ? []
      : await prisma.stamp.findMany({
          // Scoped to the collection: the derived ids come from its own rollup, but a **chosen** one
          // arrives as a stored id, and a name resolved outside the collection is a name this answer
          // has no business stating.
          where: { id: { in: [...namedIds] }, collectionId },
          select: { id: true, colnectId: true, ...STAMP_LABEL_SELECT.stamp.select },
        });
  const namedById = new Map(named.map((s) => [s.id, s]));
  // Prefixed with its vendor (`Mi·PL 865a`), unlike a copy's bare number: these name stamps that are
  // not in the offer, read against the platform's own catalogue (#423's reasoning).
  const nameOf = (stamp: (typeof named)[number]) =>
    labeller.catalogNumbers(stamp)[0] ?? labeller.copy(stamp);

  // A variant named by the offer resolves exactly as a derived one does — off its own `colnectId`,
  // with the same refusal against the same stamp when it carries none. The only difference a caller
  // can see is `sourceChosen`, which is how a surface tells a decision from an inference.
  for (const copy of chosen) {
    const source = namedById.get(copy.listedAsStampId!);
    // The stamp is gone, or is not one this read can vouch for: the choice is stale, so the copy
    // falls back to the plain refusal against its own umbrella rather than to a name from nowhere.
    if (!source) continue;
    const sourceLabel = nameOf(source);
    const catalogItemId = source.colnectId?.trim() || null;
    resolved.set(copy.itemId, {
      catalogItemId,
      // Named only where there is an id to attribute it to — the derived branch's rule exactly. A
      // chosen variant that is unmatched is reported as the **gap**, which is what names it onward.
      sourceStampId: catalogItemId ? source.id : null,
      sourceLabel: catalogItemId ? sourceLabel : null,
      sourceChosen: catalogItemId !== null,
      gap: catalogItemId
        ? null
        : { kind: "unmatched-variant", stampId: source.id, label: sourceLabel },
    });
  }

  for (const copy of pending) {
    const valuation = valuations.get(copy.itemId);

    // **Which variant is cheapest is only knowable once every one of them is priced** (#617). A
    // partially priced tree therefore resolves to nothing rather than to the cheapest of what
    // happens to be priced: a single price recorded on the dearest variant would otherwise list the
    // copy under exactly that variant. The valuation keeps its lowest-of-what-is-priced estimate —
    // it is marked uncertain (#238) — but a sale is a claim and may not rest on one.
    const unpricedVariants = (valuation?.unpricedVariantIds ?? [])
      .map((id) => namedById.get(id))
      .filter((stamp): stamp is (typeof named)[number] => stamp !== undefined)
      .map((stamp) => ({ stampId: stamp.id, label: nameOf(stamp) }));
    if (unpricedVariants.length > 0) {
      resolved.set(copy.itemId, {
        catalogItemId: null,
        sourceStampId: null,
        sourceLabel: null,
        sourceChosen: false,
        gap: { kind: "unpriced-variants", variants: unpricedVariants },
      });
      continue;
    }

    const sourceStampId = valuation?.sourceStampId ?? null;
    const source = sourceStampId ? namedById.get(sourceStampId) : undefined;
    if (!source) {
      // Nothing was rolled up at all — the umbrella's **own** catalogue price won the valuation
      // (#616's precedence), or it has no variant prices to roll up and none missing either. There is
      // no rollup gap to report: the umbrella itself is the stamp that wants matching, which is what
      // the plain refusal already says.
      continue;
    }
    const sourceLabel = nameOf(source);
    const catalogItemId = source.colnectId?.trim() || null;
    if (!catalogItemId) {
      // A variant that is itself unmatched leaves the copy unlisted, and the fault is named against
      // **that variant** (#617) rather than against the umbrella — it is the stamp an item-ID would
      // be recorded on. Nothing is invented, and no *other* variant is tried: the cheapest one is
      // what the listing would stand under, and the second-cheapest is a different claim about the
      // goods. `sourceStampId` stays null, there being no derived id for a surface to mark inferred.
      resolved.set(copy.itemId, {
        catalogItemId: null,
        sourceStampId: null,
        sourceLabel: null,
        sourceChosen: false,
        gap: { kind: "unmatched-variant", stampId: source.id, label: sourceLabel },
      });
      continue;
    }
    resolved.set(copy.itemId, {
      catalogItemId,
      sourceStampId: source.id,
      sourceLabel,
      sourceChosen: false,
      gap: null,
    });
  }
  return resolved;
}
