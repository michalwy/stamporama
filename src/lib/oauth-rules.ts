import { createHash, timingSafeEqual } from "node:crypto";
import {
  ASSISTANT_TOKEN_SCOPES,
  isAssistantTokenScope,
  type AssistantTokenScope,
} from "./assistant-token-scope";

// The rules of the OAuth 2.1 authorization server in front of `/api/mcp` (#2715, ADR-0084).
//
// claude.ai adds a remote MCP server as a **connector** by its address alone: it reads the `401`,
// finds the authorization server, registers itself, sends the collector through sign-in and a
// consent screen, and from then on calls with an access token it refreshes on its own. An Assistant
// token pasted into a configuration file is not something that flow can use, so the app issues the
// credential itself.
//
// **Every decision is here, and pure, for the reason `mcp.ts` is** (ADR-0051 §2): which redirect URI
// is acceptable, what a registration must say, which authorization request is answered with a page
// and which with a redirect, and what the metadata documents declare are all questions
// `pnpm test:unit` can hold. `oauth-server.ts` holds the rows and nothing that decides; the routes
// hold the request and the response.
//
// **What a grant is.** A signed-in collector allows one client to work as their account, with **one
// scope** — the vocabulary an Assistant token carries (#707) — on **the collections they chose**:
// every collection of the account, including ones made later, or a selection of them (#2728), as an
// app is installed on all repositories or on selected ones. `read` / `read_write` meets the
// operation's `writes` in the one place it always did; which collection a call acts on is the
// caller's to say only among those the grant reaches (`agent-api/mcp.ts`).

/** Where the protected resource lives. The only resource this server issues tokens for. */
export const MCP_RESOURCE_PATH = "/api/mcp";

export const OAUTH_PATHS = {
  authorize: "/oauth/authorize",
  token: "/api/oauth/token",
  register: "/api/oauth/register",
  revoke: "/api/oauth/revoke",
  protectedResourceMetadata: "/.well-known/oauth-protected-resource",
  authorizationServerMetadata: "/.well-known/oauth-authorization-server",
} as const;

/** Raw-value prefixes, so a credential pasted in the wrong place can be told from another kind. */
export const OAUTH_ACCESS_TOKEN_PREFIX = "stmpoa_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "stmpor_";
export const OAUTH_CODE_PREFIX = "stmpoc_";

/** An access token is short-lived because the client renews it by itself. */
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/** A code only has to survive the redirect back to the client and one request from it. */
export const OAUTH_CODE_TTL_MS = 2 * 60 * 1000;

/**
 * How long the refresh token just replaced is still honoured.
 *
 * A rotated refresh token presented again is the signature of a stolen one, and the answer to that
 * is to end the grant. It is also what a client does when the answer to its refresh was lost on the
 * way, or when two of its conversations refresh at the same moment — so for a minute the previous
 * token is answered with a fresh pair instead of ending a connection the collector would then have
 * to make again.
 */
export const OAUTH_REFRESH_REUSE_GRACE_MS = 60 * 1000;

/** A registration nobody ever authorised is swept after this long. */
export const OAUTH_UNUSED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;

export const OAUTH_MAX_REDIRECT_URIS = 10;
export const OAUTH_MAX_REDIRECT_URI_LENGTH = 2000;
export const OAUTH_MAX_CLIENT_NAME_LENGTH = 120;
export const OAUTH_DEFAULT_CLIENT_NAME = "MCP client";

/** The scopes a grant can carry — the Assistant token's own vocabulary, deliberately not a second one. */
export const OAUTH_SCOPES: readonly AssistantTokenScope[] = ASSISTANT_TOKEN_SCOPES;

// ── Addresses ────────────────────────────────────────────────────────────────

/**
 * The instance's public base URL for this request, without a trailing slash.
 *
 * `BETTER_AUTH_URL` when it is set, because behind a reverse proxy the request's own origin is the
 * container's and not the address a client on the internet uses; the request's origin otherwise, so
 * a development server and the test suite work with no configuration.
 */
export function oauthBaseUrl(configured: string | null | undefined, requestUrl: string): string {
  const fromConfig = configured?.trim().replace(/\/+$/, "");
  if (fromConfig) return fromConfig;
  return new URL(requestUrl).origin;
}

/** The identifier of the protected resource: the MCP endpoint's own address. */
export function mcpResourceUrl(baseUrl: string): string {
  return `${baseUrl}${MCP_RESOURCE_PATH}`;
}

/** Where the protected-resource metadata of the MCP endpoint is served (RFC 9728 §3.1). */
export function protectedResourceMetadataUrl(baseUrl: string): string {
  return `${baseUrl}${OAUTH_PATHS.protectedResourceMetadata}${MCP_RESOURCE_PATH}`;
}

/**
 * Whether a `resource` parameter names this server's one resource (RFC 8707).
 *
 * Absent is accepted: there is only one resource a token could be for. A trailing slash is the one
 * difference tolerated, because clients disagree about it and it cannot name anything else.
 */
export function isMcpResource(value: string | null | undefined, baseUrl: string): boolean {
  if (value === null || value === undefined || value === "") return true;
  return value.replace(/\/+$/, "") === mcpResourceUrl(baseUrl);
}

// ── Metadata documents ───────────────────────────────────────────────────────

/** RFC 9728: what protects `/api/mcp`, and where to get a token for it. */
export function protectedResourceMetadata(baseUrl: string): Record<string, unknown> {
  return {
    resource: mcpResourceUrl(baseUrl),
    authorization_servers: [baseUrl],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Stamporama",
  };
}

/** RFC 8414: the authorization server's endpoints and exactly what it supports — nothing more. */
export function authorizationServerMetadata(baseUrl: string): Record<string, unknown> {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}${OAUTH_PATHS.authorize}`,
    token_endpoint: `${baseUrl}${OAUTH_PATHS.token}`,
    registration_endpoint: `${baseUrl}${OAUTH_PATHS.register}`,
    revocation_endpoint: `${baseUrl}${OAUTH_PATHS.revoke}`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
}

/**
 * The `WWW-Authenticate` value of the MCP endpoint's `401`.
 *
 * `resource_metadata` is what lets a client that knows only the endpoint's address find everything
 * else. `invalid_token` is added when a credential was sent and refused, which is what tells a
 * client to refresh or to start over rather than to conclude it was never connected.
 */
export function mcpChallenge(baseUrl: string, credentialRefused: boolean): string {
  const parts = [`resource_metadata="${protectedResourceMetadataUrl(baseUrl)}"`];
  if (credentialRefused) parts.unshift('error="invalid_token"');
  return `Bearer ${parts.join(", ")}`;
}

// ── Redirect URIs ────────────────────────────────────────────────────────────

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Whether a client may register this redirect URI.
 *
 * `https` anywhere, or `http` on this machine's loopback — which is how a desktop or command-line
 * client receives its code (RFC 8252 §7.3). Everything else is refused: a `javascript:` or `data:`
 * address would run in the collector's browser with the code in hand, and a private scheme cannot be
 * told from one. No fragment (RFC 6749 §3.1.2), no credentials in the address, no whitespace.
 */
export function isAcceptableRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.length > OAUTH_MAX_REDIRECT_URI_LENGTH) return false;
  // `new URL` forgives whitespace around and inside an address; a stored one must be the exact
  // string a request will be compared with.
  if (/\s/.test(value)) return false;
  const url = parseUrl(value);
  if (!url) return false;
  if (url.hash || value.includes("#")) return false;
  if (url.username || url.password) return false;
  return url.protocol === "https:" || isLoopback(url);
}

/**
 * Whether the redirect URI on a request is one the client registered.
 *
 * An exact string match, with the one exception RFC 8252 §7.3 asks for: a loopback address matches
 * on any port, because a native client listens on whichever one the system hands it.
 */
export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const asked = parseUrl(requested);
  if (!asked || !isLoopback(asked) || !isAcceptableRedirectUri(requested)) return false;
  return registered.some((candidate) => {
    const known = parseUrl(candidate);
    if (!known || !isLoopback(known)) return false;
    return (
      known.hostname === asked.hostname &&
      known.pathname === asked.pathname &&
      known.search === asked.search
    );
  });
}

/** A redirect back to the client, carrying an answer in its query. */
export function redirectWithParams(
  redirectUri: string,
  params: Record<string, string | null | undefined>
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

// ── Dynamic client registration (RFC 7591) ───────────────────────────────────

export interface OAuthClientRegistration {
  readonly name: string;
  readonly redirectUris: readonly string[];
}

export type RegistrationCheck =
  | { readonly ok: true; readonly registration: OAuthClientRegistration }
  | { readonly ok: false; readonly error: string; readonly description: string };

function registrationError(error: string, description: string): RegistrationCheck {
  return { ok: false, error, description };
}

/**
 * Read a registration request.
 *
 * Only what this server uses is read: the redirect URIs and a name to show the collector. Every
 * client is a **public** one — the reply says `token_endpoint_auth_method: "none"` whatever was asked
 * for, which RFC 7591 §2 allows a server to do, and PKCE is what stands where a secret would.
 * A request that rules out the one flow on offer is refused rather than registered and left to fail.
 */
export function checkClientRegistration(body: unknown): RegistrationCheck {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return registrationError("invalid_client_metadata", "Send the client metadata as a JSON object.");
  }
  const metadata = body as Record<string, unknown>;

  const uris = metadata.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    return registrationError("invalid_redirect_uri", "`redirect_uris` must list at least one address.");
  }
  if (uris.length > OAUTH_MAX_REDIRECT_URIS) {
    return registrationError(
      "invalid_redirect_uri",
      `\`redirect_uris\` may list at most ${OAUTH_MAX_REDIRECT_URIS} addresses.`
    );
  }
  if (!uris.every(isAcceptableRedirectUri)) {
    return registrationError(
      "invalid_redirect_uri",
      "Every redirect URI must be an https address, or an http address on localhost, with no fragment."
    );
  }

  const grantTypes = metadata.grant_types;
  if (grantTypes !== undefined) {
    if (!Array.isArray(grantTypes) || !grantTypes.includes("authorization_code")) {
      return registrationError(
        "invalid_client_metadata",
        "`grant_types` must include `authorization_code`, the only way this server issues a token."
      );
    }
  }
  const responseTypes = metadata.response_types;
  if (responseTypes !== undefined) {
    if (!Array.isArray(responseTypes) || !responseTypes.includes("code")) {
      return registrationError(
        "invalid_client_metadata",
        "`response_types` must include `code`, the only response type this server gives."
      );
    }
  }

  const rawName = typeof metadata.client_name === "string" ? metadata.client_name : "";
  // Shown to the collector on the consent screen, so it is one line and of a bounded length.
  const name =
    rawName.replace(/\s+/g, " ").trim().slice(0, OAUTH_MAX_CLIENT_NAME_LENGTH) ||
    OAUTH_DEFAULT_CLIENT_NAME;

  return { ok: true, registration: { name, redirectUris: [...new Set(uris as string[])] } };
}

/** The reply to a registration: what was registered, which is not always what was asked for. */
export function clientRegistrationResponse(client: {
  id: string;
  name: string;
  redirectUris: readonly string[];
  createdAt: Date;
}): Record<string, unknown> {
  return {
    client_id: client.id,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.name,
    redirect_uris: [...client.redirectUris],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

// ── Which collections a grant reaches (#2728) ────────────────────────────────

/**
 * What the collector allowed an app to reach: every collection of the account — the ones it has and
 * the ones it makes later — or the chosen ones.
 */
export type CollectionAccess =
  | { readonly all: true }
  | { readonly all: false; readonly collectionIds: readonly string[] };

export type CollectionAccessCheck =
  | { readonly ok: true; readonly access: CollectionAccess }
  | { readonly ok: false; readonly message: string };

/**
 * Read the collector's choice of collections as it arrives from a form, against the collections the
 * account owns.
 *
 * *All* needs nothing else and is accepted from an account with no collection yet — it is a
 * statement about the future as much as the present. A selection must name at least one collection
 * and only the account's own: a choice of nothing is not a connection, and an id that is not theirs
 * is refused whole rather than dropped, because a screen that sent one is not the screen that was
 * drawn.
 */
export function checkCollectionAccess(
  choice: { readonly all: unknown; readonly collectionIds: unknown },
  ownedCollectionIds: readonly string[]
): CollectionAccessCheck {
  if (choice.all === true) return { ok: true, access: { all: true } };
  const ids = choice.collectionIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, message: "Choose at least one collection, or all of them." };
  }
  const owned = new Set(ownedCollectionIds);
  if (!ids.every((id): id is string => typeof id === "string" && owned.has(id))) {
    return { ok: false, message: "Choose among your own collections." };
  }
  return { ok: true, access: { all: false, collectionIds: [...new Set(ids)] } };
}

// ── PKCE (RFC 7636) ──────────────────────────────────────────────────────────

/** A `code_challenge` for `S256`: 43 characters of base64url, the encoding of a SHA-256. */
export function isCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** A `code_verifier`: 43 to 128 unreserved characters. */
export function isCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

/** Whether a verifier is the one its challenge was made from. `S256` only — `plain` proves nothing. */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (!isCodeVerifier(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

// ── The authorization request ────────────────────────────────────────────────

/** A registered client, as far as the rules need to know it. */
export interface KnownOAuthClient {
  readonly id: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
}

/** An authorization request that passed every check. */
export interface AuthorizationRequest {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly state: string | null;
  /** The scopes the collector may choose from, widest last. Never empty. */
  readonly offeredScopes: readonly AssistantTokenScope[];
}

export type AuthorizationCheck =
  | { readonly kind: "ok"; readonly request: AuthorizationRequest }
  /** The client or its redirect URI is not to be trusted: say so here, send the browser nowhere. */
  | { readonly kind: "page"; readonly message: string }
  /** The client is known and the fault is its request's: it is told at its own redirect URI. */
  | { readonly kind: "redirect"; readonly location: string };

export type AuthorizationParams = Readonly<Record<string, string | null | undefined>>;

/**
 * The scopes a request leaves the collector to choose between.
 *
 * The collector decides, not the client: a client that asked for nothing, or for `read_write`, is
 * offered both and the collector may still pick `read`. A client that asked for `read` alone is
 * offered only that — a grant never reaches further than what was asked.
 */
export function offeredScopes(requested: string | null | undefined): AssistantTokenScope[] {
  const known = (requested ?? "").split(/\s+/).filter(isAssistantTokenScope);
  if (known.length > 0 && !known.includes("read_write")) return ["read"];
  return [...OAUTH_SCOPES];
}

/**
 * Check an authorization request against the client that sent it.
 *
 * **The order is the security of it.** Until the client and its redirect URI are both established,
 * nothing is sent anywhere: a redirect to an address the client never registered is how an
 * authorization server becomes an open redirector, or hands a code to somebody else. Only after that
 * is a fault reported the way RFC 6749 §4.1.2.1 asks — at the client's own redirect URI, with the
 * `state` it sent.
 */
export function checkAuthorizationRequest(
  params: AuthorizationParams,
  client: KnownOAuthClient | null,
  baseUrl: string
): AuthorizationCheck {
  if (!params.client_id || !client || client.id !== params.client_id) {
    return {
      kind: "page",
      message:
        "This app is not registered with this Stamporama instance. Remove the connection in the app and add it again.",
    };
  }
  const redirectUri = params.redirect_uri;
  if (!redirectUri || !redirectUriMatches(client.redirectUris, redirectUri)) {
    return {
      kind: "page",
      message:
        "The address this app asked to be sent back to is not one it registered, so the request was stopped here.",
    };
  }

  const state = params.state ?? null;
  const refuse = (error: string, description: string): AuthorizationCheck => ({
    kind: "redirect",
    location: redirectWithParams(redirectUri, {
      error,
      error_description: description,
      state,
      iss: baseUrl,
    }),
  });

  if (params.response_type !== "code") {
    return refuse("unsupported_response_type", "Only `response_type=code` is supported.");
  }
  if (!isCodeChallenge(params.code_challenge)) {
    return refuse("invalid_request", "A PKCE `code_challenge` is required.");
  }
  // RFC 7636 makes `plain` the default when the method is absent, and `plain` is not accepted here,
  // so the method has to be stated.
  if (params.code_challenge_method !== "S256") {
    return refuse("invalid_request", "`code_challenge_method` must be `S256`.");
  }
  if (!isMcpResource(params.resource, baseUrl)) {
    return refuse("invalid_target", `This server issues tokens for ${mcpResourceUrl(baseUrl)} only.`);
  }

  return {
    kind: "ok",
    request: {
      clientId: client.id,
      clientName: client.name,
      redirectUri,
      codeChallenge: params.code_challenge,
      state,
      offeredScopes: offeredScopes(params.scope),
    },
  };
}

/** Where the browser goes once the collector has allowed the request. */
export function approvedRedirect(
  request: Pick<AuthorizationRequest, "redirectUri" | "state">,
  code: string,
  baseUrl: string
): string {
  return redirectWithParams(request.redirectUri, { code, state: request.state, iss: baseUrl });
}

/** Where the browser goes once the collector has refused it. */
export function deniedRedirect(
  request: Pick<AuthorizationRequest, "redirectUri" | "state">,
  baseUrl: string
): string {
  return redirectWithParams(request.redirectUri, {
    error: "access_denied",
    error_description: "The request was refused in Stamporama.",
    state: request.state,
    iss: baseUrl,
  });
}

// ── The token endpoint ───────────────────────────────────────────────────────

/** A refusal at the token endpoint, in RFC 6749 §5.2's words. */
export class OAuthTokenError extends Error {
  constructor(
    readonly error:
      | "invalid_request"
      | "invalid_client"
      | "invalid_grant"
      | "invalid_target"
      | "unsupported_grant_type",
    readonly description: string
  ) {
    super(description);
    this.name = "OAuthTokenError";
  }

  /** `invalid_client` is the one refusal RFC 6749 gives a `401`. */
  get status(): number {
    return this.error === "invalid_client" ? 401 : 400;
  }
}

export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly scope: AssistantTokenScope;
}

/** RFC 6749 §5.1. */
export function tokenResponse(tokens: IssuedTokens): Record<string, unknown> {
  return {
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: tokens.refreshToken,
    scope: tokens.scope,
  };
}

/**
 * What a presented refresh token is, given the grant it was found on.
 *
 * `current` is rotated. `retry` is the token just replaced, presented inside the grace period, and
 * is answered with a fresh pair. `replayed` is the same token presented later, which ends the grant:
 * by then the client holds its successor, so whoever is presenting this one is somebody else.
 */
export function classifyRefresh(
  grant: { matchesCurrent: boolean; rotatedAt: Date | null },
  now: Date
): "current" | "retry" | "replayed" {
  if (grant.matchesCurrent) return "current";
  if (!grant.rotatedAt) return "replayed";
  return now.getTime() - grant.rotatedAt.getTime() <= OAUTH_REFRESH_REUSE_GRACE_MS
    ? "retry"
    : "replayed";
}
