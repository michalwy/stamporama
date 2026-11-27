import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { isAssistantTokenScope, type AssistantTokenScope } from "./assistant-token-scope";
import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_CODE_PREFIX,
  OAUTH_CODE_TTL_MS,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_UNUSED_CLIENT_TTL_MS,
  OAuthTokenError,
  classifyRefresh,
  verifyPkce,
  type IssuedTokens,
  type KnownOAuthClient,
  type OAuthClientRegistration,
} from "./oauth-rules";

// The rows behind the OAuth authorization server (#2715, ADR-0084): registered clients, one-time
// codes, and grants. **Nothing here decides a rule** — what a registration must say, which redirect
// URI matches, whether a verifier fits its challenge and what a reused refresh token means are all
// in the pure `oauth-rules.ts`. This module stores, claims atomically, and reads back.
//
// Every secret is stored as its SHA-256 and returned raw exactly once, as `api-tokens.ts` does for
// an Assistant token. A raw value is 32 random bytes, so a hash lookup is the whole verification:
// there is nothing to guess towards and no reason to compare in constant time a value that was
// found by its own digest.

function hash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function mint(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

function accessTokenExpiry(now: Date): Date {
  return new Date(now.getTime() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000);
}

// ── Clients ──────────────────────────────────────────────────────────────────

export interface RegisteredOAuthClient extends KnownOAuthClient {
  readonly createdAt: Date;
}

/**
 * Register a client. Open to anyone who can reach the instance, which is what dynamic registration
 * is — so each call also sweeps the registrations nobody ever authorised, and the route in front of
 * this limits how fast it can be called.
 *
 * A client a collector has allowed even once is never swept, connected or not: the app goes on
 * presenting that `client_id`, and deleting it would turn "connect again" into "remove the connector
 * and add it from scratch".
 */
export async function registerOAuthClient(
  registration: OAuthClientRegistration,
  now: Date = new Date()
): Promise<RegisteredOAuthClient> {
  await prisma.oAuthClient.deleteMany({
    where: {
      authorizedAt: null,
      createdAt: { lt: new Date(now.getTime() - OAUTH_UNUSED_CLIENT_TTL_MS) },
    },
  });
  return prisma.oAuthClient.create({
    data: {
      id: randomBytes(16).toString("base64url"),
      name: registration.name,
      redirectUris: [...registration.redirectUris],
    },
    select: { id: true, name: true, redirectUris: true, createdAt: true },
  });
}

export async function findOAuthClient(clientId: string): Promise<KnownOAuthClient | null> {
  if (!clientId) return null;
  return prisma.oAuthClient.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, redirectUris: true },
  });
}

// ── Authorization codes ──────────────────────────────────────────────────────

export interface AuthorizationGrantInput {
  readonly clientId: string;
  /** The signed-in account allowing the request. */
  readonly userId: string;
  readonly collectionId: string;
  readonly scope: AssistantTokenScope;
  readonly redirectUri: string;
  readonly codeChallenge: string;
}

/**
 * Record what the collector allowed and return the code that stands for it.
 *
 * The collection must be the allowing account's own — checked here, on the server, from the session
 * the caller resolved, because the collection id arrives from a form.
 */
export async function createAuthorizationCode(
  input: AuthorizationGrantInput,
  now: Date = new Date()
): Promise<string> {
  const collection = await prisma.collection.findUnique({
    where: { id: input.collectionId },
    select: { ownerId: true },
  });
  if (!collection || collection.ownerId !== input.userId) {
    throw new Error("Collection not found or access denied.");
  }

  const code = mint(OAUTH_CODE_PREFIX);
  await prisma.$transaction([
    // The sweep that keeps the table from growing: a code is dead two minutes after it was minted.
    prisma.oAuthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.oAuthAuthorizationCode.create({
      data: {
        codeHash: hash(code),
        clientId: input.clientId,
        userId: input.userId,
        collectionId: input.collectionId,
        scope: input.scope,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        expiresAt: new Date(now.getTime() + OAUTH_CODE_TTL_MS),
      },
    }),
  ]);
  return code;
}

const INVALID_CODE = "The authorization code is invalid, expired or already used.";

/**
 * Exchange a code for the first pair of tokens (RFC 6749 §4.1.3, with PKCE).
 *
 * Every refusal is the same `invalid_grant` with the same sentence: a client holding a real code
 * never sees one, and somebody probing learns nothing from which check stopped them. **A code
 * presented a second time ends the grant its first use produced** (OAuth 2.1 §4.1.3) — one of the two
 * presenters was not the client, and there is no telling which.
 */
export async function exchangeAuthorizationCode(
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: unknown;
  },
  now: Date = new Date()
): Promise<IssuedTokens> {
  const refuse = () => new OAuthTokenError("invalid_grant", INVALID_CODE);
  if (!input.code.startsWith(OAUTH_CODE_PREFIX)) throw refuse();

  const row = await prisma.oAuthAuthorizationCode.findUnique({
    where: { codeHash: hash(input.code) },
    include: { collection: { select: { ownerId: true } } },
  });
  if (!row) throw refuse();
  if (row.usedAt) {
    if (row.grantId) await prisma.oAuthGrant.deleteMany({ where: { id: row.grantId } });
    throw refuse();
  }
  if (row.expiresAt.getTime() <= now.getTime()) throw refuse();
  if (row.clientId !== input.clientId) throw refuse();
  if (row.redirectUri !== input.redirectUri) throw refuse();
  if (!verifyPkce(input.codeVerifier, row.codeChallenge)) throw refuse();
  // The collection changed hands, or the account lost it, between the consent and the exchange.
  if (row.collection.ownerId !== row.userId) throw refuse();

  // The claim. Two requests racing with the same code both pass every check above; only one of them
  // changes this row.
  const claimed = await prisma.oAuthAuthorizationCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) throw refuse();

  const accessToken = mint(OAUTH_ACCESS_TOKEN_PREFIX);
  const refreshToken = mint(OAUTH_REFRESH_TOKEN_PREFIX);
  const scope = assistantTokenScopeOrRead(row.scope);

  const [, grant] = await prisma.$transaction([
    // One connection per app, account and collection: allowing the same app again replaces what it
    // had rather than leaving a second row the collector would have to tell apart in Settings.
    prisma.oAuthGrant.deleteMany({
      where: { clientId: row.clientId, userId: row.userId, collectionId: row.collectionId },
    }),
    prisma.oAuthGrant.create({
      data: {
        clientId: row.clientId,
        userId: row.userId,
        collectionId: row.collectionId,
        scope,
        accessTokenHash: hash(accessToken),
        accessTokenExpiresAt: accessTokenExpiry(now),
        refreshTokenHash: hash(refreshToken),
      },
      select: { id: true },
    }),
    prisma.oAuthClient.updateMany({
      where: { id: row.clientId, authorizedAt: null },
      data: { authorizedAt: now },
    }),
  ]);
  await prisma.oAuthAuthorizationCode.update({
    where: { id: row.id },
    data: { grantId: grant.id },
  });

  return { accessToken, refreshToken, scope };
}

/**
 * Read a stored scope, falling back to the **narrowest**.
 *
 * The opposite fallback from `assistantTokenScopeOrWidest`, and for the opposite reason: no grant
 * predates the column, so an unknown value here is a fault, and a fault must not widen what an app
 * may do.
 */
function assistantTokenScopeOrRead(value: string): AssistantTokenScope {
  return isAssistantTokenScope(value) ? value : "read";
}

// ── Refresh ──────────────────────────────────────────────────────────────────

const INVALID_REFRESH = "The refresh token is invalid or was revoked. Connect again.";

/**
 * Exchange a refresh token for a new pair, rotating it (OAuth 2.1 §4.3.1).
 *
 * What a token that is not the current one means is `classifyRefresh`'s to say; this finds the
 * grant, asks, and either rotates or ends it.
 */
export async function refreshOAuthTokens(
  input: { refreshToken: string; clientId: string },
  now: Date = new Date()
): Promise<IssuedTokens> {
  const refuse = () => new OAuthTokenError("invalid_grant", INVALID_REFRESH);
  if (!input.refreshToken.startsWith(OAUTH_REFRESH_TOKEN_PREFIX)) throw refuse();
  const presented = hash(input.refreshToken);

  const grant = await prisma.oAuthGrant.findFirst({
    where: { OR: [{ refreshTokenHash: presented }, { previousRefreshTokenHash: presented }] },
    include: { collection: { select: { ownerId: true } } },
  });
  if (!grant || grant.clientId !== input.clientId) throw refuse();

  if (grant.collection.ownerId !== grant.userId) {
    await prisma.oAuthGrant.deleteMany({ where: { id: grant.id } });
    throw refuse();
  }

  const kind = classifyRefresh(
    { matchesCurrent: grant.refreshTokenHash === presented, rotatedAt: grant.refreshRotatedAt },
    now
  );
  if (kind === "replayed") {
    await prisma.oAuthGrant.deleteMany({ where: { id: grant.id } });
    throw refuse();
  }

  const accessToken = mint(OAUTH_ACCESS_TOKEN_PREFIX);
  const refreshToken = mint(OAUTH_REFRESH_TOKEN_PREFIX);
  // Conditional on the row still being as it was read, so two refreshes at the same instant cannot
  // both believe they rotated it. On a retry the previous hash stays what it is — the token the
  // client is still holding — and only the grace period's clock is left alone.
  const rotated = await prisma.oAuthGrant.updateMany({
    where: { id: grant.id, refreshTokenHash: grant.refreshTokenHash },
    data: {
      accessTokenHash: hash(accessToken),
      accessTokenExpiresAt: accessTokenExpiry(now),
      refreshTokenHash: hash(refreshToken),
      ...(kind === "current"
        ? { previousRefreshTokenHash: presented, refreshRotatedAt: now }
        : {}),
    },
  });
  if (rotated.count !== 1) {
    // Somebody else rotated it between the read and the write. The presented token is now at best
    // the previous one, inside its grace period: the client asks again and gets a pair.
    throw new OAuthTokenError("invalid_grant", "The refresh token was just used. Try again.");
  }

  return { accessToken, refreshToken, scope: assistantTokenScopeOrRead(grant.scope) };
}

// ── Verification ─────────────────────────────────────────────────────────────

/** What a verified access token authorises — the shape an Assistant token verifies to. */
export interface VerifiedOAuthAccessToken {
  readonly ownerId: string;
  readonly collectionId: string;
  readonly scope: AssistantTokenScope;
}

/**
 * Verify an access token presented at `/api/mcp`. `null` for anything unknown, expired or revoked.
 *
 * **A call acts as the account that allowed it**, and only while that account still owns the
 * collection: the grant names both, and the two are compared on every call rather than trusted from
 * the day the consent was given.
 */
export async function verifyOAuthAccessToken(
  rawToken: string,
  now: Date = new Date()
): Promise<VerifiedOAuthAccessToken | null> {
  const token = rawToken.trim();
  if (!token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return null;
  const grant = await prisma.oAuthGrant.findUnique({
    where: { accessTokenHash: hash(token) },
    select: {
      id: true,
      userId: true,
      scope: true,
      accessTokenExpiresAt: true,
      collection: { select: { id: true, ownerId: true } },
    },
  });
  if (!grant) return null;
  if (grant.accessTokenExpiresAt.getTime() <= now.getTime()) return null;
  if (grant.collection.ownerId !== grant.userId) return null;
  await prisma.oAuthGrant.updateMany({ where: { id: grant.id }, data: { lastUsedAt: now } });
  return {
    ownerId: grant.userId,
    collectionId: grant.collection.id,
    scope: assistantTokenScopeOrRead(grant.scope),
  };
}

// ── Revocation ───────────────────────────────────────────────────────────────

/**
 * Revoke by token (RFC 7009): either token of a grant ends the whole grant. Silent about whether
 * anything was found, as the RFC asks — the caller answers `200` either way.
 */
export async function revokeOAuthToken(rawToken: string): Promise<void> {
  const token = rawToken.trim();
  if (
    !token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX) &&
    !token.startsWith(OAUTH_REFRESH_TOKEN_PREFIX)
  ) {
    return;
  }
  const presented = hash(token);
  await prisma.oAuthGrant.deleteMany({
    where: { OR: [{ accessTokenHash: presented }, { refreshTokenHash: presented }] },
  });
}

// ── Settings → Assistant & API ───────────────────────────────────────────────

export interface OAuthGrantData {
  id: string;
  clientName: string;
  scope: AssistantTokenScope;
  createdAt: string;
  lastUsedAt: string | null;
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** The apps connected to a collection the caller owns, newest first. */
export async function listOAuthGrants(
  ownerId: string,
  collectionId: string
): Promise<OAuthGrantData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.oAuthGrant.findMany({
    where: { collectionId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      scope: true,
      createdAt: true,
      lastUsedAt: true,
      client: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    clientName: row.client.name,
    scope: assistantTokenScopeOrRead(row.scope),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}

/** Disconnect an app from a collection the caller owns. Its tokens stop working at once. */
export async function revokeOAuthGrant(
  ownerId: string,
  collectionId: string,
  grantId: string
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.oAuthGrant.deleteMany({ where: { id: grantId, collectionId } });
}
