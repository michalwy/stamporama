import { NextRequest, NextResponse } from "next/server";
import { resolveAgentApiCaller } from "@/lib/route-auth";
import { buildOpenApiDocument } from "@/lib/agent-api/openapi";
import { OPERATIONS } from "@/lib/agent-api/registry";
import { errorResponseBody, unauthorized } from "@/lib/agent-api/errors";
import { getAppVersion } from "@/lib/version";

// `GET /api/v1/openapi.json` (#706) — the agent API described, generated from the operation
// registry and from nothing else.
//
// A static segment, so Next resolves it before the `[...path]` catch-all beside it and the document
// never goes through the registry lookup.
//
// **It requires the same token as every operation.** The document contains no collection data — it
// is the same bytes for every caller of a given build — so this is not about secrecy of content. It
// is that this is a self-hosted single-user app whose instance is often reachable from the internet,
// and publishing the list of things a valid token could do buys an unauthenticated reader something
// and buys the collector nothing: the agent that needs the document already holds a token.

export async function GET(request: NextRequest) {
  try {
    const caller = await resolveAgentApiCaller(request);
    if (!caller) {
      throw unauthorized(
        "Send an Assistant token as `Authorization: Bearer stmpa_…`. Mint one in Settings → Assistant."
      );
    }
    return NextResponse.json(
      buildOpenApiDocument(OPERATIONS, { appVersion: getAppVersion() })
    );
  } catch (error) {
    const { status, body } = errorResponseBody(error);
    if (status === 500) console.error("[api/v1/openapi.json] unhandled", error);
    return NextResponse.json(body, { status });
  }
}
