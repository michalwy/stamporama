import "server-only";
import { cookies, headers } from "next/headers";
import { auth } from "./auth";
import { prisma } from "./db";
import {
  SESSION_COOKIE_NAMES,
  sessionEndReason,
  sessionEndSentence,
  sessionTokenFromCookie,
} from "./session-lifetime";

/**
 * One sentence for the sign-in screen when the collector's session ended without them asking, or
 * `null` when there is nothing to explain (#1175).
 *
 * **The condition is "this browser holds a session this instance will not take".** Signing out
 * clears the cookie, so a cookie that is still here while the screen is the sign-in form means
 * something other than the collector ended the session — which is the only case worth a sentence.
 * The `getSession` call is what separates that from the two quiet cases: no cookie at all (a
 * first-time visitor, or someone who signed out), and a cookie that works (the collector navigated
 * to `/sign-in` while signed in).
 *
 * Nothing is cleared afterwards and nothing needs to be: the explanation stays true for as long as
 * the refused cookie is there, and signing in overwrites it.
 */
export async function endedSessionNotice(): Promise<string | null> {
  const jar = await cookies();
  const cookieValue = SESSION_COOKIE_NAMES.map((name) => jar.get(name)?.value).find(
    (value) => !!value
  );
  if (!cookieValue) return null;

  const session = await auth.api.getSession({ headers: await headers() });
  if (session) return null;

  // The token is readable straight out of the signed cookie, which is what makes the three reasons
  // tellable apart at all — a signature that no longer verifies still leaves the token in the
  // clear. Looking it up decides nothing and authorizes nothing; the session was already refused.
  const token = sessionTokenFromCookie(cookieValue);
  const stored = token
    ? await prisma.session.findUnique({ where: { token }, select: { expiresAt: true } })
    : null;

  return sessionEndSentence(sessionEndReason(stored, new Date()));
}
