import { NextResponse, type NextRequest } from "next/server";
import { requestBaseUrl } from "@/lib/oauth-http";
import { authorizationServerMetadata } from "@/lib/oauth-rules";

// `GET /.well-known/oauth-authorization-server` (#2715, ADR-0084) — RFC 8414: the authorization
// server's endpoints and what it supports. The issuer is the instance's own base address, which has
// no path, so this is the only form of the address there is.

export async function GET(request: NextRequest): Promise<NextResponse> {
  return NextResponse.json(authorizationServerMetadata(requestBaseUrl(request)), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
