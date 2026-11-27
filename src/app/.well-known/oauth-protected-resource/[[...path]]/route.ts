import { NextResponse, type NextRequest } from "next/server";
import { requestBaseUrl } from "@/lib/oauth-http";
import { MCP_RESOURCE_PATH, protectedResourceMetadata } from "@/lib/oauth-rules";

// `GET /.well-known/oauth-protected-resource[/api/mcp]` (#2715, ADR-0084) — RFC 9728: what protects
// the MCP endpoint and where a token for it is issued. A client reaches it from the
// `resource_metadata` in `/api/mcp`'s `401`, or by constructing the address itself; the root form
// and the form with the resource's path inserted answer the same document, because the instance has
// one protected resource. Any other path under it names a resource that does not exist here.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
): Promise<NextResponse> {
  const suffix = `/${((await params).path ?? []).join("/")}`;
  if (suffix !== "/" && suffix !== MCP_RESOURCE_PATH) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(protectedResourceMetadata(requestBaseUrl(request)), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
