import "server-only";
import { headers } from "next/headers";
import { CURRENT_SCREEN_HEADER, signInPathFrom } from "./sign-in-return";

/**
 * The address to send an unauthenticated request to, carrying the screen it was asking for (#1176).
 *
 * This is the read half of the pair described in `sign-in-return.ts`; the rules it applies are all
 * there. It is deliberately shaped to slot into the existing line — `redirect(await signInPath())`
 * rather than a helper that redirects — because `redirect()` is declared to return `never` and that
 * is what narrows `session` to non-null in every one of its callers.
 *
 * **Nowhere to return to is an answer, not a failure.** A request that did not come through
 * `src/proxy.ts` carries no header, and one that came from a background action names a screen the
 * collector is not looking at; both land on the collections list, which is where signing in landed
 * before this existed.
 */
export async function signInPath(): Promise<string> {
  return signInPathFrom((await headers()).get(CURRENT_SCREEN_HEADER));
}
