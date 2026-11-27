import type { NextRequest, NextResponse } from "next/server";
import { oauthError, oauthJson, oauthRateLimited } from "@/lib/oauth-http";
import { checkClientRegistration, clientRegistrationResponse } from "@/lib/oauth-rules";
import { registerOAuthClient } from "@/lib/oauth-server";

// `POST /api/oauth/register` (#2715, ADR-0084) — dynamic client registration, RFC 7591. An app
// introduces itself: a name and the addresses it may be sent back to. **Registering grants nothing**;
// the row can do nothing until a signed-in collector allows it on the consent screen. What a
// registration must say is `checkClientRegistration`'s, on the pure side.

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = oauthRateLimited(request, "register");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError("invalid_client_metadata", "Send the client metadata as a JSON object.");
  }
  const checked = checkClientRegistration(body);
  if (!checked.ok) return oauthError(checked.error, checked.description);

  const client = await registerOAuthClient(checked.registration);
  return oauthJson(clientRegistrationResponse(client), 201);
}
