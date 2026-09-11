import { NextRequest, NextResponse } from "next/server";
import { assertAgentApiScope, resolveAgentApiCaller } from "@/lib/route-auth";
import { errorResponseBody, unauthorized } from "@/lib/agent-api/errors";
import {
  JSON_RPC,
  MCP_PROTOCOL_VERSION,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  handleMcpMessage,
  isSupportedProtocolVersion,
  jsonRpcErrorResponse,
  readRequestId,
} from "@/lib/agent-api/mcp";
import { OPERATIONS } from "@/lib/agent-api/registry";
import { getAppVersion } from "@/lib/version";

// `POST /api/mcp` (#709) — the remote MCP endpoint, served by the app itself.
//
// **Nothing extra runs beside the existing container.** An MCP server here is one route handler
// over the same registry `/api/v1` dispatches: the tools are generated from `OPERATIONS`, the
// credential is the same `Bearer stmpa_…` token, the collection is pinned the same way, and the
// scope check is the same function. There is no second credential and nothing second to revoke.
//
// **This file is the transport and nothing else.** Every protocol decision — the handshake, the
// tool schemas, which failures are JSON-RPC errors and which are tool errors — is in the pure
// `src/lib/agent-api/mcp.ts`, where `pnpm test:unit` can hold it. What is here is the part that
// genuinely needs a request: reading the token, and turning an outcome into a `Response`.
//
// **Streamable HTTP, stateless.** One `POST` carrying one JSON-RPC message, answered with one
// JSON-RPC message. A session id is something a server **may** assign and this one does not: there
// is no session state to key, because the tool list is compiled into the build and every call is
// authorised from its own header. `GET` and `DELETE` are refused with `405`, which is the answer
// the specification names for a server offering no SSE stream and for one that does not let a
// client terminate a session — so a client that would like either is told plainly rather than left
// waiting on a channel that never sends anything.
//
// **One requirement of that transport is deliberately not implemented, and it is a `MUST`.** The
// specification tells a Streamable HTTP server to validate the `Origin` header against DNS
// rebinding. **The attack it prevents cannot reach this endpoint**, and the reason is structural
// rather than a judgement about likelihood: rebinding buys an attacker the browser's *ambient*
// authority, and there is none here — every call needs an `Authorization: Bearer stmpa_…` header
// that a page cannot obtain, and a cross-origin request carrying one is a preflighted request this
// route answers no CORS headers to, so the browser never sends it. An `Origin` check would refuse
// requests that are already refused, while breaking the ordinary case of a client that legitimately
// sets one. It is written down rather than silently skipped, because a `MUST` that a later reader
// finds missing should read as a decision and not as an oversight (ADR-0051).

/** The one place the endpoint's own 401 is spelled, so it matches `/api/v1`'s word for word. */
function unauthenticated(): NextResponse {
  const { status, body } = errorResponseBody(
    unauthorized(
      "Send an Assistant token as `Authorization: Bearer stmpa_…`. Mint one in Settings → Assistant."
    )
  );
  return NextResponse.json(body, {
    status,
    // The scheme, so a client that holds a credential and sent it wrongly can tell that from one it
    // does not hold at all. There is no OAuth metadata to point at: this surface takes the token the
    // collector minted, and nothing here can issue one.
    headers: { "WWW-Authenticate": "Bearer" },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  const caller = await resolveAgentApiCaller(request);
  if (!caller) return unauthenticated();

  const declaredRevision = request.headers.get("MCP-Protocol-Version");
  if (declaredRevision !== null && !isSupportedProtocolVersion(declaredRevision)) {
    // **The specification requires this `400`, and it is also this build's staleness alarm.** A
    // hand-rolled implementation of a moving specification drifts silently (ADR-0051); the first
    // client newer than this build is the thing that notices, so it says so in the log here rather
    // than failing for a reason nobody can see. A client sending **no** header is not refused —
    // the specification says to assume `2025-03-26` for it, which this build speaks.
    console.warn(
      `[api/mcp] a client asked for MCP revision ${declaredRevision}; this build speaks ${SUPPORTED_MCP_PROTOCOL_VERSIONS.join(", ")}. If this repeats, the implementation is behind the specification — see ADR-0051.`
    );
    return NextResponse.json(
      jsonRpcErrorResponse(
        null,
        JSON_RPC.invalidRequest,
        `This instance does not speak MCP revision ${declaredRevision}. It speaks ${SUPPORTED_MCP_PROTOCOL_VERSIONS.join(", ")}; negotiate one of those at initialize.`,
        { supported: SUPPORTED_MCP_PROTOCOL_VERSIONS, requested: declaredRevision, latest: MCP_PROTOCOL_VERSION }
      ),
      { status: 400 }
    );
  }

  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return NextResponse.json(
      jsonRpcErrorResponse(
        null,
        JSON_RPC.parseError,
        "The request body is not valid JSON. Send one JSON-RPC 2.0 message per request."
      )
    );
  }

  try {
    const outcome = await handleMcpMessage(message, {
      operations: OPERATIONS,
      appVersion: getAppVersion(),
      context: { ownerId: caller.ownerId, collectionId: caller.collectionId },
      // #707's enforcement point, bound to this caller. The wrapper reuses it rather than deriving
      // a scope of its own — one place decides what a token may do, and this is not it.
      //
      // **This line is covered end to end since #711, and what it used to say is worth keeping.**
      // It read: *this one line is not covered end to end, and that is measured rather than assumed
      // — replacing it with a no-op and running `tests/integration/agent-api-mcp.test.ts` leaves all
      // twelve green, because **nothing in `OPERATIONS` writes**: there is no request that could be
      // refused.* That was true when it was written and is quoted rather than deleted, because it
      // will go on arriving in anything copied from it.
      //
      // #711 put three writing operations in the registry, so a `read` token calling `draft_offer`
      // through this wrapper is now refused by **this** binding and nothing else — asserted in
      // `tests/integration/agent-api-offers.test.ts`, *a read token is refused on the wire*, which
      // is deliberately in that file rather than here: the request it has to make needs a real
      // offer and a real platform, which is that suite's fixture and not this one's.
      assertScope: (operation) => assertAgentApiScope(caller, operation),
    });

    // A notification gets no reply at all, which is what the specification asks for and what
    // `notifications/initialized` needs: a body here would be a response to a message that carried
    // no id to answer.
    if (outcome.kind === "accepted") return new Response(null, { status: 202 });

    // A JSON-RPC error rides in the body with a `200`. The HTTP status describes the transport, and
    // the transport worked.
    return NextResponse.json(outcome.body);
  } catch (error) {
    // Anything that reaches here is a defect on our side. Its message is deliberately not relayed —
    // an internal message is written for a maintainer reading a log, and putting it in front of an
    // agent spends context on a sentence it cannot act on (#706).
    console.error("[api/mcp] unhandled", error);
    return NextResponse.json(
      jsonRpcErrorResponse(
        readRequestId(message),
        JSON_RPC.internalError,
        "The request failed inside Stamporama. Retry once; if it fails again, report it."
      )
    );
  }
}

/** No server-initiated stream, so there is nothing for a `GET` to open. */
export async function GET(): Promise<NextResponse> {
  return methodNotAllowed("GET");
}

/** No session to terminate — this endpoint keeps none. */
export async function DELETE(): Promise<NextResponse> {
  return methodNotAllowed("DELETE");
}

function methodNotAllowed(method: string): NextResponse {
  return NextResponse.json(
    jsonRpcErrorResponse(
      null,
      JSON_RPC.invalidRequest,
      `This MCP endpoint accepts POST only; it does not offer a ${method} stream or a session to terminate. Send each JSON-RPC message as its own POST.`
    ),
    { status: 405, headers: { Allow: "POST" } }
  );
}
