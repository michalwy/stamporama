// The phone screens' addresses and where the home-screen icon lands (#2002, ADR-0072).
//
// Pure, so the unit suite holds it: the one decision here is what `/phone` does with the collector's
// collections, and it is the decision a phone screen added later must not have to re-make.

/** What the home-screen icon opens (the manifest's `start_url`). */
export const PHONE_START_PATH = "/phone";

/** A collection's phone start screen — the full app's link to the phone, and the icon's landing. */
export function phoneHomePath(collectionSlug: string): string {
  return `/c/${collectionSlug}/phone`;
}

/** One stamp's phone screen (#2003) — what a search hit and a browsed stamp open on the phone. */
export function phoneStampPath(collectionSlug: string, stampId: string): string {
  return `${phoneHomePath(collectionSlug)}/stamps/${stampId}`;
}

export type PhoneStart =
  /** Exactly one collection: straight into it. */
  | { kind: "collection"; href: string }
  /** Several: the phone's own list to choose from. */
  | { kind: "choose" }
  /** None yet: a collection is created at the desk, so the phone says so and links there. */
  | { kind: "none" };

/**
 * Where `/phone` takes the collector. **No collection is remembered**: with several, the list is one
 * tap, and a remembered choice would be one more thing that can be stale on a phone the collector
 * picks up once a fortnight at a fair.
 */
export function phoneStart(collections: readonly { slug: string }[]): PhoneStart {
  if (collections.length === 0) return { kind: "none" };
  if (collections.length === 1) return { kind: "collection", href: phoneHomePath(collections[0].slug) };
  return { kind: "choose" };
}
