// Existing-offer collisions by **stamp × condition** (#513, narrowed by #732) — the pure half. No
// React, no Prisma, so the server read, the picker and the unit tests share one derivation.
//
// Colnect refuses a second offer for the same *item* in the same condition, and an item on a
// marketplace is a **composition**: the series 1–3 and the single stamp 2 are two different entries
// there, not one. So the question this answers is set equality — does one of the offer's sets hold
// exactly the stamps, in exactly the conditions, that the selection holds — and not "does this
// offer contain a stamp I am also holding", which was #513's first reading and fired on the
// ordinary act of listing one stamp out of a listed series (#732). A strict subset or superset of a
// set duplicates nothing and is silent.
//
// The check `findOfferCollisions` (#167) is a different question — *this very copy* listed twice —
// and stays as it is: a destination reports the copies it already holds through `containsItemIds`,
// and a copy counted there is deliberately **not** counted here. One fact, one vocabulary.
//
// Nothing is blocked either way. It is a warning: a collector who knows what they are doing (two
// platforms, a deliberate re-list) may proceed.
//
// **A set is compared by what it will be listed as** (#1347). A platform that lists an unknown-variant
// umbrella under its cheapest variant (#616) puts a copy of `523` and a copy of `523I` on one and the
// same marketplace entry whenever `523I` is what `523` resolves to, so on such a platform a copy's key
// reads the stamp it is *listed under* rather than the one it is recorded on. The resolution is the
// listing's own (`resolveListingCatalogItemIds`), made by the caller and handed in as
// {@link CollisionCopy.listedStampId}: the check and the listing must never disagree about what an
// offer is. A platform that lists the umbrella itself compares recorded stamps, as before.

import { copyGroupKey, encodeCopyGroupKey, DEFAULT_GROUP_AXES, type GroupableCopy } from "./copy-groups";

/** A copy considered for adding, or one an offer already lists. `stampId`/`conditionId` are all the
 * key reads — `GroupableCopy`'s other two axes are zeroed by {@link DEFAULT_GROUP_AXES}. */
export interface CollisionCopy {
  itemId: string;
  stampId: string;
  conditionId: string;
  /** The stamp this copy is **listed under** on a platform that lists an umbrella as its resolved
   *  variant (#1347) — `stampId` itself wherever nothing resolves, and absent meaning the same. Read
   *  only against a set whose offer is on such a platform. A candidate's is the derivation a new
   *  listing would make; a member's is its own offer's, a variant chosen by hand included. */
  listedStampId?: string | null;
}

/** One copy already listed on an offer, as the membership rows come back. The **set** it sits in is
 * carried because the comparison is per set (#732): an offer is compared composition by
 * composition, so its members have to arrive grouped the way the marketplace would see them. Every
 * copy of a candidate set must be present, not only the ones sharing a stamp with the selection —
 * a set of 1–3 read as `{2}` would match a `{2}` selection and report the very collision this rule
 * exists to stop reporting. */
export interface OfferMemberCopy extends CollisionCopy {
  offerId: string;
  offerSetId: string;
  /** Whether the member's offer is on a platform that lists an umbrella under its resolved variant
   *  (#1347), and so whether its set is compared by listed stamps. One answer per offer. */
  listsResolved?: boolean;
}

function keyOf(copy: CollisionCopy, listed: boolean): string {
  const groupable: GroupableCopy = {
    stampId: (listed ? copy.listedStampId : null) ?? copy.stampId,
    conditionId: copy.conditionId,
    formatId: null,
    certificateStatusId: null,
  };
  return encodeCopyGroupKey(copyGroupKey(groupable, DEFAULT_GROUP_AXES), DEFAULT_GROUP_AXES);
}

/**
 * For each offer, which of `candidates` it would duplicate on the marketplace: an offer holding a
 * **set of exactly the same stamps in exactly the same conditions** as the selection (#732).
 *
 * Set equality on distinct stamp × condition keys — the stamp being the one each copy is **listed
 * under** where the set's platform resolves umbrellas (#1347) — so quantity does not enter into it; selecting
 * the series twice over is the same entry at a larger quantity, and collides just as one does. The
 * comparison is per **set**, not per offer: a mixed offer is asked about each of its compositions
 * in turn, and matching any one of them is the conflict.
 *
 * A candidate the offer already holds is left out of the answer — that is `containsItemIds`' fact,
 * not this one — and an offer left with nothing to report drops out with it, so the map's size is
 * the number of conflicts.
 */
export function collidingItemIdsByOffer(
  candidates: readonly CollisionCopy[],
  members: readonly OfferMemberCopy[]
): Map<string, string[]> {
  if (candidates.length === 0) return new Map();
  // What the selection would put on the marketplace, as one composition — read both ways, since the
  // members may sit on platforms of both kinds and each set is compared in its own platform's terms.
  const wantedRecorded = new Set(candidates.map((c) => keyOf(c, false)));
  const wantedListed = new Set(candidates.map((c) => keyOf(c, true)));
  const candidateIds = new Set(candidates.map((c) => c.itemId));

  // Each set's own composition, and — per offer — which candidates it literally already lists.
  const bySet = new Map<string, { offerId: string; listed: boolean; keys: Set<string> }>();
  const holdsByOffer = new Map<string, Set<string>>();
  for (const member of members) {
    let set = bySet.get(member.offerSetId);
    if (!set) {
      set = { offerId: member.offerId, listed: member.listsResolved ?? false, keys: new Set() };
      bySet.set(member.offerSetId, set);
    }
    set.keys.add(keyOf(member, set.listed));
    if (candidateIds.has(member.itemId)) {
      let holds = holdsByOffer.get(member.offerId);
      if (!holds) {
        holds = new Set();
        holdsByOffer.set(member.offerId, holds);
      }
      holds.add(member.itemId);
    }
  }

  const matched = new Set<string>();
  for (const { offerId, listed, keys } of bySet.values()) {
    const wanted = listed ? wantedListed : wantedRecorded;
    if (keys.size === wanted.size && [...wanted].every((k) => keys.has(k))) matched.add(offerId);
  }

  const out = new Map<string, string[]>();
  for (const offerId of matched) {
    const holds = holdsByOffer.get(offerId);
    // The whole selection is the duplicate, bar the copies this offer is already the home of.
    const hit = candidates.filter((c) => !holds?.has(c.itemId)).map((c) => c.itemId);
    if (hit.length > 0) out.set(offerId, hit);
  }
  return out;
}
