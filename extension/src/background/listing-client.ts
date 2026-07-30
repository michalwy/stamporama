import { getProfileStore, normalizeBaseUrl, type Profile } from "../core/profile";

// Posting a listing's URL back to the instance (#412) — the fallback half of the write-back.
//
// The answer normally goes to the **page** that handed the offer over, which then publishes it
// itself: the extension reports and the instance decides (#407). But the answer arrives after Save,
// which may be minutes later, and by then the workspace tab may be closed, navigated away, or busy
// with the next offer's handoff. The URL is the one thing that cannot be recovered afterwards — it is
// precisely the field that goes stale when it is left to be pasted by hand — so when no page takes
// it, it is posted straight to the instance.
//
// The instance still decides what it means: the endpoint performs `ready → active` and writes the
// URL through `publishOffer`, and refuses anything else. All this carries is the observation.

/**
 * The connected profile for `origin` + `collectionId`, or null.
 *
 * A listing task carries the collection it belongs to, and the page that wrote it carries the origin
 * — together they name exactly one connection, which is what makes this safe to do without asking:
 * the token used is the one the collector issued from that very collection. Two collections on one
 * instance are two profiles, so the collection has to match as well as the host.
 */
export async function profileForListing(
  origin: string | null,
  collectionId: string
): Promise<Profile | null> {
  if (!origin) return null;
  const { profiles } = await getProfileStore();
  return (
    profiles.find(
      (p) => normalizeBaseUrl(p.apiBaseUrl) === normalizeBaseUrl(origin) && p.collectionId === collectionId
    ) ?? null
  );
}

/**
 * Record `url` as this offer's listing and take it live. Idempotent on the instance's side, so racing
 * the page's own publication is a no-op rather than a conflict.
 *
 * Throws with a sentence worth showing: the caller has a collector to tell, and a silent failure here
 * would leave an offer Ready with a live listing behind it.
 */
export async function postListedUrl(
  profile: Profile,
  offerId: string,
  url: string
): Promise<void> {
  const endpoint = `${normalizeBaseUrl(profile.apiBaseUrl)}/api/collections/${profile.collectionId}/offers/${offerId}/listed`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.token}` },
    body: JSON.stringify({ url }),
  });
  if (res.status === 401) throw new Error("Unauthorized — check the connection's token.");
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "The instance would not activate this offer.");
  }
  if (!res.ok) throw new Error(`Could not record the listing (HTTP ${res.status}).`);
}
