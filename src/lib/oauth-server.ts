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
  checkCollectionAccess,
  verifyPkce,
  type CollectionAccess,
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
  /** Every collection of the account, or the chosen ones (#2728) — as the form sent it. */
  readonly access: { readonly all: unknown; readonly collectionIds: unknown };
  readonly scope: AssistantTokenScope;
  readonly redirectUri: string;
  readonly codeChallenge: string;
}

/** A choice of collections the account may not make. Its message is written for the collector. */
export class CollectionAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionAccessError";
  }
}

async function ownedCollectionIds(userId: string): Promise<string[]> {
  const rows = await prisma.collection.findMany({ where: { ownerId: userId }, select: { id: true } });
  return rows.map((row) => row.id);
}

/**
 * Read a choice of collections against the account's own, or throw `CollectionAccessError`.
 *
 * Checked here, on the server, from the session the caller resolved, because the ids arrive from a
 * form. The rule itself is `checkCollectionAccess`'s.
 */
async function assertCollectionAccess(
  userId: string,
  choice: { readonly all: unknown; readonly collectionIds: unknown }
): Promise<CollectionAccess> {
  const checked = checkCollectionAccess(choice, await ownedCollectionIds(userId));
  if (!checked.ok) throw new CollectionAccessError(checked.message);
  return checked.access;
}

/**
 * Record what the collector allowed and return the code that stands for it.
 *
 * A selection must be of the allowing account's own collections (`assertCollectionAccess`).
 */
export async function createAuthorizationCode(
  input: AuthorizationGrantInput,
  now: Date = new Date()
): Promise<string> {
  const access = await assertCollectionAccess(input.userId, input.access);

  const code = mint(OAUTH_CODE_PREFIX);
  await prisma.$transaction([
    // The sweep that keeps the table from growing: a code is dead two minutes after it was minted.
    prisma.oAuthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.oAuthAuthorizationCode.create({
      data: {
        codeHash: hash(code),
        clientId: input.clientId,
        userId: input.userId,
        allCollections: access.all,
        collectionIds: access.all ? [] : [...access.collectionIds],
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
  // A chosen collection changed hands, or was deleted, between the consent and the exchange: the
  // grant is made for the ones still the account's, and not at all when none is. `collectionId` is
  // what a code minted before #2728 carried.
  const chosen = row.collectionIds.length > 0 ? row.collectionIds : row.collectionId ? [row.collectionId] : [];
  const collectionIds = row.allCollections
    ? []
    : (
        await prisma.collection.findMany({
          where: { id: { in: chosen }, ownerId: row.userId },
          select: { id: true },
        })
      ).map((collection) => collection.id);
  if (!row.allCollections && collectionIds.length === 0) throw refuse();

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
    // One connection per app and account: allowing the same app again replaces what it had —
    // collections and scope both — rather than leaving a second row the collector would have to
    // tell apart in Settings (#2728; before it, one per app, account and collection).
    prisma.oAuthGrant.deleteMany({ where: { clientId: row.clientId, userId: row.userId } }),
    prisma.oAuthGrant.create({
      data: {
        clientId: row.clientId,
        userId: row.userId,
        allCollections: row.allCollections,
        collections: { create: collectionIds.map((collectionId) => ({ collectionId })) },
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
  });
  if (!grant || grant.clientId !== input.clientId) throw refuse();

  // A grant for chosen collections that reaches none of them any more — each deleted, or no longer
  // the account's — is over, as a grant whose one collection had gone was before #2728.
  if (!grant.allCollections && (await reachableCollections(grant)).length === 0) {
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

/** A collection a credential reaches, as far as a caller needs to know it to name it. */
export interface ReachableCollection {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/** What a verified access token authorises. */
export interface VerifiedOAuthAccessToken {
  readonly ownerId: string;
  readonly scope: AssistantTokenScope;
  /** Whether the grant is for every collection of the account, including ones made later. */
  readonly allCollections: boolean;
  /** The collections it reaches at this moment, oldest first. */
  readonly collections: readonly ReachableCollection[];
}

const REACHABLE_SELECT = { id: true, slug: true, name: true } as const;

/**
 * The collections a grant reaches now: every collection its account owns, or the chosen ones **that
 * the account still owns**. Read on every call rather than trusted from the day the consent was
 * given — which is also what makes a collection made afterwards reachable by a grant for all, and a
 * change in Settings take effect on the app's next call.
 */
async function reachableCollections(grant: {
  id: string;
  userId: string;
  allCollections: boolean;
}): Promise<ReachableCollection[]> {
  return prisma.collection.findMany({
    where: grant.allCollections
      ? { ownerId: grant.userId }
      : { ownerId: grant.userId, oauthGrantCollections: { some: { grantId: grant.id } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: REACHABLE_SELECT,
  });
}

/**
 * Verify an access token presented at `/api/mcp`. `null` for anything unknown, expired or revoked.
 *
 * **A call acts as the account that allowed it**, on the collections that account still owns among
 * those it allowed. A grant for chosen collections that reaches none of them any more verifies to
 * nothing; a grant for all collections stays good on an account that has none yet.
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
      allCollections: true,
      accessTokenExpiresAt: true,
    },
  });
  if (!grant) return null;
  if (grant.accessTokenExpiresAt.getTime() <= now.getTime()) return null;
  const collections = await reachableCollections(grant);
  if (!grant.allCollections && collections.length === 0) return null;
  await prisma.oAuthGrant.updateMany({ where: { id: grant.id }, data: { lastUsedAt: now } });
  return {
    ownerId: grant.userId,
    scope: assistantTokenScopeOrRead(grant.scope),
    allCollections: grant.allCollections,
    collections,
  };
}

/** The one collection an Assistant token is pinned to, in the shape a grant's are read in. */
export async function findReachableCollection(collectionId: string): Promise<ReachableCollection | null> {
  return prisma.collection.findUnique({ where: { id: collectionId }, select: REACHABLE_SELECT });
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
  /** Every collection of the account, including ones made later. */
  allCollections: boolean;
  /** The chosen collections when it is not for all — only those the account still owns. */
  collections: { id: string; name: string }[];
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * The apps connected to an account, newest first, each with what it reaches.
 *
 * **The account's, not one collection's** (#2728): a connection may reach several collections or all
 * of them, so Settings → Assistant & API shows the same list in every collection, and it is where a
 * connection that reaches *another* collection is widened to this one.
 */
export async function listOAuthGrants(userId: string): Promise<OAuthGrantData[]> {
  const rows = await prisma.oAuthGrant.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      scope: true,
      allCollections: true,
      createdAt: true,
      lastUsedAt: true,
      client: { select: { name: true } },
      collections: {
        where: { collection: { ownerId: userId } },
        orderBy: { collection: { createdAt: "asc" } },
        select: { collection: { select: { id: true, name: true } } },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    clientName: row.client.name,
    scope: assistantTokenScopeOrRead(row.scope),
    allCollections: row.allCollections,
    collections: row.allCollections ? [] : row.collections.map((entry) => entry.collection),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}

/**
 * Change which collections a connected app reaches (#2728). The app is not told and does not
 * reconnect: what its token reaches is read on every call, so the next one sees the change.
 *
 * Throws `CollectionAccessError` for a choice the account may not make, and a plain error when the
 * grant is not this account's.
 */
export async function updateOAuthGrantAccess(
  userId: string,
  grantId: string,
  choice: { readonly all: unknown; readonly collectionIds: unknown }
): Promise<void> {
  const grant = await prisma.oAuthGrant.findUnique({ where: { id: grantId }, select: { userId: true } });
  if (!grant || grant.userId !== userId) throw new Error("Connected app not found or access denied.");
  const access = await assertCollectionAccess(userId, choice);
  await prisma.$transaction([
    prisma.oAuthGrant.update({ where: { id: grantId }, data: { allCollections: access.all } }),
    prisma.oAuthGrantCollection.deleteMany({ where: { grantId } }),
    prisma.oAuthGrantCollection.createMany({
      data: access.all ? [] : access.collectionIds.map((collectionId) => ({ grantId, collectionId })),
    }),
  ]);
}

/** Disconnect an app from the account. Its tokens stop working at once. */
export async function revokeOAuthGrant(userId: string, grantId: string): Promise<void> {
  await prisma.oAuthGrant.deleteMany({ where: { id: grantId, userId } });
}
