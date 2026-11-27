import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  OAUTH_REFRESH_REUSE_GRACE_MS,
  OAuthTokenError,
  approvedRedirect,
  authorizationServerMetadata,
  checkAuthorizationRequest,
  checkClientRegistration,
  classifyRefresh,
  clientRegistrationResponse,
  deniedRedirect,
  isAcceptableRedirectUri,
  isMcpResource,
  mcpChallenge,
  oauthBaseUrl,
  offeredScopes,
  protectedResourceMetadata,
  redirectUriMatches,
  tokenResponse,
  verifyPkce,
  type KnownOAuthClient,
} from "../../src/lib/oauth-rules";

// The rules of the OAuth authorization server in front of `/api/mcp` (#2715, ADR-0084), which are
// pure so that this file can hold them: what a client may register, which authorization request is
// answered where, PKCE, and what a reused refresh token means. The rows and the routes are driven in
// `tests/integration/oauth-connector.test.ts`.

const BASE = "https://stamps.example.com";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

const client: KnownOAuthClient = { id: "client-1", name: "Claude", redirectUris: [CALLBACK] };

function request(overrides: Record<string, string | null> = {}): Record<string, string | null> {
  return {
    response_type: "code",
    client_id: "client-1",
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    ...overrides,
  };
}

describe("the instance's address", () => {
  it("is the configured one when there is one, without its trailing slash", () => {
    assert.equal(oauthBaseUrl("https://stamps.example.com/", "http://app:3000/api/mcp"), BASE);
  });

  it("falls back to the request's origin", () => {
    assert.equal(oauthBaseUrl(null, "http://localhost:3000/api/mcp?x=1"), "http://localhost:3000");
    assert.equal(oauthBaseUrl("  ", "http://localhost:3000/api/mcp"), "http://localhost:3000");
  });
});

describe("the metadata documents", () => {
  it("name the MCP endpoint as the resource and this instance as its authorization server", () => {
    const metadata = protectedResourceMetadata(BASE);
    assert.equal(metadata.resource, `${BASE}/api/mcp`);
    assert.deepEqual(metadata.authorization_servers, [BASE]);
    assert.deepEqual(metadata.scopes_supported, ["read", "read_write"]);
  });

  it("declare PKCE with S256 only, public clients only, and the two grants", () => {
    const metadata = authorizationServerMetadata(BASE);
    assert.equal(metadata.issuer, BASE);
    assert.equal(metadata.authorization_endpoint, `${BASE}/oauth/authorize`);
    assert.equal(metadata.token_endpoint, `${BASE}/api/oauth/token`);
    assert.equal(metadata.registration_endpoint, `${BASE}/api/oauth/register`);
    assert.equal(metadata.revocation_endpoint, `${BASE}/api/oauth/revoke`);
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none"]);
    assert.deepEqual(metadata.grant_types_supported, ["authorization_code", "refresh_token"]);
    assert.deepEqual(metadata.response_types_supported, ["code"]);
  });

  it("point a 401 at the resource metadata, and say when a credential was refused", () => {
    const where = `resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp"`;
    assert.equal(mcpChallenge(BASE, false), `Bearer ${where}`);
    assert.equal(mcpChallenge(BASE, true), `Bearer error="invalid_token", ${where}`);
  });
});

describe("the resource parameter", () => {
  it("accepts the MCP endpoint, with or without a trailing slash, and its absence", () => {
    assert.equal(isMcpResource(`${BASE}/api/mcp`, BASE), true);
    assert.equal(isMcpResource(`${BASE}/api/mcp/`, BASE), true);
    assert.equal(isMcpResource(null, BASE), true);
    assert.equal(isMcpResource("", BASE), true);
  });

  it("refuses any other resource", () => {
    assert.equal(isMcpResource(`${BASE}/api/v1`, BASE), false);
    assert.equal(isMcpResource("https://elsewhere.example.com/api/mcp", BASE), false);
    assert.equal(isMcpResource(BASE, BASE), false);
  });
});

describe("a redirect URI", () => {
  it("may be https anywhere or http on loopback", () => {
    for (const uri of [
      CALLBACK,
      "http://localhost:8976/callback",
      "http://127.0.0.1/cb",
      "http://[::1]:5000/cb",
    ]) {
      assert.equal(isAcceptableRedirectUri(uri), true, uri);
    }
  });

  it("may be nothing else", () => {
    for (const uri of [
      "http://example.com/cb",
      "javascript:alert(1)",
      "data:text/html,x",
      "myapp://callback",
      "https://example.com/cb#fragment",
      "https://example.com/cb#",
      "https://user:pass@example.com/cb",
      "/relative",
      " https://example.com/cb",
      "https://example.com/cb\n",
      "https://example.com/a b",
      "",
      `https://example.com/${"a".repeat(2000)}`,
      42,
      null,
    ]) {
      assert.equal(isAcceptableRedirectUri(uri), false, String(uri));
    }
  });

  it("matches a registered one exactly", () => {
    assert.equal(redirectUriMatches([CALLBACK], CALLBACK), true);
    assert.equal(redirectUriMatches([CALLBACK], `${CALLBACK}/`), false);
    assert.equal(redirectUriMatches([CALLBACK], `${CALLBACK}?x=1`), false);
    assert.equal(redirectUriMatches([CALLBACK], "https://claude.ai.evil.example/api/mcp/auth_callback"), false);
    assert.equal(redirectUriMatches([], CALLBACK), false);
  });

  it("matches a loopback one on any port, and on nothing else that differs", () => {
    const registered = ["http://localhost:1111/callback"];
    assert.equal(redirectUriMatches(registered, "http://localhost:2222/callback"), true);
    assert.equal(redirectUriMatches(registered, "http://localhost/callback"), true);
    assert.equal(redirectUriMatches(registered, "http://localhost:2222/other"), false);
    assert.equal(redirectUriMatches(registered, "http://127.0.0.1:2222/callback"), false);
    assert.equal(redirectUriMatches(registered, "https://localhost:2222/callback"), false);
    // The port freedom is the loopback's alone.
    assert.equal(redirectUriMatches(["https://example.com:1/cb"], "https://example.com:2/cb"), false);
  });
});

describe("a client registration", () => {
  it("is accepted with redirect URIs and a name", () => {
    const checked = checkClientRegistration({
      client_name: "  Claude\n ",
      redirect_uris: [CALLBACK, CALLBACK],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    });
    assert.equal(checked.ok, true);
    assert.ok(checked.ok);
    assert.deepEqual(checked.registration, { name: "Claude", redirectUris: [CALLBACK] });
  });

  it("is given a name when it sends none, and a bounded one when it sends a long one", () => {
    const unnamed = checkClientRegistration({ redirect_uris: [CALLBACK] });
    assert.ok(unnamed.ok);
    assert.equal(unnamed.registration.name, "MCP client");
    const long = checkClientRegistration({ redirect_uris: [CALLBACK], client_name: "x".repeat(500) });
    assert.ok(long.ok);
    assert.equal(long.registration.name.length, 120);
  });

  it("is refused without a usable redirect URI", () => {
    for (const body of [
      {},
      { redirect_uris: [] },
      { redirect_uris: "https://example.com/cb" },
      { redirect_uris: [CALLBACK, "http://example.com/cb"] },
      { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`) },
    ]) {
      const checked = checkClientRegistration(body);
      assert.equal(checked.ok, false, JSON.stringify(body));
      assert.ok(!checked.ok);
      assert.equal(checked.error, "invalid_redirect_uri");
    }
  });

  it("is refused when it is not an object, or rules out the code flow", () => {
    for (const body of [
      null,
      "text",
      [CALLBACK],
      { redirect_uris: [CALLBACK], grant_types: ["client_credentials"] },
      { redirect_uris: [CALLBACK], response_types: ["token"] },
    ]) {
      const checked = checkClientRegistration(body);
      assert.ok(!checked.ok, JSON.stringify(body));
      assert.equal(checked.error, "invalid_client_metadata");
    }
  });

  it("is answered as a public client, whatever it asked for", () => {
    const response = clientRegistrationResponse({
      id: "abc",
      name: "Claude",
      redirectUris: [CALLBACK],
      createdAt: new Date("2026-11-27T12:00:00Z"),
    });
    assert.equal(response.client_id, "abc");
    assert.equal(response.token_endpoint_auth_method, "none");
    assert.equal(response.client_id_issued_at, 1795780800);
    assert.equal("client_secret" in response, false);
  });
});

describe("PKCE", () => {
  it("accepts the verifier its challenge was made from", () => {
    assert.equal(verifyPkce(verifier, challenge), true);
  });

  it("refuses another verifier, a missing one and a malformed one", () => {
    assert.equal(verifyPkce("b".repeat(43), challenge), false);
    assert.equal(verifyPkce(null, challenge), false);
    assert.equal(verifyPkce(undefined, challenge), false);
    assert.equal(verifyPkce("short", challenge), false);
    assert.equal(verifyPkce("a".repeat(129), challenge), false);
    // `plain` would make the verifier equal to the challenge; it is not a method here.
    assert.equal(verifyPkce(challenge, challenge), false);
  });
});

describe("an authorization request", () => {
  it("passes with everything in place", () => {
    const checked = checkAuthorizationRequest(request({ resource: `${BASE}/api/mcp` }), client, BASE);
    assert.equal(checked.kind, "ok");
    assert.ok(checked.kind === "ok");
    assert.deepEqual(checked.request, {
      clientId: "client-1",
      clientName: "Claude",
      redirectUri: CALLBACK,
      codeChallenge: challenge,
      state: "xyz",
      offeredScopes: ["read", "read_write"],
    });
  });

  it("is stopped on the page, sending the browser nowhere, for an unknown client", () => {
    for (const [params, known] of [
      [request(), null],
      [request({ client_id: "someone-else" }), client],
      [request({ client_id: null }), client],
    ] as const) {
      assert.equal(checkAuthorizationRequest(params, known, BASE).kind, "page");
    }
  });

  it("is stopped on the page for a redirect URI the client never registered", () => {
    for (const uri of ["https://evil.example/cb", null, "", "javascript:alert(1)"]) {
      const checked = checkAuthorizationRequest(request({ redirect_uri: uri }), client, BASE);
      assert.equal(checked.kind, "page", String(uri));
    }
  });

  it("tells the client about any other fault at its own redirect URI, with its state", () => {
    const cases: [Record<string, string | null>, string][] = [
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ code_challenge: null }, "invalid_request"],
      [{ code_challenge: "too-short" }, "invalid_request"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ code_challenge_method: null }, "invalid_request"],
      [{ resource: "https://elsewhere.example.com/mcp" }, "invalid_target"],
    ];
    for (const [overrides, error] of cases) {
      const checked = checkAuthorizationRequest(request(overrides), client, BASE);
      assert.equal(checked.kind, "redirect", JSON.stringify(overrides));
      assert.ok(checked.kind === "redirect");
      const location = new URL(checked.location);
      assert.equal(location.origin + location.pathname, CALLBACK);
      assert.equal(location.searchParams.get("error"), error);
      assert.equal(location.searchParams.get("state"), "xyz");
      assert.equal(location.searchParams.get("iss"), BASE);
      assert.equal(location.searchParams.get("code"), null);
    }
  });

  it("leaves the collector the scopes the client asked for, and never more", () => {
    assert.deepEqual(offeredScopes(null), ["read", "read_write"]);
    assert.deepEqual(offeredScopes(""), ["read", "read_write"]);
    assert.deepEqual(offeredScopes("openid profile"), ["read", "read_write"]);
    assert.deepEqual(offeredScopes("read read_write"), ["read", "read_write"]);
    assert.deepEqual(offeredScopes("read_write"), ["read", "read_write"]);
    assert.deepEqual(offeredScopes("read"), ["read"]);
    assert.deepEqual(offeredScopes("read offline_access"), ["read"]);
  });

  it("is answered at the redirect URI with a code, or with a refusal", () => {
    const approved = new URL(approvedRedirect({ redirectUri: `${CALLBACK}?keep=1`, state: "s" }, "the-code", BASE));
    assert.equal(approved.searchParams.get("keep"), "1");
    assert.equal(approved.searchParams.get("code"), "the-code");
    assert.equal(approved.searchParams.get("state"), "s");
    assert.equal(approved.searchParams.get("iss"), BASE);

    const denied = new URL(deniedRedirect({ redirectUri: CALLBACK, state: null }, BASE));
    assert.equal(denied.searchParams.get("error"), "access_denied");
    assert.equal(denied.searchParams.has("state"), false);
    assert.equal(denied.searchParams.has("code"), false);
  });
});

describe("the token endpoint's answers", () => {
  it("carry a bearer token, its lifetime, a refresh token and the scope granted", () => {
    assert.deepEqual(tokenResponse({ accessToken: "a", refreshToken: "r", scope: "read" }), {
      access_token: "a",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "r",
      scope: "read",
    });
  });

  it("refuse with a 400, except an unknown client", () => {
    assert.equal(new OAuthTokenError("invalid_grant", "x").status, 400);
    assert.equal(new OAuthTokenError("invalid_client", "x").status, 401);
  });
});

describe("a refresh token presented again", () => {
  const rotatedAt = new Date("2026-11-27T12:00:00Z");
  const after = (ms: number) => new Date(rotatedAt.getTime() + ms);

  it("is rotated when it is the current one", () => {
    assert.equal(classifyRefresh({ matchesCurrent: true, rotatedAt: null }, rotatedAt), "current");
    assert.equal(classifyRefresh({ matchesCurrent: true, rotatedAt }, after(10 ** 9)), "current");
  });

  it("is a retry inside the grace period, and a replay after it", () => {
    assert.equal(classifyRefresh({ matchesCurrent: false, rotatedAt }, after(1000)), "retry");
    assert.equal(
      classifyRefresh({ matchesCurrent: false, rotatedAt }, after(OAUTH_REFRESH_REUSE_GRACE_MS)),
      "retry"
    );
    assert.equal(
      classifyRefresh({ matchesCurrent: false, rotatedAt }, after(OAUTH_REFRESH_REUSE_GRACE_MS + 1)),
      "replayed"
    );
    assert.equal(classifyRefresh({ matchesCurrent: false, rotatedAt: null }, rotatedAt), "replayed");
  });
});
