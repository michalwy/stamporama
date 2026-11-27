import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { POST as MCP_POST } from "../../src/app/api/mcp/route";
import { POST as REGISTER } from "../../src/app/api/oauth/register/route";
import { POST as TOKEN } from "../../src/app/api/oauth/token/route";
import { POST as REVOKE } from "../../src/app/api/oauth/revoke/route";
import { GET as AS_METADATA } from "../../src/app/.well-known/oauth-authorization-server/route";
import { GET as RESOURCE_METADATA } from "../../src/app/.well-known/oauth-protected-resource/[[...path]]/route";
import { GET as V1_OPENAPI } from "../../src/app/api/v1/openapi.json/route";
import {
  OAUTH_CODE_TTL_MS,
  OAUTH_REFRESH_REUSE_GRACE_MS,
  OAUTH_UNUSED_CLIENT_TTL_MS,
  approvedRedirect,
  checkAuthorizationRequest,
  oauthBaseUrl,
} from "../../src/lib/oauth-rules";
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  findOAuthClient,
  listOAuthGrants,
  refreshOAuthTokens,
  registerOAuthClient,
  revokeOAuthGrant,
  verifyOAuthAccessToken,
} from "../../src/lib/oauth-server";
import { OAUTH_RATE_LIMITS } from "../../src/lib/oauth-http";
import { resetRateLimits } from "../../src/lib/rate-limit";
import type { AssistantTokenScope } from "../../src/lib/assistant-token-scope";

// **#2715's connector flow, driven the way claude.ai drives it** (ADR-0084): from nothing but the
// address of `/api/mcp`, through discovery, registration, consent, the code exchange, a tool call,
// a refresh, and a disconnect — against the exported route handlers and a real database.
//
// `tests/unit/oauth-rules.test.ts` holds every rule. What only this file can show is that the rows
// and the routes obey them: that a real hashed code is spent once, that the access token it bought
// authenticates at the MCP endpoint as the account that allowed it, on the collection it chose, with
// the scope it chose, and that deleting the grant is what cuts the app off.
//
// **What it does not establish, said rather than left to be assumed.** The consent *screen* is not
// driven: there is no session in this suite, so `consent()` below does what the page and its server
// action do with the session's account — the same check, the same `createAuthorizationCode` — without
// the page. And no real client has spoken to these endpoints over a socket; the issue's last
// criterion, adding the connector in claude.ai on the live instance, is the owner's.

const ts = Date.now();
// The address the instance believes it has: `BETTER_AUTH_URL` where the run sets one (CI does), the
// request's own origin where it does not. The requests below are sent to the same address, so the
// two cases are one test.
const ORIGIN = oauthBaseUrl(process.env.BETTER_AUTH_URL, "http://localhost/");
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function form(path: string, fields: Record<string, string>): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

function json(path: string, body: unknown): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mcp(token: string | null, body: unknown): NextRequest {
  return new NextRequest(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const PING = { jsonrpc: "2.0", id: 1, method: "ping" };

interface TokenBody {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  error?: string;
}

async function tokenCall(fields: Record<string, string>): Promise<{ status: number; body: TokenBody }> {
  const response = await TOKEN(form("/api/oauth/token", fields));
  return { status: response.status, body: (await response.json()) as TokenBody };
}

describe("the OAuth connector flow", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let secondCollectionId: string;
  let otherUsersCollectionId: string;
  const clientIds: string[] = [];

  async function register(redirectUris: string[] = [CALLBACK], name = "Claude"): Promise<string> {
    const response = await REGISTER(
      json("/api/oauth/register", { client_name: name, redirect_uris: redirectUris })
    );
    assert.equal(response.status, 201);
    const body = (await response.json()) as { client_id: string };
    clientIds.push(body.client_id);
    return body.client_id;
  }

  /** What the consent screen does once the signed-in collector presses Allow. */
  async function consent(
    clientId: string,
    challenge: string,
    choice: { collectionId: string; scope: AssistantTokenScope; as?: string },
    now?: Date
  ): Promise<string> {
    const checked = checkAuthorizationRequest(
      {
        response_type: "code",
        client_id: clientId,
        redirect_uri: CALLBACK,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "state-1",
        resource: `${ORIGIN}/api/mcp`,
      },
      await findOAuthClient(clientId),
      ORIGIN
    );
    assert.ok(checked.kind === "ok", `the request was not accepted: ${JSON.stringify(checked)}`);
    const code = await createAuthorizationCode(
      {
        clientId: checked.request.clientId,
        userId: choice.as ?? userId,
        collectionId: choice.collectionId,
        scope: choice.scope,
        redirectUri: checked.request.redirectUri,
        codeChallenge: checked.request.codeChallenge,
      },
      now
    );
    // The code leaves on the redirect, and comes back off it as the client would read it.
    const location = new URL(approvedRedirect(checked.request, code, ORIGIN));
    assert.equal(location.searchParams.get("state"), "state-1");
    return location.searchParams.get("code") as string;
  }

  /** The whole connection: register, consent, exchange. */
  async function connect(
    choice: { collectionId: string; scope: AssistantTokenScope },
    clientId?: string
  ): Promise<{ clientId: string; tokens: TokenBody }> {
    const id = clientId ?? (await register());
    const { verifier, challenge } = pkce();
    const code = await consent(id, challenge, choice);
    const { status, body } = await tokenCall({
      grant_type: "authorization_code",
      code,
      client_id: id,
      redirect_uri: CALLBACK,
      code_verifier: verifier,
      resource: `${ORIGIN}/api/mcp`,
    });
    assert.equal(status, 200, JSON.stringify(body));
    return { clientId: id, tokens: body };
  }

  before(async () => {
    const user = (id: string) =>
      prisma.user.create({
        data: {
          id,
          name: "OAuth User",
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    userId = (await user(`test-user-oauth-${ts}`)).id;
    otherUserId = (await user(`test-user-oauth-other-${ts}`)).id;
    const collection = (slug: string, ownerId: string, baseCurrency: string) =>
      prisma.collection.create({ data: { name: slug, slug: `${slug}-${ts}`, baseCurrency, ownerId } });
    collectionId = (await collection("oauth", userId, "PLN")).id;
    secondCollectionId = (await collection("oauth-second", userId, "EUR")).id;
    otherUsersCollectionId = (await collection("oauth-theirs", otherUserId, "USD")).id;
  });

  beforeEach(() => resetRateLimits());

  after(async () => {
    await prisma.oAuthClient.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  // ── Discovery ─────────────────────────────────────────────────────────────

  it("can be discovered from the MCP endpoint's address alone", async () => {
    const refused = await MCP_POST(mcp(null, PING));
    assert.equal(refused.status, 401);
    const challenge = refused.headers.get("WWW-Authenticate") ?? "";
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
    assert.equal(metadataUrl, `${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`);

    const resource = await RESOURCE_METADATA(new NextRequest(metadataUrl as string), {
      params: Promise.resolve({ path: ["api", "mcp"] }),
    });
    assert.equal(resource.status, 200);
    const resourceBody = (await resource.json()) as { resource: string; authorization_servers: string[] };
    assert.equal(resourceBody.resource, `${ORIGIN}/api/mcp`);
    assert.deepEqual(resourceBody.authorization_servers, [ORIGIN]);

    const server = await AS_METADATA(
      new NextRequest(`${resourceBody.authorization_servers[0]}/.well-known/oauth-authorization-server`)
    );
    const serverBody = (await server.json()) as Record<string, unknown>;
    assert.equal(serverBody.issuer, ORIGIN);
    assert.equal(serverBody.registration_endpoint, `${ORIGIN}/api/oauth/register`);
    assert.equal(serverBody.token_endpoint, `${ORIGIN}/api/oauth/token`);
  });

  it("serves the resource metadata at the root form too, and nothing for another resource", async () => {
    const root = await RESOURCE_METADATA(
      new NextRequest(`${ORIGIN}/.well-known/oauth-protected-resource`),
      { params: Promise.resolve({}) }
    );
    assert.equal(root.status, 200);
    const other = await RESOURCE_METADATA(
      new NextRequest(`${ORIGIN}/.well-known/oauth-protected-resource/api/v1`),
      { params: Promise.resolve({ path: ["api", "v1"] }) }
    );
    assert.equal(other.status, 404);
  });

  // ── Registration ──────────────────────────────────────────────────────────

  it("registers a public client, and refuses one with no usable redirect URI", async () => {
    const response = await REGISTER(
      json("/api/oauth/register", {
        client_name: "Claude",
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: "client_secret_basic",
      })
    );
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = (await response.json()) as Record<string, unknown>;
    clientIds.push(body.client_id as string);
    assert.equal(body.token_endpoint_auth_method, "none");
    assert.equal("client_secret" in body, false);
    assert.deepEqual(await findOAuthClient(body.client_id as string), {
      id: body.client_id,
      name: "Claude",
      redirectUris: [CALLBACK],
    });

    const bad = await REGISTER(json("/api/oauth/register", { redirect_uris: ["http://example.com/cb"] }));
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { error: string }).error, "invalid_redirect_uri");

    const notJson = await REGISTER(
      new NextRequest(`${ORIGIN}/api/oauth/register`, { method: "POST", body: "not json" })
    );
    assert.equal(notJson.status, 400);
  });

  it("limits how fast anyone may register", async () => {
    const attempt = () => REGISTER(json("/api/oauth/register", { redirect_uris: ["not a uri"] }));
    for (let i = 0; i < OAUTH_RATE_LIMITS.register; i += 1) {
      assert.equal((await attempt()).status, 400);
    }
    const limited = await attempt();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("Retry-After")) > 0);
  });

  it("sweeps a registration nobody authorised, and keeps one somebody did", async () => {
    const stale = await register([CALLBACK], "Never authorised");
    const { clientId: used } = await connect({ collectionId, scope: "read" });
    const old = new Date(Date.now() - OAUTH_UNUSED_CLIENT_TTL_MS - 60_000);
    await prisma.oAuthClient.updateMany({ where: { id: { in: [stale, used] } }, data: { createdAt: old } });

    clientIds.push((await registerOAuthClient({ name: "Sweeper", redirectUris: [CALLBACK] })).id);
    assert.equal(await findOAuthClient(stale), null);
    assert.ok(await findOAuthClient(used));

    // Disconnected, it is still kept: the app goes on presenting this client id.
    await prisma.oAuthGrant.deleteMany({ where: { clientId: used } });
    clientIds.push((await registerOAuthClient({ name: "Sweeper", redirectUris: [CALLBACK] })).id);
    assert.ok(await findOAuthClient(used));
  });

  // ── The whole flow ────────────────────────────────────────────────────────

  it("connects, calls a tool as the collector on the chosen collection, refreshes, and is cut off", async () => {
    await prisma.stampCondition.create({
      data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
    });
    await prisma.stampCondition.create({
      data: { collectionId: secondCollectionId, name: "Should Not Appear", abbreviation: "SNA", sortOrder: 0 },
    });

    const { clientId, tokens } = await connect({ collectionId, scope: "read_write" });
    assert.equal(tokens.token_type, "Bearer");
    assert.equal(tokens.expires_in, 3600);
    assert.equal(tokens.scope, "read_write");
    assert.match(tokens.access_token, /^stmpoa_/);
    assert.match(tokens.refresh_token, /^stmpor_/);

    assert.deepEqual(await verifyOAuthAccessToken(tokens.access_token), {
      ownerId: userId,
      collectionId,
      scope: "read_write",
    });

    const list = await MCP_POST(mcp(tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" }));
    assert.equal(list.status, 200);
    const listed = (await list.json()) as { result: { tools: { name: string }[] } };
    assert.ok(listed.result.tools.some((tool) => tool.name === "get_collection_vocabulary"));

    const call = await MCP_POST(
      mcp(tokens.access_token, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_collection_vocabulary", arguments: {} },
      })
    );
    const called = (await call.json()) as { result: { isError?: boolean; content: { text: string }[] } };
    assert.equal(called.result.isError, undefined);
    const vocabulary = JSON.parse(called.result.content[0].text) as {
      baseCurrency: string;
      conditions: { name: string }[];
    };
    assert.equal(vocabulary.baseCurrency, "PLN");
    assert.deepEqual(vocabulary.conditions.map((condition) => condition.name), ["Mint Never Hinged"]);

    // Settings lists it, by the name the app registered under.
    const listedApps = await listOAuthGrants(userId, collectionId);
    assert.equal(listedApps.length, 1);
    assert.equal(listedApps[0].clientName, "Claude");
    assert.equal(listedApps[0].scope, "read_write");
    assert.ok(listedApps[0].lastUsedAt);
    assert.deepEqual(await listOAuthGrants(userId, secondCollectionId), []);

    // Refreshing rotates both tokens: the old access token stops, the new one works.
    const refreshed = await tokenCall({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
    assert.notEqual(refreshed.body.access_token, tokens.access_token);
    assert.notEqual(refreshed.body.refresh_token, tokens.refresh_token);
    assert.equal(refreshed.body.scope, "read_write");
    assert.equal((await MCP_POST(mcp(tokens.access_token, PING))).status, 401);
    assert.equal((await MCP_POST(mcp(refreshed.body.access_token, PING))).status, 200);

    // Disconnected in Settings: refused at once, told its token is the reason, and unable to refresh.
    await revokeOAuthGrant(userId, collectionId, listedApps[0].id);
    const cutOff = await MCP_POST(mcp(refreshed.body.access_token, PING));
    assert.equal(cutOff.status, 401);
    assert.match(cutOff.headers.get("WWW-Authenticate") ?? "", /error="invalid_token"/);
    assert.match(cutOff.headers.get("WWW-Authenticate") ?? "", /resource_metadata="/);
    const afterRevoke = await tokenCall({
      grant_type: "refresh_token",
      refresh_token: refreshed.body.refresh_token,
      client_id: clientId,
    });
    assert.equal(afterRevoke.status, 400);
    assert.equal(afterRevoke.body.error, "invalid_grant");
  });

  it("refuses a read grant on a writing tool, and serves it a reading one", async () => {
    const { tokens } = await connect({ collectionId, scope: "read" });
    assert.equal(tokens.scope, "read");

    const write = await MCP_POST(
      mcp(tokens.access_token, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "draft_offer", arguments: { platform: "Colnect", copy_ids: ["x"] } },
      })
    );
    const refused = (await write.json()) as { result: { isError?: boolean; content: { text: string }[] } };
    assert.equal(refused.result.isError, true);
    assert.match(refused.result.content[0].text, /read_write/);

    const read = await MCP_POST(
      mcp(tokens.access_token, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_collection_vocabulary", arguments: {} },
      })
    );
    assert.equal(((await read.json()) as { result: { isError?: boolean } }).result.isError, undefined);
  });

  it("is not a credential for /api/v1, which it was not issued for", async () => {
    const { tokens } = await connect({ collectionId, scope: "read_write" });
    const response = await V1_OPENAPI(
      new NextRequest(`${ORIGIN}/api/v1/openapi.json`, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      })
    );
    assert.equal(response.status, 401);
  });

  it("reaches only the collection it was given for, and only while its account owns it", async () => {
    // Another account's collection cannot be chosen at all.
    const clientId = await register();
    await assert.rejects(
      consent(clientId, pkce().challenge, { collectionId: otherUsersCollectionId, scope: "read" }),
      /access denied/
    );

    // Two connections of one account, each pinned to its own collection.
    const first = await connect({ collectionId, scope: "read" });
    const second = await connect({ collectionId: secondCollectionId, scope: "read" });
    assert.equal((await verifyOAuthAccessToken(first.tokens.access_token))?.collectionId, collectionId);
    assert.equal(
      (await verifyOAuthAccessToken(second.tokens.access_token))?.collectionId,
      secondCollectionId
    );

    // The collection changes hands: the grant names the account that allowed it, and that account
    // no longer owns the collection, so the token stops and cannot be refreshed.
    await prisma.collection.update({ where: { id: secondCollectionId }, data: { ownerId: otherUserId } });
    try {
      assert.equal(await verifyOAuthAccessToken(second.tokens.access_token), null);
      assert.equal((await MCP_POST(mcp(second.tokens.access_token, PING))).status, 401);
      const refresh = await tokenCall({
        grant_type: "refresh_token",
        refresh_token: second.tokens.refresh_token,
        client_id: second.clientId,
      });
      assert.equal(refresh.body.error, "invalid_grant");
      // The first is untouched by any of it.
      assert.equal((await MCP_POST(mcp(first.tokens.access_token, PING))).status, 200);
    } finally {
      await prisma.collection.update({ where: { id: secondCollectionId }, data: { ownerId: userId } });
    }
  });

  it("stops an access token when its hour is over", async () => {
    const { tokens } = await connect({ collectionId, scope: "read" });
    const later = new Date(Date.now() + 3600 * 1000 + 1000);
    assert.ok(await verifyOAuthAccessToken(tokens.access_token));
    assert.equal(await verifyOAuthAccessToken(tokens.access_token, later), null);
  });

  it("replaces an app's earlier connection to the same collection rather than adding a second", async () => {
    const first = await connect({ collectionId: secondCollectionId, scope: "read" });
    const again = await connect({ collectionId: secondCollectionId, scope: "read_write" }, first.clientId);
    const grants = await prisma.oAuthGrant.findMany({
      where: { clientId: first.clientId, collectionId: secondCollectionId },
    });
    assert.equal(grants.length, 1);
    assert.equal(grants[0].scope, "read_write");
    assert.equal((await MCP_POST(mcp(first.tokens.access_token, PING))).status, 401);
    assert.equal((await MCP_POST(mcp(again.tokens.access_token, PING))).status, 200);
  });

  // ── What the token endpoint refuses ───────────────────────────────────────

  describe("the code exchange", () => {
    async function exchange(
      overrides: Record<string, string | null>,
      prepare?: (code: string) => Promise<void>
    ): Promise<{ status: number; body: TokenBody; code: string; clientId: string; verifier: string }> {
      const clientId = await register();
      const { verifier, challenge } = pkce();
      const code = await consent(clientId, challenge, { collectionId, scope: "read" });
      if (prepare) await prepare(code);
      const fields: Record<string, string | null> = {
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: CALLBACK,
        code_verifier: verifier,
        ...overrides,
      };
      const sent = Object.fromEntries(
        Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== null)
      );
      return { ...(await tokenCall(sent)), code, clientId, verifier };
    }

    it("refuses a wrong PKCE verifier, and a missing one", async () => {
      const wrong = await exchange({ code_verifier: pkce().verifier });
      assert.equal(wrong.status, 400);
      assert.equal(wrong.body.error, "invalid_grant");
      const missing = await exchange({ code_verifier: null });
      assert.equal(missing.body.error, "invalid_grant");
    });

    it("refuses a redirect URI other than the one the code was issued to", async () => {
      const result = await exchange({ redirect_uri: "https://claude.ai/another" });
      assert.equal(result.body.error, "invalid_grant");
    });

    it("refuses a code presented by another client", async () => {
      const other = await register();
      const result = await exchange({ client_id: other });
      assert.equal(result.body.error, "invalid_grant");
    });

    it("refuses an expired code", async () => {
      const clientId = await register();
      const { verifier, challenge } = pkce();
      const code = await consent(clientId, challenge, { collectionId, scope: "read" });
      await assert.rejects(
        exchangeAuthorizationCode(
          { code, clientId, redirectUri: CALLBACK, codeVerifier: verifier },
          new Date(Date.now() + OAUTH_CODE_TTL_MS + 1000)
        ),
        /invalid, expired or already used/
      );
      // Not spent by the refusal: in time, the same code still works.
      await exchangeAuthorizationCode({ code, clientId, redirectUri: CALLBACK, codeVerifier: verifier });
    });

    it("spends a code once, and ends the connection it made when it is presented again", async () => {
      const first = await exchange({});
      assert.equal(first.status, 200);
      assert.equal((await MCP_POST(mcp(first.body.access_token, PING))).status, 200);

      const replay = await tokenCall({
        grant_type: "authorization_code",
        code: first.code,
        client_id: first.clientId,
        redirect_uri: CALLBACK,
        code_verifier: first.verifier,
      });
      assert.equal(replay.status, 400);
      assert.equal(replay.body.error, "invalid_grant");
      assert.equal((await MCP_POST(mcp(first.body.access_token, PING))).status, 401);
    });

    it("gives one of two racing exchanges the tokens, never both", async () => {
      const clientId = await register();
      const { verifier, challenge } = pkce();
      const code = await consent(clientId, challenge, { collectionId, scope: "read" });
      const attempt = () =>
        exchangeAuthorizationCode({ code, clientId, redirectUri: CALLBACK, codeVerifier: verifier }).then(
          () => "issued",
          () => "refused"
        );
      const outcomes = await Promise.all([attempt(), attempt(), attempt()]);
      assert.ok(outcomes.filter((outcome) => outcome === "issued").length <= 1, outcomes.join(","));
    });

    it("refuses an unknown grant type, a missing field, and another resource", async () => {
      assert.equal((await exchange({ grant_type: "client_credentials" })).body.error, "unsupported_grant_type");
      assert.equal((await exchange({ code: null })).body.error, "invalid_request");
      assert.equal((await exchange({ client_id: null })).body.error, "invalid_request");
      assert.equal(
        (await exchange({ resource: "https://elsewhere.example.com/mcp" })).body.error,
        "invalid_target"
      );
      assert.equal((await exchange({ code: "stmpoc_never-issued" })).body.error, "invalid_grant");
    });
  });

  describe("a refresh token", () => {
    it("is refused for another client", async () => {
      const { tokens } = await connect({ collectionId, scope: "read" });
      const other = await register();
      const result = await tokenCall({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: other,
      });
      assert.equal(result.body.error, "invalid_grant");
    });

    it("presented again at once is a retry, and is answered", async () => {
      const { clientId, tokens } = await connect({ collectionId, scope: "read" });
      const refresh = () =>
        tokenCall({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId });
      const first = await refresh();
      const retry = await refresh();
      assert.equal(first.status, 200);
      assert.equal(retry.status, 200);
      assert.notEqual(retry.body.refresh_token, first.body.refresh_token);
      assert.equal((await MCP_POST(mcp(retry.body.access_token, PING))).status, 200);
    });

    it("presented again after the grace period ends the connection", async () => {
      const { clientId, tokens } = await connect({ collectionId, scope: "read" });
      const rotated = await refreshOAuthTokens({ refreshToken: tokens.refresh_token, clientId });
      const later = new Date(Date.now() + OAUTH_REFRESH_REUSE_GRACE_MS + 5000);

      await assert.rejects(
        refreshOAuthTokens({ refreshToken: tokens.refresh_token, clientId }, later),
        /invalid or was revoked/
      );
      // The grant is gone, so the token the real client holds is dead too: the collector connects
      // again, which is the cost of not being able to tell which of the two was the thief.
      assert.equal((await MCP_POST(mcp(rotated.accessToken, PING))).status, 401);
      await assert.rejects(
        refreshOAuthTokens({ refreshToken: rotated.refreshToken, clientId }),
        /invalid or was revoked/
      );
    });
  });

  // ── Revocation by the app ─────────────────────────────────────────────────

  it("lets an app disconnect itself with either token, and answers 200 for one it never issued", async () => {
    for (const which of ["access_token", "refresh_token"] as const) {
      const { tokens } = await connect({ collectionId, scope: "read" });
      const response = await REVOKE(form("/api/oauth/revoke", { token: tokens[which] }));
      assert.equal(response.status, 200);
      assert.equal((await MCP_POST(mcp(tokens.access_token, PING))).status, 401);
    }
    assert.equal((await REVOKE(form("/api/oauth/revoke", { token: "stmpoa_unknown" }))).status, 200);
    assert.equal((await REVOKE(form("/api/oauth/revoke", {}))).status, 200);
  });

  it("does not let one collector disconnect another's app", async () => {
    const { tokens } = await connect({ collectionId, scope: "read" });
    const [grant] = await listOAuthGrants(userId, collectionId);
    await assert.rejects(revokeOAuthGrant(otherUserId, collectionId, grant.id), /access denied/);
    await revokeOAuthGrant(otherUserId, otherUsersCollectionId, grant.id);
    assert.equal((await MCP_POST(mcp(tokens.access_token, PING))).status, 200);
  });
});
