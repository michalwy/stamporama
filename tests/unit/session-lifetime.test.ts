import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy, config } from "@/proxy";
import {
  SESSION_COOKIE_NAMES,
  SESSION_MAX_AGE_SECONDS,
  SESSION_REFRESH_AGE_SECONDS,
  isSecureSessionCookieName,
  sessionEndReason,
  sessionEndSentence,
  sessionTokenFromCookie,
} from "@/lib/session-lifetime";

// #1175 — a collector was returned to the sign-in screen in the middle of working, because the
// session cookie carried a seven-day `Max-Age` that nothing ever re-issued. What is pinned here is
// the promise rather than the implementation: ordinary use does not end a session, and a session
// that ends for a real reason is explained.

const DAY = 24 * 60 * 60;

describe("how long a session lasts", () => {
  it("outlasts every span the collector was promised", () => {
    // The report's own two cases: working continuously, and coming back a fortnight later. Stated
    // as a year so that a future edit shortening this to something plausible-but-wrong — a month,
    // a quarter — fails here rather than on the collector's screen.
    assert.ok(
      SESSION_MAX_AGE_SECONDS > 365 * DAY,
      `a session must outlast a year; got ${SESSION_MAX_AGE_SECONDS / DAY} days`
    );
  });

  it("refreshes the stored row well inside its own lifetime", () => {
    // Better Auth slides `expiresAt` once `updateAge` has passed since the last refresh. If that
    // were ever set at or above the lifetime, the row would expire without once being renewed.
    assert.ok(SESSION_REFRESH_AGE_SECONDS < SESSION_MAX_AGE_SECONDS);
  });
});

describe("the session cookie's names", () => {
  it("covers the plain and the Secure spelling, and only those", () => {
    assert.deepEqual(
      [...SESSION_COOKIE_NAMES],
      ["better-auth.session_token", "__Secure-better-auth.session_token"]
    );
  });

  it("reads the Secure flag off the name Better Auth chose", () => {
    assert.equal(isSecureSessionCookieName("better-auth.session_token"), false);
    assert.equal(isSecureSessionCookieName("__Secure-better-auth.session_token"), true);
  });
});

describe("reading the token out of a signed cookie", () => {
  it("takes everything before the first dot", () => {
    assert.equal(sessionTokenFromCookie("abc123.c2lnbmF0dXJl"), "abc123");
  });

  it("is unbothered by a base64 signature's own alphabet", () => {
    // `+`, `/` and `=` all appear in a base64 signature and none of them is a dot, which is the
    // whole reason the first dot is an unambiguous boundary.
    assert.equal(sessionTokenFromCookie("Tok3n.a+b/c=="), "Tok3n");
  });

  it("cuts at the first dot, which is where the alphanumeric token ends", () => {
    // No real value has two dots — the token is letters and digits, the signature is base64 — so
    // this pins the documented reading rather than a case in the wild. It is the safe one either
    // way: whatever follows the first dot is not part of the token.
    assert.equal(sessionTokenFromCookie("tok.en.sig"), "tok");
  });

  it("refuses a value that is not a signed cookie", () => {
    assert.equal(sessionTokenFromCookie("nodothere"), null);
    assert.equal(sessionTokenFromCookie(".leadingdot"), null);
    assert.equal(sessionTokenFromCookie("trailingdot."), null);
    assert.equal(sessionTokenFromCookie(""), null);
  });
});

describe("why a session ended", () => {
  const now = new Date("2026-09-11T12:00:00Z");

  it("says the sessions were cleared when the database does not know the token", () => {
    assert.equal(sessionEndReason(null, now), "sessions-cleared");
  });

  it("says it expired when the row is past its date", () => {
    assert.equal(sessionEndReason({ expiresAt: new Date("2026-09-11T11:59:59Z") }, now), "expired");
    assert.equal(sessionEndReason({ expiresAt: now }, now), "expired");
  });

  it("says the settings changed when the row is live and the cookie was still refused", () => {
    assert.equal(
      sessionEndReason({ expiresAt: new Date("2036-09-11T12:00:00Z") }, now),
      "settings-changed"
    );
  });

  it("gives every reason its own sentence, each saying what to do", () => {
    const sentences = (["settings-changed", "sessions-cleared", "expired"] as const).map(
      sessionEndSentence
    );
    assert.equal(new Set(sentences).size, sentences.length);
    for (const sentence of sentences) {
      assert.match(sentence, /signing in again/i);
    }
  });
});

describe("the middleware that renews the lease", () => {
  function request(cookieHeader?: string): NextRequest {
    return new NextRequest("https://stamps.example.com/c/main/inventory", {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    });
  }

  /** Every `Set-Cookie` line the middleware's response carries. */
  function setCookies(response: Response): string[] {
    return response.headers.getSetCookie();
  }

  it("re-issues the plain cookie with the full lifetime and Better Auth's attributes", () => {
    const header = setCookies(proxy(request("better-auth.session_token=tok.sig")))[0];
    assert.ok(header, "expected the session cookie to be re-issued");
    assert.match(header, /^better-auth\.session_token=tok\.sig;/);
    assert.match(header, new RegExp(`Max-Age=${SESSION_MAX_AGE_SECONDS}\\b`));
    assert.match(header, /Path=\//);
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=lax/i);
    assert.doesNotMatch(header, /;\s*Secure(;|$)/);
  });

  it("re-issues the __Secure- cookie as Secure", () => {
    const header = setCookies(
      proxy(request("__Secure-better-auth.session_token=tok.sig"))
    )[0];
    assert.match(header, /^__Secure-better-auth\.session_token=tok\.sig;/);
    // The attribute, not the name — `Secure` appears in the cookie's own name here, so a bare
    // `/Secure/` would pass even with the flag dropped.
    assert.match(header, /;\s*Secure(;|$)/);
  });

  it("returns the value it was given, byte for byte", () => {
    // Next decodes a request cookie and re-encodes a response cookie. A signature's `+`, `/` and
    // `=` survive that round trip only because both halves use the same rules — if they ever stop
    // agreeing, the renewed cookie is a different credential and every collector is signed out.
    const encoded = encodeURIComponent("tok.a+b/c==");
    const header = setCookies(proxy(request(`better-auth.session_token=${encoded}`)))[0];
    assert.match(header, new RegExp(`^better-auth\\.session_token=${encoded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};`));
  });

  it("touches nothing when the browser sent no session cookie", () => {
    assert.deepEqual(setCookies(proxy(request())), []);
    assert.deepEqual(setCookies(proxy(request("theme=dark"))), []);
  });

  it("stays off Better Auth's own routes, so signing out is not undone", () => {
    // `/api/auth/sign-out` answers with a cookie-clearing `Set-Cookie`; a renewal added to the same
    // response would be a second one for the same name with no guaranteed ordering.
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    assert.equal(matcher.test("/api/auth/sign-out"), false);
    assert.equal(matcher.test("/api/auth/get-session"), false);
    assert.equal(matcher.test("/c/main/inventory"), true);
    assert.equal(matcher.test("/collections"), true);
    assert.equal(matcher.test("/sign-in"), true);
    assert.equal(matcher.test("/api/collections/abc/offers"), true);
    assert.equal(matcher.test("/_next/static/chunk.js"), false);
  });
});
