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

/** Browsing (#2005): the collection's top-level areas, where area → year → issue → stamp starts. */
export function phoneBrowsePath(collectionSlug: string): string {
  return `${phoneHomePath(collectionSlug)}/browse`;
}

/** One area while browsing: its sub-areas and the years of its own issues. */
export function phoneBrowseAreaPath(collectionSlug: string, areaId: string): string {
  return `${phoneBrowsePath(collectionSlug)}/areas/${areaId}`;
}

/**
 * The address segment of the issues with no year — the desk's issue list says `none` for that bucket
 * (`IssueListFilterOpts.year`), and the phone says the same.
 */
export const PHONE_NO_YEAR = "none";

/** One year of one area's issues; `null` is the issues with no year. */
export function phoneBrowseYearPath(
  collectionSlug: string,
  areaId: string,
  year: number | null
): string {
  return `${phoneBrowseAreaPath(collectionSlug, areaId)}/${year === null ? PHONE_NO_YEAR : year}`;
}

/** What a year segment of the address says: a year, the no-year bucket, or nothing this screen has. */
export function parsePhoneYear(segment: string): number | null | undefined {
  if (segment === PHONE_NO_YEAR) return null;
  if (!/^\d{1,4}$/.test(segment)) return undefined;
  return Number(segment);
}

/** One issue's stamps while browsing — what a stamp on the phone is opened from. */
export function phoneBrowseIssuePath(collectionSlug: string, issueId: string): string {
  return `${phoneBrowsePath(collectionSlug)}/issues/${issueId}`;
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
