import { NextRequest, NextResponse } from "next/server";
import { assertAgentApiScope, resolveAgentApiCaller } from "@/lib/route-auth";
import { errorResponseBody, invalidRequest, methodNotAllowed, unauthorized, unknownOperation } from "@/lib/agent-api/errors";
import { parseParameters } from "@/lib/agent-api/params";
import { allowedMethods, matchPath, pickMethod } from "@/lib/agent-api/registry";
import { LIST_PARAMETERS } from "@/lib/agent-api/list";
import type { HttpMethod } from "@/lib/agent-api/types";

// The whole of `/api/v1` (#706) — one dispatcher over the operation registry, rather than a route
// file per operation.
//
// That is the point of the registry and not a shortcut: an operation is a declaration in one array,
// and the REST surface, the OpenAPI document and #709's MCP tool list are all generated from it. A
// route file per operation would be the second place to edit that this design exists to remove.
//
// This is **beside** the screen API, never over it. The routes under
// `/api/collections/[collectionId]/…` are shaped for TanStack Query and for one particular table,
// and they stay free to change whenever the UI does. `/api/v1` is a contract: once published it only
// ever grows.
//
// `/api/v1/openapi.json` is a static segment and Next resolves it before this catch-all, so the
// document is served by its own route and never reaches the registry lookup.

/**
 * Read the request body as a JSON object, or `undefined` when there is none.
 *
 * An unreadable body is a request error with a sentence, not a 500: an agent that sent a trailing
 * comma should be told to send valid JSON, and it is the sort of mistake a model makes and can fix.
 */
async function readBody(request: NextRequest): Promise<unknown> {
  const raw = await request.text();
  if (raw.trim().length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw invalidRequest("The request body is not valid JSON. Send a JSON object and retry.");
  }
}

async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
  method: HttpMethod
): Promise<NextResponse> {
  try {
    const caller = await resolveAgentApiCaller(request);
    if (!caller) {
      // Before the lookup: whether a path exists is information, and an unauthenticated caller gets
      // none of it.
      throw unauthorized(
        "Send an Assistant token as `Authorization: Bearer stmpa_…`. Mint one in Settings → Assistant."
      );
    }

    const { path } = await context.params;
    const match = matchPath(path);
    if (match.candidates.length === 0) {
      throw unknownOperation(
        `No operation is bound to /api/v1/${path.join("/")}. Fetch /api/v1/openapi.json for the operations this instance offers.`
      );
    }

    const picked = pickMethod(match, method);
    if (!picked) {
      const allowed = allowedMethods(match);
      throw methodNotAllowed(
        `/api/v1/${path.join("/")} does not accept ${method}. Retry with ${allowed.join(" or ")}.`,
        allowed
      );
    }

    const { operation, pathValues } = picked;

    // #707: a `read` token is refused here, on the operation's own `writes` declaration. After the
    // lookup, because the answer depends on which operation was picked; before the parsing, because
    // there is no point validating parameters for a call that is not going to be made.
    assertAgentApiScope(caller, operation);

    const specs =
      operation.result.kind === "list"
        ? [...operation.parameters, ...LIST_PARAMETERS]
        : operation.parameters;
    const params = parseParameters(specs, {
      path: pathValues,
      query: request.nextUrl.searchParams,
      body: method === "GET" ? undefined : await readBody(request),
    });

    const result = await operation.handler(
      { ownerId: caller.ownerId, collectionId: caller.collectionId },
      params
    );
    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = errorResponseBody(error);
    if (status === 500) console.error("[api/v1] unhandled", error);
    return NextResponse.json(body, { status });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(request, context, "GET");
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(request, context, "POST");
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(request, context, "PATCH");
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handle(request, context, "DELETE");
}
