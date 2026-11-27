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
  createAuthorizationCode,
  findOAuthClient,
  revokeOAuthGrant,
} from "@/lib/oauth-server";
import { isAssistantTokenScope } from "@/lib/assistant-token-scope";

// Server actions of the OAuth authorization server (#2715, ADR-0084): the collector's answer on the
// consent screen, and disconnecting an app from Settings → Assistant & API.

export type OAuthDecisionState =
  /** Where the browser goes next: the app's own redirect URI, carrying a code or a refusal. */
  | { status: "redirect"; location: string }
  | { status: "error"; message: string };

export interface OAuthDecision {
  allow: boolean;
  collectionId: string;
  scope: string;
}

/**
 * Record the collector's answer and say where to send the browser.
 *
 * **Nothing the screen showed is trusted on the way back.** The request's parameters come from the
 * form, so they are checked again from the top — the client looked up, its redirect URI matched, the
 * PKCE challenge read — exactly as the page did before drawing itself; the collection is checked
 * against the session's account by `createAuthorizationCode`; and the scope must be one the request
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
      collectionId: decision.collectionId,
      scope: decision.scope,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
    });
    return { status: "redirect", location: approvedRedirect(request, code, baseUrl) };
  } catch {
    return { status: "error", message: "Choose one of your collections." };
  }
}

export type OAuthGrantActionState = { status: "success" } | { status: "error"; message: string };

/** Disconnect an app from this collection. Its tokens stop working at once. */
export async function revokeOAuthGrantAction(
  collectionId: string,
  grantId: string
): Promise<OAuthGrantActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  try {
    await revokeOAuthGrant(session.user.id, collectionId, grantId);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to disconnect the app. Please try again." };
  }
}
