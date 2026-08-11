import { normalizeBaseUrl, type Profile } from "../core/profile";
import type { SearchAnswer } from "../core/search";

// "Have I got this?" asked of the instance (#529), run from the background service worker so
// `host_permissions` exempts it from CORS — the asker is an extension page and the instance is a
// different origin. Authenticates with the active profile's bearer token, exactly as the matcher,
// the listing kit, the capture and the offer lookup do.

/** The instance's own answer, whose rows carry **relative** paths: it says where a row is on itself,
 *  and the origin is the one this profile authenticated against. */
interface SearchResponseBody {
  query: string;
  stamps: (Omit<SearchAnswer["stamps"][number], "url"> & { path: string })[];
  issues: (Omit<SearchAnswer["issues"][number], "url"> & { path: string })[];
  copies: (Omit<SearchAnswer["copies"][number], "url"> & { path: string })[];
}

export type SearchCallResult = { ok: true; answer: SearchAnswer } | { ok: false; error: string };

/** Ask `profile`'s instance what it holds matching `query`. */
export async function callSearch(profile: Profile, query: string): Promise<SearchCallResult> {
  const base = normalizeBaseUrl(profile.apiBaseUrl);
  const url = `${base}/api/collections/${profile.collectionId}/search?q=${encodeURIComponent(query)}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${profile.token}` } });
  } catch {
    return { ok: false, error: "Could not reach the instance. Is it running?" };
  }
  if (res.status === 401) return { ok: false, error: "Unauthorized — check the profile token." };
  if (!res.ok) return { ok: false, error: `Search failed (HTTP ${res.status}).` };

  const body = (await res.json().catch(() => null)) as SearchResponseBody | null;
  if (!body) return { ok: false, error: "The instance answered something unreadable." };

  // Every address is finished here, from the base URL this profile is connected to. A window that
  // built them itself would be a second place that knows how an instance's URLs are put together.
  const absolute = <T extends { path: string }>(row: T) => {
    const { path, ...rest } = row;
    return { ...rest, url: `${base}${path}` };
  };

  return {
    ok: true,
    answer: {
      query: body.query ?? query,
      stamps: (body.stamps ?? []).map(absolute),
      issues: (body.issues ?? []).map(absolute),
      copies: (body.copies ?? []).map(absolute),
    },
  };
}
