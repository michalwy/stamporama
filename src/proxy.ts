import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAMES,
  SESSION_MAX_AGE_SECONDS,
  isSecureSessionCookieName,
} from "@/lib/session-lifetime";
import { CURRENT_SCREEN_HEADER, screenPath } from "@/lib/sign-in-return";

// **Renew the session cookie's lease on every request the collector makes** (#1175).
//
// Better Auth writes that cookie once, at sign-in, and re-issues it only onto a response it
// controls. This app reads the session with `auth.api.getSession({ headers })` from server
// components and server actions, both of which throw the `Set-Cookie` away, so without this the
// cookie expires on a clock that started when the collector signed in and nothing they do resets
// it — which is exactly how they came to be signed out mid-task. The reasoning, and why the
// server-side span alone is not enough, is in `src/lib/session-lifetime.ts`.
//
// **It re-issues the cookie verbatim and verifies nothing.** The value is opaque here: extending
// how long a browser keeps a credential is not the same decision as accepting it, and every request
// that carries it still has it checked, server-side, by Better Auth. That is what lets this run on
// the Edge runtime with no secret, no database and no Prisma — a middleware that authorized would
// need all three. Next decodes a request cookie and re-encodes a response cookie with the same
// rules, so the bytes that go back out are the bytes that came in.
//
// The attributes are Better Auth's own defaults for this cookie (`httpOnly`, `SameSite=Lax`,
// `Path=/`), and `Secure` is read off the cookie's name rather than from configuration: the
// `__Secure-` prefix is added by Better Auth exactly when it sets the flag, so the name the browser
// sent already answers the question.
//
// **It also tells the request which screen it is for** (#1176), and that is the whole of its second
// job. A server component is given its `params`, never the address the browser asked for, and a
// server action is given neither — so without this, a redirect to the sign-in screen cannot say
// where the collector was and signing back in has to land on the collections list. This is
// information and not authorization: nothing downstream is permitted by it, and the header is
// **set** rather than added, so a browser sending one of its own has it overwritten. The rules that
// read it are in `src/lib/sign-in-return.ts`.

export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    CURRENT_SCREEN_HEADER,
    screenPath(request.nextUrl.pathname, request.nextUrl.search)
  );

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  for (const name of SESSION_COOKIE_NAMES) {
    const cookie = request.cookies.get(name);
    if (!cookie) continue;
    response.cookies.set({
      name,
      value: cookie.value,
      maxAge: SESSION_MAX_AGE_SECONDS,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isSecureSessionCookieName(name),
    });
  }

  return response;
}

export const config = {
  // **`/api/auth` is excluded, and that exclusion is what keeps signing out immediate.** Better
  // Auth's own routes are the ones that mint and clear this cookie: `/api/auth/sign-out` answers
  // with `Set-Cookie: …; Max-Age=0`, and a renewal added to the same response would be a second
  // `Set-Cookie` for the same name whose ordering nothing guarantees. Those routes never need a
  // renewal from here anyway — they write the cookie themselves.
  //
  // The rest is Next's own static output, which no collector's session depends on and which should
  // not be made uncacheable by a `Set-Cookie` header.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
