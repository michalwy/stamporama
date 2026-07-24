import "server-only";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { auth } from "./auth";
import { verifyAssistantToken } from "./api-tokens";

// Shared authorization for collection API routes that both a signed-in user (Better Auth session)
// and the Stamporama Assistant extension (bearer token, #253) may call. The extension runs
// cross-site on colnect.com, where the session cookie is not sent, so it presents an
// `Authorization: Bearer <token>` header instead.

/**
 * Resolve the owner id authorized to act on `collectionId` for this request, or `null` when
 * unauthorized. A Better Auth session wins when present; otherwise a valid Assistant bearer token is
 * accepted **only** when it was issued for this exact collection. Session callers still have their
 * ownership verified downstream by the domain layer (`assertCollectionOwner`); token callers are
 * pinned to their collection here.
 */
export async function resolveCollectionOwner(
  request: NextRequest,
  collectionId: string
): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) return session.user.id;

  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const verified = await verifyAssistantToken(match[1]);
  if (!verified || verified.collectionId !== collectionId) return null;
  return verified.ownerId;
}
