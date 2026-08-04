import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLEGRO_SALE_OFFERS_WRITE_SCOPE,
  AllegroOAuthError,
  allegroApiBase,
  allegroRedirectUri,
  allegroUserAgent,
  authorizationUrl,
  deviceCodeUrl,
  grantsOfferPublishing,
  readTokenResponse,
  readTokenScopes,
} from "../../src/lib/allegro-oauth";

describe("allegroApiBase", () => {
  it("separates sandbox from production", () => {
    assert.equal(allegroApiBase(false), "https://api.allegro.pl");
    assert.equal(allegroApiBase(true), "https://api.allegro.pl.allegrosandbox.pl");
  });
});

describe("allegroRedirectUri", () => {
  it("derives one URI from the instance's own base URL", () => {
    assert.equal(
      allegroRedirectUri("https://stamps.example.com"),
      "https://stamps.example.com/api/allegro/callback"
    );
  });

  it("tolerates a trailing slash, the URI being shown verbatim for registration", () => {
    assert.equal(
      allegroRedirectUri("http://localhost:3000/"),
      "http://localhost:3000/api/allegro/callback"
    );
  });
});

describe("deviceCodeUrl", () => {
  it("puts client_id in the query string", () => {
    // The endpoint reads the query and never the body. With it in the body Allegro answers
    // "OAuth 2.0 Parameter: client_id" — which is not a wrong id, but no id at all.
    const url = new URL(deviceCodeUrl("abc123", false));
    assert.equal(url.origin + url.pathname, "https://allegro.pl/auth/oauth/device");
    assert.equal(url.searchParams.get("client_id"), "abc123");
  });

  it("asks for no scopes — they come from the application's own registration", () => {
    assert.equal(new URL(deviceCodeUrl("abc", false)).searchParams.get("scope"), null);
  });

  it("escapes an id that needs it", () => {
    assert.equal(new URL(deviceCodeUrl("a b&c", false)).searchParams.get("client_id"), "a b&c");
  });

  it("points the sandbox at the sandbox host", () => {
    assert.ok(
      deviceCodeUrl("abc", true).startsWith("https://allegro.pl.allegrosandbox.pl/auth/oauth/device?")
    );
  });
});

describe("authorizationUrl", () => {
  it("carries the client, the redirect and the state", () => {
    const url = new URL(
      authorizationUrl({
        clientId: "abc123",
        sandbox: false,
        redirectUri: "https://stamps.example.com/api/allegro/callback",
        state: "st-1",
      })
    );
    assert.equal(url.origin + url.pathname, "https://allegro.pl/auth/oauth/authorize");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), "abc123");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "https://stamps.example.com/api/allegro/callback"
    );
    assert.equal(url.searchParams.get("state"), "st-1");
    // No scope, by the same rule the device endpoint follows: asking for one the application does
    // not hold fails the authorization, and reports it as a client_id problem.
    assert.equal(url.searchParams.get("scope"), null);
  });

  it("points the sandbox at the sandbox host", () => {
    const url = authorizationUrl({
      clientId: "abc",
      sandbox: true,
      redirectUri: "http://localhost:3000/api/allegro/callback",
      state: "s",
    });
    assert.ok(url.startsWith("https://allegro.pl.allegrosandbox.pl/auth/oauth/authorize?"));
  });
});

describe("readTokenResponse", () => {
  it("turns expires_in into an instant", () => {
    const before = Date.now();
    const token = readTokenResponse({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 7200,
    });
    assert.equal(token.accessToken, "at");
    assert.equal(token.refreshToken, "rt");
    assert.ok(token.expiresAt.getTime() >= before + 7200_000);
    assert.ok(token.expiresAt.getTime() <= Date.now() + 7200_000);
  });

  it("reads an absent refresh token as null, so the stored one stands", () => {
    assert.equal(readTokenResponse({ access_token: "at", expires_in: 60 }).refreshToken, null);
  });

  it("defaults an unstated lifetime rather than refusing a usable grant", () => {
    const token = readTokenResponse({ access_token: "at" });
    assert.ok(token.expiresAt.getTime() > Date.now());
  });

  it("refuses a response with no access token", () => {
    assert.throws(() => readTokenResponse({ refresh_token: "rt" }), AllegroOAuthError);
  });
});

describe("allegroUserAgent", () => {
  it("states Allegro's own shape: name, version and a documentation URL", () => {
    assert.equal(
      allegroUserAgent("StampSeller", "0.60.0"),
      "StampSeller/0.60.0 (+https://github.com/michalwy/stamporama)"
    );
  });

  it("falls back to this app's name when the collector has not named their application", () => {
    assert.match(allegroUserAgent(null, "0.60.0"), /^Stamporama\/0\.60\.0 \(\+/);
    assert.match(allegroUserAgent("   ", "0.60.0"), /^Stamporama\//);
  });

  it("narrows a name to what a header can carry, rather than sending a value Allegro would refuse", () => {
    assert.match(allegroUserAgent("My Stamp Shop", "1.0.0"), /^My-Stamp-Shop\/1\.0\.0 /);
    // A name of nothing but unusable characters is a name of nothing.
    assert.match(allegroUserAgent("Żółć/\\", "1.0.0"), /^Stamporama\//);
  });

  it("carries the dev version an unbuilt instance reports", () => {
    assert.match(allegroUserAgent("App", ""), /^App\/dev /);
  });
});

describe("readTokenScopes", () => {
  function token(payload: unknown): string {
    const part = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `header.${part}.signature`;
  }

  it("reads the scope array Allegro's own access token carries", () => {
    assert.deepEqual(
      readTokenScopes(token({ scope: ["allegro:api:orders:read", ALLEGRO_SALE_OFFERS_WRITE_SCOPE] })),
      ["allegro:api:orders:read", ALLEGRO_SALE_OFFERS_WRITE_SCOPE]
    );
  });

  it("accepts OAuth's space-delimited form too", () => {
    assert.deepEqual(readTokenScopes(token({ scope: "a b" })), ["a", "b"]);
  });

  it("answers null — not an empty list — for anything it cannot read", () => {
    // Null is "unknown permissions" and drives a different sentence on the settings tab from "this
    // application grants nothing", which is a claim an unreadable token gives no basis for.
    assert.equal(readTokenScopes(null), null);
    assert.equal(readTokenScopes("not-a-jwt"), null);
    assert.equal(readTokenScopes("a.!!!.c"), null);
    assert.equal(readTokenScopes(token({ sub: "someone" })), null);
    assert.equal(readTokenScopes(token({ scope: [] })), null);
  });
});

describe("grantsOfferPublishing", () => {
  it("is the sale-offer write scope being present, and nothing else", () => {
    assert.equal(grantsOfferPublishing([ALLEGRO_SALE_OFFERS_WRITE_SCOPE]), true);
    assert.equal(grantsOfferPublishing(["allegro:api:sale:offers:read"]), false);
  });

  it("stays null where the scopes are unknown, rather than warning without a basis", () => {
    assert.equal(grantsOfferPublishing(null), null);
  });
});
