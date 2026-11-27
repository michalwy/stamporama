import type { NextRequest, NextResponse } from "next/server";
import { oauthJson, oauthRateLimited, readOAuthForm } from "@/lib/oauth-http";
import { revokeOAuthToken } from "@/lib/oauth-server";

// `POST /api/oauth/revoke` (#2715, ADR-0084) — RFC 7009: an app disconnecting itself. Either of a
// grant's tokens ends the whole grant. The answer is `200` whether or not the token was known, as the
// RFC asks: holding the token is the authority to revoke it, and an unknown one is already revoked.

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = oauthRateLimited(request, "revoke");
  if (limited) return limited;

  const token = (await readOAuthForm(request)).get("token");
  if (token) await revokeOAuthToken(token);
  return oauthJson({});
}
