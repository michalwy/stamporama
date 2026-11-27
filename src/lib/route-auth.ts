import "server-only";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { auth } from "./auth";
import { verifyAssistantToken } from "./api-tokens";
import { findReachableCollection, verifyOAuthAccessToken } from "./oauth-server";
import { pinnedReach, type McpReach } from "./agent-api/mcp";
import { assertOperationScope, type ScopedOperation } from "./agent-api/scope";
import type { AssistantTokenScope } from "./assistant-token-scope";

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

/** Who a `/api/v1` call is acting as, on which collection, and how far its token reaches. */
export interface AgentApiCaller {
  readonly ownerId: string;
  readonly collectionId: string;
  /** `read` or `read_write` (#707). Checked by `assertAgentApiScope`, never by a handler. */
  readonly scope: AssistantTokenScope;
}

/**
 * Resolve the caller of a versioned agent API request (#706), or `null` when unauthorized.
 *
 * **Token only, and no collection id anywhere.** This is the sibling of `resolveCollectionOwner`
 * turned inside out: that one is handed a collection and asks whether the credential covers it,
 * because a screen route knows its collection from the URL. `/api/v1` deliberately carries no
 * collection id — an Assistant token is pinned to exactly one collection, so the collection is
 * derived *from* the credential, which removes a whole class of agent mistake and one value the
 * agent would otherwise have to obtain from somewhere.
 *
 * **A Better Auth session is not accepted here, and that is what makes the decision sound.** A
 * session covers every collection its user owns, so a session caller would leave the surface with no
 * way at all to say which collection it meant — the id would have to come back into the path, which
 * is the thing being removed. A browser that wants this surface mints a token like any other agent.
 *
 * The screen routes are untouched: they keep `resolveCollectionOwner` and keep accepting both.
 */
export async function resolveAgentApiCaller(request: NextRequest): Promise<AgentApiCaller | null> {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const verified = await verifyAssistantToken(match[1]);
  if (!verified) return null;
  return {
    ownerId: verified.ownerId,
    collectionId: verified.collectionId,
    scope: verified.scope,
  };
}

/**
 * Who an `/api/mcp` call is acting as, how far its credential reaches, and on which collections.
 *
 * The one difference from `AgentApiCaller`: a connected app's grant may reach several collections,
 * or all of the account's (#2728), so there is a `reach` where `/api/v1` has a `collectionId`.
 */
export interface McpCaller {
  readonly ownerId: string;
  readonly scope: AssistantTokenScope;
  readonly reach: McpReach;
}

/** How a request to `/api/mcp` stood with its credential: accepted, absent, or sent and refused. */
export type McpCallerResolution =
  | { readonly kind: "caller"; readonly caller: McpCaller }
  | { readonly kind: "missing" }
  | { readonly kind: "refused" };

/**
 * Resolve the caller of an MCP request (#2715): an Assistant token as on `/api/v1`, **or** an access
 * token this instance's OAuth authorization server issued to a connected app (ADR-0084).
 *
 * Both verify to the same three facts — whose account, which collections, how far it reaches — so
 * everything behind this line is one path: `assertAgentApiScope` is still the one place a scope is
 * checked, and the collection a call acts on is still taken from the credential. An Assistant token
 * reaches the one collection it is pinned to; a grant reaches what the collector chose, and where
 * that is more than one the caller names which **among them** (`resolveReachCollection`, #2728).
 * The two credentials are told apart by their prefixes, so neither lookup is tried with the other's.
 *
 * **`/api/v1` does not take the OAuth token, deliberately.** It was issued for one resource, the MCP
 * endpoint, and a token honoured somewhere it was not issued for is the thing audience binding
 * exists to prevent. `resolveAgentApiCaller` above is untouched.
 *
 * A credential that was sent and refused is told apart from one that was never sent, because the
 * `401` says so: `invalid_token` is what makes a client refresh instead of giving up.
 */
export async function resolveMcpCaller(request: NextRequest): Promise<McpCallerResolution> {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return { kind: "missing" };

  const assistant = await verifyAssistantToken(match[1]);
  if (assistant) {
    const collection = await findReachableCollection(assistant.collectionId);
    if (!collection) return { kind: "refused" };
    return {
      kind: "caller",
      caller: {
        ownerId: assistant.ownerId,
        scope: assistant.scope,
        reach: pinnedReach(collection),
      },
    };
  }
  const connected = await verifyOAuthAccessToken(match[1]);
  if (connected) {
    return {
      kind: "caller",
      caller: {
        ownerId: connected.ownerId,
        scope: connected.scope,
        reach: { all: connected.allCollections, collections: connected.collections },
      },
    };
  }
  return { kind: "refused" };
}

/**
 * Refuse a caller whose token does not reach far enough for the operation it picked (#707).
 *
 * **This is where the two halves meet, and it is here rather than in a handler on purpose.** The
 * scope is the token's — `resolveAgentApiCaller` above derives it from the credential, the same way
 * it derives the collection — and `writes` is the operation's, declared once in the registry. A
 * handler checking its own scope would be the authorization living in the caller, which is the
 * thing this file exists to prevent; and an operation that writes and forgets to check would be a
 * security defect with no test that could see it.
 *
 * The dispatcher calls this after it has resolved the operation and before it parses a parameter.
 * Ordering both ways round: a `read` token is already authenticated, so nothing is leaked by
 * telling it the operation exists — and there is no reason to hand it parameter feedback for a call
 * it may not make.
 *
 * The decision and the sentence are in `agent-api/scope.ts`, on the pure side, so a unit test can
 * hold them; this function is the enforcement point and nothing else.
 */
export function assertAgentApiScope(
  caller: Pick<AgentApiCaller, "scope">,
  operation: ScopedOperation
): void {
  assertOperationScope(caller.scope, operation);
}
