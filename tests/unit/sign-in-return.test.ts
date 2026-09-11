import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import {
  CURRENT_SCREEN_HEADER,
  RETURN_TO_PARAM,
  SIGN_IN_LANDING,
  isReturnableScreen,
  landingAfterSignIn,
  screenPath,
  signInPathFrom,
} from "@/lib/sign-in-return";

// #1176 — reaching the sign-in screen cost the collector their place as well as their session.
// What is pinned here is the promise: the screen they were dropped from comes back, an address that
// is not a screen of this app never does, and having nowhere to return to is an answer rather than
// a failure.

/**
 * The whole journey a return address makes: onto the sign-in URL, through a browser, off the query
 * string again. Asserting on `signInPathFrom` alone would pass with an encoding both halves get
 * wrong in the same way.
 */
function roundTrip(screen: string | null): string {
  const url = new URL(signInPathFrom(screen), "https://stamps.example.com");
  assert.equal(url.pathname, "/sign-in");
  return landingAfterSignIn(url.searchParams.get(RETURN_TO_PARAM));
}

describe("where signing in lands", () => {
  it("returns the collector to the screen they came from", () => {
    for (const screen of [
      "/c/main/inventory",
      "/c/main/purchases/abc123",
      "/c/main/albums/xyz/pages",
      "/c/main/offers?status=draft&sort=price",
      "/c/main/inventory?q=Poland%201960",
    ]) {
      assert.equal(roundTrip(screen), screen, screen);
    }
  });

  it("keeps today's behaviour when there is nowhere to return to", () => {
    // Opening the sign-in screen deliberately, and a redirect from a request the proxy never saw.
    assert.equal(signInPathFrom(null), "/sign-in");
    assert.equal(signInPathFrom(undefined), "/sign-in");
    assert.equal(signInPathFrom(""), "/sign-in");
    assert.equal(landingAfterSignIn(null), SIGN_IN_LANDING);
    assert.equal(roundTrip(null), SIGN_IN_LANDING);
  });

  it("ignores a destination outside this app", () => {
    // The standard way this feature becomes an open redirect. `//host` and `/\host` are the two
    // that look like paths and are not: a browser reads both as another site.
    for (const elsewhere of [
      "https://elsewhere.example/steal",
      "http://elsewhere.example/steal",
      "//elsewhere.example/steal",
      "/\\elsewhere.example/steal",
      "/\\/elsewhere.example/steal",
      "elsewhere.example",
      "javascript:alert(1)",
    ]) {
      assert.equal(isReturnableScreen(elsewhere), false, elsewhere);
      assert.equal(signInPathFrom(elsewhere), "/sign-in", elsewhere);
      assert.equal(landingAfterSignIn(elsewhere), SIGN_IN_LANDING, elsewhere);
    }
  });

  it("refuses the screens that would lead nowhere", () => {
    // Back to a form the collector has just finished with, or to the list signing in reaches
    // anyway — both are the fallback said twice.
    for (const pointless of ["/sign-in", "/sign-up", SIGN_IN_LANDING, "/sign-in?next=%2Fc%2Fmain"]) {
      assert.equal(isReturnableScreen(pointless), false, pointless);
      assert.equal(signInPathFrom(pointless), "/sign-in", pointless);
    }
  });
});

describe("the screen a request is for", () => {
  it("carries the collector's own query and drops Next's", () => {
    assert.equal(screenPath("/c/main/inventory", ""), "/c/main/inventory");
    assert.equal(screenPath("/c/main/inventory", "?_rsc=1a2b3c"), "/c/main/inventory");
    assert.equal(
      screenPath("/c/main/offers", "?status=draft&_rsc=1a2b3c"),
      "/c/main/offers?status=draft"
    );
  });

  it("is written onto every request the proxy sees", () => {
    const screen = headerOf(
      proxy(new NextRequest("https://stamps.example.com/c/main/offers?status=draft"))
    );
    assert.equal(screen, "/c/main/offers?status=draft");
  });

  it("cannot be forged by the browser", () => {
    // It is set rather than added, so a request that arrives claiming to be somewhere else is
    // overwritten with where it actually is.
    const screen = headerOf(
      proxy(
        new NextRequest("https://stamps.example.com/c/main/inventory", {
          headers: { [CURRENT_SCREEN_HEADER]: "https://elsewhere.example/steal" },
        })
      )
    );
    assert.equal(screen, "/c/main/inventory");
  });
});

/**
 * The screen the proxy put on the request, read back off the response.
 *
 * A middleware's request-header override travels as `x-middleware-request-<name>`, listed in
 * `x-middleware-override-headers` — Next's own mechanism, and the only way to observe from outside
 * a running server that the header reaches a server component at all.
 */
function headerOf(response: Response): string | null {
  const overridden = (response.headers.get("x-middleware-override-headers") ?? "").split(",");
  assert.ok(
    overridden.includes(CURRENT_SCREEN_HEADER),
    `expected ${CURRENT_SCREEN_HEADER} among the overridden request headers`
  );
  return response.headers.get(`x-middleware-request-${CURRENT_SCREEN_HEADER}`);
}
