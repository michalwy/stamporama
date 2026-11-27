import type { NextRequest, NextResponse } from "next/server";
import {
  oauthError,
  oauthJson,
  oauthRateLimited,
  readOAuthForm,
  requestBaseUrl,
} from "@/lib/oauth-http";
import { OAuthTokenError, isMcpResource, mcpResourceUrl, tokenResponse } from "@/lib/oauth-rules";
import { exchangeAuthorizationCode, refreshOAuthTokens } from "@/lib/oauth-server";

// `POST /api/oauth/token` (#2715, ADR-0084) — the two grants this server gives: an authorization code
// with its PKCE verifier, and a refresh token, which is rotated on every use. Every client is a
// public one, so there is no client authentication to check: the code is bound to its client, its
// redirect URI and its verifier, and a refresh token to the client it was issued to.

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = oauthRateLimited(request, "token");
  if (limited) return limited;

  const form = await readOAuthForm(request);
  const baseUrl = requestBaseUrl(request);

  try {
    if (!isMcpResource(form.get("resource"), baseUrl)) {
      throw new OAuthTokenError(
        "invalid_target",
        `This server issues tokens for ${mcpResourceUrl(baseUrl)} only.`
      );
    }
    const clientId = form.get("client_id");
    if (!clientId) throw new OAuthTokenError("invalid_request", "`client_id` is required.");

    const grantType = form.get("grant_type");
    if (grantType === "authorization_code") {
      const code = form.get("code");
      const redirectUri = form.get("redirect_uri");
      if (!code || !redirectUri) {
        throw new OAuthTokenError("invalid_request", "`code` and `redirect_uri` are required.");
      }
      return oauthJson(
        tokenResponse(
          await exchangeAuthorizationCode({
            code,
            clientId,
            redirectUri,
            codeVerifier: form.get("code_verifier"),
          })
        )
      );
    }
    if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token");
      if (!refreshToken) {
        throw new OAuthTokenError("invalid_request", "`refresh_token` is required.");
      }
      return oauthJson(tokenResponse(await refreshOAuthTokens({ refreshToken, clientId })));
    }
    throw new OAuthTokenError(
      "unsupported_grant_type",
      "Use `authorization_code` or `refresh_token`."
    );
  } catch (error) {
    if (error instanceof OAuthTokenError) {
      return oauthError(error.error, error.description, error.status);
    }
    console.error("[api/oauth/token] unhandled", error);
    return oauthError("server_error", "The request failed inside Stamporama.", 500);
  }
}
