import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { createAssistantToken } from "./api-tokens";

// One-time registration codes for the Stamporama Assistant extension (#252, part of #155).
//
// Typing an instance URL and a token into the extension is both tedious and easy to get wrong, so
// the instance registers *itself*: Settings mints a short-lived code and exposes it on the page next
// to the instance's own origin and collection; the extension reads that payload on a toolbar-icon
// click and exchanges the code for an `AssistantToken` (`api-tokens.ts`). The long-lived token is
// therefore never in a URL, a fragment, or the page — only the code is, and only for minutes.
//
// Codes are stored as SHA-256 hashes like tokens are, and redemption is a single atomic claim so a
// code cannot be spent twice even if two clients race for it.

const CODE_PREFIX = "stmpr_";

/** Long enough to be worth exposing on a page for a few minutes; short enough to be a one-shot. */
const CODE_TTL_MS = 5 * 60 * 1000;

/** The label registration-minted tokens carry in the Settings list, so their origin is obvious. */
const REGISTERED_TOKEN_LABEL = "Stamporama Assistant (registered)";

function hashCode(rawCode: string): string {
  return createHash("sha256").update(rawCode, "utf8").digest("hex");
}

export interface AssistantRegistrationCodeData {
  /** The raw code — returned once, at creation, and never recoverable afterwards. */
  code: string;
  expiresAt: string;
}

/**
 * Mint a registration code for a collection the caller owns. Any earlier code for the collection is
 * dropped first: only the code currently on screen should be redeemable, so re-clicking Connect
 * invalidates whatever the previous click left behind. Expired and already-used rows go with it —
 * this is also the sweep that keeps the table from growing.
 */
export async function createAssistantRegistrationCode(
  ownerId: string,
  collectionId: string
): Promise<AssistantRegistrationCodeData> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }

  const rawCode = CODE_PREFIX + randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await prisma.$transaction([
    prisma.assistantRegistrationCode.deleteMany({ where: { collectionId } }),
    prisma.assistantRegistrationCode.create({
      data: { collectionId, codeHash: hashCode(rawCode), expiresAt },
    }),
  ]);

  return { code: rawCode, expiresAt: expiresAt.toISOString() };
}

export interface RedeemedRegistration {
  /** The raw Assistant token the extension stores in its profile. */
  token: string;
  collectionId: string;
  collectionName: string;
}

/**
 * Exchange a registration code for a scoped Assistant token, or `null` when the code is unknown,
 * expired, or already spent. The claim is a conditional `updateMany` rather than a read-then-write,
 * so exactly one caller can ever move a code from unused to used; the token is minted only after
 * that claim succeeds. The token authorizes as the collection's owner, so no session is needed —
 * possession of an unspent code *is* the authorization, which is why it lives for minutes.
 */
export async function redeemAssistantRegistrationCode(
  rawCode: string
): Promise<RedeemedRegistration | null> {
  const code = rawCode.trim();
  if (!code.startsWith(CODE_PREFIX)) return null;

  const row = await prisma.assistantRegistrationCode.findUnique({
    where: { codeHash: hashCode(code) },
    select: { id: true, collection: { select: { id: true, name: true, ownerId: true } } },
  });
  if (!row) return null;

  const claimed = await prisma.assistantRegistrationCode.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;

  const { token } = await createAssistantToken(
    row.collection.ownerId,
    row.collection.id,
    REGISTERED_TOKEN_LABEL
  );

  return {
    token,
    collectionId: row.collection.id,
    collectionName: row.collection.name,
  };
}
