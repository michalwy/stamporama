"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { signInPath } from "@/lib/sign-in-redirect";
import { headersBaseUrl } from "@/lib/oauth-http";
import {
  approvedRedirect,
  checkAuthorizationRequest,
  deniedRedirect,
  type AuthorizationParams,
} from "@/lib/oauth-rules";
import {
  CollectionAccessError,
  createAuthorizationCode,
  findOAuthClient,
  revokeOAuthGrant,
  updateOAuthGrantAccess,
} from "@/lib/oauth-server";
import { isAssistantTokenScope } from "@/lib/assistant-token-scope";

// Server actions of the OAuth authorization server (#2715, ADR-0084): the collector's answer on the
// consent screen, and — from Settings → Assistant & API — changing which collections a connected app
// reaches (#2728) and disconnecting it.

export type OAuthDecisionState =
  /** Where the browser goes next: the app's own redirect URI, carrying a code or a refusal. */
  | { status: "redirect"; location: string }
  | { status: "error"; message: string };

/** Which collections: all of the account's, including ones made later, or the ticked ones (#2728). */
export interface OAuthCollectionChoice {
  all: boolean;
  collectionIds: string[];
}

export interface OAuthDecision {
  allow: boolean;
  access: OAuthCollectionChoice;
  scope: string;
}

/**
 * Record the collector's answer and say where to send the browser.
 *
 * **Nothing the screen showed is trusted on the way back.** The request's parameters come from the
 * form, so they are checked again from the top — the client looked up, its redirect URI matched, the
 * PKCE challenge read — exactly as the page did before drawing itself; the chosen collections are
 * checked against the session's account by `createAuthorizationCode`; and the scope must be one the request
 * left on offer. The location is returned rather than redirected to, because it is on another site
 * and the form sends the browser there itself.
 */
export async function decideOAuthAuthorizationAction(
  params: AuthorizationParams,
  decision: OAuthDecision
): Promise<OAuthDecisionState> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect(await signInPath());

  const baseUrl = headersBaseUrl(requestHeaders);
  const client = await findOAuthClient(params.client_id ?? "");
  const checked = checkAuthorizationRequest(params, client, baseUrl);
  if (checked.kind === "page") return { status: "error", message: checked.message };
  if (checked.kind === "redirect") return { status: "redirect", location: checked.location };

  const { request } = checked;
  if (!decision.allow) return { status: "redirect", location: deniedRedirect(request, baseUrl) };

  if (!isAssistantTokenScope(decision.scope) || !request.offeredScopes.includes(decision.scope)) {
    return { status: "error", message: "Choose what the app may do." };
  }
  try {
    const code = await createAuthorizationCode({
      clientId: request.clientId,
      userId: session.user.id,
      access: decision.access,
      scope: decision.scope,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
    });
    return { status: "redirect", location: approvedRedirect(request, code, baseUrl) };
  } catch (error) {
    if (error instanceof CollectionAccessError) return { status: "error", message: error.message };
    return { status: "error", message: "The connection could not be made. Please try again." };
  }
}

export type OAuthGrantActionState = { status: "success" } | { status: "error"; message: string };

/** Change which collections a connected app reaches (#2728). Its next call sees the change. */
export async function updateOAuthGrantAccessAction(
  grantId: string,
  access: OAuthCollectionChoice
): Promise<OAuthGrantActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  try {
    await updateOAuthGrantAccess(session.user.id, grantId, access);
    return { status: "success" };
  } catch (error) {
    if (error instanceof CollectionAccessError) return { status: "error", message: error.message };
    return { status: "error", message: "Failed to change the app's access. Please try again." };
  }
}

/** Disconnect an app from the account. Its tokens stop working at once. */
export async function revokeOAuthGrantAction(grantId: string): Promise<OAuthGrantActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  try {
    await revokeOAuthGrant(session.user.id, grantId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to disconnect the app. Please try again." };
  }
}
