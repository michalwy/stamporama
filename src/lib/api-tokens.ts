import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";

// Bearer tokens for the Stamporama Assistant browser extension (#253, part of #155). The extension
// calls a collection's Colnect matcher endpoints from colnect.com — cross-site, where the Better
// Auth session cookie is not sent — so it authenticates with a per-collection token instead. A token
// authorizes as the collection's owner for that one collection. Only the SHA-256 hash is stored; the
// raw value is returned once at creation and never again. The full registration/code-exchange
// issuance flow is #252; this is the minimal generator + verifier behind it.

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
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Mint a new Assistant token for a collection the caller owns. Returns the **raw** token exactly
 * once (prefix `stmpa_` + 32 random bytes, base64url) alongside its stored metadata; only the hash
 * is persisted, so a lost token cannot be recovered — the user regenerates instead.
 */
export async function createAssistantToken(
  ownerId: string,
  collectionId: string,
  label?: string | null
): Promise<{ token: string; record: AssistantTokenData }> {
  await assertCollectionOwner(ownerId, collectionId);
  const rawToken = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const created = await prisma.assistantToken.create({
    data: {
      collectionId,
      tokenHash: hashToken(rawToken),
      label: label?.trim() || null,
    },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  });
  return {
    token: rawToken,
    record: {
      id: created.id,
      label: created.label,
      createdAt: created.createdAt.toISOString(),
      lastUsedAt: created.lastUsedAt?.toISOString() ?? null,
    },
  };
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
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));
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

/** Constant-time comparison of two hex digests of equal length. */
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verify a raw bearer token and resolve who/what it authorizes: the collection it belongs to and
 * that collection's owner (tokens act as the owner). Returns `null` for any malformed, unknown, or
 * revoked token. Bumps `lastUsedAt` on success. The lookup is by hash; the constant-time compare is
 * a belt-and-braces guard once the row is found.
 */
export async function verifyAssistantToken(
  rawToken: string
): Promise<{ collectionId: string; ownerId: string } | null> {
  const token = rawToken.trim();
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashToken(token);
  const row = await prisma.assistantToken.findUnique({
    where: { tokenHash: hash },
    select: { id: true, tokenHash: true, collection: { select: { id: true, ownerId: true } } },
  });
  if (!row || !hashesEqual(row.tokenHash, hash)) return null;
  await prisma.assistantToken.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });
  return { collectionId: row.collection.id, ownerId: row.collection.ownerId };
}
