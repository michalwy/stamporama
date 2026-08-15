import { normalizeBaseUrl, type Profile } from "../core/profile";
import type { LotMarkerTarget } from "../core/lot-marker";

// "Which of these listings am I already tracking as auction lots?" asked of the instance (#575), the
// buying-side twin of `offer-lookup-client.ts` (#466) and run from the background service worker for
// its reason: the asker is a content script on allegro.pl, the instance is a different origin, and
// only the worker's `host_permissions` exempt the call from CORS — and the profile's token must
// never reach a page that is not ours.

/** The instance's answer, mirrored by hand as `core/decisions.ts` mirrors the matcher's — the
 *  extension is a separate build with no import path into the app. `path` is **relative**: the
 *  instance answers where the lot is on itself, and the origin is the one this profile
 *  authenticated against, never one the answer could name. */
interface AuctionLotListingMatch {
  platformOfferId: string;
  lotId: string;
  auctionLotNo: number;
  title: string;
  saleName: string;
  outcome: string;
  path: string;
  matchedBy: "lot-no" | "url";
}

/** What one asked-about listing turned out to be, by its marketplace id. Ids that matched nothing
 *  are simply absent — nearly every auction a collector opens is one they have never bid on. */
export type LotLookupMatches = Record<string, LotMarkerTarget>;

export type LotLookupResult =
  | { ok: true; matches: LotLookupMatches }
  | { ok: false; error: string };

/** How many ids go in one request, as the offer lookup batches: the endpoint has a cap of its own,
 *  and this keeps a caller that ever asks about a list from sending one enormous URL. */
const BATCH_SIZE = 100;

/**
 * Ask `profile`'s instance which auction lots, if any, track `platformOfferIds`.
 *
 * A miss is an absent entry and not an error: the overwhelming majority of listings are auctions
 * nobody here is bidding on, and this runs on every one of them the collector opens.
 */
export async function callLotLookup(
  profile: Profile,
  platformOfferIds: string[]
): Promise<LotLookupResult> {
  const base = normalizeBaseUrl(profile.apiBaseUrl);
  const ids = [...new Set(platformOfferIds)];
  const matches: LotLookupMatches = {};

  for (let from = 0; from < ids.length; from += BATCH_SIZE) {
    const batch = ids.slice(from, from + BATCH_SIZE);
    const query = batch.map((id) => `platformOfferId=${encodeURIComponent(id)}`).join("&");
    const url = `${base}/api/collections/${profile.collectionId}/auctions/lots/by-listing?${query}`;

    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${profile.token}` } });
    } catch {
      return { ok: false, error: "Could not reach the instance." };
    }
    if (res.status === 401) return { ok: false, error: "Unauthorized — check the profile token." };
    if (!res.ok) return { ok: false, error: `Lookup failed (HTTP ${res.status}).` };

    const body = (await res.json().catch(() => ({}))) as { matches?: AuctionLotListingMatch[] };
    for (const match of body.matches ?? []) {
      if (!match?.platformOfferId || typeof match.path !== "string") continue;
      matches[match.platformOfferId] = {
        // Built here, from the base URL this profile is connected to. The page is handed a finished
        // address rather than the parts of one: a content script running inside a marketplace has no
        // business knowing how an instance's URLs are put together.
        url: `${base}${match.path}`,
        auctionLotNo: match.auctionLotNo,
        title: match.title,
        saleName: match.saleName,
        outcome: match.outcome,
      };
    }
  }

  return { ok: true, matches };
}
