import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import {
  assistantTokenKindOrLegacy,
  assistantTokenScopeOrWidest,
  type AssistantTokenKind,
  type AssistantTokenScope,
} from "./assistant-token-scope";

// Bearer tokens for the Stamporama Assistant browser extension (#253, part of #155). The extension
// calls a collection's Colnect matcher endpoints from colnect.com — cross-site, where the Better
// Auth session cookie is not sent — so it authenticates with a per-collection token instead. A token
// authorizes as the collection's owner for that one collection. Only the SHA-256 hash is stored; the
// raw value is returned once at creation and never again. Tokens are minted either by the one-click
// registration exchange (`assistant-registration.ts`, #252) or by hand from Settings → Assistant;
// both land in the same list and revoke the same way.
//
// Since #707 a token also carries a **scope** (`read` / `read_write`) and a **kind**
// (`extension` / `agent`). The vocabulary and the one decision that reads it live in the pure
// `assistant-token-scope.ts`, because Settings → Assistant is a `"use client"` panel and this
// module carries `server-only`. Both are required at mint time rather than defaulted: the column's
// default was the migration's backfill and was dropped after it, so nothing here can arrive at
// `read_write` by omission.

const TOKEN_PREFIX = "stmpa_";

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** SHA-256 hex of a raw token — the only form persisted. */
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export interface AssistantTokenData {
  id: string;
  label: string | null;
  scope: AssistantTokenScope;
  kind: AssistantTokenKind;
  createdAt: string;
  lastUsedAt: string | null;
}

/** What a mint has to state. `label` is the only optional part of it. */
export interface AssistantTokenMint {
  scope: AssistantTokenScope;
  kind: AssistantTokenKind;
  label?: string | null;
}

/**
 * A stored row as the app reads it. `scope` and `kind` go through the pure readers rather than
 * being cast: the columns are TEXT, and a row written by a build that did not know about #707 is
 * exactly the case those readers fall back for.
 */
function toTokenData(row: {
  id: string;
  label: string | null;
  scope: string;
  kind: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}): AssistantTokenData {
  return {
    id: row.id,
    label: row.label,
    scope: assistantTokenScopeOrWidest(row.scope),
    kind: assistantTokenKindOrLegacy(row.kind),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/**
 * Mint a new Assistant token for a collection the caller owns. Returns the **raw** token exactly
 * once (prefix `stmpa_` + 32 random bytes, base64url) alongside its stored metadata; only the hash
 * is persisted, so a lost token cannot be recovered — the user regenerates instead.
 *
 * `scope` and `kind` are required rather than defaulted, which is the whole of #707 on this side: a
 * caller that has not thought about how far a token reaches does not compile, where a default would
 * have handed it the widest scope silently.
 */
export async function createAssistantToken(
  ownerId: string,
  collectionId: string,
  mint: AssistantTokenMint
): Promise<{ token: string; record: AssistantTokenData }> {
  await assertCollectionOwner(ownerId, collectionId);
  const rawToken = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const created = await prisma.assistantToken.create({
    data: {
      collectionId,
      tokenHash: hashToken(rawToken),
      label: mint.label?.trim() || null,
      scope: mint.scope,
      kind: mint.kind,
    },
    select: { id: true, label: true, scope: true, kind: true, createdAt: true, lastUsedAt: true },
  });
  return { token: rawToken, record: toTokenData(created) };
}

/** The tokens issued for a collection (metadata only — never the raw value), newest first. */
export async function listAssistantTokens(
  ownerId: string,
  collectionId: string
): Promise<AssistantTokenData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.assistantToken.findMany({
    where: { collectionId },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, scope: true, kind: true, createdAt: true, lastUsedAt: true },
  });
  return rows.map(toTokenData);
}

/** Revoke a token by id, scoped to a collection the caller owns. */
export async function revokeAssistantToken(
  ownerId: string,
  collectionId: string,
  tokenId: string
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.assistantToken.deleteMany({ where: { id: tokenId, collectionId } });
}

/** What a verified token authorizes: whose it is, which collection, and how far it reaches. */
export interface VerifiedAssistantToken {
  collectionId: string;
  ownerId: string;
  scope: AssistantTokenScope;
  kind: AssistantTokenKind;
}

/** Constant-time comparison of two hex digests of equal length. */
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verify a raw bearer token and resolve who/what it authorizes: the collection it belongs to, that
 * collection's owner (tokens act as the owner), and **how far the token reaches** (#707). Returns
 * `null` for any malformed, unknown, or revoked token. Bumps `lastUsedAt` on success. The lookup is
 * by hash; the constant-time compare is a belt-and-braces guard once the row is found.
 *
 * The scope is returned rather than checked here, because what it has to be checked against is the
 * *operation*, which this module knows nothing about. `route-auth.ts` is where the two meet.
 */
export async function verifyAssistantToken(
  rawToken: string
): Promise<VerifiedAssistantToken | null> {
  const token = rawToken.trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashToken(token);
  const row = await prisma.assistantToken.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true,
      tokenHash: true,
      scope: true,
      kind: true,
      collection: { select: { id: true, ownerId: true } },
    },
  });
  if (!row || !hashesEqual(row.tokenHash, hash)) return null;
  await prisma.assistantToken.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });
  return {
    collectionId: row.collection.id,
    ownerId: row.collection.ownerId,
    scope: assistantTokenScopeOrWidest(row.scope),
    kind: assistantTokenKindOrLegacy(row.kind),
  };
}
