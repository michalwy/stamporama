// Existing-offer collisions by **stamp × condition** (#513) — the pure half. No React, no Prisma,
// so the server read, the picker and the unit tests share one derivation.
//
// Colnect refuses a second offer for the same stamp in the same condition (#372's duplicate key,
// whose *fixed* part this is), so a copy going onto a listing whose platform already holds a
// sibling of it produces an offer that cannot be posted. The check `findOfferCollisions` (#167)
// already does is a different question — *this very copy* listed twice — and stays as it is: a
// destination reports the copies it already holds through `containsItemIds`, and a copy counted
// there is deliberately **not** counted here. One fact, one vocabulary.
//
// Nothing is blocked either way. It is a warning: a collector who knows what they are doing (two
// platforms, a deliberate re-list) may proceed.

import { copyGroupKey, encodeCopyGroupKey, DEFAULT_GROUP_AXES, type GroupableCopy } from "./copy-groups";

/** A copy considered for adding, or one an offer already lists. `stampId`/`conditionId` are all the
 * key reads — `GroupableCopy`'s other two axes are zeroed by {@link DEFAULT_GROUP_AXES}. */
export interface CollisionCopy {
  itemId: string;
  stampId: string;
  conditionId: string;
}

/** One copy already listed on an offer, as the membership rows come back. */
export interface OfferMemberCopy extends CollisionCopy {
  offerId: string;
}

function keyOf(copy: CollisionCopy): string {
  const groupable: GroupableCopy = {
    stampId: copy.stampId,
    conditionId: copy.conditionId,
    formatId: null,
    certificateStatusId: null,
  };
  return encodeCopyGroupKey(copyGroupKey(groupable, DEFAULT_GROUP_AXES), DEFAULT_GROUP_AXES);
}

/**
 * For each offer, which of `candidates` it would duplicate: a copy whose stamp + condition the
 * offer already lists **through a different copy**. A candidate the offer already holds is left
 * out — that is `containsItemIds`' fact, not this one.
 *
 * Offers with nothing to report are absent from the map, so its size is the number of conflicts.
 */
export function collidingItemIdsByOffer(
  candidates: readonly CollisionCopy[],
  members: readonly OfferMemberCopy[]
): Map<string, string[]> {
  const candidateIds = new Set(candidates.map((c) => c.itemId));
  // key → the offers already listing that stamp+condition, and through which copies.
  const byOffer = new Map<string, { keys: Set<string>; holds: Set<string> }>();
  for (const member of members) {
    let entry = byOffer.get(member.offerId);
    if (!entry) {
      entry = { keys: new Set(), holds: new Set() };
      byOffer.set(member.offerId, entry);
    }
    // Every listed copy contributes its key — including one that is *itself* a candidate, since a
    // second candidate sharing that key would still be the offer's second copy of the stamp. What
    // a listed candidate does not do is collide with itself, which is what `holds` remembers.
    entry.keys.add(keyOf(member));
    if (candidateIds.has(member.itemId)) entry.holds.add(member.itemId);
  }

  const out = new Map<string, string[]>();
  for (const [offerId, { keys, holds }] of byOffer) {
    const hit = candidates
      .filter((c) => !holds.has(c.itemId) && keys.has(keyOf(c)))
      .map((c) => c.itemId);
    if (hit.length > 0) out.set(offerId, hit);
  }
  return out;
}
