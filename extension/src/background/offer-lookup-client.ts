import { normalizeBaseUrl, type Profile } from "../core/profile";
import type { OfferMarkerTarget } from "../core/offer-marker";

// "Which of these listings are ours?" asked of the instance (#466), run from the background service
// worker so `host_permissions` exempts it from CORS — the asker is a content script on allegro.pl
// and the instance is a different origin. Authenticates with the active profile's bearer token,
// exactly as the matcher, the listing kit and the capture do.

/** The instance's answer, mirrored by hand as `core/decisions.ts` mirrors the matcher's — the
 *  extension is a separate build with no import path into the app. `path` is **relative**: the
 *  instance answers where the offer is on itself, and the origin is the one this profile
 *  authenticated against, never one the answer could name. */
interface OfferListingMatch {
  platformOfferId: string;
  offerId: string;
  offerNo: number;
  title: string;
  state: string;
  path: string;
  matchedBy: "listing" | "order" | "url";
}

/** What one asked-about listing turned out to be, by its marketplace id. Ids that matched nothing
 *  are simply absent — most listings a collector opens are somebody else's. */
export type OfferLookupMatches = Record<string, OfferMarkerTarget>;

export type OfferLookupResult =
  | { ok: true; matches: OfferLookupMatches }
  | { ok: false; error: string };

/** How many ids go in one request. The endpoint has a cap of its own; this keeps a page of a
 *  thousand rows from being asked as one enormous URL. */
const BATCH_SIZE = 100;

/**
 * Ask `profile`'s instance which offers, if any, are listed at `platformOfferIds`.
 *
 * A miss is an absent entry and not an error: the overwhelming majority of marketplace listings are
 * somebody else's, and this runs on every one of them the collector opens.
 */
export async function callOfferLookup(
  profile: Profile,
  platformOfferIds: string[]
): Promise<OfferLookupResult> {
  const base = normalizeBaseUrl(profile.apiBaseUrl);
  const ids = [...new Set(platformOfferIds)];
  const matches: OfferLookupMatches = {};

  for (let from = 0; from < ids.length; from += BATCH_SIZE) {
    const batch = ids.slice(from, from + BATCH_SIZE);
    const query = batch.map((id) => `platformOfferId=${encodeURIComponent(id)}`).join("&");
    const url = `${base}/api/collections/${profile.collectionId}/offers/by-listing?${query}`;

    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${profile.token}` } });
    } catch {
      return { ok: false, error: "Could not reach the instance." };
    }
    if (res.status === 401) return { ok: false, error: "Unauthorized — check the profile token." };
    if (!res.ok) return { ok: false, error: `Lookup failed (HTTP ${res.status}).` };

    const body = (await res.json().catch(() => ({}))) as { matches?: OfferListingMatch[] };
    for (const match of body.matches ?? []) {
      if (!match?.platformOfferId || typeof match.path !== "string") continue;
      matches[match.platformOfferId] = {
        // Built here, from the base URL this profile is connected to. The page is handed a finished
        // address rather than the parts of one: a content script running inside a marketplace has no
        // business knowing how an instance's URLs are put together.
        url: `${base}${match.path}`,
        offerNo: match.offerNo,
        title: match.title,
        state: match.state,
      };
    }
  }

  return { ok: true, matches };
}
