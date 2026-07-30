// The instance's own absolute URLs (#415). Everything the app shows a collector is reached through
// Next's routing, so an absolute URL is only ever needed for the one case routing cannot serve: a
// link that leaves the instance and has to point back at it — the `{offerUrl}` token a listing text
// carries onto a marketplace page.
//
// The base is `BETTER_AUTH_URL`, which a deployment already has to set correctly (Better Auth
// redirects through it), rather than a second setting that could disagree with it. Unset — a
// misconfigured install — yields null and the token simply renders empty: a relative path is worse
// than nothing once the text is sitting on someone else's site.

/** This instance's base URL without a trailing slash, or null when it is not configured. */
export function appBaseUrl(): string | null {
  const raw = process.env.BETTER_AUTH_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/** The absolute URL of one offer's own screen, or null when {@link appBaseUrl} is unset. Mirrors the
 * route `/c/[collectionSlug]/offers/[offerId]`. */
export function offerScreenUrl(collectionSlug: string, offerId: string): string | null {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/c/${encodeURIComponent(collectionSlug)}/offers/${encodeURIComponent(offerId)}`;
}
