// Where signing in takes the collector, and how the screen they were dropped from gets there
// (#1176).
//
// Reaching the sign-in screen used to cost a collector their place as well as their session:
// signing back in always landed on the collections list, so whatever was open — an intake sheet, an
// offer, an album page — had to be found again through the sidebar. The screen they came from
// travels to `/sign-in` as a query parameter and signing in sends them back to it.
//
// **Every rule that decides anything is here, and pure, deliberately.** The two halves that cannot
// be are a line each: `src/proxy.ts` writes the current screen onto the request, and
// `src/lib/sign-in-redirect.ts` reads it back. What is worth a test is which destinations are
// allowed at all — an unchecked destination is the standard way this feature turns into an open
// redirect — and that decision is held below rather than at any of the ninety-odd places that
// redirect to the sign-in screen.

/** The query parameter carrying the screen to come back to. */
export const RETURN_TO_PARAM = "next";

/**
 * Where signing in lands with nowhere to return to — today's behaviour, kept.
 *
 * It is also the answer whenever a destination is unusable. That is a deliberate choice over
 * telling the collector their return address was rejected: they did not type it, they cannot act on
 * it, and the collections list is one click from everywhere.
 */
export const SIGN_IN_LANDING = "/collections";

/**
 * The request header `src/proxy.ts` writes the current screen onto.
 *
 * A server component knows its `params`, not the address the browser asked for, and a server action
 * knows neither. The proxy sees every request the collector makes, so it is the one place that can
 * say where they are — and because it **sets** the header on every request it matches, a value a
 * browser sends under this name is overwritten rather than trusted.
 */
export const CURRENT_SCREEN_HEADER = "x-stamporama-screen";

/**
 * The address of the screen a request is for: its path, plus the query the collector can see.
 *
 * `_rsc` is Next's own cache-busting parameter on a client-side navigation. It is on the URL the
 * proxy sees but not on the one in the address bar, and carrying it into a return address would
 * send the collector back to a request rather than to a screen.
 */
export function screenPath(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("_rsc");
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/**
 * Whether a value names a screen inside this app that is worth returning to.
 *
 * Four refusals, and the first two are the whole of the security question:
 *
 * - **Anything that is not a path of this app.** `https://elsewhere/`, `elsewhere.com`, and the
 *   protocol-relative `//elsewhere` — which a browser reads as another site despite its leading
 *   slash — are all refused. `\` is checked alongside `/` because browsers normalise it to one, and
 *   a value that arrived percent-encoded has already been decoded by the time it reaches here.
 * - **The sign-in and sign-up screens themselves**, which would send the collector back to a form
 *   they have just finished with.
 * - **The collections list**, because it is where signing in lands anyway; saying so twice would
 *   put a return address on the sign-in URL that changes nothing.
 */
export function isReturnableScreen(value: string | null | undefined): value is string {
  if (!value) return false;
  if (!value.startsWith("/")) return false;
  if (value[1] === "/" || value[1] === "\\") return false;

  const pathname = value.split(/[?#]/, 1)[0];
  return pathname !== "/sign-in" && pathname !== "/sign-up" && pathname !== SIGN_IN_LANDING;
}

/** The sign-in screen's address, carrying `screen` as the place to come back to when it is one. */
export function signInPathFrom(screen: string | null | undefined): string {
  if (!isReturnableScreen(screen)) return "/sign-in";
  return `/sign-in?${RETURN_TO_PARAM}=${encodeURIComponent(screen)}`;
}

/** Where this sign-in should land, given the return address on its URL. */
export function landingAfterSignIn(returnTo: string | null | undefined): string {
  return isReturnableScreen(returnTo) ? returnTo : SIGN_IN_LANDING;
}
