// **A buyer's link to an offer's specification** (#1760) — the pure half, with no database and no
// `server-only`: whether a string is even one of these tokens, and what a dead link says.
//
// `sale-share-rules.ts`'s job for a simpler link. There is no expiry and nothing for the reader to
// answer, so the only refusal is *this link is not valid*.

/** Every raw token starts with this. `stmpa_` is the Assistant's, `stmpx_` a trade's share link and
 *  `stmps_` a sale's buyer link; credentials authorising different things are told apart before
 *  anything is hashed. */
export const OFFER_SPECIFICATION_SHARE_TOKEN_PREFIX = "stmpo_";

/** Cheap shape check, run before any lookup: anything not carrying our prefix is not ours, and
 *  hashing it to find that out would be a database round trip per stray request. */
export function isOfferSpecificationShareTokenShape(raw: string): boolean {
  return (
    raw.startsWith(OFFER_SPECIFICATION_SHARE_TOKEN_PREFIX) &&
    raw.length > OFFER_SPECIFICATION_SHARE_TOKEN_PREFIX.length
  );
}

/** What a withdrawn, replaced or invented link shows — and nothing of the offer. One sentence for
 *  all three: the reader cannot tell them apart and could do nothing differently if they could. */
export const OFFER_SPECIFICATION_SHARE_REFUSAL =
  "This link is not valid. It may have been withdrawn, or replaced by a newer one.";

/** The public page's address for a raw token. One spelling, so the collector's dialog and anything
 *  else that prints the address cannot drift from the route. */
export function offerSpecificationSharePath(token: string): string {
  return `/spec/${token}`;
}

/** The public thumbnail route's address for one photo on the page a token opens. */
export function offerSpecificationSharePhotoPath(token: string, photoId: string): string {
  return `/api/spec/${token}/photos/${photoId}`;
}
